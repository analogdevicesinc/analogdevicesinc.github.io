"use strict";

// Canvas text helpers shared by the arcade games.

const default_color = '#e9eef5'

export const text = (ctx, font, value, x, y, {
  size = 14,
  weight = 600,
  color = default_color,
  align = 'left',
  baseline = 'alphabetic',
  spacing = '0px',
} = {}) => {
  ctx.font = `${weight} ${size}px ${font}`
  if ('letterSpacing' in ctx) ctx.letterSpacing = spacing
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.fillText(value, x, y)
}

// Greedy word wrap, measured with the style the lines will be drawn in.
export const wrap = (ctx, font, value, max_width, { size = 14, weight = 600 } = {}) => {
  ctx.font = `${weight} ${size}px ${font}`
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  const lines = []
  let line = ''
  for (const word of value.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > max_width) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

// Top bar, level with the arcade toolbar: the score with the lives and the
// charge beside it (while playing, for games that have them), and one muted
// line of level, time and best below. If the score grows into the toolbar
// (narrow phones), the lives and charge move to the end of the second line.
// Games keep their board below `hud_bottom`.
export const hud_bottom = 80

// Room the toolbar (Games and close buttons) takes on the right.
const toolbar_width = 150

export const hud = (ctx, font, width, {
  score,
  level,
  elapsed,
  best,
  playing = false,
  lives = 0,
  lives_max = 0,
  hurt = false,
  charge = 0,
  charge_max = 0,
}) => {
  const x = 24
  const middle = 34
  const pips = playing && lives_max ? lives_max * 13 + 9 : 0
  const cells = playing && charge_max ? charge_max * 22 - 4 : 0

  text(ctx, font, String(score), x, middle + 10, { size: 28, weight: 800 })
  let left = x + ctx.measureText(String(score)).width + 16
  let y = middle
  if (left + pips + cells > width - toolbar_width) {
    left = width - x - pips - cells
    y = middle + 26
  }

  for (let i = 0; i < (pips ? lives_max : 0); i++) {
    ctx.fillStyle = i < lives ? (hurt ? '#ff6b6b' : '#62c5dd') : 'rgba(255, 255, 255, .14)'
    ctx.fillRect(left, y - 4, 8, 8)
    left += 13
  }
  left += pips ? 9 : 0

  for (let i = 0; i < (cells ? charge_max : 0); i++) {
    const fill = Math.min(1, Math.max(0, charge - i))
    ctx.fillStyle = 'rgba(255, 255, 255, .12)'
    ctx.fillRect(left, y - 3, 18, 6)
    ctx.fillStyle = fill >= 1 ? '#62c5dd' : 'rgba(98, 197, 221, .45)'
    ctx.fillRect(left, y - 3, 18 * fill, 6)
    left += 22
  }

  text(ctx, font, `LEVEL ${level}  ·  ${Math.floor(elapsed)}s  ·  BEST ${Math.max(best, score)}`, x, middle + 30, {
    size: 11,
    weight: 600,
    color: 'rgba(233, 238, 245, .62)',
    spacing: '1px',
  })
}
