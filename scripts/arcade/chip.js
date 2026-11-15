"use strict";

// A tiny 8-bit sound chip shared by the games: pulse waves like the NES, a
// triangle bass and a noise channel, all with hard, stepped envelopes.
// Create it from a tap or key press (start()), so browsers let audio start.

const duties = { pulse: 0.25, thin: 0.125, square: 0.5 }

export class Chip {
  constructor () {
    const Context = window.AudioContext ?? window.webkitAudioContext
    if (!Context) return
    this.ctx = new Context()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.2
    this.master.connect(this.ctx.destination)

    const harmonics = 32
    this.waves = {}
    for (const [name, duty] of Object.entries(duties)) {
      const real = new Float32Array(harmonics)
      const imag = new Float32Array(harmonics)
      for (let k = 1; k < harmonics; k++) real[k] = 2 / (k * Math.PI) * Math.sin(k * Math.PI * duty)
      this.waves[name] = this.ctx.createPeriodicWave(real, imag)
    }

    const length = Math.round(this.ctx.sampleRate)
    this.noise_buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = this.noise_buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1

    // No sound from a hidden tab: the game is paused there too.
    this.on_visibility = () => {
      if (document.hidden) this.ctx.suspend().catch(() => {})
      else this.resume()
    }
    document.addEventListener('visibilitychange', this.on_visibility)
  }

  get now () { return this.ctx.currentTime }

  resume () {
    if (this.ctx?.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {})
  }

  oscillator (wave) {
    const osc = this.ctx.createOscillator()
    if (wave === 'triangle' || wave === 'sawtooth') osc.type = wave
    else osc.setPeriodicWave(this.waves[wave] ?? this.waves.pulse)
    return osc
  }

  // A note with a stepped envelope: a short attack at full volume, then held
  // lower until it ends.
  play (freq, duration, { delay = 0, bass = false, wave = bass ? 'triangle' : 'pulse', volume = bass ? 0.55 : 0.32 } = {}) {
    if (!this.ctx) return
    const start = this.now + delay
    const end = start + duration

    const osc = this.oscillator(wave)
    osc.frequency.value = freq

    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(volume, start)
    gain.gain.setValueAtTime(volume * 0.6, start + Math.min(0.05, duration * 0.3))
    gain.gain.setValueAtTime(volume * 0.6, Math.max(start, end - 0.02))
    gain.gain.linearRampToValueAtTime(0, end)

    osc.connect(gain).connect(this.master)
    osc.start(start)
    osc.stop(end + 0.02)
  }

  // Notes one after another, `step` seconds apart.
  melody (freqs, step, { delay = 0, length = step * 0.9, ...options } = {}) {
    freqs.forEach((freq, i) => this.play(freq, length, { ...options, delay: delay + i * step }))
  }

  // A pitch slide, fading out: jumps, zaps, falls.
  sweep (from, to, duration, { delay = 0, wave = 'pulse', volume = 0.3 } = {}) {
    if (!this.ctx) return
    const start = this.now + delay
    const end = start + duration
    const osc = this.oscillator(wave)
    osc.frequency.setValueAtTime(from, start)
    osc.frequency.exponentialRampToValueAtTime(to, end)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(volume, start)
    gain.gain.linearRampToValueAtTime(0, end)
    osc.connect(gain).connect(this.master)
    osc.start(start)
    osc.stop(end + 0.02)
  }

  // A burst of noise through a filter that may slide: hats, crashes, static,
  // whooshes.
  noise (duration, { delay = 0, volume = 0.35, filter = 'highpass', freq = 7000, to = freq, q = 1 } = {}) {
    if (!this.ctx) return
    const start = this.now + delay
    const end = start + duration
    const source = this.ctx.createBufferSource()
    source.buffer = this.noise_buffer
    source.loop = true
    const shape = this.ctx.createBiquadFilter()
    shape.type = filter
    shape.Q.value = q
    shape.frequency.setValueAtTime(freq, start)
    if (to !== freq) shape.frequency.exponentialRampToValueAtTime(to, end)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(volume, start)
    gain.gain.exponentialRampToValueAtTime(0.001, end)
    source.connect(shape).connect(gain).connect(this.master)
    source.start(start)
    source.stop(end + 0.02)
  }

  hat (delay = 0, volume = 0.35) {
    this.noise(0.05, { delay, volume })
  }

