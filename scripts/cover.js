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
        innerText: "Explore our open source drivers and solutions to build with confidence."
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

    let t = Date.now() / 1000
    const waves = [
      {
        amplitude: 15,
        frequency: 0.02,
        phase: -t - 50,
        speed: -0.01,
        color: "rgba(212, 173, 240, 0.2)",
        fill_color: "rgba(212, 173, 240, 0.03)",
        lineWidth: 1
      },
      {
        amplitude: 20,
        frequency: 0.015,
        phase: -t - 30,
        speed: -0.014,
        color: "rgba(180, 180, 230, 0.3)",
        fill_color: "rgba(180, 180, 230, 0.05)",
        lineWidth: 1
      },
      {
        amplitude: 25,
        frequency: 0.012,
        phase: -t - 10,
        speed: -0.017,
        color: "rgba(130, 185, 225, 0.4)",
        fill_color: "rgba(130, 185, 225, 0.075)",
        lineWidth: 2
      },
      {
        amplitude: 35,
        frequency: 0.008,
        phase: -t - 20,
        speed: -0.02,
        color: "rgba(110, 190, 220, 0.4)",
        fill_color: "rgba(110, 190, 220, 0.1)",
        lineWidth: 3
      },
    ];

    let resize_canvas = () => {
      const new_width = this.$.container.clientWidth
      const new_height = this.$.container.clientHeight
      const dpr = window.devicePixelRatio

      if (canvas.width !== new_width || canvas.height !== new_height) {
        ctx.scale(dpr, dpr)
        w = canvas.width = new_width * dpr
        h = canvas.height = new_height * dpr

        canvas.style.width = `${new_width}px`
        canvas.style.height = `${new_height}px`
      }
    }

    let lerp = (t, x) => {
      let c =  Math.sin(t) +  Math.cos(x*0.02)  + Math.cos(x)
      return c < 0.5 ? 2*c*c : 1 - Math.pow(-2*c+2, 2)/2
    }

    let frequency
    let tick = () => {
        ctx.clearRect(0, 0, w, h);

        waves.forEach(wave => {
          wave.phase += wave.speed;

          ctx.beginPath();
          ctx.strokeStyle = wave.color;
          ctx.lineWidth = wave.lineWidth;

          ctx.moveTo(-5, h)

          for (let x = -5; x < w + 5; x++) {
            frequency = 0.0003*lerp(t, x + wave.phase * 2)
            const taper = Math.sin(((x + 100) / w) * Math.PI) + x / w

            const dyn_amp = wave.amplitude * taper
            const clamper = h / 300

            const y = (h * 0.95) + (Math.sin(x * wave.frequency + wave.phase) * dyn_amp - (h * (x / w))*.1  +
                                    Math.sin(x * frequency + wave.phase) * 5) * clamper
            ctx.lineTo(x, y)
          }

          ctx.lineTo(w + 5, h)

          ctx.stroke()
          ctx.fillStyle = wave.fill_color;
          ctx.fill()
          t += 0.01
        })

        requestAnimationFrame(tick);
      }

    addEventListener('resize', resize_canvas)
    addEventListener('DOMContentLoaded', resize_canvas)
    setTimeout(resize_canvas, 100)
    resize_canvas()
    tick()
  }
}

