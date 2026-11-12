"use strict";

// ADI Arcade: full-screen overlay that hosts the games. It owns the canvas,
// the render loop, input, fullscreen and the game picker, so each game only
// implements update/render/pointer. Built as games.umd.js and loaded on demand
// as window.Games.

import { games } from './games/index.js'
import { Field, ambient } from './field.js'

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
        el('p', { className: 'adi-arcade-subtitle', textContent: 'electronica 2026 · Messe München · 10–13 November' }),
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
      el('div', { className: 'adi-arcade-toolbar' }, [menu_button, close_button]),
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
      this.resize_observer.observe(this.$root)
      this.resize()
      this.enter_fullscreen()
      this.last = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    }

    const target = games.find(entry => entry.id === game && entry.available)
    if (target) this.launch(target)
    else this.show_menu()
  }

  close () {
    if (!this.$root.isConnected) return

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
      // Leaving fullscreen (e.g. Esc) closes the arcade in one step.
      this.fullscreen = false
      this.close()
    }
  }

  show_menu () {
    this.stop_game()
    this.$root.dataset.view = 'menu'
    this.$menu.querySelector('.adi-arcade-game:not(:disabled)')?.focus({ preventScroll: true })
  }

  launch (game) {
    this.stop_game()
    this.game = game.create(this.stage)
    this.$root.dataset.view = 'game'
    this.$root.querySelector('[data-action="menu"]').focus({ preventScroll: true })
  }

  stop_game () {
    this.game?.destroy?.()
    this.game = undefined
  }

  on_click (event) {
    const action = event.target.closest('[data-action]')?.dataset.action
    if (action === 'close') return this.close()
    if (action === 'menu') return this.show_menu()

    const id = event.target.closest('[data-game]')?.dataset.game
    const game = games.find(entry => entry.id === id && entry.available)
    if (game) this.launch(game)
  }

  on_pointer (event) {
    if (!this.game?.pointer) return
    if (event.type === 'pointerdown') {
      event.preventDefault()
      // Capture keeps drags (Trace Router) tracked outside the canvas; it
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
      this.close()
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
