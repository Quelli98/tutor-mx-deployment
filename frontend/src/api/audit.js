import { fetchWithBearerToken } from './client'
async function request(path, token, body) {
 const response = await fetchWithBearerToken(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }, token)
 if (response?.data === undefined) throw new Error('Audit data could not be read. Refresh and try again.')
 return response.data
}
export const listAudit = (query, token) => request(`/api/organiser/audit?${new URLSearchParams(query)}`, token)
export const getAudit = (id, token) => request(`/api/organiser/audit/${id}`, token)
export const exportAudit = (query, token) => request(`/api/organiser/audit/export?${new URLSearchParams(query)}`, token)
export const allocationHistory = (id, token) => request(`/api/organiser/allocations/${id}/history`, token)
export const previewRestore = (id, input, token) => request(`/api/organiser/allocations/${id}/restore-preview`, token, input)
export const restoreAllocation = (id, input, token) => request(`/api/organiser/allocations/${id}/restore`, token, input)
