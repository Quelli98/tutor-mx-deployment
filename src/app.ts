import { normalizeIdempotencyKey } from "./http/idempotency.js";
import { createRouteError, sanitizeError } from "./http/errors.js";
import { boundedInteger, MAX_DATABASE_ID, parsePage } from "./http/validation.js";
import express, { type Express } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import {
  TUTOR_ROLES,
  type AccessTokenVerifier,
  type TutorRole,
} from "./auth/contract.js";
import {
  createAuthenticationMiddleware,
  createProfileRoleMiddleware,
  hasMasterOrganiserAccess,
  requireMasterOrganiser,
  requireRole,
  type AuthenticatedRequest,
} from "./auth/middleware.js";
import type { PasswordResetRequester } from "./auth/password-reset.js";
import type { VerificationEmailSender } from "./auth/management-api.js";
import type { ExternalApiResult } from "./integrations/external-api.js";
import type { PublicHoliday } from "./integrations/public-holidays.js";
import type { CandidateReasonCode } from "./services/allocation-queries.js";
import {
  parseNotificationListQuery,
  type NotificationListQuery,
} from "./services/notifications.js";
import type { NotificationListResult } from "./services/notification-service.js";
import {
  clampSearchPage,
  clampSearchPageSize,
  isValidSearchTerm,
  normalizeSearchTerm,
  resolveSearchCategories,
} from "./services/search.js";
import type { ResolvedSearchQuery, SearchResponse } from "./services/search-service.js";
import {
  parseAcademicTermInput,
  type AcademicTermInput,
  type AcademicTermSummary,
} from "./services/academic-terms.js";
import { checkTimeSlotRules } from "./services/time-slot-rules.js";
import {
  parseTimetableImportRequest,
  type TimetableImportPreview,
  type TimetableImportRequest,
} from "./services/timetable-import.js";
import type { TimetableImportCommitResult } from "./services/timetable-import-service.js";
import type {
  TimesheetCorrectionInput,
  TimesheetCorrectionResult,
  TimesheetDeclarationSummary,
  TimesheetDisputeInput,
  TimesheetDisputeResolutionInput,
  TimesheetDisputeSummary,
  TimesheetHistory,
} from "./services/timesheet-corrections.js";

type ReadinessCheck = () => Promise<void>;

