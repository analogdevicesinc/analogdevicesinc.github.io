"use strict";

import { clamp, hash, ambient } from '../field.js'
import { text, wrap, hud_bottom } from '../ui.js'
import { Chip, note } from '../chip.js'

// Chess: two players at one screen, taking turns. Full rules: check,
// checkmate, stalemate, castling, en passant and promotion (to a queen). The
// board and the pieces are drawn by the pixel field: every square is a 7x7
// block of cells, and each piece a 7x7 pixel glyph on it. White plays the
// white pieces; the other side plays amber, which reads better on the field
// than black would.
//
// - Tap a piece to see its moves, then tap where it goes. Dragging works
//   too. To castle, move the king two squares toward the rook.
// - The last move stays marked, and a king in check burns.

const sprite_size = 7
const margin = 12

const colors = {
  text: '#e9eef5',
  muted: 'rgba(233, 238, 245, .62)',
  accent: '#62c5dd',
  gold: '#ffc36b',
  danger: '#ff6b6b',
  amber: '#f2994a',
  select: '#62c5dd',
  target: '#8bd7cf',
  last: '#c1b4ef',
}

const side_names = ['White', 'Amber']

// Piece glyphs, 7x7, rows from the top.
const glyphs = {
  p: [
    '.......',
    '...#...',
    '..###..',
    '..###..',
    '...#...',
    '..###..',
    '.#####.',
  ],
  r: [
    '.#.#.#.',
    '.#####.',
    '..###..',
    '..###..',
    '..###..',
    '..###..',
    '.#####.',
  ],
  n: [
    '...##..',
    '..####.',
    '.##.##.',
    '.#####.',
    '...##..',
    '..###..',
    '.#####.',
  ],
  b: [
    '...#...',
    '..##...',
    '..###..',
    '..###..',
    '...#...',
    '..###..',
    '.#####.',
  ],
  q: [
    '#..#..#',
    '.#.#.#.',
    '.#####.',
    '..###..',
    '..###..',
    '..###..',
    '.#####.',
  ],
  k: [
    '...#...',
    '..###..',
    '...#...',
    '..###..',
    '..###..',
    '..###..',
    '.#####.',
  ],
}
const glyph_cells = Object.fromEntries(Object.entries(glyphs).map(([type, rows]) =>
  [type, rows.map(row => row.split('').map(ch => ch === '#'))]))

// A slow, thoughtful tune in A dorian, for a long think.
const tune = {
  bpm: 92,
  volume: 0.1,
  bass_volume: 0.24,
  lead:
    'A4:1.5 B4:0.5 C5 E5 ' +
    'D5:1.5 C5:0.5 B4 R ' +
    'G4:1.5 A4:0.5 B4 D5 ' +
    'C5:1.5 B4:0.5 A4 R ' +
    'E5:1.5 D5:0.5 C5 B4 ' +
    'A4:1.5 G4:0.5 F#4 R ' +
    'G4 A4 B4 C5 ' +
    'A4:3 R',
  bass:
    'A2 R E3 R ' +
    'G2 R D3 R ' +
    'F2 R C3 R ' +
    'G2 R D3 R ' +
    'A2 R E3 R ' +
    'F2 R C3 R ' +
    'G2 R E2 R ' +
    'A2 R R R',
}

const file_of = sq => sq % 8
const rank_of = sq => Math.floor(sq / 8)
const square = (file, rank) => rank * 8 + file
const on_board = (file, rank) => file >= 0 && file < 8 && rank >= 0 && rank < 8

const knight_steps = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
const bishop_dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const rook_dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const king_steps = [...bishop_dirs, ...rook_dirs]

// -- Rules --------------------------------------------------------------

// A position: 64 squares of { type, color } or null, whose turn (0 white,
// 1 amber), castling rights per side (king side, queen side), and the en
// passant square if the last move was a double pawn push.
const initial = () => {
  const board = new Array(64).fill(null)
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']
  for (let file = 0; file < 8; file++) {
    board[square(file, 0)] = { type: back[file], color: 0 }
    board[square(file, 1)] = { type: 'p', color: 0 }
    board[square(file, 6)] = { type: 'p', color: 1 }
    board[square(file, 7)] = { type: back[file], color: 1 }
  }
  return { board, turn: 0, castling: [[true, true], [true, true]], en_passant: -1 }
}

