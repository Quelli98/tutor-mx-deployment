import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'
import { cleanShortcuts } from './destinations'
import { globalSearch } from '../../api/search'
import { resolveDestination } from '../../api/navigation'
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: 'token', user: { sub: 'student-1' } }) }))
vi.mock('../../api/search', () => ({ globalSearch: vi.fn() }))
vi.mock('../../api/navigation', () => ({ resolveDestination: vi.fn() }))
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); resolveDestination.mockResolvedValue({ linkPath: '/student/timetable' }); globalSearch.mockResolvedValue({ groups: [] }) })
function show() { render(<MemoryRouter initialEntries={['/student']}><CommandPalette role="STUDENT" /></MemoryRouter>) }
it('filters removed and wrong-role shortcuts and de-duplicates metadata', () => {
  expect(cleanShortcuts({ recent: ['student-timetable', 'student-timetable', 'tutor-forms', 'removed', { label: 'private' }], favourites: ['settings'] }, 'STUDENT')).toEqual({ recent: ['student-timetable'], favourites: ['settings'] })
})
it('opens with Ctrl+K, supports favourites, traps focus and restores focus on Escape', async () => {
  show(); fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
  expect(screen.getByRole('searchbox')).toHaveFocus()
  await userEvent.click(screen.getByRole('button', { name: 'Add My timetable to favourites' }))
  expect(screen.getByRole('region', { name: 'Favourites' })).toHaveTextContent('My timetable')
  expect(JSON.parse(sessionStorage.getItem('tutormx.shortcuts.student-1.STUDENT')).favourites).toEqual(['student-timetable'])
  expect(screen.queryByText('Tutor forms')).not.toBeInTheDocument()
  screen.getByRole('button', { name: 'Close search' }).focus(); await userEvent.tab({ shift: true })
  expect(screen.getByRole('dialog')).toContainElement(document.activeElement)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Search/ })).toHaveFocus()
})
it('rechecks a destination before navigation and reports changed permissions', async () => {
  resolveDestination.mockRejectedValue(new Error('Denied'))
  show(); await userEvent.click(screen.getByRole('button', { name: /Search/ }))
  await userEvent.click(screen.getByRole('button', { name: 'My timetable', exact: true }))
  expect(resolveDestination).toHaveBeenCalledWith({ destinationId: 'student-timetable' }, 'token')
  expect(await screen.findByText(/no longer available/)).toBeInTheDocument()
})
it('drops in-flight results when the query is cleared', async () => {
  let complete
  globalSearch.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  show(); await userEvent.click(screen.getByRole('button', { name: /Search/ }))
  await userEvent.type(screen.getByRole('searchbox'), 'math')
  await waitFor(() => expect(globalSearch).toHaveBeenCalled())
  await userEvent.clear(screen.getByRole('searchbox'))
  await act(async () => { complete({ groups: [{ category: 'course', items: [{ id: 1, category: 'course', label: 'Private stale course' }] }] }) })
  expect(screen.queryByText('Private stale course')).not.toBeInTheDocument()
})
