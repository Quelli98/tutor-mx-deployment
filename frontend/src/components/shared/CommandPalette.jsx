import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { globalSearch } from '../../api/search'

const CATEGORY_LABELS = {
  course: 'Courses',
  person: 'People',
  timesheet: 'Timesheets',
  volunteer: 'Volunteer work',
}

// variant="field" draws the opener as a wide search box (the organiser's top bar); the default
// is the compact button the tutor and student navigation use.
export function CommandPalette({ variant = 'button' }) {
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()
  const openerRef = useRef(null)
  const inputRef = useRef(null)
  const requestRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState([])
  const [status, setStatus] = useState('idle')
  const [activeIndex, setActiveIndex] = useState(0)

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setGroups([])
    setStatus('idle')
    openerRef.current?.focus()
  }, [])

  useEffect(() => {
    function onShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      } else if (event.key === 'Escape' && open) {
        event.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [close, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      return undefined
    }
    const requestId = ++requestRef.current
    const timer = window.setTimeout(async () => {
      try {
        const result = await globalSearch(term, getAccessTokenSilently)
        if (requestId !== requestRef.current) return
        setGroups(result.groups)
        setActiveIndex(0)
        setStatus('success')
      } catch {
        if (requestId === requestRef.current) setStatus('error')
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [getAccessTokenSilently, query])

  function choose(item) {
    close()
    navigate(item.linkPath)
  }

  function onInputKeyDown(event) {
    if (event.key === 'ArrowDown' && items.length) {
      event.preventDefault()
      setActiveIndex((value) => (value + 1) % items.length)
    } else if (event.key === 'ArrowUp' && items.length) {
      event.preventDefault()
      setActiveIndex((value) => (value - 1 + items.length) % items.length)
    } else if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault()
      choose(items[activeIndex])
    }
  }

  return (
    <>
      {variant === 'field' ? (
        <button ref={openerRef} type="button" className="command-palette-trigger command-palette-field" onClick={() => setOpen(true)} aria-keyshortcuts="Control+K Meta+K">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span>Search courses, people or timesheets</span>
          <kbd>Ctrl K</kbd>
        </button>
      ) : (
        <button ref={openerRef} type="button" className="command-palette-trigger" onClick={() => setOpen(true)} aria-keyshortcuts="Control+K Meta+K">
          Search <kbd>Ctrl K</kbd>
        </button>
      )}
      {open && (
        <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="Search CSAM Tutor Hub">
            <div className="command-palette-header">
              <label htmlFor="global-search">Search CSAM Tutor Hub</label>
              <button type="button" className="command-palette-close" onClick={close} aria-label="Close search">Close</button>
            </div>
            <input ref={inputRef} id="global-search" type="search" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (value.trim().length < 2) { setGroups([]); setStatus('idle') } else { setStatus('loading') } }} onKeyDown={onInputKeyDown} placeholder="Courses, people or timesheets..." autoComplete="off" aria-controls="global-search-results" />
            <div id="global-search-results" className="command-palette-results" role="listbox" aria-live="polite">
              {status === 'idle' && <p className="command-palette-hint">Type at least 2 characters.</p>}
              {status === 'loading' && <p className="command-palette-hint">Searching...</p>}
              {status === 'error' && <p className="command-palette-error" role="alert">Search is unavailable. Please try again.</p>}
              {status === 'success' && items.length === 0 && <p className="command-palette-hint">No permitted results found.</p>}
              {groups.map((group, groupIndex) => {
                const offset = groups.slice(0, groupIndex).reduce((sum, entry) => sum + entry.items.length, 0)
                return <div key={group.category} className="command-palette-group">
                  <h3>{CATEGORY_LABELS[group.category] ?? group.category}</h3>
                  {group.items.map((item, itemIndex) => {
                    const index = offset + itemIndex
                    return <button key={`${item.category}-${item.id}`} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'active' : ''} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)}><strong>{item.label}</strong><span>{item.sublabel}</span></button>
                  })}
                </div>
              })}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