export interface ApiRequestLog {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export type RequestLogger = (entry: ApiRequestLog) => void;

export interface CourseSummary {
  id: number;
  code: string;
  name: string;
  /** Unset until an organiser records them; no rate means no money figures. */
  hourlyRate: number | null;
  budget: number | null;
}

export interface TutorSummary {
  id: number;
  email: string;
  fullName: string;
  role: TutorRole;
  weeklyHours: number | null;
  usedHours: number;
  remainingHours: number | null;
  workedHours: number;
  weekStart: string;
  weekEnd: string;
  capacityStatus: "available" | "near-limit" | "limit-reached" | "not-set";
}

export interface CourseWriteInput {
  code: string;
  name: string;
  /** Absent leaves the stored value untouched; null clears it. */
  hourlyRate?: number | null;
  budget?: number | null;
}

export interface TutorWeeklyCapacity {
  weeklyHours: number | null;
}

export interface AllocationAttendanceSummary {
  occurrenceStatus?: string;
  absenceReason?: string | null;
  excusePending?: boolean;
  workLogEligible?: boolean;
  excuse?: { id: number; status: string; reviewReason: string | null; submittedAt?: string; reviewedAt: string | null } | null;
}

export interface TutorAllocationSummary extends AllocationAttendanceSummary {
  id: number;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  allocatedHours: number;
  status: "PROPOSED" | "CONFIRMED";
}

export interface TutorDashboardSummary {
  allocations: TutorAllocationSummary[];
  weeklyLimit: number | null;
  usedHours: number;
  remainingHours: number | null;
  hasSchedule?: boolean;
}

export interface TutorTimeSlotWriteInput {
  type: "AVAILABLE" | "BUSY";
  startsAt: Date;
  endsAt: Date;
  recurrence?: "WEEKLY" | "FORTNIGHTLY";
  label?: string | null;
  // Inclusive last occurrence START; null means repeat indefinitely.
  recurrenceUntil?: Date | null;
  category?: string;
  seriesId?: string | null;
}

export interface TutorTimeSlotSummary {
  termId?: number | null;
  teachingBreaks?: Array<{ startsOn: string; endsOn: string }>;
  exceptions?: Array<{ occurrenceDate: string; exceptionType: string; newStartsAt: string | null; newEndsAt: string | null }>;
  id: number;
  type: "AVAILABLE" | "BUSY";
  startsAt: string;
  endsAt: string;
  recurrence: "WEEKLY" | "FORTNIGHTLY" | "ONCE" | null;
  label: string | null;
  recurrenceUntil: string | null;
  category?: string;
  seriesId?: string | null;
}

export interface TutorWorkLogWriteInput {
  allocationId: number;
  workDate: string;
  hours: number;
  description: string;
}

export interface TutorWorkLogSummary extends TutorWorkLogWriteInput {
  id: number;
  timesheetId: number;
}

export interface TutorExcuseWriteInput {
  allocationId: number;
  reason: string;
}

export interface TutorExcuseSummary extends TutorExcuseWriteInput {
  id: number;
  status: "PENDING";
}

export interface StudentOpenWorkSummary {
  id: number;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  status: "OPEN";
  closesAt: string | null;
}

export interface StudentVolunteerRequestSummary {
  id: number;
  overflowWorkId: number;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN";
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentVolunteerRequestDetailsSummary
  extends StudentVolunteerRequestSummary {
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  hours: number;
}

export interface TutorTimesheetStatusSummary {
  id: number;
  weekStart: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  totalHours: number;
}

export interface TutorExcuseStatusSummary {
  occurrenceStatus?: "EXCUSED" | "SKIPPED" | null;
  absenceReason?: "SICK";
  reviewedAt?: string | null;
  reviewedById?: number | null;
  id: number;
  allocationId: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExcuseDecisionInput {
  decision: "APPROVE" | "REJECT";
  reason?: string;
}

export type AllocationReasonCode = CandidateReasonCode;

export interface AllocationCandidateSummary {
  tutorId: number;
  fullName: string;
  mark: number;
  weeklyLimit: number;
  usedHours: number;
  remainingHours: number;
  hasClash: boolean;
  isEligible: boolean;
  reasonCodes: AllocationReasonCode[];
  /** The mark rounded down to its band of ten: 84 becomes 80. */
  markBand: number;
  /**
   * Weekly hours already used as a fraction of the tutor's limit, the second
   * ranking step. A ranking input only - never shown to anyone. The board says
   * "4 of 10 hours used that week", from usedHours and weeklyLimit, because a
   * raw decimal like 0.4 means nothing to an organiser. Do not render it.
   */
  capacityShare: number;
}

export interface AllocationCandidateQuery {
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  minimumMark: number;
  requestedHours: number;
  excludeAllocationId?: number;
}

export type AllocationWriteStatus = "PROPOSED" | "CONFIRMED";

export interface AllocationWriteInput {
  tutorId: number;
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  minimumMark: number;
  requestedHours: number;
  status?: AllocationWriteStatus;
  /** Set only when an organiser overrode a bulk allocation suggestion. */
  overrideReason?: string;
}

export interface AllocationSummary extends AllocationAttendanceSummary {
  id: number;
  tutorId: number;
  courseId: number;
  startsAt: string;
  endsAt: string;
  allocatedHours: number;
  status: AllocationWriteStatus | "CANCELLED";
}

export type StaffingRequirementStatus = "OPEN" | "CLOSED" | "CANCELLED";

/**
 * How much of a requirement is covered, worked out on every read from confirmed
 * allocations. Never stored, so it cannot go stale. A closed or cancelled
 * requirement is "not-being-filled": nobody wants it filled, so it has no
 * shortage to add into any total.
 */
export type StaffingRequirementFillState =
  | "unfilled"
  | "partially-filled"
  | "fully-filled"
  | "not-being-filled";

/** Recorded demand for a course. Fill level is never stored here. */
export interface StaffingRequirementSummary {
  id: number;
  courseId: number;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  /** How many tutors the organiser wants on this work. */
  tutorsNeeded: number;
  /** How long the window runs. Derived, never stored. */
  windowHours: number;
  /** windowHours x tutorsNeeded. Derived, never stored. */
  requiredHours: number;
  /** Confirmed tutor-hours already covering this window. Derived, never stored. */
  assignedHours: number;
  /** requiredHours minus assignedHours, never below zero, zero once closed. */
  shortageHours: number;
  /** The shortage as whole tutors, rounded up. Zero once closed. */
  shortageTutors: number;
  fillState: StaffingRequirementFillState;
  status: StaffingRequirementStatus;
  notes: string | null;
  createdById: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffingRequirementWriteInput {
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  tutorsNeeded: number;
  /** Absent leaves an existing note untouched; null clears it. */
  notes?: string | null;
}

/** One tutor bulk allocation proposes for one place on a requirement. */
export interface BulkAllocationProposal {
  tutorId: number;
  fullName: string;
  hours: number;
  mark: number;
  markBand: number;
  usedHours: number;
  weeklyLimit: number;
}

export interface BulkAllocationPreviewItem {
  requirementId: number;
  courseId: number;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  windowHours: number;
  shortageHours: number;
  /** Places the shortage calls for, from the S3-M2-1 calculation. */
  tutorsWanted: number;
  proposals: BulkAllocationProposal[];
  /** Places nobody could be proposed for, with the reason in note. */
  unfilled: number;
  note: string | null;
  /** Eligible tutors the organiser may choose instead. Never anyone ineligible. */
  alternatives: BulkAllocationProposal[];
}

export interface BulkAllocationPreviewQuery {
  requirementIds: number[];
  minimumMark: number;
}

export interface BulkAllocationCommitItem {
  requirementId: number;
  tutorId: number;
  /** Who preview proposed, so a deliberate change is explicit, not inferred. */
  proposedTutorId: number;
  overrideReason?: string;
}

export interface BulkAllocationCommitInput {
  minimumMark: number;
  items: BulkAllocationCommitItem[];
}

export interface BulkAllocationCommitResult {
  requirementId: number;
  tutorId: number;
  outcome: "saved" | "failed";
  allocationId?: number;
  code?: string;
  message?: string;
}

export interface StaffingRequirementListQuery {
  /** Internal filter for a validated bulk selection. */
  ids?: number[];
  courseId?: number;
  status?: StaffingRequirementStatus;
}

/**
 * The lifecycle state of an overflow item. OPEN is the only state the student
 * read shows; the organiser screen can move an item to CLOSED explicitly.
 */
export type OverflowWorkStatus = "OPEN" | "FILLED" | "CLOSED" | "CANCELLED";

/**
 * Overflow work as the organiser screen reads it. Claim counts are carried so
 * the screen can show what is waiting on a decision without a second call.
 */
export interface OrganiserOverflowWorkSummary {
  id: number;
  courseId: number;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  windowHours: number;
  status: OverflowWorkStatus;
  closesAt: string | null;
  /** The staffing requirement this item was converted from, when it was. */
  sourceRequirementId: number | null;
  pendingClaims: number;
  acceptedClaims: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganiserOverflowWorkCreateInput {
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  hours: number;
  closesAt: Date | null;
  sourceRequirementId: number | null;
}

export interface OrganiserOverflowWorkUpdateInput {
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  hours: number;
  closesAt: Date | null;
  /**
   * The updatedAt the organiser was shown. The write only matches that
   * version, so a save from a second session is refused as stale.
   */
  expectedUpdatedAt: Date;
}

export interface OrganiserOverflowWorkCloseInput {
  expectedUpdatedAt: Date;
}

export interface OrganiserAllocationSummary extends AllocationSummary {
  tutorName: string;
  tutorEmail: string;
  courseCode: string;
  courseName: string;
}

export interface OrganiserTimesheetEntrySummary {
  id: number;
  allocationId: number;
  courseCode: string;
  courseName: string;
  workDate: string;
  hours: number;
  description: string;
}

export interface OrganiserTimesheetApprovalSummary {
  id: number;
  tutorId: number;
  tutorName: string;
  tutorEmail: string;
  weekStart: string;
  submittedAt: string | null;
  totalHours: number;
  workLogs: OrganiserTimesheetEntrySummary[];
}

export interface OrganiserVolunteerClaimApprovalSummary {
  id: number;
  overflowWorkId: number;
  studentId: number;
  studentName: string;
  studentEmail: string;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  createdAt: string;
}

/** A pending excuse, with everything an organiser needs to decide on it. */
export interface OrganiserExcuseApprovalSummary {
  id: number;
  tutorId: number;
  tutorName: string;
  tutorEmail: string;
  allocationId: number;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  createdAt: string;
}

export interface OrganiserApprovalQueuesSummary {
  timesheets: OrganiserTimesheetApprovalSummary[];
  volunteerClaims: OrganiserVolunteerClaimApprovalSummary[];
  excuses: OrganiserExcuseApprovalSummary[];
}

/**
 * Reporting keeps three kinds of hours apart and never adds them together:
 * capacity (what a tutor could work), allocated (what they are booked for) and
 * approved worked (what they did and had signed off).
 */
export interface CourseReportRow {
  courseId: number;
  courseCode: string;
  courseName: string;
  allocatedHours: number;
  approvedWorkedHours: number;
  hourlyRate: number | null;
  budget: number | null;
  /** Approved worked hours x rate: money owed. Null when no rate is set. */
  spend: number | null;
  /** Allocated hours x rate: booked but not yet worked. */
  committed: number | null;
  budgetRemaining: number | null;
}

export interface TutorReportRow {
  tutorId: number;
  fullName: string;
  /** Weekly limit x weeks, at today's limit. Limits are not kept historically. */
  capacityHours: number | null;
  allocatedHours: number;
  approvedWorkedHours: number;
  shareOfAllocatedHours: number;
}

export interface WorkloadReport {
  period: { weekStart: string; weekEnd: string; weeks: number };
  courses: CourseReportRow[];
  tutors: TutorReportRow[];
}

export interface WorkloadReportQuery {
  weekStart: Date;
  weeks: number;
}

/**
 * One day of the period, summed from the requirements that start on it. The
 * fill state is the staffing service's own rule applied to the day's totals,
 * and it is absent when the day has no requirements at all.
 */
export interface CommandCentreStaffingDay {
  /** The day itself, as YYYY-MM-DD. */
  date: string;
  requiredHours: number;
  assignedHours: number;
  unfilledHours: number;
  /** How many requirements start on this day. */
  requirements: number;
  fillState: StaffingRequirementFillState | null;
}

/**
 * The Organiser Command Centre's one read: everything the dashboard shows for a
 * single period, assembled by the command-centre service from the reads that
 * already own each figure. Totals are worked out on the server, so no screen
 * ever adds a business figure of its own.
 */
export interface CommandCentreSummary {
  /** The same period contract as the reports, so both measure identical weeks. */
  period: { weekStart: string; weekEnd: string; weeks: number };
  staffing: {
    /** Summed from the requirement rows below, which all start in the period. */
    requiredHours: number;
    assignedHours: number;
    unfilledHours: number;
    openRequirements: number;
    unfilledRequirements: number;
    requirements: StaffingRequirementSummary[];
    /**
     * Every day of the period in order, for the shortage heatmap. A day with
     * nothing starting on it carries zeros and no fill state at all, so an
     * empty day never reads as a filled one.
     */
    days: CommandCentreStaffingDay[];
  };
  finance: {
    /** Null means nothing could be priced. It never stands for zero. */
    budget: number | null;
    spend: number | null;
    committed: number | null;
    remaining: number | null;
    overBudgetCourses: number;
    unpricedCourses: number;
    courses: CourseReportRow[];
  };
  workload: { tutors: TutorReportRow[] };
  actions: {
    pendingTimesheets: number;
    pendingVolunteerClaims: number;
    pendingExcuses: number;
    openDisputes: number;
    total: number;
  };
  overflow: {
    openItems: number;
    openHours: number;
    unclaimedItems: number;
  };
}

/**
 * One line of a payroll run: what one tutor did on one course in one week. The
 * period is the week of the timesheet that was signed off, so every line can be
 * traced back to the sheet behind it.
 */
export interface PayrollExportRow {
  periodStart: string;
  periodEnd: string;
  tutorId: number;
  tutor: string;
  courseCode: string;
  courseName: string;
  hours: number;
  status: "APPROVED";
  /** Approved, but held back by an objection that is still open. */
  held: boolean;
}

/**
 * Approved work splits into what may be paid and what is held back, and the two
 * halves are reported rather than netted off: an hour is either payable or it is
 * waiting on an answer, never quietly missing. Payable plus held is the same
 * total the workload report shows for the period, which is what makes the two
 * reconcilable.
 */
export interface PayrollExport {
  period: { weekStart: string; weekEnd: string; weeks: number };
  /** What may be paid now. */
  rows: PayrollExportRow[];
  /** Approved work an open dispute holds back. Never paid, never hidden. */
  heldRows: PayrollExportRow[];
  totals: { payableHours: number; heldHours: number; approvedHours: number };
}

/** The file a payroll run downloads: the name to save it under, and its text. */
export interface PayrollExportCsv {
  filename: string;
  csv: string;
}

export interface TimesheetDecisionInput {
  decision: "APPROVE" | "RETURN";
  reason?: string;
}

export interface TimesheetDecisionSummary {
  id: number;
  tutorId: number;
  weekStart: string;
  status: "APPROVED" | "RETURNED";
  reviewedAt: string;
  reviewedById: number;
  reviewReason: string | null;
}

export interface VolunteerClaimDecisionInput {
  decision: "APPROVE" | "REJECT";
  reason?: string;
}

export interface VolunteerClaimDecisionSummary {
  id: number;
  overflowWorkId: number;
  studentId: number;
  status: "ACCEPTED" | "REJECTED";
  reviewReason: string | null;
}

export interface TutorMarkWriteInput {
  courseId: number;
  mark: number;
}

export interface TutorMarkSummary {
  id: number;
  courseId: number;
  courseCode: string;
  courseName: string;
  mark: number;
  activeAllocationCount: number;
}

export interface ProfileSummary {
  id: number;
  email: string;
  fullName: string;
  role: TutorRole;
}

export type OrganiserApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface OrganiserApplicationSummary {
  id: number;
  status: OrganiserApplicationStatus;
  motivation: string | null;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  applicant: {
    email: string;
    fullName: string;
  };
  reviewer: {
    id: number;
    email: string;
    fullName: string;
  } | null;
}

export interface RouteError extends Error {
  status: number;
  code: string;
}

export interface AppDependencies {
  corsOrigin?: string;
  findProfileByAuth0Id: (auth0Id: string) => Promise<ProfileSummary | null>;
  onboardUser: (auth0Id: string, role: TutorRole) => Promise<ProfileSummary>;
  registerOrganiserApplication?: (auth0Id: string) => Promise<OrganiserApplicationSummary>;
  getOwnOrganiserApplication?: (auth0Id: string) => Promise<OrganiserApplicationSummary | null>;
  getOrganiserApplicationStatusByEmail?: (email: string) => Promise<OrganiserApplicationStatus | "NOT_FOUND">;
  listOrganiserApplications?: () => Promise<OrganiserApplicationSummary[]>;
  approveOrganiserApplication?: (reviewerAuth0Id: string, applicationId: number) => Promise<OrganiserApplicationSummary>;
  rejectOrganiserApplication?: (
    reviewerAuth0Id: string,
    applicationId: number,
    reviewReason: string | null,
  ) => Promise<OrganiserApplicationSummary>;
  getPublicHolidays: (
    year: number,
  ) => Promise<ExternalApiResult<PublicHoliday[]>>;
  listCourses: () => Promise<CourseSummary[]>;
  createCourse: (input: CourseWriteInput) => Promise<CourseSummary>;
  updateCourse: (
    courseId: number,
    input: CourseWriteInput,
  ) => Promise<CourseSummary>;
  deleteCourse: (courseId: number) => Promise<void>;
  listTutors: (weekStart?: Date) => Promise<TutorSummary[]>;
  getTutorDashboard: (auth0Id: string) => Promise<TutorDashboardSummary>;
  listOwnTutorTimeSlots: (auth0Id: string) => Promise<TutorTimeSlotSummary[]>;
  updateTutorTimeSlot: (
    auth0Id: string,
    timeSlotId: number,
    input: TutorTimeSlotWriteInput,
  ) => Promise<TutorTimeSlotSummary>;
  deleteTutorTimeSlot: (auth0Id: string, timeSlotId: number) => Promise<void>;
  updateTutorWeeklyCapacity: (
    auth0Id: string,
    input: TutorWeeklyCapacity,
  ) => Promise<TutorWeeklyCapacity>;
  createTutorTimeSlot: (
    auth0Id: string,
    input: TutorTimeSlotWriteInput,
  ) => Promise<TutorTimeSlotSummary>;
  createTutorWorkLog: (
    auth0Id: string,
    input: TutorWorkLogWriteInput,
  ) => Promise<TutorWorkLogSummary>;
  createTutorExcuse: (
    auth0Id: string,
    input: TutorExcuseWriteInput,
  ) => Promise<TutorExcuseSummary>;
  listStudentOpenWork: (
    auth0Id: string,
  ) => Promise<StudentOpenWorkSummary[]>;
  listStudentVolunteerRequests: (
    auth0Id: string,
  ) => Promise<StudentVolunteerRequestDetailsSummary[]>;
  createStudentVolunteerRequest: (
    auth0Id: string,
    input: { overflowWorkId: number },
  ) => Promise<StudentVolunteerRequestSummary>;
  getStudentVolunteerRequest: (
    auth0Id: string,
    requestId: number,
  ) => Promise<StudentVolunteerRequestSummary>;
  withdrawStudentVolunteerRequest: (
    auth0Id: string,
    requestId: number,
  ) => Promise<StudentVolunteerRequestSummary>;
  getTutorTimesheetStatus: (
    auth0Id: string,
    timesheetId: number,
  ) => Promise<TutorTimesheetStatusSummary>;
  submitTutorTimesheet: (
    auth0Id: string,
    timesheetId: number,
  ) => Promise<TutorTimesheetStatusSummary>;
  /**
   * The correction-history surface. Optional so an environment that has not wired
   * it answers 503 instead of appearing to accept a correction it cannot record.
   */
  getTutorTimesheetHistory?: (
    auth0Id: string,
    timesheetId: number,
  ) => Promise<TimesheetHistory>;
  correctTutorTimesheetWorkLog?: (
    auth0Id: string,
    timesheetId: number,
    workLogId: number,
    input: TimesheetCorrectionInput,
  ) => Promise<TimesheetCorrectionResult>;
  declareTutorTimesheet?: (
    auth0Id: string,
    timesheetId: number,
    statementVersion: string,
  ) => Promise<TimesheetDeclarationSummary>;
  raiseTutorTimesheetDispute?: (
    auth0Id: string,
    timesheetId: number,
    input: TimesheetDisputeInput,
  ) => Promise<TimesheetDisputeSummary>;
  listTimesheetDisputes?: (
    auth0Id: string,
  ) => Promise<TimesheetDisputeSummary[]>;
  resolveTimesheetDispute?: (
    auth0Id: string,
    disputeId: number,
    input: TimesheetDisputeResolutionInput,
  ) => Promise<TimesheetDisputeSummary>;
  getTutorExcuseStatus: (
    auth0Id: string,
    excuseId: number,
  ) => Promise<TutorExcuseStatusSummary>;
  decideExcuse: (
    excuseId: number,
    input: ExcuseDecisionInput,
    auth0Id: string,
  ) => Promise<TutorExcuseStatusSummary>;
  listAllocationCandidates: (
    input: AllocationCandidateQuery,
  ) => Promise<AllocationCandidateSummary[]>;
  listOrganiserAllocations: () => Promise<OrganiserAllocationSummary[]>;
  listOrganiserApprovals: () => Promise<OrganiserApprovalQueuesSummary>;
  createAllocation: (
    auth0Id: string,
    input: AllocationWriteInput,
  ) => Promise<AllocationSummary>;
  updateAllocation: (
    auth0Id: string,
    allocationId: number,
    input: AllocationWriteInput,
  ) => Promise<AllocationSummary>;
  removeAllocation: (
    auth0Id: string,
    allocationId: number,
  ) => Promise<AllocationSummary | null>;
  decideTimesheet: (
    auth0Id: string,
    timesheetId: number,
    input: TimesheetDecisionInput,
  ) => Promise<TimesheetDecisionSummary>;
  decideVolunteerClaim: (
    claimId: number,
    input: VolunteerClaimDecisionInput,
  ) => Promise<VolunteerClaimDecisionSummary>;
  upsertTutorMark: (
    tutorId: number,
    input: TutorMarkWriteInput,
  ) => Promise<TutorMarkSummary>;
  listTutorMarks: (tutorId: number) => Promise<TutorMarkSummary[]>;
  deleteTutorMark: (tutorId: number, courseId: number) => Promise<void>;
  listTutorTimeSlots: (tutorId: number) => Promise<TutorTimeSlotSummary[]>;
  requestPasswordReset: PasswordResetRequester;
  requestVerificationEmail?: VerificationEmailSender;
  deleteAccount?: (auth0Id: string) => Promise<void>;
  listNotifications?: (
    auth0Id: string,
    query: NotificationListQuery,
  ) => Promise<NotificationListResult>;
  countUnreadNotifications?: (auth0Id: string) => Promise<number>;
  markNotificationRead?: (
    auth0Id: string,
    notificationId: number,
  ) => Promise<{ id: number; readAt: string }>;
  getNotification?: (
    auth0Id: string,
    notificationId: number,
  ) => Promise<{ linkPath: string; targetType: string; targetId: number | null } | null>;
  markAllNotificationsRead?: (auth0Id: string) => Promise<{ updated: number }>;
  runDueReminders?: () => Promise<{ generated: number }>;
  search?: (auth0Id: string, query: ResolvedSearchQuery) => Promise<SearchResponse>;
  workloadReport?: (query: WorkloadReportQuery) => Promise<WorkloadReport>;
  payrollExportCsv?: (
    query: WorkloadReportQuery,
  ) => Promise<PayrollExportCsv>;
  /**
   * The Command Centre's single aggregate read. Optional, so an environment
   * that has not wired it answers 503 rather than showing a dashboard of
   * blanks.
   */
  commandCentreSummary?: (
    auth0Id: string,
    query: WorkloadReportQuery,
  ) => Promise<CommandCentreSummary>;
  previewBulkAllocations?: (
    query: BulkAllocationPreviewQuery,
  ) => Promise<BulkAllocationPreviewItem[]>;
  commitBulkAllocations?: (
    auth0Id: string,
    input: BulkAllocationCommitInput,
  ) => Promise<BulkAllocationCommitResult[]>;
  listStaffingRequirements?: (
    query: StaffingRequirementListQuery,
  ) => Promise<StaffingRequirementSummary[]>;
  createStaffingRequirement?: (
    auth0Id: string,
    input: StaffingRequirementWriteInput,
  ) => Promise<StaffingRequirementSummary>;
  updateStaffingRequirement?: (
    requirementId: number,
    input: StaffingRequirementWriteInput,
  ) => Promise<StaffingRequirementSummary>;
  setStaffingRequirementStatus?: (
    requirementId: number,
    status: StaffingRequirementStatus,
  ) => Promise<StaffingRequirementSummary>;
  /** Overflow work the organiser screen posts, edits and closes. */
  listOrganiserOverflowWork?: () => Promise<OrganiserOverflowWorkSummary[]>;
  createOrganiserOverflowWork?: (
    input: OrganiserOverflowWorkCreateInput,
    retry?: { auth0Id: string; key: string },
  ) => Promise<OrganiserOverflowWorkSummary[]>;
  updateOrganiserOverflowWork?: (
    overflowWorkId: number,
    input: OrganiserOverflowWorkUpdateInput,
  ) => Promise<OrganiserOverflowWorkSummary>;
  closeOrganiserOverflowWork?: (
    overflowWorkId: number,
    input: OrganiserOverflowWorkCloseInput,
  ) => Promise<OrganiserOverflowWorkSummary>;
  /** Academic terms bound how far an imported recurring schedule entry repeats. */
  listAcademicTerms?: () => Promise<AcademicTermSummary[]>;
  listPublishedAcademicTerms?: () => Promise<AcademicTermSummary[]>;
  createAcademicTerm?: (
    input: AcademicTermInput,
  ) => Promise<AcademicTermSummary>;
  updateAcademicTerm?: (
    id: number,
    input: AcademicTermInput,
  ) => Promise<AcademicTermSummary>;
  deleteAcademicTerm?: (id: number) => Promise<void>;
  previewTutorTimetableImport?: (
    auth0Id: string,
    request: TimetableImportRequest,
  ) => Promise<TimetableImportPreview>;
  commitTutorTimetableImport?: (
    auth0Id: string,
    request: TimetableImportRequest,
    idempotencyKey?: string,
  ) => Promise<TimetableImportCommitResult>;
  verifyAccessToken: AccessTokenVerifier;
}

/* v8 ignore start -- configuration-only fail-closed stubs; route behavior is tested with injected dependencies */
const unavailableDependencies: AppDependencies = {
  async findProfileByAuth0Id() {
    throw new Error("Authentication is not configured");
  },
  async onboardUser() {
    throw new Error("Self-service onboarding is not configured");
  },
  async getPublicHolidays() {
    throw new Error("Public-holiday integration is not configured");
  },
  async listCourses() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async createCourse() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async updateCourse() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async deleteCourse() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async listTutors() {
    throw new Error("Backend course and tutor endpoints are not configured");
  },
  async listOwnTutorTimeSlots() {
    throw new Error("Tutor schedule endpoints are not configured");
  },
  async updateTutorTimeSlot() {
    throw new Error("Tutor schedule endpoints are not configured");
  },
  async deleteTutorTimeSlot() {
    throw new Error("Tutor schedule endpoints are not configured");
  },
  async updateTutorWeeklyCapacity() {
    throw new Error("Tutor capacity endpoint is not configured");
  },
  async getTutorDashboard() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async createTutorTimeSlot() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async createTutorWorkLog() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async createTutorExcuse() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async listStudentOpenWork() {
    throw new Error("Student workflow endpoints are not configured");
  },
  async listStudentVolunteerRequests() {
    throw new Error("Student workflow endpoints are not configured");
  },
  async createStudentVolunteerRequest() {
    throw new Error("Student workflow endpoints are not configured");
  },
  async getStudentVolunteerRequest() {
    throw new Error("Student workflow endpoints are not configured");
  },
  async withdrawStudentVolunteerRequest() {
    throw new Error("Student workflow endpoints are not configured");
  },
  async getTutorTimesheetStatus() {
    throw new Error("Timesheet workflow endpoints are not configured");
  },
  async submitTutorTimesheet() {
    throw new Error("Timesheet workflow endpoints are not configured");
  },
  async getTutorExcuseStatus() {
    throw new Error("Excuse workflow endpoints are not configured");
  },
  async decideExcuse() {
    throw new Error("Excuse workflow endpoints are not configured");
  },
  async listAllocationCandidates() {
    throw new Error("Allocation candidate endpoint is not configured");
  },
  async listOrganiserAllocations() {
    throw new Error("Organiser allocation endpoint is not configured");
  },
  async listOrganiserApprovals() {
    throw new Error("Organiser approval endpoint is not configured");
  },
  async createAllocation() {
    throw new Error("Allocation mutation endpoints are not configured");
  },
  async updateAllocation() {
    throw new Error("Allocation mutation endpoints are not configured");
  },
  async removeAllocation() {
    throw new Error("Allocation mutation endpoints are not configured");
  },
  async decideTimesheet() {
    throw new Error("Timesheet decision endpoint is not configured");
  },
  async decideVolunteerClaim() {
    throw new Error("Volunteer-claim decision endpoint is not configured");
  },
  async upsertTutorMark() {
    throw new Error("Tutor mark endpoint is not configured");
  },
  async listTutorMarks() {
    throw new Error("Tutor mark endpoint is not configured");
  },
  async deleteTutorMark() {
    throw new Error("Tutor mark endpoint is not configured");
  },
  async listTutorTimeSlots() {
    throw new Error("Tutor workflow endpoints are not configured");
  },
  async deleteAccount() {
    throw new Error("Account deletion is not configured");
  },
  async requestPasswordReset() {
    throw new Error("Authentication is not configured");
  },
  async requestVerificationEmail() {
    throw new Error("Verification email is not configured");
  },
  async verifyAccessToken() {
    throw new Error("Authentication is not configured");
  },
};
/* v8 ignore stop */

function isValidEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function error(status: number, code: string, message: string) {
  return { status, body: { error: { code, message } } };
}

export { createRouteError } from "./http/errors.js";
function sendRouteError(response: express.Response, value: unknown) {
  const result = sanitizeError(value);
  response.status(result.status).json(result.body);
}

function parseRequiredText(
  value: unknown,
  _fieldName: string,
  maxLength = 255,
) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }

