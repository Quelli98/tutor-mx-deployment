import { fetchWithBearerToken } from './client'

export async function getStudentOverflowWork(tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/student/open-work',
    {},
    tokenOrGetter,
  )
  const workItems = body?.data?.workItems

  if (!Array.isArray(workItems)) {
    throw new Error('The open-work response did not match the agreed contract.')
  }

  return workItems
}
