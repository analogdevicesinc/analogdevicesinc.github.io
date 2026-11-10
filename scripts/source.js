"use strict";

import { WaitEvent } from '@shared/scripts/event.js'

const demo = 'https://analogdevicesinc.github.io/'

const remote = (path) =>
  fetch(new URL(path, demo)).then(response => response.json())

const local = (app, attr, ev, key) =>
  new Promise(resolve => {
    (async () => {
      await WaitEvent(app, attr, ev)
      app[attr].then(() => resolve(app.state[key]))
    })()
  })

export const base = demo

export const repotoc = (app) => demo
  ? remote('doctools/metadata.json').then(obj => obj.repotoc)
  : local(app, 'fetch', 'app:fetch:constructed', 'metadata').then(obj => obj.repotoc)

export const collection = (app) => demo
  ? remote('system-level/collection.json').then(obj => obj.collection)
  : local(app, 'content_actions', 'app:content_actions:constructed', 'collection').then(obj => obj.collection)

export const href = (path) => base ? new URL(path, base).href : path
