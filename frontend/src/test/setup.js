import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'

// Coverage instrumentation and slow CI/Windows runners can push a state update
// past Testing Library's 1s default async poll window even though the Vitest
// test timeout is far higher. Give findBy*/waitFor room so genuine async flows
// are not reported as flaky failures.
configure({ asyncUtilTimeout: 5_000 })

// No test may reach a real server. An API module a test did not mock would
// otherwise call whatever is running on localhost (for example `npm run dev`),
// and a 401 from it ends the signed-in session part-way through the test.
// Tests that exercise the API client assign their own fetch.
beforeEach(() => {
  globalThis.fetch = vi.fn(async (input) => {
    throw new TypeError(`Network access is disabled in tests (${String(input)})`)
  })
})
