import { clearRetryKeys } from '../api/retryKey'

export const SESSION_EVENT = 'tutormx:session-invalid'
export const PERMISSION_EVENT = 'tutormx:permission-refresh'
let generation = 0
export function sessionGeneration() { return generation }
export function clearProtectedState() {
  generation += 1
  clearRetryKeys()
  // Remove only this application's protected drafts. Leave unrelated storage,
  // display preferences and Auth0's SDK-managed cache alone.
  for (const name of ['sessionStorage', 'localStorage']) {
    try {
      const storage = window[name]
      const prefixes = ['tutormx.tutorWorkLogs', 'tutormx.tutorTimesheets', 'tutormx.tutorExcuses', 'tutormx.shortcuts.']
      for (let i = storage.length - 1; i >= 0; i--) {
        const key = storage.key(i)
        if (prefixes.some(prefix => key === prefix || key.startsWith(prefix + '.') || (prefix.endsWith('.') && key.startsWith(prefix)))) storage.removeItem(key)
      }
    } catch { /* Restricted browser storage must not prevent cleanup in memory. */ }
  }
}
export function isSessionLocked() {
  try { return sessionStorage.getItem('tutormx.sessionLocked') === 'true' } catch { return false }
}
export function clearSessionLock() {
  try { sessionStorage.removeItem('tutormx.sessionLocked') } catch { /* storage unavailable */ }
}
export function invalidateSession(message = 'Your session has expired. Please sign in again.') {
  clearProtectedState()
  try { sessionStorage.setItem('tutormx.sessionLocked', 'true') } catch { /* in-memory gate still closes */ }
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { message } }))
}
export function handleAccessFailure(status, code, path) {
  if (code === 'PROFILE_NOT_FOUND' && path === '/api/me') return
  if (status === 401 || ['ROLE_MISMATCH', 'PROFILE_NOT_FOUND', 'ORGANISER_PENDING', 'ORGANISER_REJECTED'].includes(code)) {
    invalidateSession()
  } else if (status === 403) {
    // A denied operation is not automatically a signed-out account.
    clearProtectedState()
    window.dispatchEvent(new Event(PERMISSION_EVENT))
  }
}
