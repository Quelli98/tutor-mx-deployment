import { fetchWithBearerToken } from './client'

export const MAX_NOTIFICATION_PAGE_SIZE = 25

function isNotification(value) {
  if (!value || typeof value !== 'object') return false
  return (
    Number.isInteger(value.id) &&
    value.id > 0 &&
    typeof value.type === 'string' &&
    value.type.length > 0 &&
    typeof value.title === 'string' &&
    value.title.length > 0 &&
    typeof value.body === 'string' &&
    typeof value.linkPath === 'string' &&
    value.linkPath.length > 0 &&
    typeof value.targetType === 'string' &&
    (value.targetId === null || Number.isInteger(value.targetId)) &&
    (value.readAt === null || typeof value.readAt === 'string') &&
    typeof value.createdAt === 'string'
  )
}

export function parseNotificationListResponse(body) {
  const data = body?.data
  if (
    !data ||
    !Array.isArray(data.items) ||
    !data.items.every(isNotification) ||
    !Number.isInteger(data.page) ||
    !Number.isInteger(data.pageSize) ||
    !Number.isInteger(data.total) ||
    !Number.isInteger(data.unreadCount)
  ) {
    throw new Error('The notification list response did not match the agreed contract.')
  }
  return data
}

function buildListQuery({ status = 'unread', page = 1, pageSize = MAX_NOTIFICATION_PAGE_SIZE } = {}) {
  const safeStatus = status === 'all' ? 'all' : 'unread'
  const safePage = Number.isInteger(page) && page > 0 ? page : 1
  const safePageSize =
    Number.isInteger(pageSize) && pageSize > 0
      ? Math.min(pageSize, MAX_NOTIFICATION_PAGE_SIZE)
      : MAX_NOTIFICATION_PAGE_SIZE
  const params = new URLSearchParams({
    status: safeStatus,
    page: String(safePage),
    pageSize: String(safePageSize),
  })
  return params.toString()
}

export async function fetchNotifications(options, tokenOrGetter) {
  const query = buildListQuery(options)
  const body = await fetchWithBearerToken(`/api/notifications?${query}`, {}, tokenOrGetter)
  return parseNotificationListResponse(body)
}

/**
 * The most pages a single all-pages read will walk. The list endpoint caps a
 * page at 25 rows and allows page numbers up to 10,000, so a caller asking for
 * everything is bounded by this instead: it is a guard against a store that
 * keeps reporting more rows, not a page of record. A read that hits it still
 * returns every row the pages it read held.
 */
export const MAX_NOTIFICATION_PAGES = 40

/**
 * Every page of the list, for a caller that needs the whole store rather than
 * the first screenful (the Command Centre's Needs Attention feed does: the
 * reminders it folds in are not guaranteed to sit on page one). It walks the
 * same paginated read the bell pages through, one page at a time, passing the
 * page size the server reported so the pages line up, and stops once the rows
 * read add up to the total the server reported. A page that fails rejects the
 * whole read, so the caller can degrade as it already does when the list is
 * unavailable rather than working from half the store.
 */
export async function fetchAllNotifications(options = {}, tokenOrGetter) {
  const first = await fetchNotifications({ ...options, page: 1 }, tokenOrGetter)
  const pageSize = first.pageSize > 0 ? first.pageSize : MAX_NOTIFICATION_PAGE_SIZE
  const lastPage = Math.min(Math.ceil(first.total / pageSize), MAX_NOTIFICATION_PAGES)
  const items = [...first.items]

  for (let page = 2; page <= lastPage && items.length < first.total; page += 1) {
    const next = await fetchNotifications({ ...options, page, pageSize }, tokenOrGetter)
    if (next.items.length === 0) break
    items.push(...next.items)
  }

  return { ...first, items }
}

export async function fetchUnreadCount(tokenOrGetter) {
  const body = await fetchWithBearerToken('/api/notifications/unread-count', {}, tokenOrGetter)
  const unreadCount = body?.data?.unreadCount
  if (!Number.isInteger(unreadCount) || unreadCount < 0) {
    throw new Error('The unread-count response did not match the agreed contract.')
  }
  return unreadCount
}

export async function markNotificationRead(id, tokenOrGetter) {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('A notification id is required to mark it read.')
  }
  const body = await fetchWithBearerToken(
    `/api/notifications/${id}/read`,
    { method: 'PATCH' },
    tokenOrGetter,
  )
  return body?.data?.notification ?? null
}

export async function markAllNotificationsRead(tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/notifications/read-all',
    { method: 'POST' },
    tokenOrGetter,
  )
  const updated = body?.data?.updated
  return Number.isInteger(updated) ? updated : 0
}
