import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationBell } from './NotificationBell'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const tokenMock = vi.fn().mockResolvedValue('token-1')
vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: tokenMock }),
}))

vi.mock('../../api/notifications', () => ({
  fetchUnreadCount: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}))

import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications'

function makeItem(overrides = {}) {
  return {
    id: 1,
    type: 'EXCUSE_SUBMITTED',
    title: 'Excuse awaiting decision',
    body: 'A submitted excuse is ready for a decision.',
    linkPath: '/organiser',
    targetType: 'excuse',
    targetId: 10,
    readAt: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  }
}

function listResult(items, extra = {}) {
  return {
    items,
    page: 1,
    pageSize: 10,
    total: items.length,
    unreadCount: items.filter((item) => !item.readAt).length,
    ...extra,
  }
}

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  navigateMock.mockReset()
  fetchUnreadCount.mockResolvedValue(0)
  fetchNotifications.mockResolvedValue(listResult([]))
  markNotificationRead.mockResolvedValue({ id: 1, readAt: 'now' })
  markAllNotificationsRead.mockResolvedValue(0)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('NotificationBell', () => {
  it('shows the unread count in the accessible bell label', async () => {
    fetchUnreadCount.mockResolvedValue(3)
    renderBell()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /3 unread/i })).toBeInTheDocument(),
    )
  })

  it('opens the panel and lists notifications', async () => {
    fetchNotifications.mockResolvedValue(listResult([makeItem()]))
    renderBell()

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }))

    expect(await screen.findByRole('dialog', { name: /notifications/i })).toBeInTheDocument()
    expect(screen.getByText('Excuse awaiting decision')).toBeInTheDocument()
  })

  it('shows an empty state when there are no notifications', async () => {
    fetchNotifications.mockResolvedValue(listResult([]))
    renderBell()

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }))

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument()
  })

  it('shows an error state and retries', async () => {
    fetchNotifications.mockRejectedValueOnce(new Error('Notifications could not be loaded.'))
    renderBell()

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)

    fetchNotifications.mockResolvedValue(listResult([makeItem()]))
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Excuse awaiting decision')).toBeInTheDocument()
  })

  it('navigates via linkPath and marks the item read when opened', async () => {
    fetchNotifications.mockResolvedValue(listResult([makeItem()]))
    renderBell()

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByText('Excuse awaiting decision'))

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/organiser'))
    expect(markNotificationRead).toHaveBeenCalledWith(1, expect.any(Function))
  })

  it('marks all read from the panel', async () => {
    fetchUnreadCount.mockResolvedValue(2)
    fetchNotifications.mockResolvedValue(listResult([makeItem(), makeItem({ id: 2 })]))
    renderBell()

    await userEvent.click(screen.getByRole('button', { name: /notifications/i }))
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /mark all read/i }))

    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape and returns focus to the bell', async () => {
    fetchNotifications.mockResolvedValue(listResult([makeItem()]))
    renderBell()

    const bell = screen.getByRole('button', { name: /notifications/i })
    await userEvent.click(bell)
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(bell).toHaveFocus()
  })
})
