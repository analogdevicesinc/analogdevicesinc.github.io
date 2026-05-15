import alias from '@rollup/plugin-alias'
import terser from '@rollup/plugin-terser'
import path from 'path'

const doctools_path = process.env.DOCTOOLS_PATH
let shared = path.resolve(`${doctools_path}/adi_doctools/theme/harmonic`)

export default [
  {
    input: `./scripts/landing-page.js`,
    output: {
      file: `./docs/sources/landing-page.umd.js`,
      format: "umd",
      name: "LandingPage",
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
  }
]

