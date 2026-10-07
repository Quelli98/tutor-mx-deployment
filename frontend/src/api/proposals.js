import { fetchWithBearerToken } from './client'
async function request(path, token, body) {
  const response = await fetchWithBearerToken(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }, token)
  if (response?.data === undefined) throw new Error('The proposal response could not be read. Please refresh.')
  return response.data
}
export const previewProposal = (input, token) => request('/api/organiser/proposals/preview', token, input)
export const compareProposalStrategies = (input, token) => request('/api/organiser/proposals/compare', token, input)
export const generateProposal = (input, token) => request('/api/organiser/proposals/generate', token, input)
export const getProposalExplanations = (scenarioId, token) => request(`/api/organiser/proposals/${scenarioId}/explanations`, token)
export const adjustProposal = (scenarioId, input, token) => request(`/api/organiser/proposals/${scenarioId}/adjust`, token, input)
