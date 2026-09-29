"use strict";

import { WaitEvent } from '@shared/scripts/event.js'
import { DOM } from '@shared/scripts/dom.js'

import { Hero } from './hero.js'

class Landing {
  constructor (app) {
    this.$ = {}
    this.parent = app

    this.construct()

    this.parent = app
  }
  construct_repositories () {
    if (!this.active)
      return
    let repositories = DOM.get('.cards.repositories', this.$.body)
    if (!repositories)
      return

    for (const [key, value] of Object.entries(this.parent.state.metadata.repotoc)) {
      let title = DOM.new('div', {
        'className': 'title',
      })
      title.innerText = value.name
      let description = DOM.new('div', {
        'className': 'subtitle',
      })
      description.innerText = value.description
      let entry = DOM.new('a', {
        'className': 'entry',
        'href': `${key}/`
      })
      let entry_inner = DOM.new('span')
      entry_inner.append(title)
      entry_inner.append(description)
      entry.append(entry_inner)
      repositories.append(entry)
    }
  }
  collect_collections(label) {
    const label_list = label.split(',').map(l => l.trim());

    return Object.entries(this.parent.state.collection.collection)
      .filter(([key, value]) =>
        label_list.every(label => value.label.includes(label))
      )
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
  }
  construct_collection (dom) {
    const items = this.collect_collections(dom.id)
    for (const [key, value] of Object.entries(items)) {
      let entry = DOM.new('a', {
        'className': 'entry',
        'href': `${value.docname}.html`
      })
      let entry_inner = DOM.new('span')
      if (value.image) {
        let image_container = DOM.new('div', {
          'className': 'img-container',
        })
        let image = DOM.new('img', {
          'src': value.image
        })
        image_container.append(image)
        entry_inner.append(image_container)
      } else {
        let _image = DOM.new('span', {
          'className': 'spacer',
        })
        entry_inner.append(_image)
      }
      let title = DOM.new('div', {
        'className': 'title',
      })
      title.innerText = key
      let subtitle = DOM.new('div', {
        'className': 'subtitle',
      })
      subtitle.innerText = value.subtitle
      entry_inner.append(title)
      entry_inner.append(subtitle)
      if (value.description) {
        let hr = DOM.new('hr')
        let description = DOM.new('div', {
          'className': 'description',
        })
        description.innerText = value.description
        entry_inner.append(hr)
        entry_inner.append(description)
      }
      let _spacer = DOM.new('span', {
        'className': 'spacer',
      })
      entry_inner.append(_spacer)
      entry.append(entry_inner)
      dom.append(entry)
    }
  }
  construct_collections () {
    if (!this.active)
      return
    DOM.getAll('.cards.collection', this.$.body).forEach((elem) => {
      if (elem.dataset.populated)
        return
      elem.dataset.populated = ''
      this.construct_collection(elem)
    })
  }
  deinit () {
    this.active = false
  }
  construct () {
    this.active = true
    this.$.body = DOM.get('.body');

    (async () => {
      await WaitEvent(this.parent, 'fetch', "app:fetch:constructed")
      this.parent.fetch.then(
        this.construct_repositories.bind(this)
      )
    })();

    (async () => {
      await WaitEvent(this.parent, 'content_actions', "app:content_actions:constructed")
      this.parent.content_actions.then(
        this.construct_collections.bind(this)
      )
    })();
  }
}

const LandingPage = () => {
  let landing, hero
  let active = false
  const init = () => {
    landing = new Landing(app)
    hero = new Hero(app)
  }
  const deinit = () => {
    landing?.deinit()
    hero?.deinit()
    landing = hero = undefined
  }
  const activate = () => {
    active = true
    init()
  }
  const deactivate = () => {
    active = false
    deinit()
  }
  let on_visible = () => {
    activate()
    window.addEventListener('app:hot_reload:doc_deinit', deactivate)
    window.addEventListener('app:hot_reload:doc_init', () => {
      active = app.state.repository === 'analogdevicesinc.github.io'
    })
    window.addEventListener('app:hot_reload:page_loaded', () => {
      if (!active)
        return
      deinit()
      init()
    })
  }

  if (document.visibilityState === 'visible')
    on_visible()
  else
    window.addEventListener('focus', on_visible, { once: true })
}

(async () => {
  await WaitEvent(window, 'app', "app:created")
  LandingPage()
})()
