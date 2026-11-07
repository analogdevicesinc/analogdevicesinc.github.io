"use strict";

import { WaitEvent } from '@shared/scripts/event.js'
import { DOM } from '@shared/scripts/dom.js'

import { Hero } from './hero.js'
import { placeholder } from './placeholder.js'
import * as source from './source.js'

const limit = 5
const categories = {
  system: 'System',
  hdl: 'HDL',
  driver: 'Drivers',
  library: 'Libraries',
  tool: 'Tools',
  sdk: 'SDKs',
}
const icons = {
  chip: '<path fill-rule="evenodd" d="M8 8H14L16 10V16H8V8ZM10 10H14V14H10V10Z"/><path fill-rule="evenodd" d="M10 20H14V22H16V20H19C19.5523 20 20 19.5523 20 19V16H22V14H20V10H22V8H20V5C20 4.44772 19.5523 4 19 4H16V2H14V4H10V2H8V4H5C4.44772 4 4 4.44772 4 5V8H2V10H4V14H2V16H4V19C4 19.5523 4.44772 20 5 20H8V22H10V20ZM18 18H6V6H18V18Z"/>',
  binary: '<path fill-rule="evenodd" d="M7 6V8C7 8.55228 6.55228 9 6 9C5.44772 9 5 8.55228 5 8V6C5 5.44772 5.44772 5 6 5C6.55228 5 7 5.44772 7 6ZM3 6C3 4.34315 4.34315 3 6 3C7.65685 3 9 4.34315 9 6V8C9 9.65685 7.65685 11 6 11C4.34315 11 3 9.65685 3 8V6ZM19 6V8C19 8.55228 18.5523 9 18 9C17.4477 9 17 8.55228 17 8V6C17 5.44772 17.4477 5 18 5C18.5523 5 19 5.44772 19 6ZM15 6C15 4.34315 16.3431 3 18 3C19.6569 3 21 4.34315 21 6V8C21 9.65685 19.6569 11 18 11C16.3431 11 15 9.65685 15 8V6ZM11 3H13V11H11V3ZM19 21V13H17V21H19ZM13 18V16C13 15.4477 12.5523 15 12 15C11.4477 15 11 15.4477 11 16V18C11 18.5523 11.4477 19 12 19C12.5523 19 13 18.5523 13 18ZM12 13C10.3431 13 9 14.3431 9 16V18C9 19.6569 10.3431 21 12 21C13.6569 21 15 19.6569 15 18V16C15 14.3431 13.6569 13 12 13ZM7 13H5V21H7V13Z"/>',
  flow: '<path d="M6 21.4999C4.067 21.4999 2.5 19.9329 2.5 17.9999C2.5 16.0669 4.067 14.4999 6 14.4999C7.585 14.4999 8.924 15.5539 9.355 16.9999H15V14.9999H17V9.24186L14.757 6.99986H9V8.99986H3V2.99986H9V4.99986H14.757L18 1.75586L22.243 5.99986L19 9.24086V14.9999H21V20.9999H15V18.9999H9.355C8.925 20.4459 7.585 21.4999 6 21.4999ZM6 16.4999C5.172 16.4999 4.5 17.1719 4.5 17.9999C4.5 18.8279 5.172 19.4999 6 19.4999C6.828 19.4999 7.5 18.8279 7.5 17.9999C7.5 17.1719 6.828 16.4999 6 16.4999ZM19 16.9999H17V18.9999H19V16.9999ZM18 4.58586L16.586 5.99986L18 7.41386L19.414 5.99986L18 4.58586ZM7 4.99986H5V6.99986H7V4.99986Z"/>',
  stack: '<path d="M20.0835 15.1998L21.2856 15.9211C21.5224 16.0632 21.5991 16.3703 21.4571 16.6071C21.4148 16.6775 21.356 16.7364 21.2856 16.7786L12.5146 22.0411C12.198 22.2312 11.8023 22.2312 11.4857 22.0411L2.71475 16.7786C2.47796 16.6365 2.40118 16.3294 2.54325 16.0926C2.58548 16.0222 2.64437 15.9633 2.71475 15.9211L3.91684 15.1998L12.0002 20.0498L20.0835 15.1998ZM20.0835 10.4998L21.2856 11.2211C21.5224 11.3632 21.5991 11.6703 21.4571 11.9071C21.4148 11.9775 21.356 12.0364 21.2856 12.0786L12.0002 17.6498L2.71475 12.0786C2.47796 11.9365 2.40118 11.6294 2.54325 11.3926C2.58548 11.3222 2.64437 11.2633 2.71475 11.2211L3.91684 10.4998L12.0002 15.3498L20.0835 10.4998ZM12.5146 1.30852L21.2856 6.57108C21.5224 6.71315 21.5991 7.02028 21.4571 7.25707C21.4148 7.32745 21.356 7.38635 21.2856 7.42857L12.0002 12.9998L2.71475 7.42857C2.47796 7.2865 2.40118 6.97937 2.54325 6.74258C2.58548 6.6722 2.64437 6.61331 2.71475 6.57108L11.4857 1.30852C11.8023 1.11852 12.198 1.11852 12.5146 1.30852ZM12.0002 3.33221L5.88747 6.99983L12.0002 10.6675L18.1129 6.99983L12.0002 3.33221Z"/>',
  tools: '<path d="M5.32943 3.27158C6.56252 2.8332 7.9923 3.10749 8.97927 4.09446C9.96652 5.08171 10.2407 6.51202 9.80178 7.74535L20.6465 18.5902L18.5252 20.7115L7.67936 9.86709C6.44627 10.3055 5.01649 10.0312 4.02952 9.04421C3.04227 8.05696 2.7681 6.62665 3.20701 5.39332L5.44373 7.63C6.02952 8.21578 6.97927 8.21578 7.56505 7.63C8.15084 7.04421 8.15084 6.09446 7.56505 5.50868L5.32943 3.27158ZM15.6968 5.15512L18.8788 3.38736L20.293 4.80157L18.5252 7.98355L16.7574 8.3371L14.6361 10.4584L13.2219 9.04421L15.3432 6.92289L15.6968 5.15512ZM8.62572 12.9333L10.747 15.0546L5.79729 20.0044C5.2115 20.5902 4.26175 20.5902 3.67597 20.0044C3.12464 19.453 3.09221 18.5793 3.57867 17.99L3.67597 17.883L8.62572 12.9333Z"/>',
}
const category_icon = {
  system: 'flow',
  hdl: 'binary',
  driver: 'chip',
  library: 'chip',
  tool: 'tools',
  sdk: 'stack',
}

