import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BulkAllocationCommitInput,
  StaffingRequirementSummary,
} from "../app.js";
import { createBulkAllocationService } from "./bulk-allocation-service.js";
import type { QueryClient } from "./allocation-queries.js";

const migrationsPath = fileURLToPath(
  new URL("../../prisma/migrations", import.meta.url),
);

function requirement(
  overrides: Partial<StaffingRequirementSummary> = {},
): StaffingRequirementSummary {
  return {
    id: 100,
    courseId: 10,
    courseCode: "COMS3011",
    courseName: "Software Design Project",
    startsAt: "2030-09-04T10:00:00.000Z",
    endsAt: "2030-09-04T14:00:00.000Z",
    windowHours: 4,
    tutorsNeeded: 2,
    requiredHours: 8,
    assignedHours: 0,
    shortageHours: 8,
    shortageTutors: 2,
    fillState: "unfilled",
    status: "OPEN",
    notes: null,
    createdById: 8,
    createdAt: "2026-09-24T09:00:00.000Z",
    updatedAt: "2026-09-24T09:00:00.000Z",
    ...overrides,
  };
}

/** A tutor row shaped as the candidate query returns it, already ranked. */
function candidateRow(
  tutorId: number,
  overrides: Record<string, unknown> = {},
) {
  const weeklyLimit = (overrides.weeklyLimit as number) ?? 20;
  const usedHours = (overrides.usedHours as number) ?? 0;
  return {
    tutorId,
    fullName: `Tutor ${tutorId}`,
    mark: 80,
    weeklyLimit,
    usedHours,
    remainingHours: Math.max(weeklyLimit - usedHours, 0),
    hasClash: false,
    isEligible: true,
    clashDetails: [],
    ...overrides,
  };
}

/** Stands in for the candidate query; the ranking itself is tested elsewhere. */
function candidateClient(rowsByCall: Array<ReturnType<typeof candidateRow>[]>) {
  let call = 0;
  const query = vi.fn(async () => ({ rows: rowsByCall[call++] ?? [] }));
  return { query } as unknown as QueryClient & { query: typeof query };
}

