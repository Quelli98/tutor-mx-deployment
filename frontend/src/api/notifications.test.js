import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  parseNotificationListResponse,
} from './notifications'

const VALID_ITEM = {
  id: 1,
  type: 'EXCUSE_SUBMITTED',
  title: 'Excuse awaiting decision',
  body: 'A submitted excuse is ready for an organiser decision.',
  linkPath: '/organiser',
  targetType: 'excuse',
  targetId: 10,
  readAt: null,
  createdAt: '2026-09-20T00:00:00.000Z',
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseNotificationListResponse', () => {
  it('accepts a well-formed list payload', () => {
    const result = parseNotificationListResponse({
      data: { items: [VALID_ITEM], page: 1, pageSize: 10, total: 1, unreadCount: 1 },
    })
    expect(result.items).toHaveLength(1)
    expect(result.unreadCount).toBe(1)
  })

  it('rejects a payload whose items break the contract', () => {
    expect(() =>
      parseNotificationListResponse({
        data: { items: [{ id: 0 }], page: 1, pageSize: 10, total: 1, unreadCount: 0 },
      }),
    ).toThrow(/did not match/i)
  })

  it('rejects a payload missing the paging counters', () => {
    expect(() =>
      parseNotificationListResponse({ data: { items: [] } }),
    ).toThrow(/did not match/i)
  })
})

describe('fetchNotifications', () => {
  it('caps pageSize at 25 and defaults status to unread', async () => {
    const token = vi.fn().mockResolvedValue('token-1')
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        okResponse({ data: { items: [], page: 1, pageSize: 25, total: 0, unreadCount: 0 } }),
      )

    await fetchNotifications({ pageSize: 500 }, token)

    const [url] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('status=unread')
    expect(url).toContain('pageSize=25')
    expect(url).toContain('page=1')
  })

  it('passes an explicit all filter and page through', async () => {
    const token = vi.fn().mockResolvedValue('token-1')
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        okResponse({ data: { items: [], page: 3, pageSize: 10, total: 0, unreadCount: 0 } }),
      )

    await fetchNotifications({ status: 'all', page: 3, pageSize: 10 }, token)

    const [url] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('status=all')
    expect(url).toContain('page=3')
    expect(url).toContain('pageSize=10')
  })
})

describe('fetchUnreadCount', () => {
  it('returns the integer unread count', async () => {
    const token = vi.fn().mockResolvedValue('token-1')
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ data: { unreadCount: 4 } }))
    await expect(fetchUnreadCount(token)).resolves.toBe(4)
  })

  it('rejects a malformed unread count', async () => {
    const token = vi.fn().mockResolvedValue('token-1')
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ data: { unreadCount: -1 } }))
    await expect(fetchUnreadCount(token)).rejects.toThrow(/did not match/i)
  })
})

describe('markNotificationRead', () => {
  it('sends a PATCH for a valid id', async () => {
    const token = vi.fn().mockResolvedValue('token-1')
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(okResponse({ data: { notification: { id: 1, readAt: 'now' } } }))

    const result = await markNotificationRead(1, token)

    expect(result).toEqual({ id: 1, readAt: 'now' })
    const [url, options] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('/api/notifications/1/read')
    expect(options.method).toBe('PATCH')
  })

  it('refuses an invalid id before calling the network', async () => {
    globalThis.fetch = vi.fn()
    await expect(markNotificationRead(0, vi.fn())).rejects.toThrow(/notification id/i)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

describe('markAllNotificationsRead', () => {
  it('posts and returns the updated count', async () => {
    const token = vi.fn().mockResolvedValue('token-1')
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse({ data: { updated: 5 } }))

    await expect(markAllNotificationsRead(token)).resolves.toBe(5)
    const [url, options] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('/api/notifications/read-all')
    expect(options.method).toBe('POST')
  })
})
