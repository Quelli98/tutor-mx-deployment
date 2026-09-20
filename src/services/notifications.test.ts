import { describe, expect, it } from "vitest";

import {
  buildAllocationNotifications,
  buildEventKey,
  buildExcuseDecisionNotifications,
  buildTimesheetDecisionNotifications,
  buildTimesheetSubmittedNotifications,
  buildVolunteerOutcomeNotifications,
  canAccessNotification,
  computeDueReminders,
  dateBucket,
  DUE_REMINDER_THRESHOLDS,
  MAX_NOTIFICATION_PAGE_SIZE,
  parseNotificationListQuery,
  toNotificationEvent,
} from "./notifications.js";

describe("buildEventKey", () => {
  it("is deterministic: identical input always yields the same key", () => {
    const parts = {
      type: "TIMESHEET_APPROVED" as const,
      targetType: "timesheet" as const,
      targetId: 42,
      stateDiscriminator: "APPROVED",
      recipientProfileId: 7,
    };
    expect(buildEventKey(parts)).toBe(buildEventKey(parts));
    expect(buildEventKey(parts)).toBe("TIMESHEET_APPROVED:timesheet:42:APPROVED:7");
  });

  it("changes when any discriminating part changes", () => {
    const base = {
      type: "TIMESHEET_APPROVED" as const,
      targetType: "timesheet" as const,
      targetId: 42,
      stateDiscriminator: "APPROVED",
      recipientProfileId: 7,
    };
    expect(buildEventKey({ ...base, recipientProfileId: 8 })).not.toBe(
      buildEventKey(base),
    );
    expect(buildEventKey({ ...base, stateDiscriminator: "RETURNED" })).not.toBe(
      buildEventKey(base),
    );
    expect(buildEventKey({ ...base, targetId: 43 })).not.toBe(buildEventKey(base));
  });

  it("renders a null target id as a stable placeholder", () => {
    expect(
      buildEventKey({
        type: "EXCUSE_REVIEW_DUE",
        targetType: "excuse",
        targetId: null,
        stateDiscriminator: "due:2026-09-20",
        recipientProfileId: 3,
      }),
    ).toBe("EXCUSE_REVIEW_DUE:excuse:none:due:2026-09-20:3");
  });
});

describe("canAccessNotification permission mapper", () => {
  it("allows the owning recipient whose role matches the notification type", () => {
    expect(
      canAccessNotification(
        { recipientProfileId: 5, type: "TIMESHEET_APPROVED" },
        { profileId: 5, role: "TUTOR" },
      ),
    ).toBe(true);
  });

  it("rejects another user viewing the notification", () => {
    expect(
      canAccessNotification(
        { recipientProfileId: 5, type: "TIMESHEET_APPROVED" },
        { profileId: 6, role: "TUTOR" },
      ),
    ).toBe(false);
  });

  it("rejects the owner when their role does not match the type", () => {
    expect(
      canAccessNotification(
        { recipientProfileId: 5, type: "TIMESHEET_SUBMITTED" },
        { profileId: 5, role: "TUTOR" },
      ),
    ).toBe(false);
  });
});

describe("workflow notification builders", () => {
  it("targets only the assigned tutor for a new allocation", () => {
    const events = buildAllocationNotifications(
      { id: 11, tutorId: 4, status: "PROPOSED" },
      { created: true },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      recipientProfileId: 4,
      type: "ALLOCATION_CREATED",
      targetType: "allocation",
      targetId: 11,
      linkPath: "/tutor",
    });
  });

  it("uses ALLOCATION_CHANGED when the allocation already existed", () => {
    const [event] = buildAllocationNotifications(
      { id: 11, tutorId: 4, status: "CONFIRMED" },
      { created: false },
    );
    expect(event.type).toBe("ALLOCATION_CHANGED");
    expect(event.stateDiscriminator).toBe("CONFIRMED");
  });

  it("notifies every organiser with generic copy that leaks no tutor identity", () => {
    const events = buildTimesheetSubmittedNotifications({ id: 9 }, [1, 2]);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.type).toBe("TIMESHEET_SUBMITTED");
      expect(event.targetId).toBe(9);
      expect(`${event.title} ${event.body}`.toLowerCase()).not.toContain("tutor ");
    }
    expect(events.map((event) => event.recipientProfileId)).toEqual([1, 2]);
  });

  it("routes a timesheet decision to the owning tutor", () => {
    const [approved] = buildTimesheetDecisionNotifications({
      id: 3,
      tutorId: 8,
      status: "APPROVED",
      reviewReason: null,
    });
    expect(approved).toMatchObject({
      recipientProfileId: 8,
      type: "TIMESHEET_APPROVED",
      linkPath: "/tutor/forms",
    });

    const [returned] = buildTimesheetDecisionNotifications({
      id: 3,
      tutorId: 8,
      status: "RETURNED",
      reviewReason: "Add hours",
    });
    expect(returned.type).toBe("TIMESHEET_RETURNED");
    expect(returned.body).toContain("Add hours");
  });

  it("routes an excuse decision to the resolved tutor profile", () => {
    const [event] = buildExcuseDecisionNotifications(
      { id: 2, status: "REJECTED", reviewReason: "Insufficient detail" },
      15,
    );
    expect(event).toMatchObject({
      recipientProfileId: 15,
      type: "EXCUSE_DECIDED",
      targetType: "excuse",
    });
    expect(event.body).toContain("Insufficient detail");
  });

  it("routes a volunteer outcome to the student who volunteered", () => {
    const [event] = buildVolunteerOutcomeNotifications({
      id: 6,
      studentId: 20,
      status: "ACCEPTED",
      reviewReason: null,
    });
    expect(event).toMatchObject({
      recipientProfileId: 20,
      type: "VOLUNTEER_OUTCOME",
      linkPath: "/student",
    });
  });
});

