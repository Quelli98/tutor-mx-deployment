import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNotificationService,
  startDueReminderScheduler,
  type NotificationDataClient,
} from "./notification-service.js";
import { toNotificationEvent, type NotificationEvent } from "./notifications.js";

interface StoredRow {
  id: number;
  recipientProfileId: number;
  type: string;
  title: string;
  body: string;
  linkPath: string;
  targetType: string;
  targetId: number | null;
  eventKey: string;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * In-memory fake mirroring the narrow structural client. It enforces the same
 * UNIQUE(eventKey) guarantee as Postgres so de-dup behaviour is exercised
 * without a real database.
 */
function createFakeClient(seed: {
  organisers?: number[];
  submittedTimesheets?: Array<{ id: number; submittedAt: Date | null }>;
  returnedTimesheets?: Array<{
    id: number;
    tutorId: number;
    reviewedAt: Date | null;
  }>;
  pendingVolunteerClaims?: Array<{ id: number; createdAt: Date }>;
  pendingExcuses?: Array<{ id: number; createdAt: Date }>;
} = {}) {
  const rows: StoredRow[] = [];
  let nextId = 1;
  let clock = 0;

  const client: NotificationDataClient = {
    notification: {
      async createMany(args) {
        let count = 0;
        for (const data of args.data) {
          if (rows.some((row) => row.eventKey === data.eventKey)) {
            continue;
          }
          rows.push({
            id: nextId++,
            recipientProfileId: data.recipientProfileId,
            type: data.type,
            title: data.title,
            body: data.body,
            linkPath: data.linkPath,
            targetType: data.targetType,
            targetId: data.targetId,
            eventKey: data.eventKey,
            readAt: null,
            createdAt: new Date(2026, 0, 1, 0, 0, clock++),
          });
          count += 1;
        }
        return { count };
      },
      async findMany(args) {
        return rows
          .filter((row) => row.recipientProfileId === args.where.recipientProfileId)
          .filter((row) =>
            args.where.readAt === null ? row.readAt === null : true,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(args.skip, args.skip + args.take)
          .map((row) => ({ ...row }));
      },
      async count(args) {
        return rows
          .filter((row) => row.recipientProfileId === args.where.recipientProfileId)
          .filter((row) =>
            args.where.readAt === null ? row.readAt === null : true,
          ).length;
      },
      async findUnique(args) {
        const row = rows.find((row) => row.id === args.where.id);
        if (!row) return null;
        return {
          recipientProfileId: row.recipientProfileId,
          type: row.type,
          linkPath: row.linkPath,
          targetType: row.targetType,
          targetId: row.targetId,
        };
      },
      async updateMany(args) {
        let count = 0;
        for (const row of rows) {
          if (row.recipientProfileId !== args.where.recipientProfileId) continue;
          if (args.where.id !== undefined && row.id !== args.where.id) continue;
          if (args.where.readAt === null && row.readAt !== null) continue;
          row.readAt = args.data.readAt;
          count += 1;
        }
        return { count };
      },
    },
    profile: {
      async findMany() {
        return (seed.organisers ?? []).map((id) => ({ id }));
      },
    },
    timesheet: {
      async findMany(args) {
        return args.where.status === "SUBMITTED"
          ? (seed.submittedTimesheets ?? [])
          : (seed.returnedTimesheets ?? []);
      },
    },
    volunteerClaim: {
      async findMany() {
        return seed.pendingVolunteerClaims ?? [];
      },
    },
    excuse: {
      async findMany() {
        return seed.pendingExcuses ?? [];
      },
    },
  };

  return { client, rows };
}

const sampleEvent = (overrides: Partial<NotificationEvent> = {}): NotificationEvent =>
  toNotificationEvent({
    recipientProfileId: 1,
    type: "TIMESHEET_APPROVED",
    title: "Timesheet approved",
    body: "Your timesheet has been approved.",
    linkPath: "/tutor/forms",
    targetType: "timesheet",
    targetId: 10,
    stateDiscriminator: "APPROVED",
    ...overrides,
  });

describe("notification service emit", () => {
  it("creates one recipient-specific row for a single event", async () => {
    const { client, rows } = createFakeClient();
    const service = createNotificationService(client);

    const created = await service.emit([sampleEvent()]);

    expect(created).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientProfileId: 1, readAt: null });
  });

  it("never duplicates when the same event is retried", async () => {
    const { client, rows } = createFakeClient();
    const service = createNotificationService(client);

    await service.emit([sampleEvent()]);
    const secondPass = await service.emit([sampleEvent()]);

    expect(secondPass).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it("is a no-op for an empty batch", async () => {
    const { client } = createFakeClient();
    const service = createNotificationService(client);
    expect(await service.emit([])).toBe(0);
  });
});

describe("notification service list / read", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("lists unread only vs all and reports totals", async () => {
    const { client } = createFakeClient();
    const service = createNotificationService(client);
    await service.emit([
      sampleEvent({ targetId: 1, stateDiscriminator: "A" }),
      sampleEvent({ targetId: 2, stateDiscriminator: "B" }),
    ]);

    const unread = await service.list(1, {
      status: "unread",
      page: 1,
      pageSize: 25,
    });
    expect(unread.total).toBe(2);
    expect(unread.unreadCount).toBe(2);
    expect(unread.items).toHaveLength(2);

    await service.markRead(1, unread.items[0].id);

    const all = await service.list(1, { status: "all", page: 1, pageSize: 25 });
    expect(all.total).toBe(2);
    expect(all.unreadCount).toBe(1);

    const stillUnread = await service.list(1, {
      status: "unread",
      page: 1,
      pageSize: 25,
    });
    expect(stillUnread.total).toBe(1);
  });

  it("paginates within the requested window", async () => {
    const { client } = createFakeClient();
    const service = createNotificationService(client);
    await service.emit([
      sampleEvent({ targetId: 1, stateDiscriminator: "A" }),
      sampleEvent({ targetId: 2, stateDiscriminator: "B" }),
      sampleEvent({ targetId: 3, stateDiscriminator: "C" }),
    ]);

    const page2 = await service.list(1, {
      status: "all",
      page: 2,
      pageSize: 2,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it("reports the unread count directly", async () => {
    const { client } = createFakeClient();
    const service = createNotificationService(client);
    await service.emit([sampleEvent()]);
    expect(await service.unreadCount(1)).toBe(1);
  });

  it("marks a single owned notification read", async () => {
    const { client, rows } = createFakeClient();
    const service = createNotificationService(client);
    await service.emit([sampleEvent()]);

    const result = await service.markRead(1, rows[0].id);
    expect(result.id).toBe(rows[0].id);
    expect(rows[0].readAt).not.toBeNull();
  });

  it("throws 404 when marking a notification owned by someone else", async () => {
    const { client, rows } = createFakeClient();
    const service = createNotificationService(client);
    await service.emit([sampleEvent()]);

    await expect(service.markRead(2, rows[0].id)).rejects.toMatchObject({
      status: 404,
      code: "NOTIFICATION_NOT_FOUND",
    });
    expect(rows[0].readAt).toBeNull();
  });

  it("throws 404 when marking a notification that does not exist", async () => {
    const { client } = createFakeClient();
    const service = createNotificationService(client);
    await expect(service.markRead(1, 999)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("marks all unread notifications read at once", async () => {
    const { client } = createFakeClient();
    const service = createNotificationService(client);
    await service.emit([
      sampleEvent({ targetId: 1, stateDiscriminator: "A" }),
      sampleEvent({ targetId: 2, stateDiscriminator: "B" }),
    ]);

    const result = await service.markAllRead(1);
    expect(result.updated).toBe(2);
    expect(await service.unreadCount(1)).toBe(0);
  });
});

describe("notification service due reminders", () => {
  it("loads workflow data, emits reminders and de-dups repeated runs", async () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const { client, rows } = createFakeClient({
      organisers: [1],
      submittedTimesheets: [
        { id: 5, submittedAt: new Date("2026-09-17T00:00:00.000Z") },
      ],
      returnedTimesheets: [
        { id: 6, tutorId: 9, reviewedAt: new Date("2026-09-15T00:00:00.000Z") },
      ],
      pendingVolunteerClaims: [
        { id: 7, createdAt: new Date("2026-09-17T00:00:00.000Z") },
      ],
      pendingExcuses: [
        { id: 8, createdAt: new Date("2026-09-17T00:00:00.000Z") },
      ],
    });
    const service = createNotificationService(client);

    const first = await service.runDueReminders(now);
    expect(first.generated).toBe(4);
    const second = await service.runDueReminders(now);
    expect(second.generated).toBe(0);
    expect(rows).toHaveLength(4);
  });
});

describe("startDueReminderScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns a no-op when disabled and never runs", () => {
    const runDueReminders = vi.fn();
    const handle = startDueReminderScheduler(
      { runDueReminders },
      { enabled: false, intervalMs: 1000 },
    );
    vi.advanceTimersByTime(5000);
    expect(runDueReminders).not.toHaveBeenCalled();
    expect(() => handle.stop()).not.toThrow();
  });

  it("runs on the interval and reports errors through onError", async () => {
    const error = new Error("boom");
    const runDueReminders = vi
      .fn<() => Promise<{ generated: number }>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ generated: 0 });
    const onError = vi.fn();

    const handle = startDueReminderScheduler(
      { runDueReminders },
      { enabled: true, intervalMs: 1000, now: () => new Date(), onError },
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(runDueReminders).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);

    await vi.advanceTimersByTimeAsync(1000);
    expect(runDueReminders).toHaveBeenCalledTimes(2);

    handle.stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(runDueReminders).toHaveBeenCalledTimes(2);
  });
});
