import type { QueryClient } from './allocation-queries.js';
import { createRouteError } from '../http/errors.js';
import type { TutorRole } from '../auth/contract.js';

export interface NavigationInput { destinationId?: string; targetType?: string; targetId?: number; notificationId?: number }
export interface NavigationResult { linkPath: string; action: 'View' | 'Fix' | 'Review' }
export const DESTINATIONS: Record<string, { path: string; roles: TutorRole[] }> = {
  'tutor-swaps': { path: '/tutor/swaps', roles: ['TUTOR'] },
  'organiser-swaps': { path: '/organiser/swaps', roles: ['ORGANISER'] },
  'student-home': { path: '/student', roles: ['STUDENT'] },
  'student-availability': { path: '/student/availability', roles: ['STUDENT'] },
  'organiser-scenarios': { path: '/organiser/scenarios', roles: ['ORGANISER'] },
  'student-timetable': { path: '/student/timetable', roles: ['STUDENT'] },
  'tutor-home': { path: '/tutor', roles: ['TUTOR'] },
  'tutor-timetable': { path: '/tutor/timetable', roles: ['TUTOR'] },
  'tutor-forms': { path: '/tutor/forms', roles: ['TUTOR'] },
  'organiser-home': { path: '/organiser', roles: ['ORGANISER'] },
  'organiser-approvals': { path: '/organiser/approvals', roles: ['ORGANISER'] },
  'organiser-courses': { path: '/organiser/courses', roles: ['ORGANISER'] },
  'organiser-tutors': { path: '/organiser/tutors', roles: ['ORGANISER'] },
  'organiser-staffing': { path: '/organiser/staffing', roles: ['ORGANISER'] },
  'settings': { path: '/settings', roles: ['TUTOR', 'STUDENT', 'ORGANISER'] },
};
function unavailable(): never { throw createRouteError(404, 'TARGET_UNAVAILABLE', 'This item is no longer available or you no longer have access.'); }

/** Fresh database checks; never trust a cached URL, role or notification label. */
export async function resolveNavigation(client: QueryClient, auth0Id: string, input: NavigationInput): Promise<NavigationResult> {
  const { rows: profiles } = await client.query<{ id: number; role: TutorRole }>('SELECT "id", "role" FROM "Profile" WHERE "auth0Id" = $1', [auth0Id]);
  const profile = profiles[0];
  if (!profile) return unavailable();
  if (input.destinationId) {
    const destination = Object.hasOwn(DESTINATIONS, input.destinationId) ? DESTINATIONS[input.destinationId] : undefined;
    if (!destination?.roles.includes(profile.role)) return unavailable();
    return { linkPath: destination.path, action: 'View' };
  }
  let { targetType, targetId } = input;
  if (input.notificationId) {
    const { rows } = await client.query<{ targetType: string; targetId: number | null }>('SELECT "targetType", "targetId" FROM "Notification" WHERE "id" = $1 AND "recipientProfileId" = $2', [input.notificationId, profile.id]);
    if (!rows[0]?.targetId) return unavailable();
    targetType = rows[0].targetType; targetId = rows[0].targetId;
  }
  if (!Number.isSafeInteger(targetId) || targetId! <= 0) return unavailable();
  const organiser = profile.role === 'ORGANISER';
  let sql: string; const parameters: unknown[] = [targetId]; let linkPath: string;
  let action: NavigationResult['action'] = 'View';
  switch (targetType) {
    case 'sick-note':
      if(!organiser)return unavailable();
      sql='SELECT "id" FROM "StudentSickNote" WHERE "bookingId"=$1';
      linkPath='/organiser/approvals';action='Review';break;
    case 'booking':
      if (!['STUDENT','TUTOR'].includes(profile.role)) return unavailable();
      sql='SELECT "id" FROM "TutoringBooking" WHERE "id"=$1 AND ("studentId"=$2 OR "tutorId"=$2)'; parameters.push(profile.id);
      linkPath=profile.role==='STUDENT'?`/student/timetable?booking=${targetId}`:`/tutor/timetable?booking=${targetId}`; break;
    case 'swap':
      if (!organiser && profile.role!=='TUTOR') return unavailable();
      sql='SELECT "id" FROM "TutorSwap" WHERE "id"=$1';
      if(!organiser){sql+=' AND ("requesterId"=$2 OR "replacementId"=$2)';parameters.push(profile.id);}
      linkPath=(organiser?'/organiser/swaps':'/tutor/swaps')+`?swap=${targetId}`;action=organiser?'Review':'View';break;
    case 'course':
      sql = 'SELECT c."id" FROM "Course" c WHERE c."id" = $1';
      if (!organiser) {
        if (profile.role === 'TUTOR') { sql += ' AND EXISTS (SELECT 1 FROM "Allocation" a WHERE a."courseId" = c."id" AND a."tutorId" = $2)'; parameters.push(profile.id); }
        else sql += ' AND EXISTS (SELECT 1 FROM "OverflowWork" w WHERE w."courseId" = c."id" AND w."status" = \'OPEN\' AND (w."closesAt" IS NULL OR w."closesAt" > NOW()))';
      }
      linkPath = organiser ? `/organiser/courses/${targetId}` : profile.role === 'TUTOR' ? '/tutor' : '/student'; break;
    case 'person':
      if (!organiser) return unavailable();
      sql = 'SELECT "id" FROM "Profile" WHERE "id" = $1 AND "role" = \'TUTOR\'';
      linkPath = `/organiser/tutors/${targetId}`; break;
    case 'timesheet':
    case 'excuse':
    case 'allocation': {
      if (!organiser && profile.role !== 'TUTOR') return unavailable();
      const table = { timesheet: 'Timesheet', excuse: 'Excuse', allocation: 'Allocation' }[targetType];
      sql = `SELECT "id" FROM "${table}" WHERE "id" = $1`;
      if (!organiser) { sql += ' AND "tutorId" = $2'; parameters.push(profile.id); }
      linkPath = organiser ? (targetType === 'allocation' ? '/organiser/staffing' : '/organiser/approvals') : targetType === 'allocation' ? '/tutor' : '/tutor/forms';
      action = organiser && targetType !== 'allocation' ? 'Review' : targetType === 'timesheet' ? 'Fix' : 'View'; break;
    }
    case 'volunteer':
      if (!organiser && profile.role !== 'STUDENT') return unavailable();
      sql = 'SELECT "id" FROM "VolunteerClaim" WHERE "id" = $1';
      if (!organiser) { sql += ' AND "studentId" = $2'; parameters.push(profile.id); }
      linkPath = organiser ? '/organiser/approvals' : '/student'; action = organiser ? 'Review' : 'View'; break;
    default: return unavailable();
  }
  const result = await client.query(sql, parameters);
  if (!result.rows.length) return unavailable();
  return { linkPath, action };
}