  // A looping tune: a lead and a bass line as note strings ('C5 E5:0.5 R'
  // for a rest), with hats every `hats` beats. Call update() every frame to
  // keep it scheduled ahead on the audio clock; set() changes the tempo
  // without the voices drifting apart.
  tune ({ lead = '', bass = '', bpm = 140, hats = 0, volume = 0.14, bass_volume = 0.3, hat_volume = 0.1, wave = 'pulse', delay = 0.1 } = {}) {
    if (!this.ctx) return { update () {}, set () {}, stop () {} }
    const parse = line => line.trim().split(/\s+/).filter(Boolean).map(entry => {
      const [pitch, beats] = entry.split(':')
      return { freq: pitch === 'R' ? 0 : note(pitch), beats: Number(beats ?? 1) }
    })
    const voices = [
      { notes: parse(lead), play: (freq, duration, at) => this.play(freq, duration * 0.85, { delay: at, volume, wave }) },
      { notes: parse(bass), play: (freq, duration, at) => this.play(freq, duration * 0.8, { delay: at, bass: true, volume: bass_volume }) },
    ]
    if (hats) voices.push({ notes: [{ freq: 1, beats: hats }], play: (freq, duration, at) => this.hat(at, hat_volume) })
    for (const voice of voices) {
      voice.index = 0
      voice.pos = 0
    }
    // Position in beats to time: the reference moves on every tempo change.
    let beat = 60 / bpm
    let ref_time = this.now + delay
    let ref_pos = 0
    const time_of = pos => ref_time + (pos - ref_pos) * beat
    let stopped = false
    return {
      update: () => {
        if (stopped) return
        const now = this.now
        const horizon = now + 0.25
        for (const voice of voices) {
          if (!voice.notes.length) continue
          while (time_of(voice.pos) < horizon) {
            const entry = voice.notes[voice.index]
            const duration = entry.beats * beat
            if (entry.freq) voice.play(entry.freq, duration, Math.max(0, time_of(voice.pos) - now))
            voice.pos += entry.beats
            voice.index = (voice.index + 1) % voice.notes.length
          }
        }
      },
      set: next_bpm => {
        const now = this.now
        ref_pos += (now - ref_time) / beat
        ref_time = now
        beat = 60 / next_bpm
      },
      stop: () => { stopped = true },
    }
  }

  // A held tone to steer live, like an engine: set() glides its pitch and
  // volume, and an optional flutter chops it at a rate following the pitch.
  voice ({ wave = 'pulse', lowpass = 0, flutter = 0, depth = 0.5 } = {}) {
    if (!this.ctx) return { set () {}, stop () {} }
    const ctx = this.ctx
    const osc = this.oscillator(wave)
    const gain = ctx.createGain()
    gain.gain.value = 0
    let chain = osc
    if (lowpass) {
      const shape = ctx.createBiquadFilter()
      shape.type = 'lowpass'
      shape.frequency.value = lowpass
      chain = chain.connect(shape)
    }
    const amp = ctx.createGain()
    chain.connect(amp).connect(gain).connect(this.master)
    let lfo = null
    if (flutter) {
      lfo = this.oscillator('square')
      const swing = ctx.createGain()
      swing.gain.value = depth / 2
      amp.gain.value = 1 - depth / 2
      lfo.connect(swing).connect(amp.gain)
      lfo.start()
    }
    osc.start()
    let stopped = false
    return {
      set (freq, volume, glide = 0.04) {
        if (stopped) return
        const now = ctx.currentTime
        osc.frequency.setTargetAtTime(freq, now, glide)
        gain.gain.setTargetAtTime(volume, now, glide)
        lfo?.frequency.setTargetAtTime(freq * flutter, now, glide)
      },
      stop (fade = 0.15) {
        if (stopped) return
        stopped = true
        const now = ctx.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.linearRampToValueAtTime(0, now + fade)
        osc.stop(now + fade + 0.02)
        lfo?.stop(now + fade + 0.02)
      },
    }
  }

  close () {
    if (!this.ctx) return
    document.removeEventListener('visibilitychange', this.on_visibility)
    this.ctx.close().catch(() => {})
    this.ctx = null
  }
}

// Note names to pitch, e.g. note('A4') = 440.
const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
export const midi_of = name => {
  const [, letter, accidental, octave] = /^([A-G])([#b]?)(\d)$/.exec(name)
  return semitones[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + (Number(octave) + 1) * 12
}
export const freq_of = midi => 440 * Math.pow(2, (midi - 69) / 12)
export const note = name => freq_of(midi_of(name))
