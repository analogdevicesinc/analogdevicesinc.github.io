"use strict";

import { DOM } from '@shared/scripts/dom.js'

export class Cover {
  constructor (app) {
    this.app = app
    this.$ = {}

    this.construct()

    app.cover = this
  }

  construct() {
    this.mount()
    this.init_background()
  }

  mount() {
    const container = document.querySelector("div.hero")

    if (!container) {
      console.warn("Cover: div.hero not on page.")
      return
    }

    const panel = DOM.new("section", { className: "panel content" })
    const inner = DOM.new("div", { className: "inner" })
    inner.append(
      DOM.new("div", { className: "eyebrow", innerText: "Open Source" }),
      this.add_headline(),
      DOM.new("p", {
        className: "lead",
        innerText: "Explore our open source drivers and solutions to build with confidence on ADI platforms."
      }),
    )
    panel.append(
      this.add_canvas(),
      inner,
    )

    container.append(panel)

    this.$.container = container
  }

  add_headline () {
    const h1 = DOM.new("h1", {
      className: "headline",
      innerText: "Open code, ship faster."
    })
    this.$.headline = h1
    return h1
  }

  add_canvas () {
    const wrap = DOM.new("div", { className: "waves-wrap" })
    const canvas = DOM.new("canvas", {
      id: "waves",
    })

    wrap.append(canvas)
    this.$.canvas = canvas
    return wrap
  }

  init_background () {
    const canvas = this.$.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let w, h

    const waves = [
      {
        amplitude: 15,
        frequency: 0.02,
        phase: 2,
        speed: -0.01,
        color: "rgba(110, 190, 220, 0.1)",
        lineWidth: 1
      },
      {
        amplitude: 20,
        frequency: 0.015,
        phase: 2,
        speed: -0.01,
        color: "rgba(110, 190, 220, 0.2)",
        lineWidth: 1
      },
      {
        amplitude: 30,
        frequency: 0.012,
        phase: 0,
        speed: -0.015,
        color: "rgba(110, 190, 220, 0.3)",
        lineWidth: 2
      },
      {
        amplitude: 40,
        frequency: 0.008,
        phase: 1,
        speed: -0.013,
        color: "rgba(110, 190, 220, 0.4)",
        lineWidth: 3
      },
    ];

    let resize_canvas = () => {
      const new_width = this.$.container.clientWidth;
      const new_height = this.$.container.clientHeight;

      if (canvas.width !== new_width || canvas.height !== new_height) {
        w = canvas.width = new_width;
        h = canvas.height = new_height;
      }
    }

    let tick = () => {
        ctx.clearRect(0, 0, w, h);

        waves.forEach(wave => {
          wave.phase += wave.speed;

          ctx.beginPath();
          ctx.strokeStyle = wave.color;
          ctx.lineWidth = wave.lineWidth;

          ctx.moveTo(-5, h)

          for (let x = -5; x < w + 5; x++) {
            const taper = Math.sin(((x + 100) / w) * Math.PI) + x / w

            const dyn_amp = wave.amplitude * taper

            const y = (h * 0.9) + Math.sin(x * wave.frequency + wave.phase) * dyn_amp - (h * (x / w))*.1
            ctx.lineTo(x, y)
          }

          ctx.lineTo(w + 5, h)

          ctx.stroke()
          ctx.fillStyle = "rgba(110, 190, 220, 0.02)";
          ctx.fill()
        })

        requestAnimationFrame(tick);
      }

    addEventListener('resize', resize_canvas)
    addEventListener("DOMContentLoaded", resize_canvas())
    resize_canvas()
    tick()
  }
}

