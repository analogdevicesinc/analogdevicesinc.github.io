import { WaitApp } from '@shared/scripts/wait_app.js'
import { DOM } from '@shared/scripts/dom.js'

class Landing {
  constructor (app) {
    this.$ = {}
    this.parent = app

    this.parent.fetch.then(this.construct.bind(this))
  }
  construct_repositories () {
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
        'target': 'blank',
        'href': key
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
        'target': 'blank',
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
    DOM.getAll('.cards.collection', this.$.body).forEach((elem) => {
      this.construct_collection(elem)
    })
  }
  construct () {
    this.$.body = DOM.get('.body')
    this.construct_repositories()
    this.parent.content_actions.then(
      this.construct_collections.bind(this)
    )
  }
}

(async () => {
  const app = await WaitApp.wait();

  new Landing(app)

})();
