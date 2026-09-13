import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmationDialog } from './ConfirmationDialog'

describe('ConfirmationDialog', () => {
  it('does not render when closed', () => {
    render(
      <ConfirmationDialog
        open={false}
        title="Confirm volunteer"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        Confirmation details
      </ConfirmationDialog>,
    )

    expect(
      screen.queryByRole('dialog'),
    ).not.toBeInTheDocument()
  })

  it('renders the confirmation details when open', () => {
    render(
      <ConfirmationDialog
        open
        title="Confirm volunteer"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        <p>DEMO101</p>
        <p>Demo Course</p>
        <p>2 hours</p>
      </ConfirmationDialog>,
    )

    expect(
      screen.getByRole('dialog'),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', {
        name: 'Confirm volunteer',
      }),
    ).toBeInTheDocument()

    expect(screen.getByText('DEMO101')).toBeInTheDocument()
    expect(screen.getByText('Demo Course')).toBeInTheDocument()
    expect(screen.getByText('2 hours')).toBeInTheDocument()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <ConfirmationDialog
        open
        title="Confirm volunteer"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      >
        Confirmation details
      </ConfirmationDialog>,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Cancel',
      }),
    )

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onConfirm when Confirm is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <ConfirmationDialog
        open
        title="Confirm volunteer"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      >
        Confirmation details
      </ConfirmationDialog>,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Confirm',
      }),
    )

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables both actions while pending', () => {
    render(
      <ConfirmationDialog
        open
        title="Confirm volunteer"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        isPending
      >
        Confirmation details
      </ConfirmationDialog>,
    )

    expect(
      screen.getByRole('button', {
        name: 'Confirming...',
      }),
    ).toBeDisabled()

    expect(
      screen.getByRole('button', {
        name: 'Cancel',
      }),
    ).toBeDisabled()
  })

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(
      <ConfirmationDialog
        open
        title="Confirm volunteer"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      >
        Confirmation details
      </ConfirmationDialog>,
    )

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the control that opened the dialog', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Volunteer
          </button>
          <ConfirmationDialog
            open={open}
            title="Confirm volunteer"
            onConfirm={vi.fn()}
            onCancel={() => setOpen(false)}
          >
            Confirmation details
          </ConfirmationDialog>
        </>
      )
    }

    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Volunteer' })
    await user.click(opener)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(opener).toHaveFocus()
  })
})
