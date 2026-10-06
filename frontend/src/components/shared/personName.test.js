import { describe, expect, it } from 'vitest'
import { firstNameOf, personName } from './personName'

describe('personName', () => {
  it.each([
    ['Thandi Mokoena', 'Thandi Mokoena', 'Thandi'],
    ['  Thandi   Mokoena ', 'Thandi Mokoena', 'Thandi'],
    ['woyac78803@cwsgear.com', null, null],
    ['', null, null],
    [null, null, null],
    [42, null, null],
  ])('reads %j as name %j, first name %j', (value, name, first) => {
    expect(personName(value)).toBe(name)
    expect(firstNameOf(value)).toBe(first)
  })
})
