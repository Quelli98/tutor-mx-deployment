import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Coverage instrumentation plus jsdom can be substantially slower on the
    // shared runner. This remains a bounded per-test timeout; assertions and
    // coverage requirements are unchanged.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    globals: true,
    pool: 'forks',
    // Avoid exhausting the shared runner with dozens of instrumented jsdom
    // workers. Two workers keeps coverage deterministic without serialising
    // the entire frontend suite.
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/main.jsx'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
})