describe("bulk allocation preview", () => {
  it("proposes as many tutors as the shortage calls for, in ranking order", async () => {
    const service = createBulkAllocationService(
      candidateClient([[candidateRow(1), candidateRow(2), candidateRow(3)]]),
      async () => [requirement()],
      vi.fn(),
    );

    const [item] = await service.preview({
      requirementIds: [100],
      minimumMark: 65,
    });

    expect(item!.proposals.map((proposal) => proposal.tutorId)).toEqual([1, 2]);
    expect(item!.proposals[0]).toMatchObject({ hours: 4, mark: 80, markBand: 80 });
    expect(item!.unfilled).toBe(0);
    expect(item!.note).toBeNull();
  });

  it("never proposes the same tutor twice for one requirement", async () => {
    const service = createBulkAllocationService(
      candidateClient([[candidateRow(1), candidateRow(2)]]),
      async () => [requirement({ shortageTutors: 2 })],
      vi.fn(),
    );

    const [item] = await service.preview({
      requirementIds: [100],
      minimumMark: 65,
    });

    const proposed = item!.proposals.map((proposal) => proposal.tutorId);
    expect(new Set(proposed).size).toBe(proposed.length);
  });

  it("reports places it could not fill instead of inventing tutors", async () => {
    const service = createBulkAllocationService(
      candidateClient([[candidateRow(1)]]),
      async () => [requirement({ shortageTutors: 3 })],
      vi.fn(),
    );

    const [item] = await service.preview({
      requirementIds: [100],
      minimumMark: 65,
    });

    expect(item!.proposals).toHaveLength(1);
    expect(item!.unfilled).toBe(2);
    expect(item!.note).toMatch(/1 of 3 places could be proposed/i);
  });

  it("counts hours it has already promised within the same run", async () => {
    // Six hours of capacity covers one four-hour place and no more. The second
    // requirement sees only the two hours left, even though nothing is saved.
    const tutor = candidateRow(1, { weeklyLimit: 6, usedHours: 0 });
    const service = createBulkAllocationService(
      candidateClient([[tutor], [candidateRow(1, { weeklyLimit: 6, usedHours: 0 })]]),
      async () => [
        requirement({ id: 100, shortageTutors: 2 }),
        requirement({
          id: 101,
          startsAt: "2030-09-05T10:00:00.000Z",
          endsAt: "2030-09-05T14:00:00.000Z",
          shortageTutors: 1,
        }),
      ],
      vi.fn(),
    );

    const items = await service.preview({
      requirementIds: [100, 101],
      minimumMark: 65,
    });

    // One place on the first requirement uses four of the six hours; two are
    // left, which is not enough for another four-hour place.
    expect(items[0]!.proposals.map((p) => p.tutorId)).toEqual([1]);
    expect(items[0]!.unfilled).toBe(1);
    expect(items[1]!.proposals).toHaveLength(0);
  });

  it("does not propose a tutor for two sessions running at the same time", async () => {
    const service = createBulkAllocationService(
      candidateClient([[candidateRow(1)], [candidateRow(1)]]),
      async () => [
        requirement({ id: 100, shortageTutors: 1 }),
        // Same four-hour window, a different course.
        requirement({ id: 101, courseId: 20, courseCode: "COMS3009", shortageTutors: 1 }),
      ],
      vi.fn(),
    );

    const items = await service.preview({
      requirementIds: [100, 101],
      minimumMark: 65,
    });

    expect(items[0]!.proposals.map((p) => p.tutorId)).toEqual([1]);
    expect(items[1]!.proposals).toHaveLength(0);
    expect(items[1]!.note).toMatch(/no further eligible tutor/i);
  });

  it("offers only eligible tutors as alternatives, and never the proposed ones", async () => {
    const service = createBulkAllocationService(
      candidateClient([
        [
          candidateRow(1),
          candidateRow(2),
          candidateRow(3, {
            isEligible: false,
            hasClash: true,
            reasonCodes: ["schedule-clash"],
          }),
        ],
      ]),
      async () => [requirement({ shortageTutors: 1 })],
      vi.fn(),
    );

    const [item] = await service.preview({
      requirementIds: [100],
      minimumMark: 65,
    });

    expect(item!.proposals.map((p) => p.tutorId)).toEqual([1]);
    expect(item!.alternatives.map((p) => p.tutorId)).toEqual([2]);
  });

  it("ignores requirements that are not open", async () => {
    const service = createBulkAllocationService(
      candidateClient([[candidateRow(1)]]),
      // The reader only ever returns open requirements.
      async (query) => (query.status === "OPEN" ? [] : [requirement()]),
      vi.fn(),
    );

    await expect(
      service.preview({ requirementIds: [100], minimumMark: 65 }),
    ).resolves.toEqual([]);
  });

  it("plans in the same order however the ids arrive", async () => {
    const rows = [[candidateRow(1)], [candidateRow(2)]];
    const build = () =>
      createBulkAllocationService(
        candidateClient(rows),
        async () => [
          requirement({ id: 101, startsAt: "2030-09-06T10:00:00.000Z", endsAt: "2030-09-06T14:00:00.000Z" }),
          requirement({ id: 100 }),
        ],
        vi.fn(),
      );

    const first = await build().preview({ requirementIds: [100, 101], minimumMark: 65 });
    const second = await build().preview({ requirementIds: [101, 100], minimumMark: 65 });

    expect(first.map((item) => item.requirementId)).toEqual([100, 101]);
    expect(second.map((item) => item.requirementId)).toEqual([100, 101]);
  });
});

