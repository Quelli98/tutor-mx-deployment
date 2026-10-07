import { beforeEach, expect, it, vi } from 'vitest'
import { fetchWithBearerToken } from '../api/client'
import { clearProtectedState, SESSION_EVENT, PERMISSION_EVENT } from './sessionState'
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks() })
it('clears only app-owned protected state', () => {
  sessionStorage.setItem('tutormx.tutorWorkLogs.person', 'private')
  sessionStorage.setItem('tutormx.shortcuts.person.STUDENT', 'ids')
  localStorage.setItem('theme', 'dark'); localStorage.setItem('@@auth0spajs@@', 'SDK owned')
  clearProtectedState()
  expect(sessionStorage.length).toBe(0)
  expect(localStorage.getItem('theme')).toBe('dark')
  expect(localStorage.getItem('@@auth0spajs@@')).toBe('SDK owned')
})
it.each([[401, 'INVALID_ACCESS_TOKEN', SESSION_EVENT], [403, 'FORBIDDEN', PERMISSION_EVENT], [403, 'ROLE_MISMATCH', SESSION_EVENT]])('handles %s %s with intended invalidation', async (status, code, eventName) => {
  const handler = vi.fn(); window.addEventListener(eventName, handler)
  globalThis.fetch = vi.fn(async () => ({ ok: false, status, json: async () => ({ error: { code } }) }))
  await expect(fetchWithBearerToken('/api/me/time-slots', {}, 'token')).rejects.toMatchObject({ status })
  expect(handler).toHaveBeenCalledTimes(1); window.removeEventListener(eventName, handler)
})
it('rejects a response completed after sign-out', async () => {
  let complete
  globalThis.fetch = vi.fn(() => new Promise(resolve => { complete = resolve }))
  const pending = fetchWithBearerToken('/api/me/time-slots', {}, 'token')
  clearProtectedState(); complete({ ok: true, json: async () => ({ data: { secret: 'old session' } }) })
  await expect(pending).rejects.toThrow('Session changed')
})
it('invalidates revoked refresh-token failures before a request', async () => {
  const handler = vi.fn(); window.addEventListener(SESSION_EVENT, handler)
  globalThis.fetch = vi.fn()
  await expect(fetchWithBearerToken('/api/me', {}, async () => { throw { error: 'invalid_grant' } })).rejects.toEqual({ error: 'invalid_grant' })
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(handler).toHaveBeenCalledTimes(1)
  window.removeEventListener(SESSION_EVENT, handler)
})

it('discards a response body that arrives after sign-out', async () => {
  let completeBody
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: () => new Promise(resolve => { completeBody = resolve }) }))
  const pending = fetchWithBearerToken('/api/me/time-slots', {}, 'token')
  await vi.waitFor(() => expect(completeBody).toBeTypeOf('function'))
  clearProtectedState()
  completeBody({ data: { secret: 'previous account' } })
  await expect(pending).rejects.toThrow('Session changed')
})
