import alias from '@rollup/plugin-alias'
import terser from '@rollup/plugin-terser'
import path from 'path'

let shared = path.resolve("../doctools/adi_doctools/theme/cosmic")

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

