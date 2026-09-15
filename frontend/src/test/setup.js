import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// Coverage instrumentation and slow CI/Windows runners can push a state update
// past Testing Library's 1s default async poll window even though the Vitest
// test timeout is far higher. Give findBy*/waitFor room so genuine async flows
// are not reported as flaky failures.
configure({ asyncUtilTimeout: 5_000 })
