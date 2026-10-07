import { fetchWithBearerToken } from './client'
import { withRetryKey } from './retryKey'
async function request(path, token, body) {
  const response = await fetchWithBearerToken(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }, token)
  if (response?.data === undefined) throw new Error('The session response could not be read. Please refresh.')
  return response.data
}
export const listBookings = (query, token) => request(`/api/me/bookings?${new URLSearchParams(query)}`, token)
export const getBooking = (id, token) => request(`/api/me/bookings/${id}`, token)
export const createBooking = (input, token) => withRetryKey('student-booking', input, requestKey => request('/api/student/bookings', token, { ...input, requestKey }))
export const cancelBooking = (id, input, token) => request(`/api/me/bookings/${id}/cancel`, token, input)
export const listSwaps = (page, token) => request(`/api/swaps?page=${page}`, token)
export const getSwap = (id, token) => request(`/api/swaps/${id}`, token)
export const replacementOptions = (id, token) => request(`/api/tutor/allocations/${id}/replacements`, token)
export const createSwap = (input, token) => request('/api/tutor/swaps', token, input)
export const changeSwap = (id, input, token) => request(`/api/swaps/${id}/actions`, token, input)
