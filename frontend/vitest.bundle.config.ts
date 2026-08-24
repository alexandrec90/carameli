/// <reference types="vitest" />
import { defineConfig } from 'vite'

/**
 * The build-budget suite, which the default config excludes.
 *
 * `bundlePolicy.test.ts` measures `dist/` and fails when there is no build to measure,
 * on the reasoning in `.claude/rules/engineering.md`: a suite that skips itself when its
 * input is missing reports green having checked nothing. That is the right behaviour for
 * the gate and the wrong behaviour for `npm run test:run`, which must stay honest on a
 * tree nobody has built. Two configs is how both hold at once — `npm run test:bundle`
 * builds and then runs this one.
 *
 * No `environment` here: nothing under test touches a DOM. These tests read files.
 */
export default defineConfig({
  test: {
    include: ['bundlePolicy.test.ts'],
    globals: true,
  },
})
