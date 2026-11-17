"use strict";

import { DOM } from '@shared/scripts/dom.js'

const portal = 'https://developer.analog.com'
const links = [
  ['Home', '/'],
  ['Newsroom', '/newsroom'],
  ['Documentation', '/documentation'],
  ['Drivers', '/drivers'],
  ['Solutions', '/solutions'],
  ['Events', '/events'],
]
const current = 'Documentation'

export class PortalNavigation {
  constructor (app) {
    this.construct()
    app.portal_navigation = this
  }

  construct () {
    document.querySelectorAll('nav.portal-navigation').forEach(nav => nav.remove())
    const header = document.querySelector('header')
    if (!header)
      return

    const nav = DOM.new('nav', { className: 'portal-navigation' })
    nav.setAttribute('aria-label', 'Developer portal')
    for (const [label, route] of links) {
      const link = DOM.new('a', { href: portal + route, innerText: label })
      if (label === current)
        link.setAttribute('aria-current', 'page')
      nav.append(link)
    }
    nav.addEventListener('focusin', e => {
      e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    header.after(nav)
    nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'start' })
    this.nav = nav
  }

  deinit () {
    this.nav?.remove()
    this.nav = undefined
  }
}
