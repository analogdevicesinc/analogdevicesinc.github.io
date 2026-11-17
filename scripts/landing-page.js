"use strict";

import { WaitEvent } from '@shared/scripts/event.js'
import { DOM } from '@shared/scripts/dom.js'

import { Hero } from './hero.js'
import { EventBanner } from './event-banner.js'

class Landing {
  constructor () {
    this.controller = new AbortController()
    const body = DOM.get('.body')
    body.querySelectorAll('.cards.collection .img-container img').forEach(image => {
      const reveal = async () => {
        try {
          await image.decode()
        } catch {}
        if (!this.controller.signal.aborted && image.naturalWidth > 0)
          image.classList.add('is-loaded')
      }
      const options = { once: true, signal: this.controller.signal }
      image.addEventListener('load', reveal, options)
      image.addEventListener('error', reveal, options)
      if (image.complete)
        reveal()
    })
    body.querySelectorAll('.tabs').forEach(bar => {
      const grid = bar.nextElementSibling
      if (!grid?.classList.contains('cards'))
        return
      bar.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => {
          bar.querySelectorAll('button').forEach(other =>
            other.setAttribute('aria-selected', String(other === button)))
          const filter = button.dataset.filter
          grid.querySelectorAll('.entry:not(.view-all)').forEach(entry => {
            entry.hidden = grid.classList.contains('repositories')
              ? filter !== '' && entry.dataset.category !== filter
              : !JSON.parse(entry.dataset.filters).includes(filter)
          })
          // On phones the grid scrolls sideways: start the new set at its
          // first card.
          grid.scrollTo({ left: 0, behavior: 'instant' })
        }, { signal: this.controller.signal })
      })
    })
  }
  deinit () {
    this.controller.abort()
  }
}

const LandingPage = () => {
  let landing, hero, banner
  const isLanding = () => ['analogdevicesinc.github.io', 'os-tools'].includes(app.state.repository)
  let active = isLanding()
  const init = () => {
    if (landing)
      return
    landing = new Landing()
    hero = new Hero(app)
    banner = new EventBanner()
  }
  window.addEventListener('app:hot_reload:doc_unload', () => {
    active = false
  })
  window.addEventListener('app:hot_reload:doc_loaded', () => {
    active = isLanding()
  })
  window.addEventListener('app:hot_reload:page_unload', () => {
    if (!active || !landing)
      return
    landing.deinit()
    hero.deinit()
    banner.deinit()
    landing = hero = banner = undefined
  })
  window.addEventListener('app:hot_reload:page_loaded', () => {
    if (active)
      init()
  })
  if (document.readyState === 'complete' && active)
    init()
}

(async () => {
  await WaitEvent(window, 'app', "app:created")
  LandingPage()
})()
