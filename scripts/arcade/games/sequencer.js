"use strict";

import { clamp, mix, hash, ambient, difficulty, plane_step } from '../field.js'
import { text, wrap, hud, hud_bottom } from '../ui.js'

// Sequencer: notes flow down four lanes of a highway, the pixel field laid
// in perspective, toward a hit line. Tap a lane as its note crosses the line
// to play it; the melody is an 8-bit chip tune, and a missed note is missing
// from the song. A triangle bass keeps the beat either way.
//
// - Lanes follow pitch, low to high, left to right.
// - Five lives, one lost per missed note and none won back. A stray tap only
//   breaks the streak. Hit streaks multiply points up to x4, and the lane
//   rails glow with it.
// - Hits and the beat send ripples across the floor.
// - Songs play on and on, each a little faster with notes arriving sooner,
//   along an ease-in-out difficulty curve that levels off.

const lanes = 4
// Six cells per lane: a rail and five across the lane.
const cell = 1 / 6
const per_lane = 6
const z_near = 1
const z_hit = 1.5
const z_far = 14
// Note length and hit line, in rows of the plane.
const note_rows = 3
const great_window = 0.06
const good_window = 0.13
const ramp_seconds = 150
const tier_seconds = 15
const max_lives = 5
const best_key = 'best'

// ADI hues, one per lane.
const lane_colors = ['#92befc', '#d4adf0', '#ffa3ab', '#f2994a']

const colors = {
  text: '#e9eef5',
  muted: 'rgba(233, 238, 245, .62)',
  accent: '#62c5dd',
  danger: '#ff6b6b',
  gold: '#ffc36b',
}

// Public domain melodies: pitch[:beats], a quarter note being one beat.
const songs = [
  {
    name: 'Ode to Joy',
    bpm: 120,
    bass: ['C3', 'G2'],
    notes: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2 ' +
      'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:0.5 C4:2',
  },
  {
    name: 'Twinkle, Twinkle',
    bpm: 112,
    bass: ['C3', 'G2'],
    notes: 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2 ' +
      'G4 G4 F4 F4 E4 E4 D4:2 G4 G4 F4 F4 E4 E4 D4:2 ' +
      'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2',
  },
  {
    name: 'Frère Jacques',
    bpm: 120,
    bass: ['C3', 'G2'],
    notes: 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:2 E4 F4 G4:2 ' +
      'G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4 C4 G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4 C4 ' +
      'C4 G3 C4:2 C4 G3 C4:2',
  },
  {
    name: 'Korobeiniki',
    bpm: 132,
    bass: ['A2', 'E3'],
    notes: 'E5 B4:0.5 C5:0.5 D5 C5:0.5 B4:0.5 A4 A4:0.5 C5:0.5 E5 D5:0.5 C5:0.5 ' +
      'B4:1.5 C5:0.5 D5 E5 C5 A4 A4:2 ' +
      'D5:1.5 F5:0.5 A5 G5:0.5 F5:0.5 E5:1.5 C5:0.5 E5 D5:0.5 C5:0.5 ' +
      'B4 B4:0.5 C5:0.5 D5 E5 C5 A4 A4:2',
  },
]

