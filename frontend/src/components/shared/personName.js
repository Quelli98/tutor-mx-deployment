/**
 * A name fit to greet someone by, or null. An account created without a name
 * stores its email address as the profile's full name, and greeting a person
 * by their email reads like an error, so an address is never treated as a name.
 */
export function personName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  return name && !name.includes('@') ? name : null
}

export function firstNameOf(value) {
  return personName(value)?.split(' ')[0] ?? null
}