const clone = position => ({
  board: position.board.slice(),
  turn: position.turn,
  castling: position.castling.map(rights => rights.slice()),
  en_passant: position.en_passant,
})

// Is `sq` attacked by `color`?
const attacked = (position, sq, color) => {
  const { board } = position
  const file = file_of(sq)
  const rank = rank_of(sq)
  const dir = color === 0 ? 1 : -1
  for (const df of [-1, 1]) {
    const f = file + df
    const r = rank - dir
    if (on_board(f, r)) {
      const piece = board[square(f, r)]
      if (piece && piece.color === color && piece.type === 'p') return true
    }
  }
  for (const [df, dr] of knight_steps) {
    const f = file + df
    const r = rank + dr
    if (!on_board(f, r)) continue
    const piece = board[square(f, r)]
    if (piece && piece.color === color && piece.type === 'n') return true
  }
  for (const [df, dr] of king_steps) {
    const f = file + df
    const r = rank + dr
    if (!on_board(f, r)) continue
    const piece = board[square(f, r)]
    if (piece && piece.color === color && piece.type === 'k') return true
  }
  const slide = (dirs, types) => {
    for (const [df, dr] of dirs) {
      let f = file + df
      let r = rank + dr
      while (on_board(f, r)) {
        const piece = board[square(f, r)]
        if (piece) {
          if (piece.color === color && types.includes(piece.type)) return true
          break
        }
        f += df
        r += dr
      }
    }
    return false
  }
  return slide(bishop_dirs, ['b', 'q']) || slide(rook_dirs, ['r', 'q'])
}

const king_square = (position, color) =>
  position.board.findIndex(piece => piece && piece.type === 'k' && piece.color === color)

const in_check = (position, color) => attacked(position, king_square(position, color), 1 - color)

// Moves of the piece on `from`, without checking the king's safety. A move is
// { from, to, capture?, castle?, en_passant?, promote? }.
const pseudo_moves = (position, from) => {
  const { board } = position
  const piece = board[from]
  const moves = []
  const file = file_of(from)
  const rank = rank_of(from)
  const color = piece.color
  const add = (f, r, extra = {}) => {
    const to = square(f, r)
    moves.push({ from, to, capture: board[to] !== null, ...extra })
  }
  const slide = dirs => {
    for (const [df, dr] of dirs) {
      let f = file + df
      let r = rank + dr
      while (on_board(f, r)) {
        const other = board[square(f, r)]
        if (other) {
          if (other.color !== color) add(f, r)
          break
        }
        add(f, r)
        f += df
        r += dr
      }
    }
  }
  const step = steps => {
    for (const [df, dr] of steps) {
      const f = file + df
      const r = rank + dr
      if (!on_board(f, r)) continue
      const other = board[square(f, r)]
      if (!other || other.color !== color) add(f, r)
    }
  }

  switch (piece.type) {
    case 'p': {
      const dir = color === 0 ? 1 : -1
      const start = color === 0 ? 1 : 6
      const last = color === 0 ? 7 : 0
      const r = rank + dir
      if (on_board(file, r) && !board[square(file, r)]) {
        add(file, r, { promote: r === last })
        if (rank === start && !board[square(file, r + dir)]) add(file, r + dir, { double: true })
      }
      for (const df of [-1, 1]) {
        const f = file + df
        if (!on_board(f, r)) continue
        const to = square(f, r)
        const other = board[to]
        if (other && other.color !== color) add(f, r, { promote: r === last })
        else if (to === position.en_passant) add(f, r, { en_passant: true, capture: true })
      }
      break
    }
    case 'n': step(knight_steps); break
    case 'b': slide(bishop_dirs); break
    case 'r': slide(rook_dirs); break
    case 'q': slide([...bishop_dirs, ...rook_dirs]); break
    case 'k': {
      step(king_steps)
      // Castling: king and rook unmoved, the squares between empty, and the
      // king neither in check nor crossing or landing on an attacked square.
      const home = color === 0 ? 0 : 7
      if (rank === home && file === 4 && !attacked(position, from, 1 - color)) {
        const [king_side, queen_side] = position.castling[color]
        if (king_side && !board[square(5, home)] && !board[square(6, home)] &&
          board[square(7, home)]?.type === 'r' && board[square(7, home)]?.color === color &&
          !attacked(position, square(5, home), 1 - color) && !attacked(position, square(6, home), 1 - color)) {
          add(6, home, { castle: 'king' })
        }
        if (queen_side && !board[square(3, home)] && !board[square(2, home)] && !board[square(1, home)] &&
          board[square(0, home)]?.type === 'r' && board[square(0, home)]?.color === color &&
          !attacked(position, square(3, home), 1 - color) && !attacked(position, square(2, home), 1 - color)) {
          add(2, home, { castle: 'queen' })
        }
      }
      break
    }
  }
  return moves
}