const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const midi_of = name => {
  const [, letter, accidental, octave] = /^([A-G])([#b]?)(\d)$/.exec(name)
  return semitones[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + (Number(octave) + 1) * 12
}
const freq_of = midi => 440 * Math.pow(2, (midi - 69) / 12)

const lane_keys = {
  d: 0, f: 1, j: 2, k: 3,
  1: 0, 2: 1, 3: 2, 4: 3,
  ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3,
}

// A tiny chip: a 25% duty pulse lead, like the NES, and a triangle bass, both
// with hard, stepped envelopes.
class Chip {
  constructor () {
    const Context = window.AudioContext ?? window.webkitAudioContext
    if (!Context) return
    this.ctx = new Context()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.2
    this.master.connect(this.ctx.destination)

    const harmonics = 32
    const real = new Float32Array(harmonics)
    const imag = new Float32Array(harmonics)
    for (let k = 1; k < harmonics; k++) real[k] = 2 / (k * Math.PI) * Math.sin(k * Math.PI * 0.25)
    this.pulse = this.ctx.createPeriodicWave(real, imag)
  }

  resume () {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  play (freq, duration, { delay = 0, bass = false } = {}) {
    if (!this.ctx) return
    const start = this.ctx.currentTime + delay
    const end = start + duration
    const volume = bass ? 0.55 : 0.32

    const osc = this.ctx.createOscillator()
    if (bass) osc.type = 'triangle'
    else osc.setPeriodicWave(this.pulse)
    osc.frequency.value = freq

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(volume, start)
    gain.gain.setValueAtTime(volume * 0.6, start + Math.min(0.05, duration * 0.3))
    gain.gain.setValueAtTime(volume * 0.6, end - 0.02)
    gain.gain.linearRampToValueAtTime(0, end)

    osc.connect(gain).connect(this.master)
    osc.start(start)
    osc.stop(end + 0.02)
  }

  close () {
    this.ctx?.close().catch(() => {})
  }
}

class Sequencer {
  constructor (stage) {
    this.stage = stage
    this.store = stage.storage('sequencer')
    this.best = Number(this.store.get(best_key, 0)) || 0
    this.time = 0
    this.state = 'ready'
    this.state_time = 0
    this.travel = 0
    this.chip = null
    this.reset()
  }

  get tier () { return 1 + Math.floor(this.elapsed / tier_seconds) }
  get ramp () { return difficulty(this.elapsed, ramp_seconds) }
  // Seconds a note takes from the horizon to the hit line.
  get lead () { return mix(3, 1.5, this.ramp) }
  get multiplier () { return Math.min(4, 1 + Math.floor(this.streak / 8)) }

  reset () {
    this.score = 0
    this.elapsed = 0
    this.level = 1
    this.clock = 0
    this.lives = max_lives
    this.ripples = []
    this.streak = 0
    this.notes = []
    this.bass = []
    this.song = Math.floor(Math.random() * songs.length)
    // The first song starts once its first note has travelled the highway.
    this.next_song = 0.6 + this.lead
    this.pressed = new Array(lanes).fill(-Infinity)
    this.hits = new Array(lanes).fill(-Infinity)
    this.misses = new Array(lanes).fill(-Infinity)
    this.flash = 0
    this.best_beaten = false
  }

  // Called from a tap or key press, so audio may start.
  start () {
    this.chip ??= new Chip()
    this.chip.resume()
    this.reset()
    this.state = 'playing'
    this.state_time = 0
  }

  // -- Songs ----------------------------------------------------------------

  // Lays a song out from `start` (when its first note crosses the line),
  // faster along the difficulty curve, and returns when it ends.
  queue (song, start) {
    const beat = 60 / (song.bpm * mix(0.75, 1.35, this.ramp))
    const lead = this.lead
    const parsed = song.notes.split(' ').map(entry => {
      const [pitch, beats] = entry.split(':')
      return { midi: midi_of(pitch), beats: Number(beats ?? 1) }
    })
    const pitches = [...new Set(parsed.map(note => note.midi))].sort((a, b) => a - b)

    let t = start
    for (const { midi, beats } of parsed) {
      const lane = Math.min(lanes - 1, Math.floor(pitches.indexOf(midi) * lanes / pitches.length))
      this.notes.push({ t, lane, freq: freq_of(midi), duration: beats * beat, lead, hit: false, missed: false })
      t += beats * beat
    }
    const bass = song.bass.map(pitch => freq_of(midi_of(pitch)))
    for (let b = start, k = 0; b < t - beat * 0.5; b += beat, k++) {
      this.bass.push({ t: b, freq: bass[k % 2], duration: beat * 0.8 })
    }
    return t + beat * 2
  }

  // -- Input ----------------------------------------------------------------

  // The screen is split in four columns, one per lane, for fingers.
  pointer (type, x) {
    if (type !== 'down') return
    if (this.state !== 'playing') {
      this.try_start()
      return
    }
    this.press(clamp(Math.floor(x / this.stage.width * lanes), 0, lanes - 1))
  }

  key (type, event) {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const lane = lane_keys[key]
    if (lane === undefined && key !== ' ' && key !== 'Enter') return false
    if (type !== 'down' || event.repeat) return true
    if (this.state !== 'playing') this.try_start()
    else if (lane !== undefined) this.press(lane)
    return true
  }

  try_start () {
    // Ignore presses right after losing, so frantic last taps don't skip the
    // score screen.
    if (this.state === 'over' && this.state_time < 0.9) return
    this.start()
  }

  press (lane) {
    this.pressed[lane] = this.time
    let best = null
    let best_error = good_window
    for (const note of this.notes) {
      if (note.lane !== lane || note.hit || note.missed) continue
      const error = Math.abs(note.t - this.clock)
      if (error < best_error) {
        best = note
        best_error = error
      }
    }

    if (!best) {
      // A stray tap breaks the streak.
      this.streak = 0
      return
    }

    best.hit = true
    this.hits[lane] = this.time
    this.chip?.play(best.freq, Math.max(0.08, best.duration * 0.92))
    this.streak += 1
    const great = best_error < great_window
    this.score += 10 * this.tier * this.multiplier * (great ? 2 : 1)
    this.ripples.push({ u: lane - lanes / 2 + 0.5, z: z_hit, age: 0, life: 1, speed: 4, strength: great ? 0.7 : 0.5 })
  }

  game_over () {
    this.state = 'over'
    this.state_time = 0
    this.bass = []
    if (this.score > this.best) {
      this.best = this.score
      this.best_beaten = true
      this.store.set(best_key, this.best)
    }
  }

  // -- Simulation -----------------------------------------------------------

  update (dt) {
    this.time += dt
    this.state_time += dt
    this.flash = Math.max(0, this.flash - dt * 3)
    this.travel += dt * (z_far - z_hit) / this.lead * (this.state === 'playing' ? 1 : 0.4)

    if (this.state !== 'playing') return

    this.elapsed += dt
    this.clock += dt
    this.level = this.tier

    if (this.next_song - this.clock < 3) {
      this.next_song = this.queue(songs[this.song % songs.length], this.next_song)
      this.song += 1
    }

    // The bass keeps time whatever you hit.
    while (this.bass.length && this.bass[0].t <= this.clock + 0.05) {
      const beat = this.bass.shift()
      const delay = Math.max(0, beat.t - this.clock)
      this.chip?.play(beat.freq, beat.duration, { delay, bass: true })
      this.ripples.push({ u: 0, z: z_hit, age: -delay, life: 1.4, speed: 6, strength: 0.22 })
    }

    for (const note of this.notes) {
      if (note.hit || note.missed || this.clock - note.t <= good_window) continue
      note.missed = true
      this.misses[note.lane] = this.time
      this.streak = 0
      this.flash = 1
      this.lives -= 1
      if (this.lives <= 0) {
        this.game_over()
        break
      }
    }

    for (const ripple of this.ripples) ripple.age += dt
    this.ripples = this.ripples.filter(ripple => ripple.age < ripple.life)

    // Drop notes once they are past the bottom of the screen.
    this.notes = this.notes.filter(note => this.depth(note) > z_near - 0.5)
  }

  depth (note) {
    return z_hit + (note.t - this.clock) / note.lead * (z_far - z_hit)
  }

  // -- Rendering ------------------------------------------------------------

  render (ctx) {
    this.draw_field(ctx)
    this.draw_hud(ctx)
    if (this.state !== 'playing') this.draw_screen(ctx, this.stage.width, this.stage.height)
  }

  draw_field (ctx) {
    const { width, height } = this.stage
    const time = this.time
    const travel = this.travel
    const flicker = Math.floor(time * 16)
    const rail = 0.5 + (this.multiplier - 1) * 0.15
    const layout = this.layout()
    // Depth spans scale with depth, so they cover the same rows anywhere.
    const step = plane_step(layout)
    const note_half = step * note_rows / 2
    const line_half = step / 2

    const notes = []
    for (const note of this.notes) {
      if (note.hit) continue
      const z = this.depth(note)
      if (z < z_near * (1 - note_half) || z > z_far) continue
      notes.push({ z, lane: note.lane, missed: note.missed })
    }
    const pressed = this.pressed.map(t => clamp(1 - (time - t) / 0.15))
    const hits = this.hits.map(t => clamp(1 - (time - t) / 0.3))
    const misses = this.misses.map(t => clamp(1 - (time - t) / 0.4))
    const ripples = this.ripples

    this.stage.field.draw_plane(ctx, width, height, (u, z, column, row, out) => {
      const fog = mix(0.35, 1, clamp(1 - (z - z_near) / (z_far - z_near)))
      const road = u > -2.01 && u < 2.01
      const edge = road && column % per_lane === 0
      const lane = Math.min(lanes - 1, Math.floor(u + 2))

      const wave = ambient(u * 0.35, (z + travel) * 0.35, time * 0.5)
      // The road is a lit floor; around it the field fades out.
      let level = road ? 0.16 + wave * 0.45 : wave * 0.24

      // Ripples: rings spreading over the plane from hits and beats.
      for (let k = 0; k < ripples.length; k++) {
        const ripple = ripples[k]
        if (ripple.age < 0) continue
        const front = Math.hypot(u - ripple.u, z - ripple.z) - ripple.age * ripple.speed
        if (front > 0.6 || front < -0.6) continue
        level += Math.exp(-Math.abs(front) / 0.16) * (1 - ripple.age / ripple.life) * ripple.strength
      }
      let heat = 0
      let light = 0
      let color = null

      if (edge) {
        level = Math.max(level, rail)
      } else if (road) {
        // The hit line, in the lane colors; a press lights it white.
        if (Math.abs(z / z_hit - 1) < line_half) {
          level = Math.max(level, 0.7)
          color = lane_colors[lane]
          light = pressed[lane] * 0.8
          heat = misses[lane] * 0.9
        }
        // A hit flares up the lane around the line.
        const above = z / z_hit - 1
        if (hits[lane] > 0 && above > -step && above < step * 5) {
          light = Math.max(light, hits[lane] * (1 - above / (step * 6)))
        }

        for (let k = 0; k < notes.length; k++) {
          const note = notes[k]
          if (note.lane !== lane || Math.abs(z / note.z - 1) > note_half) continue
          if (note.missed) {
            heat = Math.max(heat, 0.6)
          } else {
            level = 0.95
            color = lane_colors[lane]
          }
        }
      }
      if (heat > 0.02) heat *= 0.7 + 0.4 * hash(column + flicker * 0.37, row)

      out.level = level * fog
      out.heat = heat
      out.light = light
      out.color = color
    }, layout)
  }

  layout () {
    const { width, height } = this.stage
    return {
      horizon: Math.max(hud_bottom + 16, height * 0.2),
      near_y: height + 4,
      unit: Math.min(width * 0.98 / 4, height * 0.22),
      cell,
      u_start: -6,
      columns: 12 * per_lane + 1,
      z_near,
      z_far,
    }
  }

  draw_hud (ctx) {
    hud(ctx, this.stage.font, this.stage.width, {
      score: this.score,
      level: this.level,
      elapsed: this.elapsed,
      best: this.best,
      playing: this.state === 'playing',
      lives: this.lives,
      lives_max: max_lives,
      hurt: this.flash > 0,
    })
  }

  draw_screen (ctx, width, height) {
    ctx.fillStyle = 'rgba(7, 11, 18, .72)'
    ctx.fillRect(0, 0, width, height)

    const center = width / 2
    const max_width = Math.min(width - 48, 640)
    const title = clamp(width * 0.06, 26, 56)
    const lines = []
    const add = (value, style, lead) => lines.push({ value, style, lead })
    const paragraph = (value, style, lead) => {
      this.wrap(ctx, value, max_width, style).forEach((line, i) => add(line, style, i ? style.size * 1.4 : lead))
    }

    if (this.state === 'ready') {
      add('ADI ARCADE  ·  ELECTRONICA 2026', { size: 12, weight: 700, color: colors.accent, spacing: '3px' }, 0)
      add('SEQUENCER', { size: title, weight: 800, spacing: '2px' }, title + 12)
      paragraph('Tap each note as it crosses the line to play the melody. Miss one and the song misses it too.',
        { size: 16, weight: 500, color: colors.muted }, 34)
      paragraph('Tap the lanes, or use D F J K or the arrow keys. Sound on! It speeds up song after song.',
        { size: 14, weight: 500, color: colors.muted }, 26)
    } else {
      add(`OUT OF TUNE  ·  SURVIVED ${Math.floor(this.elapsed)}s`, { size: 12, weight: 700, color: colors.danger, spacing: '3px' }, 0)
      add(String(this.score), { size: title * 1.15, weight: 800 }, title * 1.15 + 12)
      add(this.best_beaten ? 'New best score!' : `Best ${this.best}`,
        { size: 16, weight: 700, color: this.best_beaten ? colors.gold : colors.muted }, 34)
    }

    const total = lines.reduce((sum, line) => sum + line.lead, 0)
    let y = Math.max(70, (height - total) / 2 - 30)
    for (const line of lines) {
      y += line.lead
      this.text(ctx, line.value, center, y, { ...line.style, align: 'center' })
    }

    if (this.state === 'over' && this.state_time < 0.9) return

    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.time * 4)
    this.text(ctx, this.state === 'ready' ? 'Tap to start' : 'Tap to play again', center, y + 48, {
      size: 15, weight: 700, color: colors.text, align: 'center', spacing: '1px',
    })
    ctx.globalAlpha = 1
  }

  wrap (ctx, value, max_width, style) {
    return wrap(ctx, this.stage.font, value, max_width, style)
  }

  text (ctx, value, x, y, style) {
    text(ctx, this.stage.font, value, x, y, style)
  }

  destroy () {
    this.chip?.close()
    this.chip = null
  }
}

export default {
  id: 'sequencer',
  name: 'Sequencer',
  tagline: 'Play the melody, note by note, in 8-bit.',
  controls: 'Tap the lanes',
  color: '#b16ee0',
  available: true,
  icon: '<svg class="no-background" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 42M30 6l12 36M24 6v36" opacity=".5"/><path d="M8 34h32"/><rect x="21" y="16" width="6" height="4" rx="1"/><rect x="11" y="24" width="6" height="4" rx="1"/><rect x="32" y="26" width="6" height="4" rx="1"/></svg>',
  create: stage => new Sequencer(stage),
}