const icon = category => {
  const span = DOM.new('span', { className: 'icon' })
  span.dataset.category = category
  span.setAttribute('aria-hidden', 'true')
  span.innerHTML = `<svg class="no-background" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${icons[category_icon[category] ?? 'flow']}</svg>`
  return span
}

const plural = label =>
  categories[label] ?? label.charAt(0).toUpperCase() + label.slice(1) + 's'

class Landing {
  constructor (app) {
    this.$ = {}
    this.parent = app

    this.construct()
  }
  tabs (anchor, items, active, callback) {
    const bar = DOM.new('div', { className: 'tabs' })
    bar.setAttribute('role', 'tablist')
    for (const [value, label] of items) {
      const button = DOM.new('button', { type: 'button', innerText: label })
      button.setAttribute('role', 'tab')
      button.setAttribute('aria-selected', value === active)
      button.addEventListener('click', () => {
        bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b === button))
        callback(value)
      })
      bar.append(button)
    }
    anchor.before(bar)
  }
  construct_repositories (repotoc) {
    if (!this.active)
      return
    const grid = DOM.get('.cards.repositories', this.$.body)
    if (!grid || grid.dataset.populated !== undefined)
      return
    grid.dataset.populated = ''

    const repos = Object.entries(repotoc).filter(([, value]) => value.visibility !== 'hidden')
    for (const [key, value] of repos) {
      const entry = DOM.new('a', { className: 'entry', href: `${key}/` })
      entry.dataset.category = value.category
      const inner = DOM.new('span')
      const head = DOM.new('span', { className: 'head' })
      head.append(
        icon(value.category),
        DOM.new('span', { className: 'tag', innerText: plural(value.category) }),
      )
      inner.append(
        head,
        DOM.new('span', { className: 'title', innerText: value.name }),
        DOM.new('span', { className: 'subtitle', innerText: value.description }),
      )
      entry.append(inner)
      grid.append(entry)
    }

    const present = new Set(repos.map(([, value]) => value.category))
    const items = [['', 'All']]
    for (const key of Object.keys(categories).filter(key => present.has(key)))
      items.push([key, categories[key]])
    this.tabs(grid, items, '', value => {
      grid.querySelectorAll('.entry').forEach(entry => {
        entry.hidden = value !== '' && entry.dataset.category !== value
      })
    })
  }
  matching (collection, labels) {
    return Object.entries(collection)
      .filter(([, value]) => labels.every(label => value.label.includes(label)))
  }
  card (key, value) {
    const entry = DOM.new('a', { className: 'entry', href: `${value.docname}.html` })
    const inner = DOM.new('span')
    const image_container = DOM.new('div', { className: 'img-container' })
    if (value.image) {
      image_container.append(DOM.new('img', {
        src: value.image,
        loading: 'lazy',
        alt: '',
      }))
    } else {
      image_container.append(placeholder(key))
    }
    inner.append(
      image_container,
      DOM.new('div', { className: 'title', innerText: key }),
      DOM.new('div', { className: 'subtitle', innerText: value.subtitle ?? '' }),
    )
    if (value.description) {
      inner.append(
        DOM.new('hr'),
        DOM.new('div', { className: 'description', innerText: value.description }),
      )
    }
    inner.append(DOM.new('span', { className: 'spacer' }))
    entry.append(inner)
    return entry
  }
  render_collection (grid, collection, labels) {
    grid.querySelectorAll('.entry:not(.view-all)').forEach(entry => entry.remove())
    const view_all = grid.querySelector('.view-all-card')
    for (const [key, value] of this.matching(collection, labels).slice(0, limit))
      grid.insertBefore(this.card(key, value), view_all)
  }
  construct_collections (collection) {
    if (!this.active || !collection)
      return
    DOM.getAll('.cards.collection', this.$.body).forEach(grid => {
      if (grid.dataset.populated !== undefined)
        return
      grid.dataset.populated = ''

      const labels = grid.id.split(',').map(label => label.trim())
      const tabs = grid.parentElement.querySelector('.collection-tabs')
      if (tabs) {
        const items = [...tabs.querySelectorAll('.tab')]
          .map(tab => tab.textContent.trim())
          .filter(label => this.matching(collection, [label]).length)
          .map(label => [label, plural(label)])
        tabs.remove()
        this.tabs(grid, items, labels[0], label => this.render_collection(grid, collection, [label]))
      }
      this.render_collection(grid, collection, labels)
    })
  }
  deinit () {
    this.active = false
  }
  construct () {
    this.active = true
    this.$.body = DOM.get('.body')

    source.repotoc(this.parent)
      .then(this.construct_repositories.bind(this))
      .catch(() => {})
    source.collection(this.parent)
      .then(this.construct_collections.bind(this))
      .catch(() => {})
  }
}

const LandingPage = () => {
  let landing, hero
  let active = false
  const init = () => {
    landing = new Landing(app)
    hero = new Hero(app)
  }
  window.addEventListener('app:hot_reload:doc_unload', () => {
    active = false
  })
  window.addEventListener('app:hot_reload:doc_loaded', () => {
    if (app.state.repository === 'analogdevicesinc.github.io')
      active = true
  })
  window.addEventListener('app:hot_reload:page_unload', () => {
    if (!active || !landing)
      return
    landing.deinit()
    hero.deinit()
    landing = hero = undefined
  })
  window.addEventListener('app:hot_reload:page_loaded', () => {
    if (active)
      init()
  })
}

(async () => {
  await WaitEvent(window, 'app', "app:created")
  LandingPage()
})()