// Plays a move on a copy of the position.
const apply = (position, move) => {
  const next = clone(position)
  const { board } = next
  const piece = board[move.from]
  const color = piece.color
  const home = color === 0 ? 0 : 7
  board[move.to] = move.promote ? { type: 'q', color } : piece
  board[move.from] = null
  if (move.en_passant) board[square(file_of(move.to), rank_of(move.from))] = null
  if (move.castle === 'king') {
    board[square(5, home)] = board[square(7, home)]
    board[square(7, home)] = null
  } else if (move.castle === 'queen') {
    board[square(3, home)] = board[square(0, home)]
    board[square(0, home)] = null
  }
  // Rights go with a king or rook that moves, or a rook that is captured.
  if (piece.type === 'k') next.castling[color] = [false, false]
  for (const [c, rank] of [[0, 0], [1, 7]]) {
    if (move.from === square(7, rank) || move.to === square(7, rank)) next.castling[c][0] = false
    if (move.from === square(0, rank) || move.to === square(0, rank)) next.castling[c][1] = false
  }
  next.en_passant = move.double ? square(file_of(move.from), (rank_of(move.from) + rank_of(move.to)) / 2) : -1
  next.turn = 1 - color
  return next
}

// Legal moves of the piece on `from`: those that leave its own king safe.
const legal_moves = (position, from) =>
  pseudo_moves(position, from).filter(move => !in_check(apply(position, move), position.board[from].color))

const has_moves = (position, color) => {
  for (let sq = 0; sq < 64; sq++) {
    const piece = position.board[sq]
    if (piece && piece.color === color && legal_moves(position, sq).length) return true
  }
  return false
}

// -- Game ---------------------------------------------------------------

class Chess {
  constructor (stage) {
    this.stage = stage
    this.store = stage.storage('chess')
    this.time = 0
    this.state = 'ready'
    this.state_time = 0
    this.chip = null
    this.music = null
    this.reset()
  }

  reset () {
    this.position = initial()
    this.selected = -1
    this.moves = []
    this.last = null
    this.move_number = 1
    this.check = false
    this.result = null
    this.ripples = []
    this.flash = 0
    this.drag = null
    this.captured = [[], []]
  }

  // Called from a tap or key press, so audio may start.
  start () {
    this.chip ??= new Chip()
    this.chip.resume()
    this.reset()
    this.state = 'playing'
    this.state_time = 0
    this.music?.stop()
    this.music = this.chip.tune(tune)
  }

  // -- Board geometry -------------------------------------------------------

  // The board is 8 squares of 7 cells; the cell size fits the space below
  // the HUD, and the field grid is anchored on the board's corner.
  get layout () {
    const { width, height } = this.stage
    const room = Math.min(width - margin * 2, height - hud_bottom - margin)
    const cell = Math.max(3, Math.floor(room / (8 * sprite_size)))
    const size = cell * 8 * sprite_size
    const x = Math.round((width - size) / 2)
    const y = Math.round(hud_bottom + (height - hud_bottom - size) / 2)
    return { cell, size, x, y, gap: Math.max(1, Math.round(cell * 0.18)) }
  }

  // Screen point to a square, or -1 off the board. White sits at the bottom.
  square_at (px, py, layout = this.layout) {
    const file = Math.floor((px - layout.x) / (layout.cell * sprite_size))
    const row = Math.floor((py - layout.y) / (layout.cell * sprite_size))
    if (!on_board(file, row)) return -1
    return square(file, 7 - row)
  }

