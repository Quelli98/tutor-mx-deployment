import type { QueryClient } from './allocation-queries.js';
import { createRouteError, isRouteError } from '../http/errors.js';

export interface PlanningStore extends QueryClient {
  transaction<T>(work: (client: QueryClient) => Promise<T>): Promise<T>;
}
export async function inPlanningTransaction<T>(store: PlanningStore, work: (client: QueryClient) => Promise<T>): Promise<T> {
  try { return await store.transaction(work); }
  catch (error) {
    if (isRouteError(error)) throw error;
    const code = (error as { code?: string })?.code;
    if (['40001', '40P01', '23503', '23505', '23514', 'P2034', 'P2002', 'P2003', 'P2004', 'P2010', 'P2039'].includes(code ?? '')) {
      throw createRouteError(409, 'PLANNING_CONFLICT', 'Planning data changed or violates a current rule. Refresh and compare before trying again.');
    }
    throw error;
  }
}
export async function requireProfile(client: QueryClient, subject: string, role: 'STUDENT' | 'ORGANISER') {
  const { rows } = await client.query<{ id: number; fullName: string }>('SELECT "id","fullName" FROM "Profile" WHERE "auth0Id"=$1 AND "role"=$2::"UserRole"', [subject, role]);
  if (!rows[0]) throw createRouteError(403, 'FORBIDDEN', 'This action is unavailable for your current account.');
  return rows[0];
}
export function invalid(message: string): never { throw createRouteError(400, 'VALIDATION_ERROR', message); }
export function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2147483647) invalid('Use a positive whole-number identifier.');
  return Number(value);
}
export function exactFields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid('The request contains invalid or unexpected fields.');
  return value as Record<string, unknown>;
}
export function instant(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid('Include a full date, time and time-zone offset.');
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) invalid('Enter a valid date and time.');
  return date;
}
