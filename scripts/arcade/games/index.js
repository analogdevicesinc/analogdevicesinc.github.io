"use strict";

// Game registry, in menu order. Each entry provides:
//   id, name, tagline, controls, color (card accent), icon (SVG markup), available,
//   create(stage) -> { update(dt), render(ctx), pointer?(type, x, y, event),
//                      key?(type, event) -> handled, destroy?() }

import frequency_hopper from './frequency-hopper.js'
import accumulator from './accumulator.js'
import sequencer from './sequencer.js'
import slew_rate from './slew-rate.js'
import pong from './pong.js'
import chess from './chess.js'

export const games = [frequency_hopper, accumulator, sequencer, slew_rate, pong, chess]