  // -- Input ----------------------------------------------------------------

  pointer (type, x, y) {
    if (this.state !== 'playing') {
      if (type !== 'down') return
      if (this.state === 'over' && this.state_time < 0.9) return
      this.start()
      return
    }
    const sq = this.square_at(x, y)
    if (type === 'down') {
      this.drag = sq
      this.tap(sq)
    } else if (type === 'up') {
      // A drag from a piece to a target square plays the move on release.
      if (this.drag >= 0 && sq !== this.drag && this.selected === this.drag) this.tap(sq)
      this.drag = null
    }
  }

  key (type, event) {
    if (event.key !== ' ' && event.key !== 'Enter') return false
    if (type === 'down' && !event.repeat && this.state !== 'playing') {
      if (!(this.state === 'over' && this.state_time < 0.9)) this.start()
    }
    return true
  }

  tap (sq) {
    if (sq < 0) {
      this.select(-1)
      return
    }
    const move = this.moves.find(entry => entry.to === sq)
    if (move) {
      this.play(move)
      return
    }
    const piece = this.position.board[sq]
    if (piece && piece.color === this.position.turn) this.select(sq)
    else this.select(-1)
  }

  select (sq) {
    this.selected = sq
    this.moves = sq >= 0 ? legal_moves(this.position, sq) : []
    if (sq >= 0) this.chip?.play(note('E5'), 0.03, { wave: 'square', volume: 0.1 })
  }

  play (move) {
    const taken = move.en_passant
      ? this.position.board[square(file_of(move.to), rank_of(move.from))]
      : this.position.board[move.to]
    const mover = this.position.board[move.from]
    this.position = apply(this.position, move)
    this.last = move
    this.selected = -1
    this.moves = []
    if (mover.color === 1) this.move_number += 1
    if (taken) this.captured[mover.color].push(taken.type)

    const them = this.position.turn
    this.check = in_check(this.position, them)
    const can_move = has_moves(this.position, them)
    this.ripples.push({ sq: move.to, age: 0, life: 0.5, hot: !!taken })

    if (!can_move) {
      this.result = this.check ? { winner: 1 - them } : { draw: 'stalemate' }
      this.game_over()
      return
    }

    if (move.castle) {
      this.chip?.melody([note('C5'), note('G5')], 0.08, { volume: 0.2 })
    } else if (taken) {
      this.chip?.noise(0.12, { volume: 0.4, filter: 'lowpass', freq: 1500, to: 300 })
      this.chip?.play(note('A3'), 0.08, { bass: true, volume: 0.5 })
    } else {
      this.chip?.play(note('A4'), 0.05, { wave: 'square', volume: 0.18 })
    }
    if (move.promote) this.chip?.melody(['C5', 'E5', 'G5', 'C6'].map(note), 0.07, { delay: 0.1, volume: 0.2 })
    if (this.check) {
      this.flash = 1
      this.chip?.melody([note('B5'), note('B5')], 0.12, { delay: 0.15, volume: 0.2 })
    }
  }

  game_over () {
    this.state = 'over'
    this.state_time = 0
    this.flash = 1
    this.music?.stop()
    this.music = null
    if (this.result.winner !== undefined) {
      this.chip?.melody(['C5', 'E5', 'G5', 'C6', 'G5'].map(note), 0.1, { delay: 0.2, volume: 0.22 })
      this.chip?.play(note('C6'), 0.5, { delay: 0.7, volume: 0.22 })
      this.chip?.melody(['C3', 'G3', 'C4'].map(note), 0.2, { delay: 0.2, bass: true, length: 0.18 })
    } else {
      this.chip?.melody(['E4', 'D4', 'E4', 'D4'].map(note), 0.18, { delay: 0.2, volume: 0.2 })
    }
  }

  // -- Simulation -----------------------------------------------------------

  update (dt) {
    this.time += dt
    this.state_time += dt
    this.music?.update()
    this.flash = Math.max(0, this.flash - dt * 1.5)
    for (const ripple of this.ripples) ripple.age += dt
    this.ripples = this.ripples.filter(ripple => ripple.age < ripple.life)
  }

  // -- Rendering ------------------------------------------------------------

