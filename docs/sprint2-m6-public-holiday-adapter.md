# S2-M6-2 - Production Public-Holiday Adapter

**Branch target:** `s2/m6/external-api-adapter`  
**Integrated base:** latest Gitea `main` after Member 5 API-quality integration  
**Date verified:** 2026-09-12

## Implemented contract

`GET /api/public-holidays?year=YYYY` is available to authenticated `ORGANISER`,
`TUTOR` and `STUDENT` profiles. The route uses the same access-token,
database-profile and supported-role middleware as the other protected Tutor Mx
routes. The year must be one unambiguous four-digit value from 2000 to 2100.

The server returns:

```json
{
  "data": {
    "source": "external",
    "holidays": [
      {
        "date": "2026-12-25",
        "name": "Christmas Day",
        "countryCode": "ZA",
        "nationalHoliday": true,
        "holidayTypes": ["Public"]
      }
    ],
    "retrievedAt": "2026-09-12T10:00:00.000Z"
  }
}
```

Only the five documented holiday fields pass through the strict decoder.
Unexpected provider fields are discarded. The request sends only the country
code and year; it sends no user identity, bearer token or database data to the
provider.

## Cache, timeout and fallback

- Successful results are cached in memory by year for one hour.
- Fallbacks are not cached, allowing the next request to retry after a transient
  provider problem.
- The provider request is aborted after three seconds.
- Timeout, network, rate-limit, HTTP and invalid-response failures return HTTP
  `200` with `source: "fallback"`, `holidays: []`, `retrievedAt: null` and a
  controlled reason code. Core Tutor Mx workflows therefore remain available.
- The reason is an internal display-state code; the UI should show a friendly
  fallback message rather than the raw reason.

## Deterministic verification

Automated tests use injected/mocked fetch and route dependencies. They cover
safe-field selection, caching, expiry, per-year cache keys, invalid data,
timeout, provider failure, authentication, all three supported roles, strict
year validation, response mapping and safe unexpected-error handling. No CI
test relies on the live provider.

The manual `npm run spike:holidays -- 2026` command remains available when a
real provider check is specifically required.

Historical document: its original AI use/non-use and model evidence have not been verified in the final audit. Confirm a document-specific declaration before submitting it for marking; see the root AI_DECLARATION.md.
