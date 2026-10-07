import { useEffect, useRef } from 'react'
/** Announce server conflicts and give keyboard users a stable recovery point. */
export function ConflictNotice({ message }) {
  const ref = useRef(null)
  useEffect(() => { if (message) ref.current?.focus() }, [message])
  return message ? <p ref={ref} tabIndex={-1} role="alert" className="status-message error">{message}</p> : null
}
