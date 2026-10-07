import { fetchWithBearerToken } from './client'
export async function resolveDestination(target, token) {
  const response = await fetchWithBearerToken('/api/navigation/resolve', { method: 'POST', body: JSON.stringify(target) }, token)
  const result = response?.data
  if (!result || typeof result.linkPath !== 'string' || !/^\/(student|tutor|organiser|settings)(\/|$)/.test(result.linkPath) || /[?#\\]/.test(result.linkPath)) throw new Error('This destination is unavailable.')
  return result
}
