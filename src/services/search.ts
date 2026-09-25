// Sprint 3 Member 1: role-filtered global search.
//
// Pure, dependency-free logic for query normalisation, the role/category
// permission matrix, result mapping and grouping. All filtering decisions are
// made here from the caller's authenticated role - never from anything the
// browser supplies - so the DB service and route can stay thin.

export type SearchRole = "ORGANISER" | "TUTOR" | "STUDENT";
export type SearchCategory = "course" | "person" | "timesheet" | "volunteer";

export const SEARCH_CATEGORIES: readonly SearchCategory[] = [
  "course",
  "person",
  "timesheet",
  "volunteer",
];

/**
 * The single source of truth for which categories each role may search.
 * ORGANISER sees courses, people and timesheets; a TUTOR only their own
 * courses/allocations and timesheets; a STUDENT only permitted course info and
 * their own volunteer/overflow items.
 */
export const ROLE_CATEGORY_MATRIX: Record<SearchRole, SearchCategory[]> = {
  ORGANISER: ["course", "person", "timesheet"],
  TUTOR: ["course", "timesheet"],
  STUDENT: ["course", "volunteer"],
};

export const MIN_SEARCH_QUERY_LENGTH = 2;
export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MAX_SEARCH_PAGE_SIZE = 25;
export const DEFAULT_SEARCH_PAGE_SIZE = 10;

export interface SearchResultItem {
  id: number;
  category: SearchCategory;
  label: string;
  sublabel: string;
  linkPath: string;
}

export interface SearchResultGroup {
  category: SearchCategory;
  items: SearchResultItem[];
}

/** Trim and collapse a raw query term without trusting its type. */
export function normalizeSearchTerm(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/u, " ");
}

/** A term is searchable only within the bounded length window. */
export function isValidSearchTerm(term: string): boolean {
  return (
    term.length >= MIN_SEARCH_QUERY_LENGTH &&
    term.length <= MAX_SEARCH_QUERY_LENGTH
  );
}

export function allowedCategoriesForRole(role: SearchRole): SearchCategory[] {
  return ROLE_CATEGORY_MATRIX[role] ?? [];
}

function parseCategoryList(raw: unknown): SearchCategory[] {
  const tokens =
    typeof raw === "string"
      ? raw.split(",")
      : Array.isArray(raw)
        ? raw
        : [];
  const parsed: SearchCategory[] = [];
  for (const token of tokens) {
    const value = typeof token === "string" ? token.trim() : "";
    if (
      SEARCH_CATEGORIES.includes(value as SearchCategory) &&
      !parsed.includes(value as SearchCategory)
    ) {
      parsed.push(value as SearchCategory);
    }
  }
  return parsed;
}

/**
 * Resolve the effective categories for a request: intersect the requested
 * categories with the role's allowed set. An empty or fully-disallowed request
 * falls back to every category the role may see, never to another role's.
 */
export function resolveSearchCategories(
  role: SearchRole,
  rawCategories: unknown,
): SearchCategory[] {
  const allowed = allowedCategoriesForRole(role);
  const requested = parseCategoryList(rawCategories);
  if (requested.length === 0) return allowed;
  const intersection = requested.filter((category) =>
    allowed.includes(category),
  );
  return intersection.length > 0 ? intersection : allowed;
}

function clampInteger(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export function clampSearchPage(raw: unknown): number {
  return clampInteger(raw, 1, 1, 10_000);
}

export function clampSearchPageSize(raw: unknown): number {
  return clampInteger(
    raw,
    DEFAULT_SEARCH_PAGE_SIZE,
    1,
    MAX_SEARCH_PAGE_SIZE,
  );
}

/** Where a result of a given category should take a given role. */
export function linkPathFor(
  category: SearchCategory,
  role: SearchRole,
  id?: number,
): string {
  if (category === "course") {
    if (role === "ORGANISER") return id ? `/organiser/courses/${id}` : "/organiser/courses";
    if (role === "TUTOR") return id ? `/tutor/courses/${id}` : "/tutor";
    return id ? `/student/courses/${id}` : "/student";
  }
  if (category === "person") return id ? `/organiser/tutors/${id}` : "/organiser/tutors";
  if (category === "timesheet") {
    if (role === "ORGANISER") return id ? `/organiser/timesheets/${id}` : "/organiser";
    return id ? `/tutor/forms/timesheets/${id}` : "/tutor/forms";
  }
  return id ? `/student/volunteer/${id}` : "/student";
}

export interface CourseRow {
  id: number;
  code: string;
  name: string;
}

export interface PersonRow {
  id: number;
  fullName: string;
  role: string;
}

export interface TimesheetRow {
  id: number;
  status: string;
  weekStart: string;
  tutorName: string;
}

export interface VolunteerRow {
  id: number;
  status: string;
  courseCode: string;
  courseName: string;
}

export function toCourseResult(
  row: CourseRow,
  role: SearchRole,
): SearchResultItem {
  return {
    id: row.id,
    category: "course",
    label: row.code,
    sublabel: row.name,
    linkPath: linkPathFor("course", role, row.id),
  };
}

export function toPersonResult(
  row: PersonRow,
  role: SearchRole,
): SearchResultItem {
  return {
    id: row.id,
    category: "person",
    label: row.fullName,
    // Role is not private detail; a name plus role is what an organiser may
    // already see. No email or other contact detail is exposed here.
    sublabel: row.role,
    linkPath: linkPathFor("person", role, row.id),
  };
}

export function toTimesheetResult(
  row: TimesheetRow,
  role: SearchRole,
): SearchResultItem {
  const week = String(row.weekStart).slice(0, 10);
  return {
    id: row.id,
    category: "timesheet",
    label:
      role === "ORGANISER"
        ? `${row.tutorName} - week of ${week}`
        : `Timesheet week of ${week}`,
    sublabel: row.status,
    linkPath: linkPathFor("timesheet", role, row.id),
  };
}

export function toVolunteerResult(
  row: VolunteerRow,
  role: SearchRole,
): SearchResultItem {
  return {
    id: row.id,
    category: "volunteer",
    label: `${row.courseCode} volunteer work`,
    sublabel: `${row.courseName} - ${row.status}`,
    linkPath: linkPathFor("volunteer", role, row.id),
  };
}

/**
 * Group flat results by category, preserving the category order the role sees
 * and dropping empty groups. Total item count is bounded by the caller.
 */
export function groupSearchResults(
  role: SearchRole,
  items: SearchResultItem[],
): SearchResultGroup[] {
  const order = allowedCategoriesForRole(role);
  const groups: SearchResultGroup[] = [];
  for (const category of order) {
    const forCategory = items.filter((item) => item.category === category);
    if (forCategory.length > 0) {
      groups.push({ category, items: forCategory });
    }
  }
  return groups;
}