  render (ctx) {
    const { width, height } = this.stage
    this.draw_field(ctx, width, height)
    this.draw_hud(ctx, width)
    if (this.state !== 'playing') this.draw_screen(ctx, width, height)
  }

  // Squares are dim blocks, light and dark; pieces are glyphs in white or
  // amber. The selected square is tinted, its targets get a dot (a hot one
  // on a capture), the last move is marked, and a king in check burns.
  draw_field (ctx, width, height) {
    const time = this.time
    const layout = this.layout
    const { cell } = layout
    const { board } = this.position
    const selected = this.selected
    const targets = new Map(this.moves.map(move => [move.to, move]))
    const last = this.last
    const check_sq = this.check || this.result?.winner !== undefined ? king_square(this.position, this.position.turn) : -1
    const flash = this.flash
    const flicker = Math.floor(time * 12)
    const ripples = this.ripples
    const winner = this.result?.winner
    const over = this.state === 'over'
    // Cells are indexed from the board's corner, see Field.draw with anchor.
    const c0 = Math.ceil(layout.x / cell)
    const r0 = Math.ceil(layout.y / cell)

    this.stage.field.draw(ctx, width, height, (x, y, column, row, out) => {
      const bc = column - c0
      const br = row - r0
      const file = Math.floor(bc / sprite_size)
      const rank = 7 - Math.floor(br / sprite_size)
      if (bc < 0 || br < 0 || !on_board(file, rank)) {
        out.level = ambient(x / width, y / height, time) * 0.12
        return
      }
      const sq = square(file, rank)
      const gx = bc % sprite_size
      const gy = br % sprite_size
      const piece = board[sq]
      const light_square = (file + rank) % 2 === 1

      // The piece.
      if (piece && glyph_cells[piece.type][gy][gx]) {
        if (piece.color === 0) out.light = 1
        else {
          out.level = 0.95
          out.color = colors.amber
        }
        if (sq === selected) out.light = Math.max(out.light, 0.6 + 0.4 * Math.sin(time * 6))
        if (over && winner !== undefined && piece.color === winner && hash(column + flicker * 0.29, row) > 0.8) out.light = 1
        if (sq === check_sq) out.heat = 0.9 * (0.6 + 0.4 * Math.sin(time * 10))
        return
      }

      // The square.
      let level = light_square ? 0.4 : 0.22
      let color = null
      if (sq === selected) {
        level = 0.5
        color = colors.select
      } else if (last && (sq === last.from || sq === last.to)) {
        level = light_square ? 0.5 : 0.36
        color = colors.last
      }
      const target = targets.get(sq)
      if (target) {
        const center = Math.abs(gx - 3) <= (target.capture ? 3 : 0) && Math.abs(gy - 3) <= (target.capture ? 3 : 0)
        const ring = target.capture && (gx === 0 || gx === 6 || gy === 0 || gy === 6)
        if (target.capture ? ring : center) {
          if (target.capture) out.heat = 0.7 + 0.2 * Math.sin(time * 5)
          else {
            level = 0.8 + 0.15 * Math.sin(time * 5)
            color = colors.target
          }
        } else if (!piece) {
          level = Math.max(level, 0.2)
          color = colors.target
        }
      }
      if (sq === check_sq && flash > 0) out.heat = Math.max(out.heat, flash * 0.5 * hash(column + flicker * 0.37, row))
      for (const ripple of ripples) {
        if (ripple.sq !== sq) continue
        const strength = 1 - ripple.age / ripple.life
        if (ripple.hot) out.heat = Math.max(out.heat, strength * 0.6)
        else level = Math.max(level, strength * 0.5)
      }
      out.level = level
      out.color = color
    }, { cell, gap: layout.gap, anchor_x: layout.x, anchor_y: layout.y })
  }

