"use strict";

// Game registry, in menu order. Each entry provides:
//   id, name, tagline, controls, color (card accent), icon (SVG markup), available,
//   create(stage) -> { update(dt), render(ctx), pointer?(type, x, y, event),
//                      key?(type, event) -> handled, destroy?() }

import interference from './interference.js'
import trace_router from './trace-router.js'
import frequency_hopper from './frequency-hopper.js'
import accumulator from './accumulator.js'
import sequencer from './sequencer.js'

export const games = [interference, trace_router, frequency_hopper, accumulator, sequencer]
