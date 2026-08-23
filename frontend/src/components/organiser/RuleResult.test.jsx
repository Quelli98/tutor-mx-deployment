import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RuleResult } from './RuleResult'

describe('RuleResult', () => {
  it.each([
    ['pass', 'Mark eligibility: Pass'],
    ['fail', 'Mark eligibility: Fail'],
    ['unknown', 'Mark eligibility: Not checked'],
  ])('shows a written %s result so colour is not the only status signal', (state, text) => {
    render(<RuleResult label="Mark eligibility" state={state} message="Rule detail" />)

    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByText('Rule detail')).toBeInTheDocument()
  })
})
