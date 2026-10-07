import { fetchWithBearerToken } from './client'
const root = '/api/organiser/scenarios'
async function request(path, token, body) {
  const response = await fetchWithBearerToken(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }, token)
  if (response?.data === undefined) throw new Error('The planning response could not be read. Please refresh.')
  return response.data
}
export const listScenarios = (status, token) => request(`${root}?status=${encodeURIComponent(status)}`, token)
export const createScenario = (input, token) => request(root, token, input)
export const getScenario = (id, token) => request(`${root}/${id}`, token)
export const compareScenario = (id, token) => request(`${root}/${id}/compare`, token)
export const changeScenario = (id, input, token) => request(`${root}/${id}/actions`, token, input)
export const heartbeatScenario = (id, token) => request(`${root}/${id}/presence`, token, {})
export const discoverTutoring = token => request('/api/student/tutoring-options', token)
export const findMutualAvailability = (input, token) => request('/api/student/mutual-availability', token, input)
