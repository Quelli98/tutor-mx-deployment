import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { globalSearch } from '../../api/search'
import { resolveDestination } from '../../api/navigation'
import { permittedDestinations, readShortcuts, saveShortcuts } from './destinations'

const CATEGORY_LABELS = { course: 'Courses', person: 'People', timesheet: 'Timesheets', volunteer: 'Volunteer work' }
export function CommandPalette({ variant = 'button', role, scope }) {
  const { getAccessTokenSilently, user } = useAuth0()
  const owner = scope ?? user?.sub
  const navigate = useNavigate()
  const location = useLocation()
  const openerRef = useRef(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const requestRef = useRef(0)
  const actionRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState([])
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [shortcutVersion, setShortcutVersion] = useState(0)
  const shortcuts = readShortcuts(owner, role)
  void shortcutVersion
  const available = useMemo(() => permittedDestinations(role), [role])
  const items = useMemo(() => groups.flatMap(group => group.items), [groups])
  const close = useCallback(() => {
    requestRef.current += 1
    actionRef.current += 1
    setOpen(false); setQuery(''); setGroups([]); setStatus('idle'); setMessage('')
    openerRef.current?.focus()
  }, [])

  useEffect(() => {
    const current = available.find(item => item.path === location.pathname)
    if (current) {
      const previous = readShortcuts(owner, role)
      saveShortcuts(owner, role, { ...previous, recent: [current.id, ...previous.recent.filter(id => id !== current.id)] })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShortcutVersion(value => value + 1)
    }
  }, [location.pathname, owner, role, available])

  useEffect(() => {
    function shortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (open) close(); else setOpen(true)
      } else if (event.key === 'Escape' && open) { event.preventDefault(); close() }
    }
    document.addEventListener('keydown', shortcut)
    return () => { document.removeEventListener('keydown', shortcut) }
  }, [close, open])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])
  useEffect(() => () => { requestRef.current += 1; actionRef.current += 1 }, [])
  useEffect(() => {
    const request = ++requestRef.current
    const term = query.trim()
    if (!open || term.length < 2) return undefined
    const timer = window.setTimeout(async () => {
      try {
        const result = await globalSearch(term, getAccessTokenSilently)
        if (request !== requestRef.current) return
        setGroups(result.groups); setActiveIndex(0); setStatus('success')
      } catch { if (request === requestRef.current) setStatus('error') }
    }, 180)
    return () => { window.clearTimeout(timer); requestRef.current += 1 }
  }, [getAccessTokenSilently, query, open])

  async function choose(target) {
    const action = ++actionRef.current
    setMessage('Checking access...')
    try {
      const result = await resolveDestination(target, getAccessTokenSilently)
      if (action !== actionRef.current) return
      close(); navigate(result.linkPath)
    } catch {
      if (action !== actionRef.current) return
      setMessage('This item is no longer available or you no longer have access.')
      setGroups([])
      requestRef.current += 1
    }
  }
  function toggleFavourite(id) {
    const previous = readShortcuts(owner, role)
    const favourites = previous.favourites.includes(id) ? previous.favourites.filter(value => value !== id) : [id, ...previous.favourites]
    saveShortcuts(owner, role, { ...previous, favourites }); setShortcutVersion(value => value + 1)
  }
  function trapFocus(event) {
    if (event.key !== 'Tab') return
    const controls = [...panelRef.current.querySelectorAll('button:not([disabled]), input')]
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  function inputKeys(event) {
    if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); setActiveIndex(value => (value + 1) % items.length) }
    else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); setActiveIndex(value => (value - 1 + items.length) % items.length) }
    else if (event.key === 'Enter' && items[activeIndex]) { event.preventDefault(); choose({ targetType: items[activeIndex].category, targetId: items[activeIndex].id }) }
  }
  const shortcutSections = [
    ['Favourites', shortcuts.favourites],
    ['Recent', shortcuts.recent.filter(id => !shortcuts.favourites.includes(id))],
    ['Destinations', available.map(item => item.id).filter(id => !shortcuts.favourites.includes(id) && !shortcuts.recent.includes(id))],
  ]
  return <>
    <button ref={openerRef} type="button" className={`command-palette-trigger${variant === 'field' ? ' command-palette-field' : ''}`} onClick={() => setOpen(true)} aria-keyshortcuts="Control+K Meta+K">
      <span>{variant === 'field' ? 'Search courses, people or timesheets' : 'Search'}</span><kbd>Ctrl K</kbd>
    </button>
    {open && <div className="command-palette-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <section ref={panelRef} className="command-palette" role="dialog" aria-modal="true" aria-label="Search CSAM Tutor Hub" onKeyDown={trapFocus}>
        <div className="command-palette-header"><label htmlFor="global-search">Search CSAM Tutor Hub</label><button className="command-palette-close" type="button" onClick={close} aria-label="Close search">Close</button></div>
        <input ref={inputRef} id="global-search" type="search" value={query} onChange={event => { requestRef.current += 1; setQuery(event.target.value); setGroups([]); setMessage(''); setStatus(event.target.value.trim().length < 2 ? 'idle' : 'loading') }} onKeyDown={inputKeys} placeholder="Courses, people or timesheets..." autoComplete="off" aria-controls="global-search-results" aria-activedescendant={items[activeIndex] ? `search-option-${activeIndex}` : undefined} />
        {message && <p role="status" className="command-palette-hint">{message}</p>}
        {status === 'idle' && <div className="shortcut-sections">{shortcutSections.map(([title, ids]) => ids.length > 0 && <section key={title} aria-label={title}><h3>{title}</h3>{ids.map(id => {
          const item = available.find(entry => entry.id === id)
          return <div className="shortcut-row" key={id}><button type="button" onClick={() => choose({ destinationId: id })}>{item.label}</button><button type="button" aria-pressed={shortcuts.favourites.includes(id)} aria-label={`${shortcuts.favourites.includes(id) ? 'Remove' : 'Add'} ${item.label} ${shortcuts.favourites.includes(id) ? 'from' : 'to'} favourites`} onClick={() => toggleFavourite(id)}>{shortcuts.favourites.includes(id) ? '★' : '☆'}</button></div>
        })}</section>)}</div>}
        <div id="global-search-results" className="command-palette-results" role="listbox" aria-label="Search results" aria-live="polite">
          {status === 'idle' && <p className="command-palette-hint">Type at least 2 characters.</p>}
          {status === 'loading' && <p className="command-palette-hint">Searching...</p>}
          {status === 'error' && <p role="alert">Search is unavailable. Please try again.</p>}
          {status === 'success' && !items.length && <p className="command-palette-hint">No permitted results found.</p>}
          {groups.map((group, groupIndex) => {
            const offset = groups.slice(0, groupIndex).reduce((sum, entry) => sum + entry.items.length, 0)
            return <div key={group.category} className="command-palette-group"><h3>{CATEGORY_LABELS[group.category] ?? group.category}</h3>{group.items.map((item, index) => <button id={`search-option-${offset + index}`} key={`${item.category}-${item.id}`} type="button" role="option" aria-selected={offset + index === activeIndex} className={offset + index === activeIndex ? 'active' : ''} onMouseEnter={() => setActiveIndex(offset + index)} onClick={() => choose({ targetType: item.category, targetId: item.id })}><strong>{item.label}</strong><span>{item.sublabel}</span></button>)}</div>
          })}
        </div>
      </section>
    </div>}
  </>
}
