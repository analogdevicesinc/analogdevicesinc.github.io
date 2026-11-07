"use strict";

import { WaitEvent } from '@shared/scripts/event.js'

const local = (app, attr, ev, key) =>
  new Promise(resolve => {
    (async () => {
      await WaitEvent(app, attr, ev)
      app[attr].then(() => resolve(app.state[key]))
    })()
  })

export const repotoc = (app) =>
  local(app, 'fetch', 'app:fetch:constructed', 'metadata').then(obj => obj.repotoc)

export const collection = (app) =>
  local(app, 'content_actions', 'app:content_actions:constructed', 'collection').then(obj => obj.collection)