  // Whose move, in their colour, and the move number and state below.
  draw_hud (ctx, width) {
    const x = 24
    const middle = 34
    const font = this.stage.font
    const turn = this.position.turn
    const over = this.state === 'over'
    let head = `${side_names[turn]} to move`
    let head_color = turn === 0 ? colors.text : colors.amber
    if (over) {
      head = this.result.winner !== undefined ? `${side_names[this.result.winner]} wins` : 'Draw'
      head_color = this.result.winner === 1 ? colors.amber : colors.text
    }
    text(ctx, font, head, x, middle + 10, { size: width < 640 ? 20 : 26, weight: 800, color: head_color })

    const parts = [`MOVE ${this.move_number}`]
    if (over) parts.push(this.result.winner !== undefined ? 'CHECKMATE' : 'STALEMATE')
    else if (this.check) parts.push('CHECK')
    const material = this.material()
    if (material) parts.push(material)
    text(ctx, font, parts.join('  ·  '), x, middle + 30, {
      size: 11, weight: 600, color: this.check && !over ? colors.danger : colors.muted, spacing: '1px',
    })
  }

  // The material lead, if any, e.g. "WHITE +3".
  material () {
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9 }
    const sum = list => list.reduce((total, type) => total + values[type], 0)
    const lead = sum(this.captured[0]) - sum(this.captured[1])
    if (!lead) return ''
    return `${side_names[lead > 0 ? 0 : 1].toUpperCase()} +${Math.abs(lead)}`
  }

  draw_screen (ctx, width, height) {
    ctx.fillStyle = 'rgba(7, 11, 18, .72)'
    ctx.fillRect(0, 0, width, height)

    const center = width / 2
    const max_width = Math.min(width - 48, 640)
    const title = clamp(width * 0.06, 26, 56)
    const lines = []
    const add = (text, style, lead) => lines.push({ text, style, lead })
    const paragraph = (text, style, lead) => {
      this.wrap(ctx, text, max_width, style).forEach((line, i) => add(line, style, i ? style.size * 1.4 : lead))
    }

    if (this.state === 'ready') {
      add('ADI ARCADE', { size: 12, weight: 700, color: colors.accent, spacing: '3px' }, 0)
      add('CHESS', { size: title, weight: 800, spacing: '2px' }, title + 12)
      paragraph('Two players, taking turns at the same screen. Tap a piece to see its moves, then tap where it goes.',
        { size: 16, weight: 500, color: colors.muted }, 34)
      paragraph('Full rules: castling (move the king two squares), en passant, and pawns promote to queens.',
        { size: 14, weight: 500, color: colors.muted }, 26)
    } else {
      const won = this.result.winner !== undefined
      add(won ? 'CHECKMATE' : 'STALEMATE', { size: 12, weight: 700, color: won ? colors.gold : colors.muted, spacing: '3px' }, 0)
      add(won ? `${side_names[this.result.winner].toUpperCase()} WINS` : 'DRAW', { size: title, weight: 800, spacing: '2px' }, title + 12)
      add(`${this.move_number} moves`, { size: 16, weight: 700, color: colors.muted }, 34)
    }

    const total = lines.reduce((sum, line) => sum + line.lead, 0)
    let y = Math.max(110, (height - total) / 2 - 30)
    for (const line of lines) {
      y += line.lead
      this.text(ctx, line.text, center, y, { ...line.style, align: 'center' })
    }

    if (this.state === 'over' && this.state_time < 0.9) return

    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.time * 4)
    this.text(ctx, this.state === 'ready' ? 'Tap to start' : 'Tap to play again', center, y + 48, {
      size: 15, weight: 700, color: colors.text, align: 'center', spacing: '1px',
    })
    ctx.globalAlpha = 1
  }

  wrap (ctx, value, max_width, style) {
    return wrap(ctx, this.stage.font, value, max_width, style)
  }

  text (ctx, value, x, y, style) {
    text(ctx, this.stage.font, value, x, y, style)
  }

  destroy () {
    this.music?.stop()
    this.music = null
    this.chip?.close()
    this.chip = null
  }
}

export default {
  id: 'chess',
  name: 'Chess',
  tagline: 'Two players, full rules, in pixels.',
  controls: 'Tap to move',
  color: '#f2994a',
  available: true,
  icon: '<svg class="no-background" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 8h8l-2 6h-4l-2-6zM18 14v6M14 20h8l2 10H12l2-10zM10 30h16v6H10z"/><path d="M30 10h10v4h-3v6h3l2 14H28l2-14h3v-6h-3z" opacity=".5"/><path d="M26 38h16v4H26z" opacity=".5"/></svg>',
  create: stage => new Chess(stage),
}
