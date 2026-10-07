import { fetchWithBearerToken } from './client'
async function request(path, token, body) {
  const response = await fetchWithBearerToken(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }, token)
  if (response?.data === undefined) throw new Error('Sick notes could not be loaded. Please refresh.')
  return response.data
}
export const submitStudentSickNote = (id, input, token) => request(`/api/student/bookings/${id}/sick-notes`, token, input)
export const listStudentSickNotes = (page, token) => request(`/api/organiser/student-sick-notes?page=${page}`, token)
export const decideStudentSickNote = (id, input, token) => request(`/api/organiser/student-sick-notes/${id}/decision`, token, input)
