# Sprint 1 Member 6 handoff

## S1-M6-1 - Neon PostgreSQL schema, Prisma migrations and safe seed data

Implemented:

- versioned Prisma/PostgreSQL migrations for profiles and roles, courses, tutor marks, availability, weekly hour limits and allocations;
- primary/foreign keys, uniqueness, value checks, relationship constraints and role/state triggers;
- rerunnable, invented non-personal seed data for Organiser, Tutor and Student roles and allocation-rule boundaries;
- reset/setup commands, migration tests, in-memory PostgreSQL constraint tests and a real PostgreSQL verification script; and
- tracked-file checks for committed secrets, production environment files and credential-bearing PostgreSQL URLs.

Stable demo identities use the `demo|...` prefix and the course code `DEMO101`. Production identity data and `DATABASE_URL` are not included.

## S1-M6-2 - GitHub Actions, Codecov and protected integration flow

Implemented in `.github/workflows/ci.yml`:

- clean root/frontend installs, lint, strict backend type-checks, automated tests, coverage and production builds;
- separate Codecov v5 uploads using `backend` and `frontend` flags;
- clean PostgreSQL migration, safe seed, constraint/query verification and local API health/readiness smoke; and
- least-privilege workflow permissions, cancellation of superseded runs and secret-only Codecov configuration.

The exact branch-protection settings and required check names are in `docs/github-required-checks.md`. Installing the Codecov GitHub App, adding `CODECOV_TOKEN`, creating protected branches and enabling required checks are GitHub administrator actions and cannot be embedded in the source archive.

## S1-M6-3 - Relevant external API spike and fallback contract

Decision and use case:

- **Service:** Nager.Date Holiday API v4, which provides public holiday calendar data and does not require an API key for the community endpoint.
- **Tutor Mx purpose:** retrieve South African public holidays for a requested year so later scheduling/allocation work can warn about dates that may be unsuitable for tutoring.
- **Backend-only call:** `npm run spike:holidays -- 2026` calls `https://nagerholidays.com/api/v4/Holidays/ZA/2026`; no frontend code calls the external service.
- **Safe response:** only `date`, `name`, `countryCode`, `nationalHoliday` and `holidayTypes` are retained. Unexpected fields are discarded.
- **Resilience:** the request has a three-second abortable timeout, strict response decoding and an empty-list fallback with a controlled reason (`timeout`, `unavailable`, `invalid-response`, and related mapped failures).
- **Privacy/secrets:** the request contains only country code `ZA` and a year. It sends no Tutor Mx user, authentication or database data and requires no credential.
- **Limits:** the [official service page](https://nagerholidays.com/api) states that the community endpoint has no rate limit. A later production route should still cache responsibly and avoid requesting the service on every browser render.
- **Terms:** the [service terms](https://nagerholidays.com/legal/termsofservice) allow private/non-profit projects, require sponsorship for commercial use, prohibit operating a separate holiday portal from the data and do not guarantee availability or accuracy. Tutor Mx is using the service only as supporting scheduling information with a fallback, not as a holiday portal or source of truth.
- **Privacy:** the [privacy policy](https://nagerholidays.com/legal/privacy) states that general visitors are not collected as personal data, while the provider/CDN may process technical request data such as IP logs. The Tutor Mx adapter sends no user identity, email, access token, database value or other personal record.

Mocked tests cover successful safe-field selection, timeout/abort and invalid response fallback. The generic adapter also covers unavailable, rate-limited, invalid JSON, HTTP and network failures.

This service is the implemented Sprint 1 recommendation. The Project Coordinator should record the choice in issue `S1-M6-3`. If the stakeholder rejects it, record the replacement service and use case no later than **18 August 2026**, before the Sprint 1 end date.

Member 5 can later expose this service through an authenticated handwritten Express route; Member 4 can later render the safe external/fallback result. Those follow-ups are outside Member 6's Sprint 1 issue.

## Verification

```sh
npm ci
npm ci --prefix frontend
npm run generate
npm run check
npm run coverage
npm run db:migrate
npm run db:seed
npm run db:verify
npm run spike:holidays -- 2026
```

The external spike command performs a real network request; automated tests use mocks so CI is deterministic.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].
