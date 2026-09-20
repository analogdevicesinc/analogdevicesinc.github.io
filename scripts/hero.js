"use strict";

import { DOM } from '@shared/scripts/dom.js'

export class Hero {
  constructor (app) {
    this.app = app
    this.$ = {}

    this.construct()

    app.hero = this
  }

  construct () {
    this.mount()
    this.init_background()
  }

  mount () {
    const container = document.querySelector("div.hero")

    if (!container) {
      console.warn("Hero: div.hero not on page.")
      return
    }

    const panel = DOM.new("section", { className: "hero-panel" })
    const inner = DOM.new("div", { className: "hero-inner" })
    const eyebrow = DOM.new("div", { className: "hero-eyebrow" })
    eyebrow.append(
      DOM.new("span", { innerText: "ADI" }),
      DOM.new("span", { innerText: "Open Source" })
    )
    inner.append(
      eyebrow,
      this.add_headline(),
      DOM.new("p", {
        className: "hero-lead",
        innerText: "Explore our open source solutions to build with confidence."
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
      className: "hero-headline",
      innerText: "Open code, ship faster."
    })
    this.$.headline = h1
    return h1
  }

  add_canvas () {
    const wrap = DOM.new("div", { className: "hero-pixel-field" })
    const canvas = DOM.new("canvas", { id: "hero-pixels" })
    canvas.setAttribute("aria-hidden", "true")

    wrap.append(canvas)
    this.$.canvas = canvas
    return wrap
  }

  init_background () {
    const canvas = this.$.canvas
    const container = this.$.container
    if (!canvas || !container) return

    const ctx = canvas.getContext("2d", { alpha: true })
    const reduced_motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const palette = ["#627eea", "#6e8ef2", "#64a9ee", "#62c5dd", "#8bd7cf", "#c1b4ef"]

    let width = 0
    let height = 0
    let animation_frame

    const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
    const mix = (a, b, amount) => a + (b - a) * amount
    const fade = value => value * value * (3 - 2 * value)
    const hash = (x, y) => {
      const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
      return value - Math.floor(value)
    }
    const noise = (x, y) => {
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const tx = fade(x - x0)
      const ty = fade(y - y0)
      const top = mix(hash(x0, y0), hash(x0 + 1, y0), tx)
      const bottom = mix(hash(x0, y0 + 1), hash(x0 + 1, y0 + 1), tx)
      return mix(top, bottom, ty)
    }

    const draw = timestamp => {
      const time = timestamp * 0.001
      const cell = width < 640 ? 14 : 17
      const gap = width < 640 ? 3 : 4
      const columns = Math.ceil(width / cell) + 1
      const rows = Math.ceil(height / cell) + 1
      // The grid is centered on the field, so both edges are cropped equally.
      const offset_x = Math.round((width - columns * cell) * 0.5)
      const offset_y = Math.round((height - rows * cell) * 0.5)
      const max_size = cell - gap
      const min_size = Math.max(1, cell * 0.16)

      ctx.clearRect(0, 0, width, height)

      for (let row = 0; row < rows; row++) {
        // Sample the height field at the cell center, which is also the anchor
        // the square grows from and shrinks back to.
        const center_y = offset_y + (row + 0.5) * cell
        const v = center_y / Math.max(height, 1)

        for (let column = 0; column < columns; column++) {
          const center_x = offset_x + (column + 0.5) * cell
          const u = center_x / Math.max(width, 1)

          // Several crossing waves form a height field viewed directly from above.
          const broad_wave = Math.sin(u * 8.5 + v * 5.2 - time * 1.25)
          const cross_wave = Math.sin(u * -3.8 + v * 10.5 + time * 0.82)
          const fine_wave = Math.sin((u + v) * 18 - time * 1.8)
          const turbulence = noise(u * 5.2 + time * 0.11, v * 5.2 - time * 0.08)

          let height_value = 0.5
          height_value += broad_wave * 0.23
          height_value += cross_wave * 0.13
          height_value += fine_wave * 0.05
          height_value += (turbulence - 0.5) * 0.36

          const intensity = clamp(height_value)
          const crest = Math.pow(intensity, 1.55)
          const alpha = mix(0.08, 0.72, crest)
          const palette_index = Math.min(palette.length - 1, Math.floor(intensity * palette.length))

          const size = mix(min_size, max_size, crest)
          const half = size * 0.5

          ctx.globalAlpha = alpha
          ctx.fillStyle = palette[palette_index]
          ctx.fillRect(center_x - half, center_y - half, size, size)
        }
      }

      ctx.globalAlpha = 1
    }

    const tick = timestamp => {
      draw(timestamp)
      animation_frame = requestAnimationFrame(tick)
    }

    const resize_canvas = () => {
      const bounds = canvas.parentElement.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, Math.round(bounds.width))
      height = Math.max(1, Math.round(bounds.height))

      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (reduced_motion.matches) draw(0)
    }

    const update_motion = () => {
      cancelAnimationFrame(animation_frame)
      if (reduced_motion.matches) {
        draw(0)
      } else {
        animation_frame = requestAnimationFrame(tick)
      }
    }

    reduced_motion.addEventListener("change", update_motion)

    const resize_observer = new ResizeObserver(resize_canvas)
    resize_observer.observe(container)

    resize_canvas()
    update_motion()
  }
}
