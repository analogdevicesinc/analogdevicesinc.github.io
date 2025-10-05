import { WaitApp } from '@shared/scripts/wait_app.js'
import { DOM } from '@shared/scripts/dom.js'

class Landing {
  constructor (app) {
    this.parent = app

    this.parent.fetch.then(this.construct.bind(this))
  }
  construct () {
    // TODO: continue here, to fill page and all.
    console.log(this.parent.state.metadata)
  }
}

(async () => {
  const app = await WaitApp.wait();

  new Landing(app)
})();
