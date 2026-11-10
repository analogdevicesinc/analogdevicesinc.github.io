import alias from '@rollup/plugin-alias'
import terser from '@rollup/plugin-terser'
import path from 'path'

const doctools_path = process.env.DOCTOOLS_PATH
let shared = path.resolve(`${doctools_path}/adi_doctools/theme/harmonic`)

const bundle = (input, file, name) => ({
  input,
  output: {
    file,
    format: "umd",
    name,
    sourcemap: true,
  },
  plugins: [
    alias({
      entries: [
        { find: '@shared', replacement: shared }
      ]
    }),
    terser()
  ],
})

export default [
  bundle(`./scripts/landing-page.js`, `./docs/sources/custom.umd.js`, "LandingPage"),
  // Loaded on demand by event-banner.js, exposed as window.ADIArcade.
  bundle(`./scripts/arcade/index.js`, `./docs/sources/arcade.umd.js`, "ADIArcade"),
]