  return trimmed;
}

function hasOnlyFields(body: unknown, fields: string[]): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) &&
    Object.keys(body).every((key) => fields.includes(key));
}

function parseTutorWeeklyCapacity(body: unknown) {
  if (!hasOnlyFields(body, ["weeklyHours"])) {
    return { error: "Provide only weeklyHours." } as const;
  }
  const weeklyHours = body.weeklyHours;
  if (weeklyHours !== null && (
    typeof weeklyHours !== "number" || !Number.isFinite(weeklyHours) ||
    weeklyHours <= 0 || weeklyHours > 168 || !hasAtMostTwoDecimalPlaces(weeklyHours)
  )) {
    return { error: "Weekly hours must be null or a number above 0 and at most 168 with at most two decimals." } as const;
  }
  return { value: { weeklyHours } } as const;
}

function parseMoneyField(
  value: unknown,
  { allowZero }: { allowZero: boolean },
) {
  if (value === undefined) {
    return { kind: "absent" } as const;
  }
  if (value === null || value === "") {
    return { kind: "clear" } as const;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (!allowZero && value === 0) ||
    !hasAtMostTwoDecimalPlaces(value)
  ) {
    return { kind: "invalid" } as const;
  }
  return { kind: "value", value } as const;
}

function parseCourseInput(body: unknown) {
  if (!hasOnlyFields(body, ["code", "name", "hourlyRate", "budget"])) {
    return {
      error: "Provide only course code, name, hourly rate and budget.",
    } as const;
  }

  const code = parseRequiredText(body.code, "code", 50);
  const name = parseRequiredText(body.name, "name", 120);
  // A rate of zero would make every hour look free; a budget of zero is a real
  // decision, so zero is allowed there.
  const hourlyRate = parseMoneyField(body.hourlyRate, { allowZero: false });
  const budget = parseMoneyField(body.budget, { allowZero: true });

  if (
    !code ||
    !name ||
    hourlyRate.kind === "invalid" ||
    budget.kind === "invalid"
  ) {
    return {
      error:
        "Enter a valid course code and name, an hourly rate above 0, and a budget of 0 or more.",
    } as const;
  }

  return {
    value: {
      code,
      name,
      ...(hourlyRate.kind === "absent"
        ? {}
        : { hourlyRate: hourlyRate.kind === "clear" ? null : hourlyRate.value }),
      ...(budget.kind === "absent"
        ? {}
        : { budget: budget.kind === "clear" ? null : budget.value }),
    },
  } as const;
}

const STAFFING_REQUIREMENT_STATUSES = [
  "OPEN",
  "CLOSED",
  "CANCELLED",
] as const;

/** Matches the "StaffingRequirement_tutors_needed_range" database constraint. */
const MAX_TUTORS_NEEDED = 20;

/** The board's default bar, reused so bulk judges eligibility the same way. */
const DEFAULT_MINIMUM_MARK = 65;

/** One screenful of work; a larger run should be split rather than timed out. */
const MAX_BULK_ITEMS = 50;

/** A year of weeks is the longest period worth reporting in one go. */
const MAX_REPORT_WEEKS = 52;

function bulkAllocationUnavailable() {
  return createRouteError(
    503,
    "BULK_ALLOCATION_UNAVAILABLE",
    "Bulk allocation is not configured.",
  );
}

/** Ids of the requirements to plan for, plus the bar eligibility is judged at. */
/** Whole weeks only: capacity is stored per week, so part-weeks mean nothing. */
function parseWorkloadReportQuery(query: unknown) {
  const params = (query ?? {}) as { weekStart?: unknown; weeks?: unknown };
  // parseWeekStart already insists on a Monday, the same rule the rest of the
  // system uses for a week.
  const weekStart = parseWeekStart(params.weekStart);
  const rawWeeks = firstQueryParam(params.weeks);
  const weeks = rawWeeks === undefined ? 1 : parsePositiveInteger(rawWeeks);

  if (!weekStart || !weeks || weeks > MAX_REPORT_WEEKS) {
    return {
      error: `Choose a week starting on a Monday and a length of 1 to ${MAX_REPORT_WEEKS} weeks.`,
    } as const;
  }

  return { value: { weekStart, weeks } } as const;
}

function parseBulkPreviewQuery(body: unknown) {
  if (!hasOnlyFields(body, ["requirementIds", "minimumMark"])) {
    return { error: "Provide only requirementIds and minimumMark." } as const;
  }

  const requirementIds = Array.isArray(body.requirementIds)
    ? body.requirementIds.map((value) => parseJsonPositiveInteger(value))
    : null;
  const minimumMark = parseMarkValue(body.minimumMark ?? DEFAULT_MINIMUM_MARK);

  if (
    !requirementIds ||
    requirementIds.length === 0 ||
    requirementIds.length > MAX_BULK_ITEMS ||
    requirementIds.some((value) => value === null) ||
    minimumMark === null
  ) {
    return {
      error: `Choose between 1 and ${MAX_BULK_ITEMS} staffing requirements and a minimum mark from 0 to 100.`,
    } as const;
  }

  // The same requirement twice would plan it twice over.
  const value: BulkAllocationPreviewQuery = {
    requirementIds: [...new Set(requirementIds as number[])],
    minimumMark,
  };
  return { value } as const;
}

function parseBulkCommitItem(value: unknown) {
  if (
    !hasOnlyFields(value, [
      "requirementId",
      "tutorId",
      "proposedTutorId",
      "overrideReason",
    ])
  ) {
    return null;
  }

  const requirementId = parseJsonPositiveInteger(value.requirementId);
  const tutorId = parseJsonPositiveInteger(value.tutorId);
  const proposedTutorId = parseJsonPositiveInteger(value.proposedTutorId);
  const hasReason = value.overrideReason !== undefined && value.overrideReason !== null;
  const overrideReason = hasReason
    ? parseRequiredText(value.overrideReason, "overrideReason", 1000)
    : undefined;

  if (!requirementId || !tutorId || !proposedTutorId || (hasReason && !overrideReason)) {
    return null;
  }
  // A reason only means something when the suggestion was actually changed.
  if (tutorId === proposedTutorId && overrideReason) {
    return null;
  }

  return {
    requirementId,
    tutorId,
    proposedTutorId,
    ...(overrideReason ? { overrideReason } : {}),
  };
}

function parseBulkCommitInput(body: unknown) {
  if (!hasOnlyFields(body, ["items", "minimumMark"])) {
    return { error: "Provide only items and minimumMark." } as const;
  }

  const minimumMark = parseMarkValue(body.minimumMark ?? DEFAULT_MINIMUM_MARK);
  const items = Array.isArray(body.items)
    ? body.items.map((item) => parseBulkCommitItem(item))
    : null;

  if (
    !items ||
    items.length === 0 ||
    items.length > MAX_BULK_ITEMS ||
    items.some((item) => item === null) ||
    minimumMark === null
  ) {
    return {
      error: `Send between 1 and ${MAX_BULK_ITEMS} allocations, each with a requirement, a tutor, the tutor that was proposed, and a reason when the two differ.`,
    } as const;
  }

  return {
    value: {
      minimumMark,
      items: items as NonNullable<(typeof items)[number]>[],
    },
  } as const;
}

function staffingRequirementsUnavailable() {
  return createRouteError(
    503,
    "STAFFING_REQUIREMENTS_UNAVAILABLE",
    "Staffing requirements are not configured.",
  );
}

function overflowWorkUnavailable() {
  return createRouteError(
    503,
    "OVERFLOW_WORK_UNAVAILABLE",
    "Organiser overflow work is not configured.",
  );
}

function parseStaffingRequirementStatus(value: unknown) {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : null;
  return (
    STAFFING_REQUIREMENT_STATUSES.find((status) => status === normalized) ??
    null
  );
}

function parseStaffingRequirementInput(body: unknown) {
  if (
    !hasOnlyFields(body, [
      "courseId",
      "startsAt",
      "endsAt",
      "tutorsNeeded",
      "notes",
    ])
  ) {
    // status and createdById are deliberately not accepted: a new requirement
    // always starts OPEN, the author comes from the verified token, and the
    // status is changed through its own route. Required hours are derived from
    // the window and the tutor count, so they are never accepted either.
    return {
      error:
        "Provide only course, start and end time, tutors needed and notes.",
    } as const;
  }

  const courseId = parseJsonPositiveInteger(body.courseId);
  const startsAt = parseIsoDateTime(body.startsAt);
  const endsAt = parseIsoDateTime(body.endsAt);
  // Mirrors the database range: whole people, and no more than one session can
  // realistically be staffed with.
  const tutorsNeeded = parseJsonPositiveInteger(body.tutorsNeeded);
  const hasNotes = body.notes !== undefined && body.notes !== null;
  const notes = hasNotes
    ? parseRequiredText(body.notes, "notes", 1000)
    : undefined;

  if (
    !courseId ||
    !startsAt ||
    !endsAt ||
    endsAt <= startsAt ||
    !tutorsNeeded ||
    tutorsNeeded > MAX_TUTORS_NEEDED ||
    (hasNotes && !notes)
  ) {
    return {
      error: `Enter a valid course, an end time later than the start, a whole number of tutors from 1 to ${MAX_TUTORS_NEEDED}, and optional notes.`,
    } as const;
  }

  // The same bound as an allocation, and it matters more here: required hours
  // are derived as window x tutorsNeeded, so an unbounded window would report a
  // shortage of thousands of hours and send the bulk allocator after it.
  if (!sessionWithinMaximumLength(startsAt, endsAt)) {
    return { error: maximumSessionLengthMessage(startsAt, endsAt) } as const;
  }

  return {
    value: {
      courseId,
      startsAt,
      endsAt,
      tutorsNeeded,
      ...(body.notes === undefined ? {} : { notes: notes ?? null }),
    },
  } as const;
}

function parseStaffingRequirementStatusInput(body: unknown) {
  if (!hasOnlyFields(body, ["status"])) {
    return { error: "Provide only status." } as const;
  }

  const status = parseStaffingRequirementStatus(body.status);
  if (!status) {
    return {
      error: "Enter a valid status of OPEN, CLOSED or CANCELLED.",
    } as const;
  }

  return { value: status } as const;
}

function parseStaffingRequirementListQuery(query: unknown) {
  const params = (query ?? {}) as { courseId?: unknown; status?: unknown };
  const rawCourseId = firstQueryParam(params.courseId);
  const rawStatus = firstQueryParam(params.status);
  const courseId =
    rawCourseId === undefined ? undefined : parsePositiveInteger(rawCourseId);
  const status =
    rawStatus === undefined
      ? undefined
      : parseStaffingRequirementStatus(rawStatus);

  // A filter that cannot be understood is reported, never ignored, so a
  // mistyped filter can never look like "no requirements exist".
  if (
    (rawCourseId !== undefined && !courseId) ||
    (rawStatus !== undefined && !status)
  ) {
    return {
      error:
        "Filter by a valid course identifier and a status of OPEN, CLOSED or CANCELLED.",
    } as const;
  }

  return {
    value: {
      ...(courseId ? { courseId } : {}),
      ...(status ? { status } : {}),
    },
  } as const;
}

const OVERFLOW_WORK_CORE_FIELDS = [
  "courseId",
  "startsAt",
  "endsAt",
  "hours",
  "closesAt",
] as const;

/** What every overflow write has in common, before create/update differences. */
interface OverflowWorkState {
  courseId: number;
  startsAt: Date;
  endsAt: Date;
  hours: number;
  closesAt: Date | null;
}

/**
 * Overflow hours are what a Student ends up claiming, so they follow the same
 * rules as saving an allocation: a positive number with at most two decimals.
 * The window is capped by the same session maximum.
 */
function parseOverflowHours(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 24 ||
    !hasAtMostTwoDecimalPlaces(value)
  ) {
    return null;
  }
  return value;
}

