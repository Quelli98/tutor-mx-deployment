import { fetchWithBearerToken } from './client'

export async function getPublicHolidays(
  tokenOrGetter,
  year = new Date().getUTCFullYear(),
) {
  const body = await fetchWithBearerToken(
    `/api/public-holidays?year=${year}`,
    {},
    tokenOrGetter,
  )
  const data = body?.data

  if (!data || !Array.isArray(data.holidays)) {
    throw new Error('The public-holiday response did not match the agreed contract.')
  }

  return {
    source: data.source === 'external' ? 'external' : 'fallback',
    holidays: data.holidays,
    retrievedAt: data.retrievedAt ?? null,
  }
}
