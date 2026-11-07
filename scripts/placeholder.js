"use strict";

import { DOM } from '@shared/scripts/dom.js'

const palette = ['#0067B9', '#8E3DC7', '#0E6D95', '#16744D', '#AE4410', '#C81A28']
const width = 480
const height = 270
const cell = 30
const gap = 12

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const mix = (a, b, amount) => a + (b - a) * amount

const seed = text => {
  let h = 2166136261
  for (const c of text)
    h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

const prng = state => () => {
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const placeholder = (text) => {
  const rand = prng(seed(text))
  const canvas = DOM.new('canvas', { className: 'placeholder' })
  canvas.setAttribute('aria-hidden', 'true')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const color = palette[Math.floor(rand() * palette.length)]
  canvas.style.setProperty('--placeholder', color)
  ctx.fillStyle = color

  const blobs = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: mix(40, 110, rand()),
  }))

  const columns = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const offset_x = (width - columns * cell) * 0.5
  const offset_y = (height - rows * cell) * 0.5

  for (let row = 0; row < rows; row++) {
    const y = offset_y + (row + 0.5) * cell
    for (let column = 0; column < columns; column++) {
      const x = offset_x + (column + 0.5) * cell

      let field = 0
      for (const blob of blobs) {
        const dx = x - blob.x
        const dy = y - blob.y
        field += (blob.r * blob.r) / (dx * dx + dy * dy + 1)
      }
      const value = clamp((field - 0.35) * 0.8 + (rand() - 0.5) * 0.15)
      if (value <= 0.08)
        continue

      const size = mix(4, cell - gap, value)
      const half = size * 0.5

      ctx.globalAlpha = clamp(mix(0.08, 0.5, value) * mix(0.5, 1.3, rand()), 0.05, 0.6)
      ctx.fillRect(x - half, y - half, size, size)
    }
  }
  ctx.globalAlpha = 1
  return canvas
}
