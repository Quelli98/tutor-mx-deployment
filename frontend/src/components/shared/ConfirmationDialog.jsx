import { useEffect, useRef } from 'react'

export function ConfirmationDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  isPending = false,
}) {
  const dialogRef = useRef(null)
  const cancelButtonRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }

    cancelButtonRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isPending) {
        onCancel()
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
        aria-labelledby="confirmation-dialog-title"
      >
        <div className="confirmation-dialog-content">
          <h2 id="confirmation-dialog-title">{title}</h2>

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