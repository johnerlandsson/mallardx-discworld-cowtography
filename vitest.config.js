import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.mjs', 'tools/**/*.test.mjs'],
  },
})