describe("bulk allocation commit", () => {
  const acceptedItem = {
    requirementId: 100,
    tutorId: 1,
    proposedTutorId: 1,
  };

  function commitService(
    createAllocation: ReturnType<typeof vi.fn>,
    requirements = [requirement()],
  ) {
    return createBulkAllocationService(
      candidateClient([]),
      async () => requirements,
      createAllocation as unknown as Parameters<
        typeof createBulkAllocationService
      >[2],
    );
  }

  async function commit(
    service: ReturnType<typeof commitService>,
    items: BulkAllocationCommitInput["items"],
  ) {
    return service.commit("auth0|organiser", { minimumMark: 65, items });
  }

  it("saves an accepted proposal with the requirement's own course, window and hours", async () => {
    const createAllocation = vi.fn().mockResolvedValue({ id: 41 });

    await expect(commit(commitService(createAllocation), [acceptedItem])).resolves.toEqual([
      { requirementId: 100, tutorId: 1, outcome: "saved", allocationId: 41 },
    ]);
    expect(createAllocation).toHaveBeenCalledWith("auth0|organiser", {
      tutorId: 1,
      courseId: 10,
      startsAt: new Date("2030-09-04T10:00:00.000Z"),
      endsAt: new Date("2030-09-04T14:00:00.000Z"),
      minimumMark: 65,
      requestedHours: 4,
      status: "CONFIRMED",
    });
  });

  it("stores the reason when the organiser chose someone else", async () => {
    const createAllocation = vi.fn().mockResolvedValue({ id: 42 });

    await commit(commitService(createAllocation), [
      {
        requirementId: 100,
        tutorId: 9,
        proposedTutorId: 1,
        overrideReason: "Sam knows this lab.",
      },
    ]);

    expect(createAllocation.mock.calls[0]![1]).toMatchObject({
      tutorId: 9,
      overrideReason: "Sam knows this lab.",
    });
  });

  it("refuses a changed tutor with no reason and saves nothing for that item", async () => {
    const createAllocation = vi.fn();

    await expect(
      commit(commitService(createAllocation), [
        { requirementId: 100, tutorId: 9, proposedTutorId: 1 },
      ]),
    ).resolves.toEqual([
      {
        requirementId: 100,
        tutorId: 9,
        outcome: "failed",
        code: "OVERRIDE_REASON_REQUIRED",
        message: expect.stringContaining("needs a reason"),
      },
    ]);
    expect(createAllocation).not.toHaveBeenCalled();
  });

  it("never asks an organiser to justify a suggestion they accepted", async () => {
    // Saving the first item changes the ranking, but an accepted proposal is
    // recognised by what the organiser was shown, not by re-ranking.
    const createAllocation = vi.fn().mockResolvedValue({ id: 43 });

    const results = await commit(commitService(createAllocation), [
      { requirementId: 100, tutorId: 1, proposedTutorId: 1 },
      { requirementId: 100, tutorId: 2, proposedTutorId: 2 },
    ]);

    expect(results.every((result) => result.outcome === "saved")).toBe(true);
    for (const call of createAllocation.mock.calls) {
      expect(call[1]).not.toHaveProperty("overrideReason");
    }
  });

  it("keeps saving the rest when one item fails its rule check", async () => {
    const createAllocation = vi
      .fn()
      .mockResolvedValueOnce({ id: 44 })
      .mockRejectedValueOnce(
        Object.assign(new Error("The tutor has a timetable clash for this allocation."), {
          status: 409,
          code: "schedule-clash",
        }),
      )
      .mockResolvedValueOnce({ id: 45 });

    const results = await commit(commitService(createAllocation), [
      { requirementId: 100, tutorId: 1, proposedTutorId: 1 },
      { requirementId: 100, tutorId: 2, proposedTutorId: 2 },
      { requirementId: 100, tutorId: 3, proposedTutorId: 3 },
    ]);

    expect(results.map((result) => result.outcome)).toEqual([
      "saved",
      "failed",
      "saved",
    ]);
    expect(results[1]).toMatchObject({
      code: "schedule-clash",
      message: "The tutor has a timetable clash for this allocation.",
    });
  });

  it("reports an ineligible tutor as the rules refused them, reason or not", async () => {
    const createAllocation = vi.fn().mockRejectedValue(
      Object.assign(new Error("The tutor does not meet the allocation mark requirement."), {
        status: 409,
        code: "insufficient-mark",
      }),
    );

    const results = await commit(commitService(createAllocation), [
      {
        requirementId: 100,
        tutorId: 9,
        proposedTutorId: 1,
        overrideReason: "I want them anyway.",
      },
    ]);

    expect(results[0]).toMatchObject({
      outcome: "failed",
      code: "insufficient-mark",
    });
  });

  it("hides the detail of an unexpected failure", async () => {
    const createAllocation = vi
      .fn()
      .mockRejectedValue(new Error("connection string and password"));

    const results = await commit(commitService(createAllocation), [acceptedItem]);

    expect(results[0]).toMatchObject({
      outcome: "failed",
      code: "INTERNAL_ERROR",
      message: "This allocation could not be saved.",
    });
    expect(JSON.stringify(results)).not.toContain("password");
  });

  it("reports a requirement that closed since the preview", async () => {
    const createAllocation = vi.fn();

    const results = await commit(commitService(createAllocation, []), [acceptedItem]);

    expect(results[0]).toMatchObject({
      outcome: "failed",
      code: "STAFFING_REQUIREMENT_NOT_FOUND",
    });
    expect(createAllocation).not.toHaveBeenCalled();
  });
});

