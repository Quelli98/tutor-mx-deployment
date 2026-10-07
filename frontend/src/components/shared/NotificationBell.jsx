import { resolveDestination } from '../../api/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications'
import { EmptyState, ErrorState, LoadingState } from './StatusMessage'

const PAGE_SIZE = 10

function formatWhen(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.valueOf())) return ''
  return date.toLocaleString()
}

// icon replaces the default bell emoji (the organiser top bar passes a line icon).
export function NotificationBell({ icon } = {}) {
  const { getAccessTokenSilently } = useAuth0()
  const navigate = useNavigate()
  const bellRef = useRef(null)
  const actionRef = useRef(0)
  const pageRequestRef = useRef(0)
  useEffect(() => () => { actionRef.current += 1; pageRequestRef.current += 1 }, [])
  const panelRef = useRef(null)
  const closeButtonRef = useRef(null)

  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [filter, setFilter] = useState('unread')
  const [status, setStatus] = useState('idle')
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const loadUnreadCount = useCallback(async () => {
    try {
      const count = await fetchUnreadCount(getAccessTokenSilently)
      setUnreadCount(count)
    } catch {
      // A failed badge fetch must never break the shared navigation.
      setUnreadCount(0)
    }
  }, [getAccessTokenSilently])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUnreadCount()
  }, [loadUnreadCount])

  const loadPage = useCallback(
    async (nextPage, nextFilter, append) => {
      const requestId = ++pageRequestRef.current
      setStatus('loading')
      setError('')
      try {
        const result = await fetchNotifications(
          { status: nextFilter, page: nextPage, pageSize: PAGE_SIZE },
          getAccessTokenSilently,
        )
        if (requestId !== pageRequestRef.current) return
        setItems((current) => (append ? [...current, ...result.items] : result.items))
        setPage(result.page)
        setTotal(result.total)
        setUnreadCount(result.unreadCount)
        setStatus('success')
      } catch (loadError) {
        if (requestId !== pageRequestRef.current) return
        if (!append) setItems([])
        setError(loadError?.message || 'Notifications could not be loaded.')
        setStatus('error')
      }
    },
    [getAccessTokenSilently],
  )

  function openPanel() {
    setOpen(true)
    setFilter('unread')
    loadPage(1, 'unread', false)
  }

  const closePanel = useCallback(() => {
    actionRef.current += 1
    pageRequestRef.current += 1
    setOpen(false)
    // Focus returns to the triggering bell so keyboard users are not stranded.
    bellRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    // Move focus into the panel so it is immediately keyboard operable.
    closeButtonRef.current?.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePanel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, closePanel])

  function togglePanel() {
    if (open) {
      closePanel()
    } else {
      openPanel()
    }
  }

  function changeFilter(nextFilter) {
    if (nextFilter === filter) return
    setFilter(nextFilter)
    loadPage(1, nextFilter, false)
  }

  async function handleOpenNotification(notification) {
    const action = ++actionRef.current
    try {
      const destination = await resolveDestination({ notificationId: notification.id }, getAccessTokenSilently)
      if (!notification.readAt) {
        try { await markNotificationRead(notification.id, getAccessTokenSilently) } catch (error) {
          if (error?.status === 401 || error?.status === 403) throw error
        }
      }
      if (action !== actionRef.current) return
      closePanel()
      navigate(destination.linkPath)
      loadUnreadCount()
    } catch {
      if (action !== actionRef.current) return
      setError('This item is no longer available or you no longer have access.')
      setStatus('error')
    }
  }

  async function handleMarkRead(event, notification) {
    event.stopPropagation()
    try {
      await markNotificationRead(notification.id, getAccessTokenSilently)
      await loadPage(page, filter, false)
    } catch (markError) {
      setError(markError?.message || 'The notification could not be updated.')
      setStatus('error')
    }
  }

  async function handleMarkAll() {
    try {
      await markAllNotificationsRead(getAccessTokenSilently)
      await loadPage(1, filter, false)
    } catch (markError) {
      setError(markError?.message || 'Notifications could not be updated.')
      setStatus('error')
    }
  }

  const hasMore = items.length < total

  return (
    <div className="notification-bell">
      <button
        type="button"
        ref={bellRef}
        className="notification-bell-button"
        onClick={togglePanel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications, none unread'
        }
      >
        <span aria-hidden="true" className="notification-bell-icon">
          {icon ?? '🔔'}
        </span>
        {unreadCount > 0 && (
          <span className="notification-bell-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          className="notification-panel"
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Notifications"
        >
          <header className="notification-panel-header">
            <h2>Notifications</h2>
            <div className="notification-filter" role="group" aria-label="Filter notifications">
              <button
                type="button"
                className={`notification-filter-button${filter === 'unread' ? ' active' : ''}`}
                aria-pressed={filter === 'unread'}
                onClick={() => changeFilter('unread')}
              >
                Unread
              </button>
              <button
                type="button"
                className={`notification-filter-button${filter === 'all' ? ' active' : ''}`}
                aria-pressed={filter === 'all'}
                onClick={() => changeFilter('all')}
              >
                All
              </button>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={handleMarkAll}
              disabled={unreadCount === 0}
            >
              Mark all read
            </button>
            <button
              type="button"
              className="notification-panel-close"
              ref={closeButtonRef}
              onClick={closePanel}
              aria-label="Close notifications"
            >
              Close
            </button>
          </header>

          {status === 'loading' && items.length === 0 && (
            <LoadingState title="Loading notifications..." />
          )}
          {status === 'error' && (
            <ErrorState
              title="Notifications unavailable"
              message={error}
              onRetry={() => loadPage(1, filter, false)}
            />
          )}
          {status === 'success' && items.length === 0 && (
            <EmptyState
              title="You're all caught up"
              message="There are no notifications to show for this filter."
            />
          )}

          {items.length > 0 && (
            <ul className="notification-list">
              {items.map((notification) => (
                <li
                  key={notification.id}
                  className={`notification-item${notification.readAt ? '' : ' unread'}`}
                >
                  <button
                    type="button"
                    className="notification-item-button"
                    onClick={() => handleOpenNotification(notification)}
                  >
                    <span className="notification-item-title">{notification.title}</span>
                    <span className="notification-item-body">{notification.body}</span>
                    <span className="notification-action">{notification.linkPath.startsWith('/organiser') ? 'Review' : notification.type.includes('RETURN') ? 'Fix' : 'View'}</span>
                    <span className="notification-time">
                      {formatWhen(notification.createdAt)}
                    </span>
                  </button>
                  {!notification.readAt && (
                    <button
                      type="button"
                      className="notification-item-read"
                      onClick={(event) => handleMarkRead(event, notification)}
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {hasMore && status !== 'loading' && (
            <button
              type="button"
              className="secondary-button notification-load-more"
              onClick={() => loadPage(page + 1, filter, true)}
            >
              Load more
            </button>
          )}
        </section>
      )}
    </div>
  )
}

export default NotificationBell
