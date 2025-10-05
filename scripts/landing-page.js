import { WaitApp } from '@shared/scripts/wait_app.js'
import { DOM } from '@shared/scripts/dom.js'

class Landing {
  constructor (app) {
    this.parent = app

    this.parent.fetch.then(this.construct.bind(this))
  }
  construct_repositories () {
    let repositories = DOM.get('.body .cards.repositories')
    if (!repositories)
      return

    for (const [key, value] of Object.entries(this.parent.state.metadata.repotoc)) {
      let title = DOM.new('div', {
        'className': 'title',
      })
      title.innerText = value.name
      let description = DOM.new('div', {
        'className': 'description',
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
  construct () {
    this.construct_repositories()
  }
}

(async () => {
  const app = await WaitApp.wait();

  new Landing(app)

})();