function readOverflowWorkFields(
  body: Record<string, unknown>,
): { error: string } | { value: OverflowWorkState } {
  const courseId = parseJsonPositiveInteger(body.courseId);
  const startsAt = parseIsoDateTime(body.startsAt);
  const endsAt = parseIsoDateTime(body.endsAt);
  const hours = parseOverflowHours(body.hours);
  // An absent deadline means "open until the work starts". An empty string is
  // the form's way of saying the same thing.
  const hasClosesAt =
    body.closesAt !== undefined &&
    body.closesAt !== null &&
    body.closesAt !== "";
  const closesAt = hasClosesAt ? parseIsoDateTime(body.closesAt) : null;

  if (!courseId) {
    return {
      error: "Select the course the overflow work belongs to.",
    } as const;
  }
  if (!startsAt || !endsAt || endsAt <= startsAt) {
    return {
      error: "Provide a start time, and an end time later than the start.",
    } as const;
  }
  if (!sessionWithinMaximumLength(startsAt, endsAt)) {
    return { error: maximumSessionLengthMessage(startsAt, endsAt) } as const;
  }
  if (hours === null || !hoursWithinSession(hours, startsAt, endsAt)) {
    return {
      error: `Enter hours above 0 and no more than the session length of ${sessionLengthText(startsAt, endsAt)}.`,
    } as const;
  }
  // The database check constraint says the same thing: a deadline can only
  // close the window early, never after the work has started.
  if (hasClosesAt && (!closesAt || closesAt > startsAt)) {
    return {
      error:
        "The claim deadline must be a valid time at or before the work starts.",
    } as const;
  }

  return { value: { courseId, startsAt, endsAt, hours, closesAt } } as const;
}

function parseOverflowWorkCreateInput(
  body: unknown,
): { error: string } | { value: OrganiserOverflowWorkCreateInput } {
  if (
    !hasOnlyFields(body, [...OVERFLOW_WORK_CORE_FIELDS, "sourceRequirementId"])
  ) {
    return {
      error:
        "Provide only course, start and end time, hours, an optional claim deadline and an optional source requirement.",
    } as const;
  }
  const fields = readOverflowWorkFields(body);
  if ("error" in fields) {
    return { error: fields.error } as const;
  }
  if (
    body.sourceRequirementId !== undefined &&
    body.sourceRequirementId !== null &&
    body.sourceRequirementId !== ""
  ) {
    const sourceRequirementId = parseJsonPositiveInteger(
      body.sourceRequirementId,
    );
    if (!sourceRequirementId) {
      return {
        error: "sourceRequirementId must be a positive whole number.",
      } as const;
    }
    return { value: { ...fields.value, sourceRequirementId } } as const;
  }

  // Posted by hand, with no staffing requirement behind it.
  return { value: { ...fields.value, sourceRequirementId: null } } as const;
}

function parseOverflowWorkUpdateInput(
  body: unknown,
): { error: string } | { value: OrganiserOverflowWorkUpdateInput } {
  if (
    !hasOnlyFields(body, [...OVERFLOW_WORK_CORE_FIELDS, "expectedUpdatedAt"])
  ) {
    return {
      error:
        "Provide only course, start and end time, hours, an optional claim deadline and the expected version.",
    } as const;
  }
  const expectedUpdatedAt = parseIsoDateTime(body.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return {
      error:
        "expectedUpdatedAt must be the updatedAt you were shown when you started editing.",
    } as const;
  }
  const fields = readOverflowWorkFields(body);
  if ("error" in fields) {
    return { error: fields.error } as const;
  }

  return { value: { ...fields.value, expectedUpdatedAt } } as const;
}

function parseOverflowWorkCloseInput(
  body: unknown,
): { error: string } | { value: OrganiserOverflowWorkCloseInput } {
  if (!hasOnlyFields(body, ["expectedUpdatedAt"])) {
    return {
      error:
        "Provide only expectedUpdatedAt: the updatedAt you were shown when you started closing.",
    } as const;
  }
  const expectedUpdatedAt = parseIsoDateTime(body.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return {
      error:
        "expectedUpdatedAt must be the updatedAt you were shown when you started closing.",
    } as const;
  }
  return { value: { expectedUpdatedAt } } as const;
}

