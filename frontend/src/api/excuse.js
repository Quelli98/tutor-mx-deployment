import { fetchWithBearerToken } from './client'

const EXCUSE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED']

function isNullableString(value) {
  return value === null || typeof value === 'string'
}

export function parseExcuseStatusResponse(body) {
  const excuse = body?.data?.excuse
  if (
    !excuse ||
    !Number.isInteger(excuse.id) ||
    !Number.isInteger(excuse.allocationId) ||
    typeof excuse.reason !== 'string' ||
    !EXCUSE_STATUSES.includes(excuse.status) ||
    !isNullableString(excuse.reviewReason) ||
    typeof excuse.createdAt !== 'string' ||
    typeof excuse.updatedAt !== 'string'
  ) {
    throw new Error('The excuse response did not match the agreed contract.')
  }
  return excuse
}

export async function fetchExcuseStatus(excuseId, tokenOrGetter) {
  const body = await fetchWithBearerToken(
    `/api/tutor/excuses/${excuseId}/status`,
    {},
    tokenOrGetter,
  )
  return parseExcuseStatusResponse(body)
}

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
