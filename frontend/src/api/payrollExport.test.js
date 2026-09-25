import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let downloadPayrollExport
let click
const input = { weekStart: '2030-09-02', weeks: 2 }

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.org/')
  vi.stubEnv('VITE_AUTH0_AUDIENCE', 'https://tutormx.example.org')
  vi.stubGlobal('fetch', vi.fn())
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:payroll')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  ;({ downloadPayrollExport } = await import('./organiser'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('payroll export through the authenticated API client', () => {
  it('uses the configured API host, Auth0 audience and server filename', async () => {
    const tokenGetter = vi.fn().mockResolvedValue('valid-token')
    fetch.mockResolvedValue(new Response('Tutor,Hours\nSam,2', {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="payroll-2030.csv"' },
    }))
    await downloadPayrollExport(input, tokenGetter)
    expect(fetch).toHaveBeenCalledWith('https://api.example.org/api/reports/payroll-export?weekStart=2030-09-02&weeks=2', expect.objectContaining({
      cache: 'no-store', headers: { Accept: 'text/csv', Authorization: 'Bearer valid-token' },
    }))
    expect(tokenGetter).toHaveBeenCalledWith({ detailedResponse: false, authorizationParams: { audience: 'https://tutormx.example.org' } })
    expect(click.mock.instances[0].download).toBe('payroll-2030.csv')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:payroll')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('fails before making a request when the token is absent', async () => {
    await expect(downloadPayrollExport(input, null)).rejects.toThrow('Missing bearer token')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves safe API error details without starting a download', async () => {
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'REPORT_RESULT_LIMIT', message: 'Choose a shorter period.' } }), { status: 422 }))
    await expect(downloadPayrollExport(input, 'token')).rejects.toMatchObject({ status: 422, code: 'REPORT_RESULT_LIMIT', message: 'Choose a shorter period.' })
    expect(click).not.toHaveBeenCalled()
  })

  it('rejects an HTML fallback page rather than saving it as payroll', async () => {
    fetch.mockResolvedValue(new Response('<html>Application</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(downloadPayrollExport(input, 'token')).rejects.toThrow('not a CSV file')
    expect(click).not.toHaveBeenCalled()
  })
})