function parseIsoDateTime(value: unknown) {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function parseDateOnly(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function parseWeekStart(value: unknown): Date | null {
  const text = parseDateOnly(firstQueryParam(value));
  if (!text) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return date.getUTCDay() === 1 ? date : null;
}

function parsePositiveInteger(value: unknown) {
  return boundedInteger(value, 1, MAX_DATABASE_ID);
}
function parseJsonPositiveInteger(value: unknown) {
  return typeof value === "number" ? boundedInteger(value, 1, MAX_DATABASE_ID) : null;
}

function hasAtMostTwoDecimalPlaces(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
}

function parseTutorTimeSlotInput(body: unknown) {
  if (!hasOnlyFields(body, ["type", "startsAt", "endsAt", "recurrence", "label", "recurrenceUntil", "category", "seriesId"])) {
    return { error: "Provide only schedule fields, without an ownership identifier." } as const;
  }
  const { type, recurrence } = body;
  // Schedule timestamps must be ISO date-times with an explicit UTC/offset zone.
  const scheduleDate = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    parseDateOnly(value.slice(0, 10))
      ? parseIsoDateTime(value)
      : null;
  const startsAt = scheduleDate(body.startsAt);
  const endsAt = scheduleDate(body.endsAt);
  const label = typeof body.label === "string" ? body.label.trim() : body.label;
  const recurrenceUntil = body.recurrenceUntil == null ? null : scheduleDate(body.recurrenceUntil);

  // The rules themselves live in src/services/time-slot-rules.ts so that the
  // timetable import cannot drift away from what the manual form accepts. Key
  // presence is passed through because an explicit null label and an omitted
  // one have always meant the same thing here.
  const checked = checkTimeSlotRules({
    type,
    startsAt,
    endsAt,
    recurrence,
    labelSupplied: body.label !== undefined,
    label,
    recurrenceUntilSupplied: body.recurrenceUntil !== undefined,
    recurrenceUntilProvided: body.recurrenceUntil != null,
    recurrenceUntil,
  });
  if ("error" in checked) {
    return { error: checked.error } as const;
  }

  if (body.category !== undefined && body.category !== "CLASS" && body.category !== "UNAVAILABLE") {
    return { error: "Choose Class or Unavailable as the schedule category." } as const;
  }
  if (body.seriesId !== undefined && body.seriesId !== null &&
      (typeof body.seriesId !== "string" || !body.seriesId.trim() || body.seriesId.length > 36)) {
    return { error: "Provide a valid schedule series identifier." } as const;
  }
  const value: TutorTimeSlotWriteInput = {
    ...checked.value,
    ...(body.category !== undefined ? { category: body.category as string } : {}),
    ...(body.seriesId !== undefined ? { seriesId: body.seriesId as string | null } : {}),
  };
  return { value } as const;
}

function parseTutorWorkLogInput(body: unknown) {
  const payload = body as {
    allocationId?: unknown;
    workDate?: unknown;
    hours?: unknown;
    description?: unknown;
  } | null;
  const allocationId = parseJsonPositiveInteger(payload?.allocationId);
  const workDate = parseDateOnly(payload?.workDate);
  const hours =
    typeof payload?.hours === "number" ? payload.hours : Number.NaN;
  const description = parseRequiredText(
    payload?.description,
    "description",
    500,
  );

  if (
    !allocationId ||
    !workDate ||
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24 ||
    !hasAtMostTwoDecimalPlaces(hours) ||
    !description
  ) {
    return {
      error:
        "Select a valid session and enter its date, 0-24 worked hours and a description.",
    } as const;
  }

  return {
    value: { allocationId, workDate, hours, description },
  } as const;
}

/**
 * A correction carries only what a tutor may change about an existing work log:
 * the hours and the description. The session and its date belong to the
 * allocation, so they are not editable here at all.
 */
function parseTutorWorkLogCorrectionInput(body: unknown) {
  const payload = body as { hours?: unknown; description?: unknown } | null;
  const hours =
    typeof payload?.hours === "number" ? payload.hours : Number.NaN;
  const description = parseRequiredText(
    payload?.description,
    "description",
    500,
  );

  if (
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24 ||
    !hasAtMostTwoDecimalPlaces(hours) ||
    !description
  ) {
    return {
      error: "Enter corrected hours between 0 and 24 and a description.",
    } as const;
  }

  return { value: { hours, description } } as const;
}

function parseTimesheetDeclarationInput(body: unknown) {
  const payload = body as { statementVersion?: unknown } | null;
  const statementVersion = parseRequiredText(
    payload?.statementVersion,
    "statementVersion",
    32,
  );

  if (!statementVersion) {
    return {
      error: "Acknowledge the current declaration wording before declaring.",
    } as const;
  }

  return { value: { statementVersion } } as const;
}

function parseTimesheetDisputeInput(body: unknown) {
  const payload = body as { reason?: unknown } | null;
  const reason = parseRequiredText(payload?.reason, "reason", 1000);

  if (!reason) {
    return {
      error: "Explain what you are disputing, in 1000 characters or fewer.",
    } as const;
  }

  return { value: { reason } } as const;
}

function parseTimesheetDisputeResolutionInput(body: unknown) {
  if (!hasOnlyFields(body, ["resolutionReason"])) return { error: "Provide only a resolutionReason; resolving a dispute does not change the timesheet status." } as const;
  const payload = body as { resolutionReason?: unknown } | null;
  const resolutionReason = parseRequiredText(
    payload?.resolutionReason,
    "resolutionReason",
    1000,
  );

  if (!resolutionReason) {
    return {
      error: "Give the reason for answering this dispute.",
    } as const;
  }

  return { value: { resolutionReason } } as const;
}

function parseTutorExcuseInput(body: unknown) {
  const payload = body as {
    allocationId?: unknown;
    reason?: unknown;
  } | null;
  const allocationId = parseJsonPositiveInteger(payload?.allocationId);
  const reason = parseRequiredText(payload?.reason, "reason", 1000);

  if (!allocationId || !reason) {
    return {
      error: "Select an assigned session and enter a valid reason.",
    } as const;
  }

  return { value: { allocationId, reason } } as const;
}

function parseStudentVolunteerRequestInput(body: unknown) {
  const payload = body as { overflowWorkId?: unknown } | null;
  const overflowWorkId = parseJsonPositiveInteger(payload?.overflowWorkId);

  if (!overflowWorkId) {
    return {
      error: "Select a valid open-work item.",
    } as const;
  }

  return { value: { overflowWorkId } } as const;
}

function parseExcuseDecisionInput(body: unknown) {
  const payload = body as {
    decision?: unknown;
    reason?: unknown;
  } | null;
  const decision =
    typeof payload?.decision === "string"
      ? payload.decision.trim().toUpperCase()
      : null;
  const hasReason =
    payload?.reason !== undefined &&
    payload.reason !== null &&
    payload.reason !== "";
  const reason = hasReason
    ? parseRequiredText(payload?.reason, "reason", 1000)
    : undefined;

  if (
    (decision !== "APPROVE" && decision !== "REJECT") ||
    (hasReason && !reason) ||
    (decision === "REJECT" && !reason)
  ) {
    return {
      error: "Choose approve or reject and include a valid rejection reason.",
    } as const;
  }

  const value: ExcuseDecisionInput = { decision };
  if (reason) {
    value.reason = reason;
  }
  return { value } as const;
}

function firstQueryParam(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parseMarkValue(value: unknown) {
  const normalized = firstQueryParam(value);
  if (
    normalized === null ||
    normalized === undefined ||
    typeof normalized === "boolean" ||
    (typeof normalized === "string" && normalized.trim() === "")
  ) {
    return null;
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return null;
  }
  return numeric;
}

function parseRequestedHours(value: unknown) {
  const normalized = firstQueryParam(value);
  if (
    normalized === null ||
    normalized === undefined ||
    typeof normalized === "boolean" ||
    (typeof normalized === "string" && normalized.trim() === "")
  ) {
    return null;
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 24) {
    return null;
  }
  return numeric;
}

function parseAllocationCandidateQuery(query: unknown) {
  const params = (query ?? {}) as {
    courseId?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
    minimumMark?: unknown;
    requestedHours?: unknown;
    excludeAllocationId?: unknown;
  };
  const courseId = parsePositiveInteger(firstQueryParam(params.courseId));
  const startsAt = parseIsoDateTime(firstQueryParam(params.startsAt));
  const endsAt = parseIsoDateTime(firstQueryParam(params.endsAt));
  const minimumMark = parseMarkValue(params.minimumMark);
  const requestedHours = parseRequestedHours(params.requestedHours);
  const rawExcludeAllocationId = firstQueryParam(params.excludeAllocationId);
  const excludeAllocationId =
    rawExcludeAllocationId === undefined
      ? undefined
      : parsePositiveInteger(rawExcludeAllocationId);

  if (
    !courseId ||
    !startsAt ||
    !endsAt ||
    endsAt <= startsAt ||
    minimumMark === null ||
    requestedHours === null ||
    (rawExcludeAllocationId !== undefined && !excludeAllocationId)
  ) {
    return {
      error:
        "Enter a valid course, start/end time, minimum mark (0-100) and requested hours.",
    } as const;
  }

  // The same bound as saving. Ranking candidates for a window that could never
  // be saved would answer a question the organiser cannot act on.
  if (!sessionWithinMaximumLength(startsAt, endsAt)) {
    return { error: maximumSessionLengthMessage(startsAt, endsAt) } as const;
  }

  return {
    value: {
      courseId,
      startsAt,
      endsAt,
      minimumMark,
      requestedHours,
      ...(excludeAllocationId ? { excludeAllocationId } : {}),
    },
  } as const;
}

/**
 * A session length said the way a person would: "2 hours", "1 hour 30 minutes",
 * "45 minutes". The board repeats this wording exactly, so the two never
 * contradict each other.
 */
export function sessionLengthText(startsAt: Date, endsAt: Date): string {
  const totalMinutes = Math.round(
    (endsAt.valueOf() - startsAt.valueOf()) / 60_000,
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }
  if (minutes > 0 || hours === 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }

  return parts.join(" ");
}

/**
 * A tutoring session is a slot in a day, not a term. Nothing bounded the window
 * itself before: "end after start" plus "hours no longer than the window" let a
 * month-long booking carrying two hours through every layer, and one reached
 * production. Eight hours is a working day's worth of contact time.
 *
 * Deliberately not a rule about when the session falls. Editing a past
 * allocation is legitimate.
 */
export const MAX_SESSION_HOURS = 8;

function sessionWithinMaximumLength(startsAt: Date, endsAt: Date): boolean {
  return (
    (endsAt.valueOf() - startsAt.valueOf()) / 3_600_000 <= MAX_SESSION_HOURS
  );
}

/**
 * Says the limit and what was actually entered, because the usual cause is a
 * mistyped date: "722 hours" makes a wrong month obvious in a way that "too
 * long" does not. The board repeats this wording exactly.
 */
export function maximumSessionLengthMessage(
  startsAt: Date,
  endsAt: Date,
): string {
  return `A session cannot be longer than ${MAX_SESSION_HOURS} hours. This one is ${sessionLengthText(startsAt, endsAt)}. Check the start and end dates.`;
}

function hoursWithinSession(
  requestedHours: number,
  startsAt: Date,
  endsAt: Date,
): boolean {
  return (
    requestedHours <= (endsAt.valueOf() - startsAt.valueOf()) / 3_600_000
  );
}

function parseAllocationWriteInput(body: unknown) {
  const payload = body as {
    tutorId?: unknown;
    courseId?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
    minimumMark?: unknown;
    requestedHours?: unknown;
    status?: unknown;
  } | null;
  const tutorId = parsePositiveInteger(payload?.tutorId);
  const courseId = parsePositiveInteger(payload?.courseId);
  const startsAt = parseIsoDateTime(payload?.startsAt);
  const endsAt = parseIsoDateTime(payload?.endsAt);
  const minimumMark = parseMarkValue(payload?.minimumMark);
  const requestedHours = parseRequestedHours(payload?.requestedHours);
  const status = payload?.status;

  if (
    !tutorId ||
    !courseId ||
    !startsAt ||
    !endsAt ||
    endsAt <= startsAt ||
    minimumMark === null ||
    requestedHours === null ||
    (status !== undefined && status !== "PROPOSED" && status !== "CONFIRMED")
  ) {
    return {
      error:
        "Enter a valid tutor, course, start/end time, minimum mark (0-100), requested hours and allocation status.",
    } as const;
  }

  // Checked before the hours rule: a month-long window passes that one (two
  // hours fits inside it), so the window error is both the true fault and the
  // more useful thing to say.
  if (!sessionWithinMaximumLength(startsAt, endsAt)) {
    return { error: maximumSessionLengthMessage(startsAt, endsAt) } as const;
  }

  // Hours longer than the session itself would inflate the tutor's used capacity
  // and a course's staffing shortage, which both add these hours up. Fewer hours
  // than the window stays allowed. The database enforces the same rule.
  if (!hoursWithinSession(requestedHours, startsAt, endsAt)) {
    return {
      error: `Enter hours above 0 and no more than the session length of ${sessionLengthText(startsAt, endsAt)}.`,
    } as const;
  }

  const value: AllocationWriteInput = {
    tutorId,
    courseId,
    startsAt,
    endsAt,
    minimumMark,
    requestedHours,
  };
  if (status === "PROPOSED" || status === "CONFIRMED") {
    value.status = status;
  }
  return { value } as const;
}

function parseDecisionReason(value: unknown) {
  return value === undefined
    ? undefined
    : parseRequiredText(value, "reason", 1000);
}

function parseTimesheetDecisionInput(body: unknown) {
  const payload = body as { decision?: unknown; reason?: unknown } | null;
  const decision = payload?.decision;
  const reason = parseDecisionReason(payload?.reason);

  if (
    (decision !== "APPROVE" && decision !== "RETURN") ||
    reason === null ||
    (decision === "RETURN" && reason === undefined)
  ) {
    return {
      error:
        "Choose APPROVE or RETURN and provide a valid reason when returning a timesheet.",
    } as const;
  }

  const value: TimesheetDecisionInput = { decision };
  if (reason !== undefined) {
    value.reason = reason;
  }
  return { value } as const;
}

function parseVolunteerClaimDecisionInput(body: unknown) {
  const payload = body as { decision?: unknown; reason?: unknown } | null;
  const decision = payload?.decision;
  const reason = parseDecisionReason(payload?.reason);

  if (
    (decision !== "APPROVE" && decision !== "REJECT") ||
    reason === null ||
    (decision === "REJECT" && reason === undefined)
  ) {
    return {
      error:
        "Choose APPROVE or REJECT and provide a valid reason when rejecting a volunteer claim.",
    } as const;
  }

  const value: VolunteerClaimDecisionInput = { decision };
  if (reason !== undefined) {
    value.reason = reason;
  }
  return { value } as const;
}

function parseTutorMarkInput(body: unknown) {
  const payload = body as { courseId?: unknown; mark?: unknown } | null;
  const courseId = parsePositiveInteger(payload?.courseId);
  const mark = parseMarkValue(payload?.mark);

  if (!courseId || mark === null) {
    return {
      error: "Select a course and enter a valid mark (0-100).",
    } as const;
  }

  return { value: { courseId, mark } } as const;
}

function parseNumericId(
  value: string | string[] | undefined,
  resourceName: string,
): { error: string } | { value: number } {
  const resolved = Array.isArray(value) ? value[0] : value;
  const numeric = boundedInteger(resolved, 1, MAX_DATABASE_ID);

  if (numeric === null) {
    return {
      error: `${resourceName} identifier must be a positive whole number.`,
    };
  }

  return { value: numeric };
}

function parsePublicHolidayYear(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}$/.test(value) ||
    Number(value) < 2000 ||
    Number(value) > 2100
  ) {
    return null;
  }

  return Number(value);
}

function currentProfileRoute(
  dependencies: AppDependencies,
  request: express.Request,
  response: express.Response,
) {
  return (async () => {
    const auth = (request as AuthenticatedRequest).auth!;
    const profile = await dependencies.findProfileByAuth0Id(auth.subject);

    if (!profile) {
      const result = error(
        404,
        "PROFILE_NOT_FOUND",
        "No CSAM Tutor Hub profile is linked to this account.",
      );
      response.status(result.status).json(result.body);
      return;
    }

    if (profile.role !== auth.role) {
      const result = error(
        403,
        "ROLE_MISMATCH",
        "Your account permissions are out of date. Sign in again or contact support.",
      );
      response.status(result.status).json(result.body);
      return;
    }

    const masterOrganiser = hasMasterOrganiserAccess(auth);
    response.status(200).json({
      data: {
        profile,
        ...(masterOrganiser ? { capabilities: { masterOrganiser: true } } : {}),
      },
    });
  })().catch((value) => sendRouteError(response, value));
}

export function createApp(
  checkReadiness: ReadinessCheck,
  dependencies: AppDependencies = unavailableDependencies,
  requestLogger?: RequestLogger,
): Express {
  const app = express();
  const authenticate = createAuthenticationMiddleware(
    dependencies.verifyAccessToken,
  );
  const resolveProfileRole = createProfileRoleMiddleware(dependencies.findProfileByAuth0Id);
  const requireTutorMxRole = requireRole(...TUTOR_ROLES);
  const requireMaster = requireMasterOrganiser();

  const corsOrigin = dependencies.corsOrigin;
  if (corsOrigin) {
    app.use((request, response, next) => {
      if (request.header("origin") === corsOrigin) {
        response.setHeader("Access-Control-Allow-Origin", corsOrigin);
        response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
        response.setHeader(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, Idempotency-Key",
        );
        response.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        );
      }
      if (request.method === "OPTIONS") {
        response.status(204).end();
        return;
      }
      next();
    });
  }

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again shortly." } },
    }),
  );
  const sensitiveAuthLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
      message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again shortly." } },
  });

  if (requestLogger) {
    app.use((request, response, next) => {
      const startedAt = process.hrtime.bigint();

      response.on("finish", () => {
        requestLogger({
          method: request.method,
          path: typeof request.route?.path === "string" ? request.route.path : "/unmatched",
          status: response.statusCode,
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        });
      });

      next();
    });
  }

  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/ready", async (_request, response) => {
    try {
      await checkReadiness();
      response.status(200).json({
        status: "ready",
        database: "connected",
      });
    } catch {
      response.status(503).json({
        status: "not ready",
        database: "disconnected",
      });
    }
  });

  app.post("/api/auth/password-reset", sensitiveAuthLimiter, async (request, response) => {
    if (!isValidEmail(request.body?.email)) {
      const result = error(
        400,
        "VALIDATION_ERROR",
        "Enter a valid email address.",
      );
      response.status(result.status).json(result.body);
      return;
    }

    try {
      await dependencies.requestPasswordReset(request.body.email);
      response.status(202).json({
        data: {
          message:
            "If the account can be reset, Auth0 will send password-reset instructions.",
        },
      });
    } catch {
      const result = error(
        503,
        "PASSWORD_RESET_UNAVAILABLE",
        "Password reset is temporarily unavailable. Please try again later.",
      );
      response.status(result.status).json(result.body);
    }
  });

  app.post(
    "/api/auth/onboarding",
    sensitiveAuthLimiter,
    authenticate,
    async (request, response) => {
      const role = request.body?.role;
      if (!TUTOR_ROLES.includes(role) || role === "ORGANISER") {
        const result = error(400, "VALIDATION_ERROR", "Choose Student or Tutor for standard onboarding. Organisers must use organiser registration.");
        response.status(result.status).json(result.body);
        return;
      }
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const profile = await dependencies.onboardUser(auth.subject, role);
        response.status(200).json({ data: { profile } });
      } catch (value) { sendRouteError(response, value); }
    },
  );

  app.post(
    "/api/auth/organiser-registration",
    sensitiveAuthLimiter,
    authenticate,
    async (request, response) => {
      if (!dependencies.registerOrganiserApplication) {
        const result = error(503, "ORGANISER_APPLICATIONS_UNAVAILABLE", "Organiser registration is not configured.");
        response.status(result.status).json(result.body);
        return;
      }
      try {
        const auth = (request as AuthenticatedRequest).auth!;
        const application = await dependencies.registerOrganiserApplication(auth.subject);
        response.status(200).json({ data: { application } });
      } catch (value) { sendRouteError(response, value); }
    },
  );

  app.post(
    "/api/auth/organiser-application-status",
    sensitiveAuthLimiter,
    async (request, response) => {
      if (!dependencies.getOrganiserApplicationStatusByEmail) {
        const result = error(503, "ORGANISER_APPLICATIONS_UNAVAILABLE", "Organiser application status is not configured.");
        response.status(result.status).json(result.body);
        return;
      }
      if (!isValidEmail(request.body?.email)) {
        const result = error(400, "VALIDATION_ERROR", "Enter a valid email address.");
        response.status(result.status).json(result.body);
        return;
      }
      try {
        const status = await dependencies.getOrganiserApplicationStatusByEmail(request.body.email.trim().toLowerCase());
        response.status(200).json({ data: { status } });
      } catch (value) { sendRouteError(response, value); }
    },
  );

  app.post(
    "/api/auth/resend-verification",
    sensitiveAuthLimiter,
    authenticate,
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.requestVerificationEmail) {
          throw new Error("Verification email is not configured");
        }
        await dependencies.requestVerificationEmail(auth.subject);
        response.status(202).json({
          data: { message: "If your account needs verification, Auth0 will send an email." },
        });
      } catch {
        const result = error(
          503,
          "VERIFICATION_EMAIL_UNAVAILABLE",
          "Verification email could not be sent. Please try again later.",
        );
        response.status(result.status).json(result.body);
      }
    },
  );

  app.get("/api/me", authenticate, resolveProfileRole, requireTutorMxRole, (request, response) =>
    currentProfileRoute(dependencies, request, response),
  );

  app.get(
    "/api/profile/current",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    (request, response) => currentProfileRoute(dependencies, request, response),
  );

  app.get(
    "/api/auth/organiser-application/me",
    authenticate,
    async (request, response) => {
      if (!dependencies.getOwnOrganiserApplication) {
        const result = error(503, "ORGANISER_APPLICATIONS_UNAVAILABLE", "Organiser applications are not configured.");
        response.status(result.status).json(result.body);
        return;
      }
      try {
        const auth = (request as AuthenticatedRequest).auth!;
        const application = await dependencies.getOwnOrganiserApplication(auth.subject);
        response.status(200).json({ data: { application } });
      } catch (value) { sendRouteError(response, value); }
    },
  );

  app.get(
    "/api/master-organiser/organiser-applications",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    requireMaster,
    async (_request, response) => {
      if (!dependencies.listOrganiserApplications) {
        const result = error(503, "ORGANISER_APPLICATIONS_UNAVAILABLE", "Organiser applications are not configured.");
        response.status(result.status).json(result.body);
        return;
      }
      try {
        const applications = await dependencies.listOrganiserApplications();
        response.status(200).json({ data: { applications } });
      } catch (value) { sendRouteError(response, value); }
    },
  );

  app.post(
    "/api/master-organiser/organiser-applications/:id/approve",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    requireMaster,
    async (request, response) => {
      if (!dependencies.approveOrganiserApplication) {
        const result = error(503, "ORGANISER_APPLICATIONS_UNAVAILABLE", "Organiser applications are not configured.");
        response.status(result.status).json(result.body);
        return;
      }
      const applicationId = parseNumericId(request.params.id, "Organiser application");
      if ("error" in applicationId) {
        const result = error(400, "VALIDATION_ERROR", applicationId.error);
        response.status(result.status).json(result.body);
        return;
      }
      try {
        const auth = (request as AuthenticatedRequest).auth!;
        const application = await dependencies.approveOrganiserApplication(auth.subject, applicationId.value);
        response.status(200).json({ data: { application } });
      } catch (value) { sendRouteError(response, value); }
    },
  );

  app.post(
    "/api/master-organiser/organiser-applications/:id/reject",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    requireMaster,
    async (request, response) => {
      if (!dependencies.rejectOrganiserApplication) {
        const result = error(503, "ORGANISER_APPLICATIONS_UNAVAILABLE", "Organiser applications are not configured.");
        response.status(result.status).json(result.body);
        return;
      }
      const applicationId = parseNumericId(request.params.id, "Organiser application");
      if ("error" in applicationId) {
        const result = error(400, "VALIDATION_ERROR", applicationId.error);
        response.status(result.status).json(result.body);
        return;
      }
      const reviewReason = request.body?.reviewReason == null
        ? null
        : typeof request.body.reviewReason === "string"
          ? request.body.reviewReason.trim()
          : "";
      if (reviewReason !== null && reviewReason.length > 500) {
        const result = error(400, "VALIDATION_ERROR", "Review notes must be 500 characters or fewer.");
        response.status(result.status).json(result.body);
        return;
      }
      try {
        const auth = (request as AuthenticatedRequest).auth!;
        const application = await dependencies.rejectOrganiserApplication(
          auth.subject,
          applicationId.value,
          reviewReason || null,
        );
        response.status(200).json({ data: { application } });
      } catch (value) { sendRouteError(response, value); }
    },
  );

  app.get(
    "/api/public-holidays",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const year = parsePublicHolidayYear(request.query.year);
      if (year === null) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          "Enter a four-digit year from 2000 to 2100.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const result = await dependencies.getPublicHolidays(year);
        response.status(200).json({
          data: {
            source: result.source,
            holidays: result.data,
            retrievedAt: result.retrievedAt,
            ...(result.source === "fallback" ? { reason: result.reason } : {}),
          },
        });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/courses",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (_request, response) => {
      try {
        const courses = await dependencies.listCourses();
        response.status(200).json({ data: { courses } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/courses",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseCourseInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid course code and name.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const course = await dependencies.createCourse(parsed.value);
        response.status(201).json({ data: { course } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/courses/:courseId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const courseId = parseNumericId(request.params.courseId, "Course");
      if ("error" in courseId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          courseId.error ??
            "Course identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseCourseInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid course code and name.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const course = await dependencies.updateCourse(
          courseId.value,
          parsed.value,
        );
        response.status(200).json({ data: { course } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.delete(
    "/api/courses/:courseId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const courseId = parseNumericId(request.params.courseId, "Course");
      if ("error" in courseId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          courseId.error ??
            "Course identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        await dependencies.deleteCourse(courseId.value);
        response.status(204).end();
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutors",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const hasWeekStart = request.query.weekStart !== undefined;
      const weekStart = hasWeekStart
        ? parseWeekStart(request.query.weekStart)
        : null;
      if (hasWeekStart && weekStart === null) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          "weekStart must be a Monday in YYYY-MM-DD format.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const tutors = await dependencies.listTutors(weekStart ?? undefined);
        response.status(200).json({ data: { tutors } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/allocations",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (_request, response) => {
      try {
        const allocations = await dependencies.listOrganiserAllocations();
        response.status(200).json({ data: { allocations } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/allocations/candidates",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseAllocationCandidateQuery(request.query);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ??
            "Enter a valid course, start/end time, minimum mark (0-100) and requested hours.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const candidates = await dependencies.listAllocationCandidates(
          parsed.value,
        );
        response.status(200).json({ data: { candidates } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/allocations",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseAllocationWriteInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid allocation.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const allocation = await dependencies.createAllocation(
          (request as AuthenticatedRequest).auth!.subject,
          parsed.value,
        );
        response.status(201).json({ data: { allocation } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/allocations/:allocationId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const allocationId = parseNumericId(
        request.params.allocationId,
        "Allocation",
      );
      if ("error" in allocationId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          allocationId.error ??
            "Allocation identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseAllocationWriteInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid allocation.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const allocation = await dependencies.updateAllocation(
          (request as AuthenticatedRequest).auth!.subject,
          allocationId.value,
          parsed.value,
        );
        response.status(200).json({ data: { allocation } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.delete(
    "/api/allocations/:allocationId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const allocationId = parseNumericId(
        request.params.allocationId,
        "Allocation",
      );
      if ("error" in allocationId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          allocationId.error ??
            "Allocation identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        await dependencies.removeAllocation(
          (request as AuthenticatedRequest).auth!.subject,
          allocationId.value,
        );
        response.status(204).end();
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/reports/workload",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseWorkloadReportQuery(request.query);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ??
            "Choose a week starting on a Monday and a length of 1 to 52 weeks.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.workloadReport) {
          throw createRouteError(
            503,
            "REPORTING_UNAVAILABLE",
            "Reporting is not configured.",
          );
        }
        const report = await dependencies.workloadReport(parsed.value);
        response.status(200).json({ data: report });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/reports/payroll-export",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      // The same period contract as the workload report, because the export is
      // reconciled against that report for the same weeks.
      const parsed = parseWorkloadReportQuery(request.query);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ??
            "Choose a week starting on a Monday and a length of 1 to 52 weeks.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.payrollExportCsv) {
          throw createRouteError(
            503,
            "PAYROLL_EXPORT_UNAVAILABLE",
            "Payroll export is not configured.",
          );
        }
        const file = await dependencies.payrollExportCsv(parsed.value);
        // A download, not a page: the browser saves the body as it is sent.
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.filename}"`,
        );
        response.status(200).send(file.csv);
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/allocations/bulk-preview",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseBulkPreviewQuery(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Choose staffing requirements to preview.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.previewBulkAllocations) {
          throw bulkAllocationUnavailable();
        }
        // Reads only: nothing is saved until the organiser confirms.
        const items = await dependencies.previewBulkAllocations(parsed.value);
        response.status(200).json({ data: { items } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/allocations/bulk-commit",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseBulkCommitInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Send the allocations to save.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.commitBulkAllocations) {
          throw bulkAllocationUnavailable();
        }
        // Every item reports its own outcome, so a 200 here does not mean they
        // all saved: the results say which did.
        const results = await dependencies.commitBulkAllocations(
          (request as AuthenticatedRequest).auth!.subject,
          parsed.value,
        );
        response.status(200).json({ data: { results } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/staffing-requirements",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseStaffingRequirementListQuery(request.query);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ??
            "Filter by a valid course identifier and a status of OPEN, CLOSED or CANCELLED.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.listStaffingRequirements) {
          throw staffingRequirementsUnavailable();
        }
        const staffingRequirements =
          await dependencies.listStaffingRequirements(parsed.value);
        response.status(200).json({ data: { staffingRequirements } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/staffing-requirements",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseStaffingRequirementInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid staffing requirement.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.createStaffingRequirement) {
          throw staffingRequirementsUnavailable();
        }
        const staffingRequirement =
          await dependencies.createStaffingRequirement(
            (request as AuthenticatedRequest).auth!.subject,
            parsed.value,
          );
        response.status(201).json({ data: { staffingRequirement } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/staffing-requirements/:requirementId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const requirementId = parseNumericId(
        request.params.requirementId,
        "Staffing requirement",
      );
      if ("error" in requirementId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          requirementId.error ??
            "Staffing requirement identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseStaffingRequirementInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid staffing requirement.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.updateStaffingRequirement) {
          throw staffingRequirementsUnavailable();
        }
        const staffingRequirement =
          await dependencies.updateStaffingRequirement(
            requirementId.value,
            parsed.value,
          );
        response.status(200).json({ data: { staffingRequirement } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/staffing-requirements/:requirementId/status",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const requirementId = parseNumericId(
        request.params.requirementId,
        "Staffing requirement",
      );
      if ("error" in requirementId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          requirementId.error ??
            "Staffing requirement identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseStaffingRequirementStatusInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid status of OPEN, CLOSED or CANCELLED.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.setStaffingRequirementStatus) {
          throw staffingRequirementsUnavailable();
        }
        const staffingRequirement =
          await dependencies.setStaffingRequirementStatus(
            requirementId.value,
            parsed.value,
          );
        response.status(200).json({ data: { staffingRequirement } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/organiser/command-centre",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      // The same period contract as the reports, so the totals on this screen
      // and the report it drills into are measured over identical weeks.
      const parsed = parseWorkloadReportQuery(request.query);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ??
            "Choose a week starting on a Monday and a length of 1 to 52 weeks.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.commandCentreSummary) {
          throw createRouteError(
            503,
            "COMMAND_CENTRE_UNAVAILABLE",
            "The command centre is not configured.",
          );
        }
        const summary = await dependencies.commandCentreSummary(
          // The organiser who is asking, so the dispute queue is read for them.
          (request as AuthenticatedRequest).auth!.subject,
          parsed.value,
        );
        response.status(200).json({ data: summary });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/organiser/approvals",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (_request, response) => {
      try {
        const approvals = await dependencies.listOrganiserApprovals();
        response.status(200).json({ data: approvals });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/timesheets/:timesheetId/decision",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const timesheetId = parseNumericId(
        request.params.timesheetId,
        "Timesheet",
      );
      if ("error" in timesheetId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          timesheetId.error ??
            "Timesheet identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTimesheetDecisionInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid timesheet decision.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const timesheet = await dependencies.decideTimesheet(
          auth.subject,
          timesheetId.value,
          parsed.value,
        );
        response.status(200).json({ data: { timesheet } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/volunteer-claims/:claimId/decision",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const claimId = parseNumericId(request.params.claimId, "Volunteer claim");
      if ("error" in claimId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          claimId.error ??
            "Volunteer claim identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseVolunteerClaimDecisionInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid volunteer-claim decision.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const volunteerClaim = await dependencies.decideVolunteerClaim(
          claimId.value,
          parsed.value,
        );
        response.status(200).json({ data: { volunteerClaim } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  /**
   * The organiser screen that posts, edits and closes overflow work. Students
   * already read open rows through the volunteer feed; this is the only place
   * that writes them, so a shortage can become a real opportunity without
   * touching the database by hand.
   */
  app.get(
    "/api/organiser/overflow-work",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (_request, response) => {
      try {
        if (!dependencies.listOrganiserOverflowWork) {
          throw overflowWorkUnavailable();
        }
        const overflowWork = await dependencies.listOrganiserOverflowWork();
        response.status(200).json({ data: { overflowWork } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/organiser/overflow-work",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseOverflowWorkCreateInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter valid overflow work.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.createOrganiserOverflowWork) {
          throw overflowWorkUnavailable();
        }
        const key = normalizeIdempotencyKey(request.headers["idempotency-key"]);
        const overflowWork = await dependencies.createOrganiserOverflowWork(
          parsed.value,
          ...(key ? [{ auth0Id: (request as AuthenticatedRequest).auth!.subject, key }] : []),
        );
        response.status(201).json({ data: { overflowWork } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/organiser/overflow-work/:overflowWorkId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const overflowWorkId = parseNumericId(
        request.params.overflowWorkId,
        "Overflow work",
      );
      if ("error" in overflowWorkId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          overflowWorkId.error ??
            "Overflow work identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseOverflowWorkUpdateInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter valid overflow work changes.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.updateOrganiserOverflowWork) {
          throw overflowWorkUnavailable();
        }
        const overflowWork = await dependencies.updateOrganiserOverflowWork(
          overflowWorkId.value,
          parsed.value,
        );
        response.status(200).json({ data: { overflowWork } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/organiser/overflow-work/:overflowWorkId/close",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const overflowWorkId = parseNumericId(
        request.params.overflowWorkId,
        "Overflow work",
      );
      if ("error" in overflowWorkId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          overflowWorkId.error ??
            "Overflow work identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseOverflowWorkCloseInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter the version of the overflow work being closed.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.closeOrganiserOverflowWork) {
          throw overflowWorkUnavailable();
        }
        const overflowWork = await dependencies.closeOrganiserOverflowWork(
          overflowWorkId.value,
          parsed.value,
        );
        response.status(200).json({ data: { overflowWork } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  /**
   * The organiser side of a dispute. Without a list an organiser has nothing to
   * read after the notification arrives, and without the decision below there
   * would be no way to clear the objection that holds payroll back.
   */
  app.get(
    "/api/organiser/timesheet-disputes",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      try {
        if (!dependencies.listTimesheetDisputes) {
          throw createRouteError(
            503,
            "TIMESHEET_DISPUTE_UNAVAILABLE",
            "Timesheet disputes are not configured.",
          );
        }
        const disputes = await dependencies.listTimesheetDisputes(
          (request as AuthenticatedRequest).auth!.subject,
        );
        response.status(200).json({ data: { disputes } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/timesheet-disputes/:disputeId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const disputeId = parseNumericId(
        request.params.disputeId,
        "Dispute",
      );
      if ("error" in disputeId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          disputeId.error ??
            "Dispute identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTimesheetDisputeResolutionInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid dispute answer.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.resolveTimesheetDispute) {
          throw createRouteError(
            503,
            "TIMESHEET_DISPUTE_UNAVAILABLE",
            "Timesheet disputes are not configured.",
          );
        }
        const dispute = await dependencies.resolveTimesheetDispute(
          auth.subject,
          disputeId.value,
          parsed.value,
        );
        response.status(200).json({ data: { dispute } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutors/:tutorId/marks",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      if ("error" in tutorId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          tutorId.error ?? "Tutor identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const marks = await dependencies.listTutorMarks(tutorId.value);
        response.status(200).json({ data: { marks } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.put(
    "/api/tutors/:tutorId/marks",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      if ("error" in tutorId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          tutorId.error ?? "Tutor identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTutorMarkInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Select a course and enter a valid mark (0-100).",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const mark = await dependencies.upsertTutorMark(
          tutorId.value,
          parsed.value,
        );
        response.status(200).json({ data: { mark } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.delete(
    "/api/tutors/:tutorId/marks/:courseId",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      const courseId = parseNumericId(request.params.courseId, "Course");
      if ("error" in tutorId || "error" in courseId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          "Tutor and course identifiers must be positive whole numbers.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        await dependencies.deleteTutorMark(tutorId.value, courseId.value);
        response.status(204).end();
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutors/:tutorId/time-slots",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const tutorId = parseNumericId(request.params.tutorId, "Tutor");
      if ("error" in tutorId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          tutorId.error ?? "Tutor identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const timeSlots = await dependencies.listTutorTimeSlots(tutorId.value);
        response.status(200).json({ data: { timeSlots } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutor/dashboard",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const dashboard = await dependencies.getTutorDashboard(auth.subject);
        response.status(200).json({ data: { dashboard } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/time-slots",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTutorTimeSlotInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid tutor availability slot.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const timeSlot = await dependencies.createTutorTimeSlot(
          auth.subject,
          parsed.value,
        );
        response.status(201).json({ data: { timeSlot } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutor/time-slots",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      try {
        const timeSlots = await dependencies.listOwnTutorTimeSlots(
          (request as AuthenticatedRequest).auth!.subject,
        );
        response.status(200).json({ data: { timeSlots } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/tutor/time-slots/:timeSlotId",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const timeSlotId = parseNumericId(request.params.timeSlotId, "Time slot");
      const parsed = parseTutorTimeSlotInput(request.body);
      if ("error" in timeSlotId || "error" in parsed) {
        response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Enter a valid time-slot identifier and schedule." } });
        return;
      }
      try {
        const timeSlot = await dependencies.updateTutorTimeSlot(
          (request as AuthenticatedRequest).auth!.subject, timeSlotId.value, parsed.value,
        );
        response.status(200).json({ data: { timeSlot } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.delete(
    "/api/tutor/time-slots/:timeSlotId",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const timeSlotId = parseNumericId(request.params.timeSlotId, "Time slot");
      if ("error" in timeSlotId || (request.body !== undefined && !hasOnlyFields(request.body, []))) {
        response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Provide a valid time-slot identifier without extra fields." } });
        return;
      }
      try {
        await dependencies.deleteTutorTimeSlot(
          (request as AuthenticatedRequest).auth!.subject, timeSlotId.value,
        );
        response.status(204).end();
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/academic-terms",
    authenticate,
    resolveProfileRole,
    async (request, response) => {
      try {
        if (!dependencies.listAcademicTerms) {
          throw createRouteError(
            503,
            "ACADEMIC_TERMS_UNAVAILABLE",
            "Academic terms are not configured.",
          );
        }
        const role = (request as AuthenticatedRequest).auth!.role;
        const academicTerms = role === "ORGANISER"
          ? await dependencies.listAcademicTerms()
          : (await dependencies.listAcademicTerms()).filter((term) => term.published);
        response.status(200).json({ data: { academicTerms } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/organiser/academic-terms",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const parsed = parseAcademicTermInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a term name and ordered start and end dates.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.createAcademicTerm) {
          throw createRouteError(
            503,
            "ACADEMIC_TERMS_UNAVAILABLE",
            "Academic terms are not configured.",
          );
        }
        const academicTerm = await dependencies.createAcademicTerm(parsed.value);
        response.status(201).json({ data: { academicTerm } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/academic-terms/published",
    authenticate,
    resolveProfileRole,
    async (request, response) => {
      try {
        if (!dependencies.listPublishedAcademicTerms) {
          throw createRouteError(
            503,
            "ACADEMIC_TERMS_UNAVAILABLE",
            "Academic terms are not configured.",
          );
        }
        const academicTerms = await dependencies.listPublishedAcademicTerms();
        response.status(200).json({ data: { academicTerms } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/organiser/academic-terms/:id",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const termId = Number.parseInt(request.params.id as string, 10);
      if (!Number.isInteger(termId) || termId <= 0) {
        const result = error(400, "VALIDATION_ERROR", "Term id must be a positive integer.");
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseAcademicTermInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter valid term fields.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.updateAcademicTerm) {
          throw createRouteError(
            503,
            "ACADEMIC_TERMS_UNAVAILABLE",
            "Academic terms are not configured.",
          );
        }
        const academicTerm = await dependencies.updateAcademicTerm(termId, parsed.value);
        response.status(200).json({ data: { academicTerm } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.delete(
    "/api/organiser/academic-terms/:id",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const termId = Number.parseInt(request.params.id as string, 10);
      if (!Number.isInteger(termId) || termId <= 0) {
        const result = error(400, "VALIDATION_ERROR", "Term id must be a positive integer.");
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.deleteAcademicTerm) {
          throw createRouteError(
            503,
            "ACADEMIC_TERMS_UNAVAILABLE",
            "Academic terms are not configured.",
          );
        }
        await dependencies.deleteAcademicTerm(termId);
        response.status(204).end();
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/time-slots/import/preview",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTimetableImportRequest(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Send a CSV or ICS timetable with a term to import against.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.previewTutorTimetableImport) {
          throw createRouteError(
            503,
            "TIMETABLE_IMPORT_UNAVAILABLE",
            "Timetable import is not configured.",
          );
        }
        const preview = await dependencies.previewTutorTimetableImport(
          (request as AuthenticatedRequest).auth!.subject,
          parsed.value,
        );
        response.status(200).json({ data: { preview } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/time-slots/import/commit",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTimetableImportRequest(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Send a CSV or ICS timetable with a term to import against.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        if (!dependencies.commitTutorTimetableImport) {
          throw createRouteError(
            503,
            "TIMETABLE_IMPORT_UNAVAILABLE",
            "Timetable import is not configured.",
          );
        }
        // Atomic by design: the whole file lands as one transaction, or nothing
        // does. This is why the batch endpoint exists rather than a client loop
        // over the single-time-slot route, which would leave partial writes
        // behind once a later row failed.
        const key = normalizeIdempotencyKey(request.headers["idempotency-key"]);
        const result = await dependencies.commitTutorTimetableImport(
          (request as AuthenticatedRequest).auth!.subject,
          parsed.value,
          ...(key ? [key] : []),
        );
        response.status(200).json({ data: { result } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/tutor/weekly-capacity",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTutorWeeklyCapacity(request.body);
      if ("error" in parsed) {
        response.status(400).json({ error: { code: "VALIDATION_ERROR", message: parsed.error } });
        return;
      }
      try {
        const capacity = await dependencies.updateTutorWeeklyCapacity(
          (request as AuthenticatedRequest).auth!.subject, parsed.value,
        );
        response.status(200).json({ data: capacity });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/work-logs",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTutorWorkLogInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid tutor work-log entry.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const workLog = await dependencies.createTutorWorkLog(
          auth.subject,
          parsed.value,
        );
        response.status(201).json({ data: { workLog } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  /**
   * The whole correction surface of a timesheet, in one read: the sheet, its
   * work logs, every return and correction, each declaration and any dispute.
   * The timeline the tutor sees is built from this and nothing else.
   */
  app.get(
    "/api/tutor/timesheets/:timesheetId/history",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const timesheetId = parseNumericId(
        request.params.timesheetId,
        "Timesheet",
      );
      if ("error" in timesheetId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          timesheetId.error ??
            "Timesheet identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.getTutorTimesheetHistory) {
          throw createRouteError(
            503,
            "TIMESHEET_CORRECTIONS_UNAVAILABLE",
            "Timesheet corrections are not configured.",
          );
        }
        const history = await dependencies.getTutorTimesheetHistory(
          auth.subject,
          timesheetId.value,
        );
        response.status(200).json({ data: { history } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  /**
   * Corrects one work log on a draft or returned timesheet. The prior hours and
   * description are written to the history in the same transaction as the
   * change, so a correction can never replace what was previously claimed
   * without leaving a record of it.
   */
  app.patch(
    "/api/tutor/timesheets/:timesheetId/work-logs/:workLogId",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const timesheetId = parseNumericId(
        request.params.timesheetId,
        "Timesheet",
      );
      if ("error" in timesheetId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          timesheetId.error ??
            "Timesheet identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const workLogId = parseNumericId(request.params.workLogId, "Work log");
      if ("error" in workLogId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          workLogId.error ??
            "Work log identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTutorWorkLogCorrectionInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid correction.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.correctTutorTimesheetWorkLog) {
          throw createRouteError(
            503,
            "TIMESHEET_CORRECTIONS_UNAVAILABLE",
            "Timesheet corrections are not configured.",
          );
        }
        const correction = await dependencies.correctTutorTimesheetWorkLog(
          auth.subject,
          timesheetId.value,
          workLogId.value,
          parsed.value,
        );
        response.status(200).json({
          data: { workLog: correction.workLog, revision: correction.revision },
        });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  /**
   * Acknowledges the declaration wording the client was shown. Resubmitting a
   * returned timesheet is refused until a declaration newer than the return and
   * newer than the last correction has been recorded.
   */
  app.post(
    "/api/tutor/timesheets/:timesheetId/declaration",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const timesheetId = parseNumericId(
        request.params.timesheetId,
        "Timesheet",
      );
      if ("error" in timesheetId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          timesheetId.error ??
            "Timesheet identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTimesheetDeclarationInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid declaration.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.declareTutorTimesheet) {
          throw createRouteError(
            503,
            "TIMESHEET_CORRECTIONS_UNAVAILABLE",
            "Timesheet corrections are not configured.",
          );
        }
        const declaration = await dependencies.declareTutorTimesheet(
          auth.subject,
          timesheetId.value,
          parsed.value.statementVersion,
        );
        response.status(201).json({ data: { declaration } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  /**
   * Raises an objection to a decision. Any submitted sheet can be disputed, and
   * only one objection may be open at a time, so an organiser always has a
   * single question to answer.
   */
  app.post(
    "/api/tutor/timesheets/:timesheetId/disputes",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const timesheetId = parseNumericId(
        request.params.timesheetId,
        "Timesheet",
      );
      if ("error" in timesheetId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          timesheetId.error ??
            "Timesheet identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseTimesheetDisputeInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid dispute.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.raiseTutorTimesheetDispute) {
          throw createRouteError(
            503,
            "TIMESHEET_CORRECTIONS_UNAVAILABLE",
            "Timesheet corrections are not configured.",
          );
        }
        const dispute = await dependencies.raiseTutorTimesheetDispute(
          auth.subject,
          timesheetId.value,
          parsed.value,
        );
        response.status(201).json({ data: { dispute } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/excuses",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const parsed = parseTutorExcuseInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid tutor excuse.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const excuse = await dependencies.createTutorExcuse(
          auth.subject,
          parsed.value,
        );
        response.status(201).json({ data: { excuse } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/student/open-work",
    authenticate,
    resolveProfileRole,
    requireRole("STUDENT"),
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const workItems = await dependencies.listStudentOpenWork(auth.subject);
        response.status(200).json({ data: { workItems } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/student/volunteer-requests",
    authenticate,
    resolveProfileRole,
    requireRole("STUDENT"),
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const volunteerRequests =
          await dependencies.listStudentVolunteerRequests(auth.subject);
        response.status(200).json({ data: { volunteerRequests } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/student/volunteer-requests",
    authenticate,
    resolveProfileRole,
    requireRole("STUDENT"),
    async (request, response) => {
      const parsed = parseStudentVolunteerRequestInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Select a valid open-work item.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const volunteerRequest =
          await dependencies.createStudentVolunteerRequest(
            auth.subject,
            parsed.value,
          );
        response.status(201).json({ data: { volunteerRequest } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/student/volunteer-requests/:requestId",
    authenticate,
    resolveProfileRole,
    requireRole("STUDENT"),
    async (request, response) => {
      const requestId = parseNumericId(
        request.params.requestId,
        "Volunteer request",
      );
      if ("error" in requestId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          requestId.error ??
            "Volunteer request identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const volunteerRequest =
          await dependencies.getStudentVolunteerRequest(
            auth.subject,
            requestId.value,
          );
        response.status(200).json({ data: { volunteerRequest } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/student/volunteer-requests/:requestId/withdraw",
    authenticate,
    resolveProfileRole,
    requireRole("STUDENT"),
    async (request, response) => {
      const requestId = parseNumericId(
        request.params.requestId,
        "Volunteer request",
      );
      if ("error" in requestId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          requestId.error ??
            "Volunteer request identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const volunteerRequest =
          await dependencies.withdrawStudentVolunteerRequest(
            auth.subject,
            requestId.value,
          );
        response.status(200).json({ data: { volunteerRequest } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutor/timesheets/:timesheetId/status",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const timesheetId = parseNumericId(
        request.params.timesheetId,
        "Timesheet",
      );
      if ("error" in timesheetId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          timesheetId.error ??
            "Timesheet identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const timesheet = await dependencies.getTutorTimesheetStatus(
          auth.subject,
          timesheetId.value,
        );
        response.status(200).json({ data: { timesheet } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/tutor/timesheets/:timesheetId/submit",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const timesheetId = parseNumericId(
        request.params.timesheetId,
        "Timesheet",
      );
      if ("error" in timesheetId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          timesheetId.error ??
            "Timesheet identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const timesheet = await dependencies.submitTutorTimesheet(
          auth.subject,
          timesheetId.value,
        );
        response.status(200).json({ data: { timesheet } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/tutor/excuses/:excuseId/status",
    authenticate,
    resolveProfileRole,
    requireRole("TUTOR"),
    async (request, response) => {
      const excuseId = parseNumericId(request.params.excuseId, "Excuse");
      if ("error" in excuseId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          excuseId.error ?? "Excuse identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const auth = (request as AuthenticatedRequest).auth!;
      try {
        const excuse = await dependencies.getTutorExcuseStatus(
          auth.subject,
          excuseId.value,
        );
        response.status(200).json({ data: { excuse } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/excuses/:excuseId/decision",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (request, response) => {
      const excuseId = parseNumericId(request.params.excuseId, "Excuse");
      if ("error" in excuseId) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          excuseId.error ?? "Excuse identifier must be a positive whole number.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const parsed = parseExcuseDecisionInput(request.body);
      if ("error" in parsed) {
        const result = error(
          400,
          "VALIDATION_ERROR",
          parsed.error ?? "Enter a valid excuse decision.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      try {
        const excuse = await dependencies.decideExcuse(
          excuseId.value,
          parsed.value,
          (request as AuthenticatedRequest).auth!.subject,
        );
        response.status(200).json({ data: { excuse } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/search",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      if (parsePage(request.query.page) === null || parsePage(request.query.pageSize, 10, 25) === null) {
        response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Use page 1–10000 and pageSize 1–25." } });
        return;
      }
      try {
        if (!dependencies.search) {
          throw createRouteError(503, "SEARCH_UNAVAILABLE", "Search is not configured.");
        }
        const term = normalizeSearchTerm(request.query.q);
        if (!isValidSearchTerm(term)) {
          const result = error(400, "VALIDATION_ERROR", "Search terms must be between 2 and 100 characters long.");
          response.status(result.status).json(result.body);
          return;
        }
        const query: ResolvedSearchQuery = {
          term,
          categories: resolveSearchCategories(auth.role!, request.query.categories),
          page: clampSearchPage(request.query.page),
          pageSize: clampSearchPageSize(request.query.pageSize),
        };
        response.status(200).json({ data: await dependencies.search(auth.subject, query) });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/notifications",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      if (parsePage(request.query.page) === null || parsePage(request.query.pageSize, 10, 25) === null) {
        response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Use page 1–10000 and pageSize 1–25." } });
        return;
      }
      try {
        if (!dependencies.listNotifications) throw createRouteError(503, "NOTIFICATIONS_UNAVAILABLE", "Notifications are not configured.");
        const query = parseNotificationListQuery(request.query);
        response.status(200).json({ data: await dependencies.listNotifications(auth.subject, query) });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/notifications/unread-count",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.countUnreadNotifications) throw createRouteError(503, "NOTIFICATIONS_UNAVAILABLE", "Notifications are not configured.");
        const unreadCount = await dependencies.countUnreadNotifications(auth.subject);
        response.status(200).json({ data: { unreadCount } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.get(
    "/api/notifications/:id",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const notificationId = parseNumericId(request.params.id, "Notification");
      if ("error" in notificationId) {
        const result = error(400, "VALIDATION_ERROR", notificationId.error ?? "Notification identifier must be a positive whole number.");
        response.status(result.status).json(result.body);
        return;
      }
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.getNotification) throw createRouteError(503, "NOTIFICATIONS_UNAVAILABLE", "Notifications are not configured.");
        const notification = await dependencies.getNotification(auth.subject, notificationId.value);
        if (!notification) {
          const result = error(404, "NOTIFICATION_NOT_FOUND", "The requested notification could not be found.");
          response.status(result.status).json(result.body);
          return;
        }
        response.status(200).json({ data: notification });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.patch(
    "/api/notifications/:id/read",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const notificationId = parseNumericId(request.params.id, "Notification");
      if ("error" in notificationId) {
        const result = error(400, "VALIDATION_ERROR", notificationId.error ?? "Notification identifier must be a positive whole number.");
        response.status(result.status).json(result.body);
        return;
      }
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.markNotificationRead) throw createRouteError(503, "NOTIFICATIONS_UNAVAILABLE", "Notifications are not configured.");
        const notification = await dependencies.markNotificationRead(auth.subject, notificationId.value);
        response.status(200).json({ data: { notification } });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/notifications/read-all",
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.markAllNotificationsRead) throw createRouteError(503, "NOTIFICATIONS_UNAVAILABLE", "Notifications are not configured.");
        response.status(200).json({ data: await dependencies.markAllNotificationsRead(auth.subject) });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.post(
    "/api/notifications/reminders/run",
    authenticate,
    resolveProfileRole,
    requireRole("ORGANISER"),
    async (_request, response) => {
      try {
        if (!dependencies.runDueReminders) throw createRouteError(503, "NOTIFICATIONS_UNAVAILABLE", "Notifications are not configured.");
        response.status(200).json({ data: await dependencies.runDueReminders() });
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.delete(
    "/api/auth/delete-account",
    sensitiveAuthLimiter,
    authenticate,
    resolveProfileRole,
    requireTutorMxRole,
    async (request, response) => {
      const auth = (request as AuthenticatedRequest).auth!;
      try {
        if (!dependencies.deleteAccount) {
          throw new Error("Account deletion is not configured");
        }
        await dependencies.deleteAccount(auth.subject);
        response.status(204).end();
      } catch (value) {
        sendRouteError(response, value);
      }
    },
  );

  app.use((_request, response) => {
    const result = error(
      404,
      "NOT_FOUND",
      "The requested route was not found.",
    );
    response.status(result.status).json(result.body);
  });

  app.use(
    (
      thrown: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;

      if (typeof thrown === "object" && thrown !== null && "type" in thrown && thrown.type === "entity.too.large") {
        response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Keep the request body within 32 KB." } });
        return;
      }
      if (
        thrown instanceof SyntaxError &&
        "status" in thrown &&
        thrown.status === 400
      ) {
        const result = error(
          400,
          "INVALID_JSON",
          "The request body must contain valid JSON.",
        );
        response.status(result.status).json(result.body);
        return;
      }

      const result = error(
        500,
        "INTERNAL_ERROR",
        "The request could not be completed.",
      );
      response.status(result.status).json(result.body);
    },
  );

  return app;
}
