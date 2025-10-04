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

function wait_app() {
  return new Promise((resolve) => {
    let value;
    Object.defineProperty(window, 'app', {
      configurable: true,
      set (_overwrite) {
        value = _overwrite
        resolve(value)
        Object.defineProperty(window, 'app', {
          value,
          writable: true,
          configurable: true
        })
      }
    })
  })
}

(async () => {
  const app = await wait_app();

  new Landing(app)
})();
