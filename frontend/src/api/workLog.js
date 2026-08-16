import { fetchWithBearerToken } from './client'

export async function submitWorkLog(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/tutor/work-logs',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    tokenOrGetter,
  )
  const workLog = body?.data?.workLog
  if (!workLog || !Number.isInteger(workLog.id) || !Number.isInteger(workLog.timesheetId)) {
    throw new Error('The work-log response did not match the agreed contract.')
  }
  return workLog
}
