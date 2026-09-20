import { fetchWithBearerToken } from './client'

export async function globalSearch(query, tokenOrGetter, { page = 1, pageSize = 8 } = {}) {
  const normalised = String(query ?? '').trim().replace(/\s+/g, ' ')
  if (normalised.length < 2) return { groups: [], total: 0, page: 1, pageSize }
  const params = new URLSearchParams({ q: normalised, page: String(page), pageSize: String(pageSize) })
  const body = await fetchWithBearerToken(`/api/search?${params}`, {}, tokenOrGetter)
  const data = body?.data
  if (!data || !Array.isArray(data.groups)) {
    throw new Error('Search returned an unexpected response.')
  }
  return data
}
