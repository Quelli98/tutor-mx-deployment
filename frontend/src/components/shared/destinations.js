// Store only public destination IDs, never record names, IDs, queries or URLs.
export const destinations = [
  { id: 'tutor-swaps', label: 'Tutor swaps', role: 'TUTOR', path: '/tutor/swaps' },
  { id: 'organiser-swaps', label: 'Tutor swap decisions', role: 'ORGANISER', path: '/organiser/swaps' },
  { id: 'student-availability', label: 'Find a tutoring time', role: 'STUDENT', path: '/student/availability' },
  { id: 'organiser-scenarios', label: 'Scenario planning', role: 'ORGANISER', path: '/organiser/scenarios' },
  { id: 'organiser-proposals', label: 'Allocation proposal lab', role: 'ORGANISER', path: '/organiser/proposals' },
  { id: 'student-home', label: 'Student workspace', role: 'STUDENT', path: '/student' },
  { id: 'student-timetable', label: 'My timetable', role: 'STUDENT', path: '/student/timetable' },
  { id: 'tutor-home', label: 'Tutor workspace', role: 'TUTOR', path: '/tutor' },
  { id: 'tutor-timetable', label: 'My timetable', role: 'TUTOR', path: '/tutor/timetable' },
  { id: 'tutor-forms', label: 'Tutor forms', role: 'TUTOR', path: '/tutor/forms' },
  { id: 'organiser-home', label: 'Organiser workspace', role: 'ORGANISER', path: '/organiser' },
  { id: 'organiser-approvals', label: 'Approvals', role: 'ORGANISER', path: '/organiser/approvals' },
  { id: 'organiser-courses', label: 'Courses', role: 'ORGANISER', path: '/organiser/courses' },
  { id: 'organiser-tutors', label: 'Tutors', role: 'ORGANISER', path: '/organiser/tutors' },
  { id: 'organiser-staffing', label: 'Staffing', role: 'ORGANISER', path: '/organiser/staffing' },
  { id: 'settings', label: 'Account settings', path: '/settings' },
]
export function permittedDestinations(role) { return destinations.filter(item => ['STUDENT', 'TUTOR', 'ORGANISER'].includes(role) && (!item.role || item.role === role)) }
export function cleanShortcuts(value, role) {
  const allowed = new Set(permittedDestinations(role).map(item => item.id))
  const clean = items => Array.isArray(items) ? [...new Set(items.filter(id => allowed.has(id)))].slice(0, 8) : []
  return { recent: clean(value?.recent), favourites: clean(value?.favourites) }
}
export function readShortcuts(scope, role) {
  try { return cleanShortcuts(scope ? JSON.parse(sessionStorage.getItem(`tutormx.shortcuts.${scope}.${role}`)) : null, role) }
  catch { return cleanShortcuts(null, role) }
}
export function saveShortcuts(scope, role, value) {
  const safe = cleanShortcuts(value, role)
  try { if (scope) sessionStorage.setItem(`tutormx.shortcuts.${scope}.${role}`, JSON.stringify(safe)) } catch { /* in-memory shortcuts still work */ }
  return safe
}
