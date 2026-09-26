import { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidePanel } from './SidePanel'

function Harness({ onClose = vi.fn(), closeDisabled = false }) {
  const [open, setOpen] = useState(false)
  const openerRef = useRef(null)
  return (
    <>
      <main>
        <h1>Home</h1>
        <button type="button" onClick={(event) => { openerRef.current = event.currentTarget; setOpen(true) }}>
          Open panel
        </button>
      </main>
      <SidePanel
        open={open}
        title="Allocate a tutor"
        description="Checked against marks."
        closeDisabled={closeDisabled}
        returnFocusRef={openerRef}
        onClose={() => { onClose(); setOpen(false) }}
      >
        <label htmlFor="panel-course">Course</label>
        <input id="panel-course" />
        <button type="button">Save allocation</button>
      </SidePanel>
    </>
  )
}

describe('SidePanel', () => {
  it('opens as a labelled dialog, focuses its heading and hides the page behind it', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /open panel/i }))

    const dialog = screen.getByRole('dialog', { name: 'Allocate a tutor' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Checked against marks.')
    expect(screen.getByRole('heading', { name: 'Allocate a tutor' })).toHaveFocus()
    expect(screen.queryByRole('heading', { name: 'Home' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('closes with Escape, restores the page and returns focus to the opener', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: /open panel/i })
    fireEvent.click(opener)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(opener.closest('div')).not.toHaveAttribute('inert')
    expect(opener).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('closes from its close button and ignores Escape while it is busy', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Harness onClose={onClose} closeDisabled />)
    fireEvent.click(screen.getByRole('button', { name: /open panel/i }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /close allocate a tutor/i })).toBeDisabled()
    unmount()

    render(<Harness onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
    fireEvent.click(screen.getByRole('button', { name: /close allocate a tutor/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab inside the panel', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /open panel/i }))
    const save = screen.getByRole('button', { name: /save allocation/i })
    const close = screen.getByRole('button', { name: /close allocate a tutor/i })

    save.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(save).toHaveFocus()
  })
})
