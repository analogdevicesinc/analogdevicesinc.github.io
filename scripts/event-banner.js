"use strict";

import { DOM } from '@shared/scripts/dom.js'

// Adds the Play button to the electronica banner (`.event-banner` in
// docs/index.rst) and lazy-loads the arcade bundle, so the landing page does
// not pay for the games until the banner is near the viewport or clicked.

const bundle = 'arcade.umd.js'
let loading

const bundle_url = () => {
  const script = document.querySelector('script[src*="custom.umd.js"]')
  return script
    ? new URL(bundle, script.src).href
    : new URL(`_static/${bundle}`, document.baseURI).href
}

export const load_arcade = () => {
  if (window.ADIArcade) return Promise.resolve(window.ADIArcade)

  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      loading = undefined
      script.remove()
      reject(new Error(`Could not load ${bundle}`))
    }
    script.src = bundle_url()
    script.async = true
    script.onload = () => window.ADIArcade ? resolve(window.ADIArcade) : fail()
    script.onerror = fail
    document.head.append(script)
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

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        this.observer.disconnect()
        load_arcade().catch(() => {})
      }, { rootMargin: '200px' })
      this.observer.observe(banner)
    }
  }

  play () {
    const button = this.$.button
    // Open synchronously when preloaded, so fullscreen keeps the user gesture.
    if (window.ADIArcade) {
      window.ADIArcade.open({ opener: button })
      return
    }

    button.disabled = true
    button.dataset.state = 'loading'
    load_arcade()
      .then(arcade => {
        delete button.dataset.state
        arcade.open({ opener: button })
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
    this.observer?.disconnect()
    this.$.button?.removeEventListener('click', this.on_click)
    this.$.button?.remove()
    window.ADIArcade?.close()
    this.$ = {}
  }
}
