import { attendanceLabel } from '../components/shared/attendance'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchExcuseStatus } from '../api/excuse'

const STORAGE_KEY = 'tutormx.tutorExcuses'

function storageKeyFor(scope) {
  return scope ? `${STORAGE_KEY}.${scope}` : STORAGE_KEY
}

function loadStoredExcuses(storageKey) {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    const stored = raw ? JSON.parse(raw) : []
    if (!Array.isArray(stored)) return {}
    const byId = {}
    for (const summary of stored) {
      if (Number.isInteger(summary?.id)) {
        byId[summary.id] = summary
      }
    }
    return byId
  } catch {
    return {}
  }
}

function persistExcuses(statuses, storageKey) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(Object.values(statuses)))
  } catch {
    // A blocked or full store must not break the in-page workflow.
  }
}

function statusLine(summary) {
  if (summary?.status === 'APPROVED') {
    return `Approved by the organiser. ${attendanceLabel(summary) || ''}${summary.occurrenceStatus === 'EXCUSED' ? ' — removed from your active timetable; kept here in history.' : ''}`
  }
  if (summary?.status === 'REJECTED') {
    return 'Rejected by the organiser.'
  }
  return 'Submitted and waiting for the organiser decision.'
}

function sessionLabelFor(summary, allocations) {
  const allocation = allocations.find(
    (candidate) => candidate.id === summary.allocationId,
  )
  if (allocation) {
    return `${allocation.courseCode} - ${new Date(allocation.startsAt).toLocaleString()}`
  }
  return `Session ${summary.allocationId}`
}

export default function ExcuseStatusSection({
  submitted = null,
  allocations = [],
  tokenOrGetter,
  storageScope = null,
}) {
  const storageKey = storageKeyFor(storageScope)
  const [statuses, setStatuses] = useState(() => ({ ...loadStoredExcuses(storageKey), ...Object.fromEntries(allocations.filter((item) => item.excuse).map((item) => [item.excuse.id, { ...item.excuse, allocationId: item.id, occurrenceStatus: item.occurrenceStatus }])) }))
  const [busy, setBusy] = useState({})
  const [messages, setMessages] = useState({})
  const knownIdsRef = useRef([])
  const refreshInFlightRef = useRef(false)

  const cards = useMemo(
    () => Object.values(statuses).sort((first, second) => second.id - first.id),
    [statuses],
  )

  useEffect(() => {
    knownIdsRef.current = Object.keys(statuses).map(Number)
  }, [statuses])

  useEffect(() => {
    persistExcuses(statuses, storageKey)
  }, [statuses, storageKey])

  // A successful form submit hands over the fresh excuse for tracking.
  useEffect(() => {
    if (!Number.isInteger(submitted?.id)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatuses((current) => ({ ...current, [submitted.id]: submitted }))
  }, [submitted])

  const refreshStatus = useCallback(
    async (excuseId) => {
      try {
        const summary = await fetchExcuseStatus(excuseId, tokenOrGetter)
        setStatuses((current) => ({ ...current, [excuseId]: summary }))
        return true
      } catch (error) {
        if (error?.code === 'EXCUSE_NOT_FOUND') {
          // Left over from another account or removed server-side: drop quietly.
          setStatuses((current) => {
            const next = { ...current }
            delete next[excuseId]
            return next
          })
        }
        return false
      }
    },
    [tokenOrGetter],
  )

  const refreshAllStatuses = useCallback(async () => {
    if (refreshInFlightRef.current || knownIdsRef.current.length === 0) return
    refreshInFlightRef.current = true
    try {
      await Promise.allSettled(knownIdsRef.current.map((id) => refreshStatus(id)))
    } finally {
      refreshInFlightRef.current = false
    }
  }, [refreshStatus])

  // The organiser decision happens outside this tab: refetch quietly
  // whenever the tutor returns to the Tutor Mx tab.
  useEffect(() => {
    const handleWindowFocus = () => {
      refreshAllStatuses()
    }
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [refreshAllStatuses])

  useEffect(() => {
    refreshAllStatuses()
  }, [refreshAllStatuses])

  function setBusyFor(excuseId, value) {
    setBusy((current) => {
      const next = { ...current }
      if (value === undefined) {
        delete next[excuseId]
      } else {
        next[excuseId] = value
      }
      return next
    })
  }

  function setMessageFor(excuseId, text) {
    setMessages((current) => {
      const next = { ...current }
      if (text === undefined) {
        delete next[excuseId]
      } else {
        next[excuseId] = text
      }
      return next
    })
  }

  async function handleCheck(excuseId) {
    setBusyFor(excuseId, 'checking')
    setMessageFor(excuseId, undefined)
    const updated = await refreshStatus(excuseId)
    if (!updated) {
      setMessageFor(excuseId, 'The excuse status could not be checked. Try again.')
    }
    setBusyFor(excuseId, undefined)
  }

  return (
    <section className="draft-list" aria-labelledby="excuse-status-heading">
      <h3 id="excuse-status-heading">Submitted excuses</h3>
      {cards.length === 0 ? (
        <p>No excuses submitted yet. Excuses are reviewed by the organiser.</p>
      ) : (
        <ul>
          {cards.map((card) => {
            const isBusy = Boolean(busy[card.id])
            return (
              <li key={card.id} className="excuse-card">
                <p>
                  <strong>{sessionLabelFor(card, allocations)}</strong>
                </p>
                <p className="excuse-status">{statusLine(card)}</p>
                {card.status === 'REJECTED' && card.reviewReason && (
                  <p className="status-note danger" role="alert">
                    Organiser note: {card.reviewReason}
                  </p>
                )}
                {messages[card.id] && (
                  <p className="status-note danger" role="alert">{messages[card.id]}</p>
                )}
                <div className="excuse-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleCheck(card.id)}
                    disabled={isBusy}
                  >
                    {busy[card.id] === 'checking' ? 'Checking...' : 'Check for decision'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
