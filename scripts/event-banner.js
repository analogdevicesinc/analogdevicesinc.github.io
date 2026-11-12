"use strict";

import { DOM } from '@shared/scripts/dom.js'

// Adds the Play button to the electronica banner (`.event-banner` in
// docs/index.rst). The games bundle (games.umd.js + games.min.css) is only
// fetched once Play is clicked.

const assets = { script: 'games.umd.js', style: 'games.min.css' }
let loading

const asset_url = name => {
  const script = document.querySelector('script[src*="custom.umd.js"]')
  return script
    ? new URL(name, script.src).href
    : new URL(`_static/${name}`, document.baseURI).href
}

const load_style = href => new Promise((resolve, reject) => {
  const existing = document.querySelector(`link[data-games-style]`)
  if (existing) return resolve()
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.dataset.gamesStyle = ''
  link.onload = () => resolve()
  link.onerror = () => {
    link.remove()
    reject(new Error(`Could not load ${href}`))
  }
  document.head.append(link)
})

const load_script = src => new Promise((resolve, reject) => {
  const script = document.createElement('script')
  script.src = src
  script.async = true
  script.onload = () => window.Games ? resolve(window.Games) : reject(new Error('Games missing'))
  script.onerror = () => {
    script.remove()
    reject(new Error(`Could not load ${src}`))
  }
  document.head.append(script)
})

export const load_games = () => {
  if (window.Games && document.querySelector('link[data-games-style]')) {
    return Promise.resolve(window.Games)
  }
  loading ??= Promise.all([
    load_style(asset_url(assets.style)),
    window.Games ? Promise.resolve(window.Games) : load_script(asset_url(assets.script)),
  ]).then(([, games]) => games).catch(error => {
    loading = undefined
    throw error
  })
  return loading
}

const play_icon = '<svg class="no-background" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.52.85l10.4-6.5a1 1 0 0 0 0-1.7L9.52 4.65A1 1 0 0 0 8 5.5Z"/></svg>'

export class EventBanner {
  constructor () {
    this.$ = {}
    this.mount()
  }

  mount () {
    const banner = document.querySelector('.event-banner')
    if (!banner || banner.querySelector('.event-banner-play')) return

    const button = DOM.new('button', { type: 'button', className: 'event-banner-play' })
    button.innerHTML = `${play_icon}<span>Play</span>`
    button.setAttribute('aria-label', 'Play the ADI Arcade games')
    this.on_click = () => this.play()
    button.addEventListener('click', this.on_click)
    banner.append(button)

    this.$.banner = banner
    this.$.button = button
  }

  play () {
    const button = this.$.button
    if (window.Games && document.querySelector('link[data-games-style]')) {
      window.Games.open({ opener: button })
      return
    }

    button.disabled = true
    button.dataset.state = 'loading'
    button.querySelector('span').textContent = 'Loading…'
    load_games()
      .then(games => {
        delete button.dataset.state
        button.querySelector('span').textContent = 'Play'
        games.open({ opener: button })
      })
      .catch(() => {
        button.dataset.state = 'error'
        button.querySelector('span').textContent = 'Retry'
      })
      .finally(() => {
        button.disabled = false
      })
  }

  deinit () {
    this.$.button?.removeEventListener('click', this.on_click)
    this.$.button?.remove()
    window.Games?.close()
    this.$ = {}
  }
}
