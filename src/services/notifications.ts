import type { TutorRole } from "../auth/contract.js";

/**
 * Pure notification logic: deterministic event keys, recipient targeting from
 * existing workflow results, the read-time permission mapper and due-reminder
 * computation. Nothing here touches the database, so every rule is unit
 * testable in isolation. The database `UNIQUE(eventKey)` constraint is the
 * real de-duplication guarantee; these helpers only make the keys stable.
 */

export const NOTIFICATION_TYPES = [
  "BOOKING_CONFIRMED", "BOOKING_CANCELLED", "SWAP_REQUESTED", "SWAP_UPDATED",
  "ALLOCATION_CREATED",
  "ALLOCATION_CHANGED",
  "ALLOCATION_CANCELLED",
  "TIMESHEET_SUBMITTED",
  "TIMESHEET_RETURNED",
  "TIMESHEET_APPROVED",
  "EXCUSE_SUBMITTED",
  "EXCUSE_DECIDED",
  "VOLUNTEER_OUTCOME",
  "TIMESHEET_REVIEW_DUE",
  "TIMESHEET_RESUBMIT_DUE",
  "VOLUNTEER_CLAIM_DUE",
  "EXCUSE_REVIEW_DUE",
  "TIMESHEET_DISPUTED",
  "TIMESHEET_DISPUTE_RESOLVED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationTargetType =
  | "booking"
  | "swap"
  | "allocation"
  | "timesheet"
  | "excuse"
  | "volunteer";

export interface NotificationDraft {
  recipientProfileId: number;
  type: NotificationType;
  title: string;
  body: string;
  linkPath: string;
  targetType: NotificationTargetType;
  targetId: number | null;
  stateDiscriminator: string;
}

export interface NotificationEvent extends NotificationDraft {
  eventKey: string;
}

/** Only the recipient role that a given notification type is ever meant for. */
export const NOTIFICATION_TYPE_ROLES: Record<NotificationType, TutorRole[]> = {
  BOOKING_CONFIRMED: ["STUDENT", "TUTOR"],
  BOOKING_CANCELLED: ["STUDENT", "TUTOR"],
  SWAP_REQUESTED: ["TUTOR"],
  SWAP_UPDATED: ["TUTOR", "ORGANISER"],
  ALLOCATION_CREATED: ["TUTOR"],
  ALLOCATION_CHANGED: ["TUTOR"],
  ALLOCATION_CANCELLED: ["TUTOR"],
  TIMESHEET_SUBMITTED: ["ORGANISER"],
  TIMESHEET_RETURNED: ["TUTOR"],
  TIMESHEET_APPROVED: ["TUTOR"],
  EXCUSE_SUBMITTED: ["ORGANISER"],
  EXCUSE_DECIDED: ["TUTOR"],
  VOLUNTEER_OUTCOME: ["STUDENT"],
  TIMESHEET_REVIEW_DUE: ["ORGANISER"],
  TIMESHEET_RESUBMIT_DUE: ["TUTOR"],
  VOLUNTEER_CLAIM_DUE: ["ORGANISER"],
  EXCUSE_REVIEW_DUE: ["ORGANISER"],
  TIMESHEET_DISPUTED: ["ORGANISER"],
  TIMESHEET_DISPUTE_RESOLVED: ["TUTOR"],
};

export interface DueReminderThresholds {
  timesheetReviewHours: number;
  timesheetResubmitHours: number;
  volunteerClaimHours: number;
  excuseReviewHours: number;
}

/** Single source of truth for how long a workflow may stall before reminding. */
export const DUE_REMINDER_THRESHOLDS: DueReminderThresholds = {
  timesheetReviewHours: 48,
  timesheetResubmitHours: 72,
  volunteerClaimHours: 48,
  excuseReviewHours: 48,
};

/**
 * Deterministic de-dup key. Identical inputs always produce an identical key,
 * so a retried write collides on the unique index instead of duplicating.
 */
export function buildEventKey(parts: {
  type: NotificationType;
  targetType: NotificationTargetType;
  targetId: number | null;
  stateDiscriminator: string;
  recipientProfileId: number;
}): string {
  return [
    parts.type,
    parts.targetType,
    parts.targetId ?? "none",
    parts.stateDiscriminator,
    parts.recipientProfileId,
  ].join(":");
}

export function toNotificationEvent(draft: NotificationDraft): NotificationEvent {
  return { ...draft, eventKey: buildEventKey(draft) };
}

/**
 * Read-time permission mapper. A notification may be opened only by its own
 * recipient (rejects another user) whose role matches the notification type
 * (rejects another role). Used for ownership checks and as defence in depth.
 */
export function canAccessNotification(
  notification: { recipientProfileId: number; type: NotificationType },
  viewer: { profileId: number; role: TutorRole },
): boolean {
  if (notification.recipientProfileId !== viewer.profileId) {
    return false;
  }
  return NOTIFICATION_TYPE_ROLES[notification.type].includes(viewer.role);
}

export interface AllocationResult {
  id: number;
  tutorId: number;
  status: "PROPOSED" | "CONFIRMED" | "CANCELLED";
}

/** Allocation created/changed only ever affects the assigned tutor. */
export function buildAllocationNotifications(
  allocation: AllocationResult,
  options: { created: boolean },
): NotificationEvent[] {
  const type: NotificationType = options.created
    ? "ALLOCATION_CREATED"
    : "ALLOCATION_CHANGED";
  const title = options.created
    ? "New work assignment"
    : "Your assignment changed";
  return [
    toNotificationEvent({
      recipientProfileId: allocation.tutorId,
      type,
      title,
      body: `An allocation is now ${allocation.status.toLowerCase()}.`,
      linkPath: "/tutor",
      targetType: "allocation",
      targetId: allocation.id,
      stateDiscriminator: allocation.status,
    }),
  ];
}

/**
 * A cancelled allocation notifies the tutor that their assignment was removed.
 * The state discriminator is always CANCELLED so retries of the same removal
 * are de-duplicated.
 */
export function buildAllocationCancelledNotifications(
  allocation: AllocationResult,
): NotificationEvent[] {
  return [
    toNotificationEvent({
      recipientProfileId: allocation.tutorId,
      type: "ALLOCATION_CANCELLED",
      title: "Assignment removed",
      body: "An allocation has been cancelled.",
      linkPath: "/tutor",
      targetType: "allocation",
      targetId: allocation.id,
      stateDiscriminator: "CANCELLED",
    }),
  ];
}

/**
 * A submitted timesheet notifies organisers that a decision is due. Organiser
 * facing copy is deliberately generic and carries no tutor identity.
 */
export function buildTimesheetSubmittedNotifications(
  timesheet: { id: number },
  organiserProfileIds: number[],
): NotificationEvent[] {
  return organiserProfileIds.map((organiserProfileId) =>
    toNotificationEvent({
      recipientProfileId: organiserProfileId,
      type: "TIMESHEET_SUBMITTED",
      title: "Timesheet awaiting review",
      body: "A submitted timesheet is ready for an organiser decision.",
      linkPath: "/organiser",
      targetType: "timesheet",
      targetId: timesheet.id,
      stateDiscriminator: "SUBMITTED",
    }),
  );
}

export interface TimesheetDecisionResult {
  id: number;
  tutorId: number;
  status: "APPROVED" | "RETURNED";
  reviewReason: string | null;
}

/** An organiser decision notifies the owning tutor with their own detail. */
export function buildTimesheetDecisionNotifications(
  decision: TimesheetDecisionResult,
): NotificationEvent[] {
  const approved = decision.status === "APPROVED";
  return [
    toNotificationEvent({
      recipientProfileId: decision.tutorId,
      type: approved ? "TIMESHEET_APPROVED" : "TIMESHEET_RETURNED",
      title: approved ? "Timesheet approved" : "Timesheet returned for changes",
      body: approved
        ? "Your timesheet has been approved."
        : decision.reviewReason
          ? `Your timesheet needs changes: ${decision.reviewReason}`
          : "Your timesheet was returned for changes.",
      linkPath: "/tutor/forms",
      targetType: "timesheet",
      targetId: decision.id,
      stateDiscriminator: decision.status,
    }),
  ];
}

/**
 * A tutor-submitted excuse notifies organisers that a decision is due. This is
 * the one cross-user workflow transition that exists on the current backend, so
 * it is wired live; the remaining builders are ready for the Sprint 2 workflows.
 * Organiser-facing copy is deliberately generic and carries no tutor identity.
 */
export function buildExcuseSubmittedNotifications(
  excuse: { id: number },
  organiserProfileIds: number[],
): NotificationEvent[] {
  return organiserProfileIds.map((organiserProfileId) =>
    toNotificationEvent({
      recipientProfileId: organiserProfileId,
      type: "EXCUSE_SUBMITTED",
      title: "Excuse awaiting decision",
      body: "A submitted excuse is ready for an organiser decision.",
      linkPath: "/organiser",
      targetType: "excuse",
      targetId: excuse.id,
      stateDiscriminator: "PENDING",
    }),
  );
}

export interface ExcuseDecisionResult {
  id: number;
  status: "APPROVED" | "REJECTED";
  reviewReason: string | null;
}

/** Excuse decision notifies the tutor who raised it (recipient resolved by caller). */
export function buildExcuseDecisionNotifications(
  excuse: ExcuseDecisionResult,
  tutorProfileId: number,
): NotificationEvent[] {
  const approved = excuse.status === "APPROVED";
  return [
    toNotificationEvent({
      recipientProfileId: tutorProfileId,
      type: "EXCUSE_DECIDED",
      title: approved ? "Excuse approved" : "Excuse rejected",
      body: approved
        ? "Your excuse request was approved."
        : excuse.reviewReason
          ? `Your excuse request was rejected: ${excuse.reviewReason}`
          : "Your excuse request was rejected.",
      linkPath: "/tutor/forms",
      targetType: "excuse",
      targetId: excuse.id,
      stateDiscriminator: excuse.status,
    }),
  ];
}

/** An objection raised by the tutor, or an organiser's answer to one. */
export interface TimesheetDisputeResult {
  id: number;
  timesheetId: number;
  tutorId: number;
  status: "OPEN" | "RESOLVED";
  resolutionReason: string | null;
}

/**
 * A challenged decision notifies organisers that a response is due.
 * Organiser-facing copy is deliberately generic and carries no tutor identity.
 * The dispute id is part of the discriminator because the same timesheet can be
 * disputed again once a first dispute is resolved, and that second objection
 * must not be swallowed by the de-duplication key.
 */
export function buildTimesheetDisputedNotifications(
  dispute: TimesheetDisputeResult,
  organiserProfileIds: number[],
): NotificationEvent[] {
  return organiserProfileIds.map((organiserProfileId) =>
    toNotificationEvent({
      recipientProfileId: organiserProfileId,
      type: "TIMESHEET_DISPUTED",
      title: "Timesheet decision disputed",
      body: "A timesheet decision has been disputed and needs an organiser response.",
      linkPath: "/organiser",
      targetType: "timesheet",
      targetId: dispute.timesheetId,
      stateDiscriminator: `dispute:${dispute.id}`,
    }),
  );
}

/** The answer goes back to the tutor who raised the objection. */
export function buildTimesheetDisputeResolvedNotifications(
  dispute: TimesheetDisputeResult,
): NotificationEvent[] {
  return [
    toNotificationEvent({
      recipientProfileId: dispute.tutorId,
      type: "TIMESHEET_DISPUTE_RESOLVED",
      title: "Your dispute was answered",
      body: dispute.resolutionReason
        ? `An organiser answered your dispute: ${dispute.resolutionReason}`
        : "An organiser answered your dispute.",
      linkPath: "/tutor/forms",
      targetType: "timesheet",
      targetId: dispute.timesheetId,
      stateDiscriminator: `dispute:${dispute.id}:RESOLVED`,
    }),
  ];
}

export interface VolunteerOutcomeResult {
  id: number;
  studentId: number;
  status: "ACCEPTED" | "REJECTED";
  reviewReason: string | null;
}

/** Volunteer claim outcome notifies the student who volunteered. */
export function buildVolunteerOutcomeNotifications(
  claim: VolunteerOutcomeResult,
): NotificationEvent[] {
  const accepted = claim.status === "ACCEPTED";
  return [
    toNotificationEvent({
      recipientProfileId: claim.studentId,
      type: "VOLUNTEER_OUTCOME",
      title: accepted ? "Volunteer request accepted" : "Volunteer request declined",
      body: accepted
        ? "Your volunteer request was accepted."
        : claim.reviewReason
          ? `Your volunteer request was declined: ${claim.reviewReason}`
          : "Your volunteer request was declined.",
      linkPath: "/student",
      targetType: "volunteer",
      targetId: claim.id,
      stateDiscriminator: claim.status,
    }),
  ];
}

function hoursBetween(now: Date, then: Date | null): number {
  if (!then) {
    return 0;
  }
  return (now.getTime() - then.getTime()) / 3_600_000;
}

/** UTC day bucket so a reminder is generated once per day, not once per run. */
export function dateBucket(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface DueReminderData {
  now: Date;
  organiserProfileIds: number[];
  submittedTimesheets: { id: number; submittedAt: Date | null }[];
  returnedTimesheets: { id: number; tutorId: number; reviewedAt: Date | null }[];
  pendingVolunteerClaims: { id: number; createdAt: Date }[];
  pendingExcuses: { id: number; createdAt: Date }[];
  thresholds?: DueReminderThresholds;
}

/**
 * Pure reminder computation: finds items where someone is currently holding up
 * the workflow past the configured threshold and emits one reminder per day
 * per affected recipient. The date bucket in the discriminator keeps repeated
 * runs from producing a second row for the same day.
 */
export function computeDueReminders(data: DueReminderData): NotificationEvent[] {
  const thresholds = data.thresholds ?? DUE_REMINDER_THRESHOLDS;
  const bucket = `due:${dateBucket(data.now)}`;
  const events: NotificationEvent[] = [];

  for (const timesheet of data.submittedTimesheets) {
    if (
      hoursBetween(data.now, timesheet.submittedAt) >=
      thresholds.timesheetReviewHours
    ) {
      for (const organiserProfileId of data.organiserProfileIds) {
        events.push(
          toNotificationEvent({
            recipientProfileId: organiserProfileId,
            type: "TIMESHEET_REVIEW_DUE",
            title: "Timesheet review overdue",
            body: "A submitted timesheet has been waiting for a decision.",
            linkPath: "/organiser",
            targetType: "timesheet",
            targetId: timesheet.id,
            stateDiscriminator: bucket,
          }),
        );
      }
    }
  }

  for (const timesheet of data.returnedTimesheets) {
    if (
      hoursBetween(data.now, timesheet.reviewedAt) >=
      thresholds.timesheetResubmitHours
    ) {
      events.push(
        toNotificationEvent({
          recipientProfileId: timesheet.tutorId,
          type: "TIMESHEET_RESUBMIT_DUE",
          title: "Timesheet needs resubmitting",
          body: "Your returned timesheet still needs changes and resubmission.",
          linkPath: "/tutor/forms",
          targetType: "timesheet",
          targetId: timesheet.id,
          stateDiscriminator: bucket,
        }),
      );
    }
  }

  for (const claim of data.pendingVolunteerClaims) {
    if (hoursBetween(data.now, claim.createdAt) >= thresholds.volunteerClaimHours) {
      for (const organiserProfileId of data.organiserProfileIds) {
        events.push(
          toNotificationEvent({
            recipientProfileId: organiserProfileId,
            type: "VOLUNTEER_CLAIM_DUE",
            title: "Volunteer claim awaiting decision",
            body: "A pending volunteer claim is waiting for an organiser decision.",
            linkPath: "/organiser",
            targetType: "volunteer",
            targetId: claim.id,
            stateDiscriminator: bucket,
          }),
        );
      }
    }
  }

  for (const excuse of data.pendingExcuses) {
    if (hoursBetween(data.now, excuse.createdAt) >= thresholds.excuseReviewHours) {
      for (const organiserProfileId of data.organiserProfileIds) {
        events.push(
          toNotificationEvent({
            recipientProfileId: organiserProfileId,
            type: "EXCUSE_REVIEW_DUE",
            title: "Excuse awaiting decision",
            body: "A pending excuse is waiting for an organiser decision.",
            linkPath: "/organiser",
            targetType: "excuse",
            targetId: excuse.id,
            stateDiscriminator: bucket,
          }),
        );
      }
    }
  }

  return events;
}

export interface NotificationListQuery {
  status: "unread" | "all";
  page: number;
  pageSize: number;
}

export const MAX_NOTIFICATION_PAGE_SIZE = 25;

/** Bounded, defensive parsing of untrusted list query parameters. */
export function parseNotificationListQuery(raw: {
  status?: unknown;
  page?: unknown;
  pageSize?: unknown;
}): NotificationListQuery {
  const status = raw.status === "all" ? "all" : "unread";
  const page = clampInteger(raw.page, 1, 1, 10_000);
  const pageSize = clampInteger(
    raw.pageSize,
    MAX_NOTIFICATION_PAGE_SIZE,
    1,
    MAX_NOTIFICATION_PAGE_SIZE,
  );
  return { status, page, pageSize };
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const resolved = Array.isArray(value) ? value[0] : value;
  const numeric = Number(resolved);
  if (!Number.isInteger(numeric) || numeric < min) {
    return fallback;
  }
  return Math.min(numeric, max);
}
