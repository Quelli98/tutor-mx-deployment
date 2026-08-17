import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SuccessState,
} from './StatusMessage'

describe('shared status components', () => {
  it('renders a loading state', () => {
    render(
      <LoadingState
        title="Loading dashboard"
        message="Please wait."
      />,
    )

    expect(
      screen.getByRole('status'),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', {
        name: 'Loading dashboard',
      }),
    ).toBeInTheDocument()

    expect(screen.getByText('Please wait.')).toBeInTheDocument()
  })

  it('renders an empty state', () => {
    render(
      <EmptyState
        title="No assignments"
        message="Nothing has been assigned yet."
      />,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: 'No assignments',
      }),
    ).toBeInTheDocument()
  })

  it('renders an error state with a retry action', async () => {
    const onRetry = vi.fn()

    render(
      <ErrorState
        title="Unable to load"
        message="Please try again."
        onRetry={onRetry}
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Retry' }),
    ).toBeInTheDocument()
  })

  it('renders a success state', () => {
    render(
      <SuccessState
        title="Saved"
        message="Your changes were saved."
      />,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Saved' }),
    ).toBeInTheDocument()
  })
})