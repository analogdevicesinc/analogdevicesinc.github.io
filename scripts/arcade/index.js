"use strict";

// ADI Arcade: full-screen overlay that hosts the games. It owns the canvas,
// the render loop, input, fullscreen and the game picker, so each game only
// implements update/render/pointer. Built as games.umd.js and loaded on demand
// as window.Games.

import { games } from './games/index.js'
import { Field, ambient } from './field.js'
import { sound } from './chip.js'

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key in node) node[key] = value
    else node.setAttribute(key, value)
  }
  node.append(...children)
  return node
}

const storage = id => ({
  get (key, fallback) {
    try {
      const value = localStorage.getItem(`adi-arcade:${id}:${key}`)
      return value === null ? fallback : JSON.parse(value)
    } catch {
      return fallback
    }
  },
  set (key, value) {
    try {
      localStorage.setItem(`adi-arcade:${id}:${key}`, JSON.stringify(value))
    } catch {}
  },
})

// Music (a note) and effects (a speaker); muted, a slash crosses them out.
const svg = body => `<svg class="no-background" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const mute_icons = {
  music: svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/><path class="slash" d="M4 4l16 16"/>'),
  effects: svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="wave" d="M16.5 8.5a5 5 0 0 1 0 7"/><path class="slash" d="M4 4l16 16"/>'),
}
const mute_labels = { music: 'music', effects: 'sound effects' }

const close_icon = '<svg class="no-background" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'

class Arcade {
  constructor () {
    this.field = new Field()
    this.game = undefined
    this.time = 0
    this.last = 0
    this.width = 0
    this.height = 0
    this.fullscreen = false
    this.reduced_motion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const arcade = this
    this.stage = {
      field: this.field,
      font: 'system-ui, sans-serif',
      get width () { return arcade.width },
      get height () { return arcade.height },
      reduced_motion: () => this.reduced_motion.matches,
      storage,
      menu: () => this.show_menu(),
    }

    this.tick = this.tick.bind(this)
    this.on_click = this.on_click.bind(this)
    this.on_pointer = this.on_pointer.bind(this)
    this.on_key = this.on_key.bind(this)
    this.on_fullscreen = this.on_fullscreen.bind(this)
    this.on_popstate = this.on_popstate.bind(this)
    // Our entries on the history stack: 1 for the menu, 2 in a game. Back
    // steps from a game to the menu, and from the menu out of the arcade.
    this.depth = 0
    // Pops we caused ourselves (the Games button, Esc), to ignore.
    this.skip_pops = 0
    this.resize_observer = new ResizeObserver(() => this.resize())

    this.build()
  }

  build () {
    this.$canvas = el('canvas', { className: 'adi-arcade-canvas', 'aria-hidden': 'true' })
    this.ctx = this.$canvas.getContext('2d')

    const cards = games.map(game => {
      const icon = el('span', { className: 'adi-arcade-game-icon' })
      icon.innerHTML = game.icon ?? ''
      const card = el('button', {
        type: 'button',
        className: 'adi-arcade-game',
        disabled: !game.available,
        dataset: { game: game.id },
      }, [
        icon,
        el('span', { className: 'adi-arcade-game-text' }, [
          el('span', { className: 'adi-arcade-game-name', textContent: game.name }),
          el('span', { className: 'adi-arcade-game-tagline', textContent: game.tagline }),
          el('span', { className: 'adi-arcade-game-controls', textContent: game.available ? game.controls : 'Coming soon' }),
        ]),
      ])
      if (game.color) card.style.setProperty('--game-color', game.color)
      return card
    })

    this.$mutes = {}
    for (const channel of ['music', 'effects']) {
      const button = el('button', {
        type: 'button',
        className: 'adi-arcade-tool adi-arcade-mute',
        dataset: { action: 'mute', channel },
      })
      button.innerHTML = mute_icons[channel]
      this.$mutes[channel] = button
    }
    this.update_mutes()

    const menu_button = el('button', {
      type: 'button',
      className: 'adi-arcade-tool',
      textContent: 'Games',
      dataset: { action: 'menu' },
    })
    const close_button = el('button', {
      type: 'button',
      className: 'adi-arcade-tool',
      title: 'Close (Esc)',
      'aria-label': 'Close arcade',
      dataset: { action: 'close' },
    })
    close_button.innerHTML = close_icon

    this.$menu = el('div', { className: 'adi-arcade-menu' }, [
      el('div', { className: 'adi-arcade-brand' }, [
        el('h2', { className: 'adi-arcade-title', id: 'adi-arcade-title', textContent: 'ADI Arcade' }),
        el('p', { className: 'adi-arcade-subtitle', textContent: 'Quick break games' }),
      ]),
      el('div', { className: 'adi-arcade-games' }, cards),
    ])

    this.$root = el('div', {
      className: 'adi-arcade',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'adi-arcade-title',
    }, [
      this.$canvas,
      this.$menu,
      el('div', { className: 'adi-arcade-toolbar' }, [this.$mutes.music, this.$mutes.effects, menu_button, close_button]),
    ])

    this.$root.addEventListener('click', this.on_click)
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
      this.$canvas.addEventListener(type, this.on_pointer)
    // Right click is a game input (Accumulator splits with it).
    this.$canvas.addEventListener('contextmenu', event => event.preventDefault())
  }

  open ({ game, opener } = {}) {
    this.opener = opener ?? document.activeElement

    if (!this.$root.isConnected) {
      this.stage.font = getComputedStyle(document.body).fontFamily || this.stage.font
      document.body.append(this.$root)
      document.documentElement.classList.add('adi-arcade-open')
      document.addEventListener('keydown', this.on_key)
      document.addEventListener('keyup', this.on_key)
      document.addEventListener('fullscreenchange', this.on_fullscreen)
      document.addEventListener('webkitfullscreenchange', this.on_fullscreen)
      window.addEventListener('popstate', this.on_popstate)
      this.push('menu')
      this.resize_observer.observe(this.$root)
      this.resize()
      this.enter_fullscreen()
      this.last = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    }

    const target = games.find(entry => entry.id === game && entry.available)
    if (target) this.launch(target, { fullscreen: false })
    else this.show_menu()
  }

  close () {
    if (!this.$root.isConnected) return

    window.removeEventListener('popstate', this.on_popstate)
    // Drop our history entries, so Back afterwards leaves the page as usual.
    if (this.depth > 0) history.go(-this.depth)
    this.depth = 0
    this.skip_pops = 0
    this.stop_game()
    cancelAnimationFrame(this.frame)
    document.removeEventListener('keydown', this.on_key)
    document.removeEventListener('keyup', this.on_key)
    document.removeEventListener('fullscreenchange', this.on_fullscreen)
    document.removeEventListener('webkitfullscreenchange', this.on_fullscreen)
    this.resize_observer.unobserve(this.$root)

    const fullscreen_element = document.fullscreenElement ?? document.webkitFullscreenElement
    this.fullscreen = false
    if (fullscreen_element === this.$root) {
      const exit = document.exitFullscreen ?? document.webkitExitFullscreen
      try {
        exit?.call(document)?.catch?.(() => {})
      } catch {}
    }

    this.$root.remove()
    document.documentElement.classList.remove('adi-arcade-open')
    this.opener?.focus?.({ preventScroll: true })
  }

  // Fullscreen is best effort: if the browser refuses (or lacks element
  // fullscreen, as on iPhone), the fixed overlay still covers the viewport.
  enter_fullscreen () {
    const request = this.$root.requestFullscreen ?? this.$root.webkitRequestFullscreen
    if (!request) return
    try {
      request.call(this.$root, { navigationUI: 'hide' })?.catch?.(() => {})
    } catch {}
  }

  on_fullscreen () {
    const current = document.fullscreenElement ?? document.webkitFullscreenElement
    if (current === this.$root) {
      this.fullscreen = true
    } else if (this.fullscreen) {
      // Leaving fullscreen (Esc, or Back on Android, which only exits
      // fullscreen) steps back: from a game to the menu, from the menu out.
      this.fullscreen = false
      this.back()
    }
  }

  // -- History ---------------------------------------------------------------

  // The theme (hot_reload.js) handles popstate too: for the same page it
  // scrolls to state.scrollY, or to the top without one. So every entry we
  // add, and the one we leave from, carries the scroll position, and the page
  // stays where it was under the arcade.
  push (view) {
    try {
      const scrollY = window.scrollY
      if (this.depth === 0) history.replaceState({ ...(history.state ?? {}), scrollY }, '')
      history.pushState({ adi_arcade: view, scrollY }, '')
      this.depth += 1
    } catch {}
  }

  // Back, by any means (Esc, the Games button, leaving fullscreen): from a
  // game to the menu, from the menu out of the arcade.
  back () {
    if (this.game) this.show_menu()
    else this.close()
  }

  on_popstate (event) {
    if (this.skip_pops > 0) {
      this.skip_pops -= 1
      return
    }
    const view = event.state?.adi_arcade
    if (view === 'menu') {
      this.depth = 1
      if (this.game) this.show_menu({ from_history: true })
    } else if (view === 'game') {
      // Forward into a game we no longer have: stay on the menu.
      this.depth = 2
      this.show_menu()
    } else {
      this.depth = 0
      this.close()
    }
  }

  show_menu ({ from_history = false } = {}) {
    if (this.game && !from_history && this.depth > 1) {
      this.skip_pops += 1
      this.depth -= 1
      history.back()
    }
    this.stop_game()
    this.$root.dataset.view = 'menu'
    this.$menu.querySelector('.adi-arcade-game:not(:disabled)')?.focus({ preventScroll: true })
  }

  launch (game, { fullscreen = true } = {}) {
    const playing = Boolean(this.game)
    this.stop_game()
    if (!playing) this.push('game')
    // Back from fullscreen (Esc) lands on the menu; picking a game from
    // there (a click, so a user gesture) goes fullscreen again. open()
    // has just asked already.
    if (fullscreen && !this.fullscreen) this.enter_fullscreen()
    this.game = game.create(this.stage)
    this.$root.dataset.view = 'game'
    this.$root.querySelector('[data-action="menu"]').focus({ preventScroll: true })
  }

  stop_game () {
    this.game?.destroy?.()
    this.game = undefined
  }

  update_mutes () {
    for (const [channel, button] of Object.entries(this.$mutes)) {
      const on = sound[channel]
      button.dataset.muted = String(!on)
      button.setAttribute('aria-pressed', String(!on))
      button.title = `${on ? 'Mute' : 'Unmute'} ${mute_labels[channel]}`
      button.setAttribute('aria-label', button.title)
    }
  }

  on_click (event) {
    const target = event.target.closest('[data-action]')
    const action = target?.dataset.action
    if (action === 'close') return this.close()
    if (action === 'menu') return this.show_menu()
    if (action === 'mute') {
      sound.toggle(target.dataset.channel)
      this.update_mutes()
      return
    }

    const id = event.target.closest('[data-game]')?.dataset.game
    const game = games.find(entry => entry.id === id && entry.available)
    if (game) this.launch(game)
  }

  on_pointer (event) {
    if (!this.game?.pointer) return
    if (event.type === 'pointerdown') {
      event.preventDefault()
      // Capture keeps drags (Chess) tracked outside the canvas; it
      // throws for pointers the browser no longer considers active.
      try {
        this.$canvas.setPointerCapture(event.pointerId)
      } catch {}
    }
    const rect = this.$canvas.getBoundingClientRect()
    // 'pointerdown' -> 'down', 'pointermove' -> 'move', ...
    this.game.pointer(event.type.slice(7), event.clientX - rect.left, event.clientY - rect.top, event)
  }

  on_key (event) {
    if (event.key === 'Escape') {
      if (event.type !== 'keydown') return
      event.preventDefault()
      this.back()
      return
    }
    // Keys a game claims (e.g. Space) must not also press the focused
    // toolbar button, so both keydown and keyup are cancelled.
    // 'keydown' -> 'down', 'keyup' -> 'up'.
    if (this.game?.key?.(event.type.slice(3), event)) event.preventDefault()
  }

  resize () {
    const rect = this.$root.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.width = Math.max(1, Math.round(rect.width))
    this.height = Math.max(1, Math.round(rect.height))
    this.$canvas.width = Math.round(this.width * dpr)
    this.$canvas.height = Math.round(this.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.game?.resize?.(this.width, this.height)
  }

  tick (now) {
    this.frame = requestAnimationFrame(this.tick)
    // Clamp the step so a backgrounded tab doesn't jump the simulation.
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.time += dt

    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)

    if (this.game) {
      this.game.update(dt)
      this.game.render(ctx)
    } else {
      const { width, height, time } = this
      this.field.draw(ctx, width, height, (x, y, column, row, out) => {
        out.level = ambient(x / width, y / height, time) * 0.8
      })
    }
  }
}

let instance

export const open = (options) => {
  instance ??= new Arcade()
  instance.open(options)
  return instance
}

export const close = () => instance?.close()

export { games }