describe("preview writes nothing, against a real database", () => {
  let database: PGlite;
  let service: ReturnType<typeof createBulkAllocationService>;

  async function snapshot() {
    const result = await database.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`);
    const counts: Record<string, number> = {};
    for (const { table_name } of result.rows) {
      const rows = await database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "${table_name}"`,
      );
      counts[table_name] = rows.rows[0]!.count;
    }
    return counts;
  }

  beforeAll(async () => {
    database = new PGlite();
    const directories = (await readdir(migrationsPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const directory of directories) {
      await database.exec(
        await readFile(`${migrationsPath}/${directory}/migration.sql`, "utf8"),
      );
    }
  }, 60_000);

  afterAll(async () => {
    await database?.close();
  });

  beforeEach(async () => {
    await database.exec(`
      TRUNCATE "StaffingRequirement", "Allocation", "TutorMark", "TutorHourLimit",
        "Course", "Profile" RESTART IDENTITY CASCADE;

      INSERT INTO "Profile" ("id","auth0Id","email","fullName","role","updatedAt") VALUES
        (1, 'auth0|tutor-1', 't1@tutormx.example', 'Tutor One', 'TUTOR', now()),
        (2, 'auth0|tutor-2', 't2@tutormx.example', 'Tutor Two', 'TUTOR', now()),
        (3, 'auth0|organiser', 'o@tutormx.example', 'Organiser', 'ORGANISER', now());
      INSERT INTO "Course" ("id","code","name","updatedAt")
        VALUES (10, 'COMS3011', 'Software Design Project', now());
      INSERT INTO "TutorMark" ("tutorId","courseId","mark") VALUES (1, 10, 90), (2, 10, 85);
      INSERT INTO "TutorHourLimit" ("tutorId","weeklyHours") VALUES (1, 20), (2, 20);
      INSERT INTO "StaffingRequirement"
        ("id","courseId","startsAt","endsAt","tutorsNeeded","createdById","updatedAt")
      VALUES (100, 10, '2030-09-04 10:00', '2030-09-04 14:00', 2, 3, now());
    `);

    const queryClient: QueryClient = {
      async query<Row>(sql: string, parameters?: unknown[]) {
        const result = await database.query(sql, parameters);
        return { rows: result.rows as Row[] };
      },
    };

    service = createBulkAllocationService(
      queryClient,
      async () => [requirement()],
      // A writer that would throw if preview ever reached for it.
      vi.fn(async () => {
        throw new Error("preview must not save anything");
      }),
    );
  });

  it("proposes real tutors and leaves every table exactly as it was", async () => {
    const before = await snapshot();

    const items = await service.preview({
      requirementIds: [100],
      minimumMark: 65,
    });

    // The proposals are real: both seeded tutors qualify and are ranked by mark.
    expect(items[0]!.proposals.map((proposal) => proposal.tutorId)).toEqual([1, 2]);
    expect(await snapshot()).toEqual(before);
    expect(before.Allocation).toBe(0);
  });
});
