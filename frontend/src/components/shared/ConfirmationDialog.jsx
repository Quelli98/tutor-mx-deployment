import { useEffect, useId, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ConfirmationDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isPending = false,
  returnFocusRef,
}) {
  const dialogRef = useRef(null)
  const cancelButtonRef = useRef(null)
  const previouslyFocusedRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) {
      return undefined
    }

    previouslyFocusedRef.current = document.activeElement
    const returnTarget = returnFocusRef?.current
    cancelButtonRef.current?.focus()

    return () => {
      if (previouslyFocusedRef.current?.isConnected && !previouslyFocusedRef.current.disabled) {
        previouslyFocusedRef.current.focus()
      } else if (returnTarget?.isConnected) {
        returnTarget.focus()
      }
    }
  }, [open, returnFocusRef])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (!isPending) {
          onCancel()
        }
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const dialog = dialogRef.current

      if (!dialog) {
        return
      }

      // Keep Tab inside the dialog: without this, focus walks into the page
      // behind the backdrop even though the dialog is the only visible modal.
      const focusable = Array.from(
        dialog.querySelectorAll(FOCUSABLE_SELECTOR),
      )

      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey) {
        if (activeElement === first || !dialog.contains(activeElement)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (activeElement === last || !dialog.contains(activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, isPending, onCancel])

  if (!open) {
    return null
  }

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="confirmation-dialog-content">
          <h2 id={titleId}>{title}</h2>

          <div className="confirmation-dialog-body">
            {children}
          </div>

          <div className="confirmation-dialog-actions">
            <button
              ref={cancelButtonRef}
              type="button"
              className="secondary-button"
              onClick={onCancel}
              disabled={isPending}
            >
              {cancelLabel}
            </button>

            <button
              type="button"
              className="primary-button"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Confirming...' : confirmLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
