import { fetchWithBearerToken } from './client'
export const TUTOR_MX_ROLES = Object.freeze(['STUDENT', 'TUTOR', 'ORGANISER'])
export async function completeOnboarding(role, getAccessTokenSilently) {
  if (!TUTOR_MX_ROLES.includes(role)) throw new Error('Choose Student, Tutor or Organiser.')
  return fetchWithBearerToken('/api/auth/onboarding', { method: 'POST', body: JSON.stringify({ role }) }, getAccessTokenSilently)
}
