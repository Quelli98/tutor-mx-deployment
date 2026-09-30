import { fetchWithBearerToken } from './client'
export const TUTOR_MX_ROLES = Object.freeze(['STUDENT', 'TUTOR', 'ORGANISER'])
export async function completeOnboarding(role, getAccessTokenSilently) {
  if (!TUTOR_MX_ROLES.includes(role)) throw new Error('Choose Student, Tutor or Organiser.')
  if (role === 'ORGANISER') {
    return fetchWithBearerToken('/api/auth/organiser-registration', { method: 'POST' }, getAccessTokenSilently)
  }
  return fetchWithBearerToken('/api/auth/onboarding', { method: 'POST', body: JSON.stringify({ role }) }, getAccessTokenSilently)
}

export async function resendVerificationEmail(getAccessTokenSilently) {
  return fetchWithBearerToken('/api/auth/resend-verification', { method: 'POST' }, getAccessTokenSilently)
}
