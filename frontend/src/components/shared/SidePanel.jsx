import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A panel that slides in from the right over the page, for work that belongs to the page
 * (such as allocating a tutor from Home) without leaving it. While it is open, everything
 * else is hidden from assistive technology and cannot take focus, Escape or the backdrop
 * closes it, and focus returns to whatever opened it. Pass returnFocusRef when the opener is
 * known: a mouse click does not focus a button in every browser.
 */
export function SidePanel({ open, title, description, onClose, closeDisabled = false, returnFocusRef, children }) {
  const panelRef = useRef(null)
  const headingRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
    closeDisabledRef.current = closeDisabled
  })

  useEffect(() => {
    if (!open) return undefined

    // Whoever opened the panel gets focus back when it closes.
    const opener = returnFocusRef?.current ?? document.activeElement
    const panelRoot = panelRef.current?.parentElement
    const hidden = []
    for (const element of Array.from(document.body.children)) {
      if (element === panelRoot || element.tagName === 'SCRIPT') continue
      hidden.push([element, element.getAttribute('aria-hidden'), element.hasAttribute('inert')])
      element.setAttribute('aria-hidden', 'true')
      element.setAttribute('inert', '')
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    headingRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        if (!closeDisabledRef.current) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      // Keep Tab inside the panel: the page behind it is inert while it is open.
      const focusable = Array.from(panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      for (const [element, ariaHidden, wasInert] of hidden) {
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
        if (!wasInert) element.removeAttribute('inert')
      }
      if (opener?.isConnected) opener.focus()
    }
  }, [open, returnFocusRef])

  if (!open) return null

  return createPortal(
    <div className="side-panel-layer">
      <div
        className="side-panel-backdrop"
        aria-hidden="true"
        onMouseDown={() => {
          if (!closeDisabled) onClose()
        }}
      />
      <section
        ref={panelRef}
        className="side-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="side-panel-header">
          <div>
            <h2 id={titleId} ref={headingRef} tabIndex={-1}>
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="helper-text">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="side-panel-close"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label={`Close ${typeof title === 'string' ? title.toLowerCase() : 'panel'}`}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>
        <div className="side-panel-body">{children}</div>
      </section>
    </div>,
    document.body,
  )
}
