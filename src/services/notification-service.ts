import { createRouteError } from "../app.js";
import {
  computeDueReminders,
  type DueReminderThresholds,
  type NotificationEvent,
  type NotificationListQuery,
} from "./notifications.js";

/**
 * Database-backed notification store. It accepts a narrow structural client so
 * it can be unit tested with in-memory fakes (mirroring timesheet-workflows).
 * De-duplication relies on the `UNIQUE(eventKey)` index plus
 * `createMany({ skipDuplicates: true })`, so retries never insert a second row.
 */

export interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string;
  linkPath: string;
  targetType: string;
  targetId: number | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationSummary {
  id: number;
  type: string;
  title: string;
  body: string;
  linkPath: string;
  targetType: string;
  targetId: number | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationSummary[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
}

export interface NotificationDataClient {
  notification: {
    createMany(args: {
      data: Array<{
        recipientProfileId: number;
        type: string;
        title: string;
        body: string;
        linkPath: string;
        targetType: string;
        targetId: number | null;
        eventKey: string;
      }>;
      skipDuplicates: true;
    }): Promise<{ count: number }>;
    findMany(args: {
      where: { recipientProfileId: number; readAt?: null };
      orderBy: { createdAt: "desc" };
      skip: number;
      take: number;
      select: Record<string, true>;
    }): Promise<NotificationRow[]>;
    count(args: {
      where: { recipientProfileId: number; readAt?: null };
    }): Promise<number>;
    updateMany(args: {
      where: { id?: number; recipientProfileId: number; readAt?: null };
      data: { readAt: Date };
    }): Promise<{ count: number }>;
  };
  profile: {
    findMany(args: {
      where: { role: "ORGANISER" };
      select: { id: true };
    }): Promise<Array<{ id: number }>>;
  };
  timesheet: {
    findMany(args: {
      where: { status: "SUBMITTED" | "RETURNED" };
      select: Record<string, true>;
    }): Promise<
      Array<{
        id: number;
        tutorId?: number;
        submittedAt?: Date | null;
        reviewedAt?: Date | null;
      }>
    >;
  };
  volunteerClaim: {
    findMany(args: {
      where: { status: "PENDING" };
      select: { id: true; createdAt: true };
    }): Promise<Array<{ id: number; createdAt: Date }>>;
  };
  excuse: {
    findMany(args: {
      where: { status: "PENDING" };
      select: { id: true; createdAt: true };
    }): Promise<Array<{ id: number; createdAt: Date }>>;
  };
}

const summarySelection = {
  id: true,
  type: true,
  title: true,
  body: true,
  linkPath: true,
  targetType: true,
  targetId: true,
  readAt: true,
  createdAt: true,
} as const;

function toSummary(row: NotificationRow): NotificationSummary {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    targetType: row.targetType,
    targetId: row.targetId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface NotificationService {
  emit(events: NotificationEvent[]): Promise<number>;
  list(
    recipientProfileId: number,
    query: NotificationListQuery,
  ): Promise<NotificationListResult>;
  unreadCount(recipientProfileId: number): Promise<number>;
  markRead(
    recipientProfileId: number,
    notificationId: number,
  ): Promise<{ id: number; readAt: string }>;
  markAllRead(recipientProfileId: number): Promise<{ updated: number }>;
  runDueReminders(
    now: Date,
    thresholds?: DueReminderThresholds,
  ): Promise<{ generated: number }>;
}

export function createNotificationService(
  client: NotificationDataClient,
): NotificationService {
  async function emit(events: NotificationEvent[]): Promise<number> {
    if (events.length === 0) {
      return 0;
    }
    const result = await client.notification.createMany({
      data: events.map((event) => ({
        recipientProfileId: event.recipientProfileId,
        type: event.type,
        title: event.title,
        body: event.body,
        linkPath: event.linkPath,
        targetType: event.targetType,
        targetId: event.targetId,
        eventKey: event.eventKey,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  return {
    emit,

    async list(recipientProfileId, query) {
      const where =
        query.status === "unread"
          ? { recipientProfileId, readAt: null as null }
          : { recipientProfileId };
      const [items, total, unreadCount] = await Promise.all([
        client.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: summarySelection,
        }),
        client.notification.count({ where }),
        client.notification.count({
          where: { recipientProfileId, readAt: null },
        }),
      ]);
      return {
        items: items.map(toSummary),
        page: query.page,
        pageSize: query.pageSize,
        total,
        unreadCount,
      };
    },

    async unreadCount(recipientProfileId) {
      return client.notification.count({
        where: { recipientProfileId, readAt: null },
      });
    },

    async markRead(recipientProfileId, notificationId) {
      const readAt = new Date();
      const result = await client.notification.updateMany({
        where: { id: notificationId, recipientProfileId, readAt: null },
        data: { readAt },
      });
      if (result.count === 0) {
        // Either the notification does not exist or it belongs to someone else.
        // Return 404 so ownership of another user's row is never confirmed.
        throw createRouteError(
          404,
          "NOTIFICATION_NOT_FOUND",
          "The requested notification could not be found.",
        );
      }
      return { id: notificationId, readAt: readAt.toISOString() };
    },

    async markAllRead(recipientProfileId) {
      const result = await client.notification.updateMany({
        where: { recipientProfileId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    },

    async runDueReminders(now, thresholds) {
      const [
        organisers,
        submittedTimesheets,
        returnedTimesheets,
        pendingVolunteerClaims,
        pendingExcuses,
      ] = await Promise.all([
        client.profile.findMany({
          where: { role: "ORGANISER" },
          select: { id: true },
        }),
        client.timesheet.findMany({
          where: { status: "SUBMITTED" },
          select: { id: true, submittedAt: true },
        }),
        client.timesheet.findMany({
          where: { status: "RETURNED" },
          select: { id: true, tutorId: true, reviewedAt: true },
        }),
        client.volunteerClaim.findMany({
          where: { status: "PENDING" },
          select: { id: true, createdAt: true },
        }),
        client.excuse.findMany({
          where: { status: "PENDING" },
          select: { id: true, createdAt: true },
        }),
      ]);

      const events = computeDueReminders({
        now,
        thresholds,
        organiserProfileIds: organisers.map((organiser) => organiser.id),
        submittedTimesheets: submittedTimesheets.map((timesheet) => ({
          id: timesheet.id,
          submittedAt: timesheet.submittedAt ?? null,
        })),
        returnedTimesheets: returnedTimesheets.map((timesheet) => ({
          id: timesheet.id,
          tutorId: timesheet.tutorId ?? 0,
          reviewedAt: timesheet.reviewedAt ?? null,
        })),
        pendingVolunteerClaims,
        pendingExcuses,
      });
      const generated = await emit(events);
      return { generated };
    },
  };
}

/**
 * Guarded scheduler. Extracted so it is unit testable with fake timers and so
 * server startup only needs a single call. Disabled in tests and unref'd so it
 * never keeps the process alive.
 */
export function startDueReminderScheduler(
  service: Pick<NotificationService, "runDueReminders">,
  options: {
    enabled: boolean;
    intervalMs: number;
    now?: () => Date;
    onError?: (error: unknown) => void;
  },
): { stop: () => void } {
  if (!options.enabled) {
    return { stop: () => undefined };
  }
  const now = options.now ?? (() => new Date());
  const timer = setInterval(() => {
    void service.runDueReminders(now()).catch((error) => {
      options.onError?.(error);
    });
  }, options.intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return { stop: () => clearInterval(timer) };
}
