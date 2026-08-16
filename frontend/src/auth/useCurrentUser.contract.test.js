import { describe, it, expect } from 'vitest'
import { normalizeRole } from './useCurrentUser'

describe('normalizeRole', () => {
  it('accepts organiser aliases from the API', () => {
    expect(normalizeRole('organizer')).toBe('ORGANISER')
    expect(normalizeRole('ORGANISER')).toBe('ORGANISER')
  })

  it('accepts tutor aliases from the API', () => {
    expect(normalizeRole('mentor')).toBe('TUTOR')
    expect(normalizeRole('TUTOR')).toBe('TUTOR')
  })

  it('accepts student aliases from the API', () => {
    expect(normalizeRole('learner')).toBe('STUDENT')
    expect(normalizeRole('STUDENT')).toBe('STUDENT')
  })

  it('returns null for empty or missing role values', () => {
    expect(normalizeRole(null)).toBe(null)
    expect(normalizeRole(undefined)).toBe(null)
    expect(normalizeRole('')).toBe(null)
  })

  it('returns the uppercased value for an unrecognised role', () => {
    expect(normalizeRole('superadmin')).toBe('SUPERADMIN')
    expect(normalizeRole('ADMIN')).toBe('ADMIN')
  })
})