describe("computeDueReminders", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");

  it("uses a per-day bucket so repeated runs produce identical event keys", () => {
    const data = {
      now,
      organiserProfileIds: [1],
      submittedTimesheets: [
        { id: 5, submittedAt: new Date("2026-09-17T12:00:00.000Z") },
      ],
      returnedTimesheets: [],
      pendingVolunteerClaims: [],
      pendingExcuses: [],
    };
    const first = computeDueReminders(data);
    const second = computeDueReminders(data);
    expect(first).toHaveLength(1);
    expect(first[0].eventKey).toBe(second[0].eventKey);
    expect(first[0].stateDiscriminator).toBe(`due:${dateBucket(now)}`);
  });

  it("only reminds once the configured threshold has elapsed", () => {
    const fresh = computeDueReminders({
      now,
      organiserProfileIds: [1],
      submittedTimesheets: [
        { id: 5, submittedAt: new Date("2026-09-20T06:00:00.000Z") },
      ],
      returnedTimesheets: [],
      pendingVolunteerClaims: [],
      pendingExcuses: [],
    });
    expect(fresh).toHaveLength(0);
  });

  it("covers each stalled workflow and fans organiser reminders out", () => {
    const events = computeDueReminders({
      now,
      organiserProfileIds: [1, 2],
      submittedTimesheets: [
        { id: 5, submittedAt: new Date("2026-09-17T00:00:00.000Z") },
      ],
      returnedTimesheets: [
        { id: 6, tutorId: 9, reviewedAt: new Date("2026-09-16T00:00:00.000Z") },
      ],
      pendingVolunteerClaims: [
        { id: 7, createdAt: new Date("2026-09-17T00:00:00.000Z") },
      ],
      pendingExcuses: [
        { id: 8, createdAt: new Date("2026-09-17T00:00:00.000Z") },
      ],
    });
    const byType = events.reduce<Record<string, number>>((acc, event) => {
      acc[event.type] = (acc[event.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType.TIMESHEET_REVIEW_DUE).toBe(2);
    expect(byType.VOLUNTEER_CLAIM_DUE).toBe(2);
    expect(byType.EXCUSE_REVIEW_DUE).toBe(2);
    expect(byType.TIMESHEET_RESUBMIT_DUE).toBe(1);
    const resubmit = events.find(
      (event) => event.type === "TIMESHEET_RESUBMIT_DUE",
    );
    expect(resubmit?.recipientProfileId).toBe(9);
  });

  it("treats a missing timestamp as not yet overdue", () => {
    expect(
      computeDueReminders({
        now,
        organiserProfileIds: [1],
        submittedTimesheets: [{ id: 5, submittedAt: null }],
        returnedTimesheets: [{ id: 6, tutorId: 9, reviewedAt: null }],
        pendingVolunteerClaims: [],
        pendingExcuses: [],
      }),
    ).toHaveLength(0);
  });

  it("honours custom thresholds", () => {
    const events = computeDueReminders({
      now,
      organiserProfileIds: [1],
      submittedTimesheets: [
        { id: 5, submittedAt: new Date("2026-09-20T09:00:00.000Z") },
      ],
      returnedTimesheets: [],
      pendingVolunteerClaims: [],
      pendingExcuses: [],
      thresholds: { ...DUE_REMINDER_THRESHOLDS, timesheetReviewHours: 2 },
    });
    expect(events).toHaveLength(1);
  });
});

describe("parseNotificationListQuery", () => {
  it("defaults to unread, page 1 and the max page size", () => {
    expect(parseNotificationListQuery({})).toEqual({
      status: "unread",
      page: 1,
      pageSize: MAX_NOTIFICATION_PAGE_SIZE,
    });
  });

  it("accepts an explicit all filter and valid pagination", () => {
    expect(
      parseNotificationListQuery({ status: "all", page: "3", pageSize: "10" }),
    ).toEqual({ status: "all", page: 3, pageSize: 10 });
  });

  it("caps the page size at the maximum and rejects junk", () => {
    expect(parseNotificationListQuery({ pageSize: "999" }).pageSize).toBe(
      MAX_NOTIFICATION_PAGE_SIZE,
    );
    expect(parseNotificationListQuery({ pageSize: "abc" }).pageSize).toBe(
      MAX_NOTIFICATION_PAGE_SIZE,
    );
    expect(parseNotificationListQuery({ page: "0" }).page).toBe(1);
    expect(parseNotificationListQuery({ page: "-4" }).page).toBe(1);
  });

  it("takes the first value when a parameter arrives as an array", () => {
    expect(
      parseNotificationListQuery({ page: ["2", "5"], pageSize: ["7"] }),
    ).toEqual({ status: "unread", page: 2, pageSize: 7 });
  });
});

describe("toNotificationEvent", () => {
  it("attaches the derived event key to the draft", () => {
    const event = toNotificationEvent({
      recipientProfileId: 1,
      type: "ALLOCATION_CREATED",
      title: "New work assignment",
      body: "An allocation is now proposed.",
      linkPath: "/tutor",
      targetType: "allocation",
      targetId: 3,
      stateDiscriminator: "PROPOSED",
    });
    expect(event.eventKey).toBe("ALLOCATION_CREATED:allocation:3:PROPOSED:1");
  });
});
