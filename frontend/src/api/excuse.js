import { fetchWithBearerToken } from './client'

export async function submitExcuse(input, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    '/api/tutor/excuses',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    tokenOrGetter,
  )
  const excuse = body?.data?.excuse
  if (!excuse || !Number.isInteger(excuse.id) || excuse.status !== 'PENDING') {
    throw new Error('The excuse response did not match the agreed contract.')
  }
  return excuse
}
