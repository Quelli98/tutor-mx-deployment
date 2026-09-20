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
