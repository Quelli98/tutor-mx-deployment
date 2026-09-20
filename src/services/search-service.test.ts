import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "./allocation-queries.js";
import { createSearchService } from "./search-service.js";

interface StubResponse {
  match: RegExp;
  rows: unknown[];
}

function stubClient(responses: StubResponse[]): {
  client: QueryClient;
  calls: Array<{ sql: string; parameters: unknown[] }>;
} {
  const calls: Array<{ sql: string; parameters: unknown[] }> = [];
  const client: QueryClient = {
    async query<Row>(sql: string, parameters: unknown[] = []) {
      calls.push({ sql, parameters });
      const response = responses.find((entry) => entry.match.test(sql));
      return { rows: (response?.rows ?? []) as Row[] };
    },
  };
  return { client, calls };
}

describe("createSearchService", () => {
  it("searches organiser courses, people and timesheets with bounded queries", async () => {
    const { client, calls } = stubClient([
      { match: /FROM "Course"/u, rows: [{ id: 1, code: "COMS3011A", name: "Design" }] },
      { match: /FROM "Profile"/u, rows: [{ id: 5, fullName: "Ada", role: "TUTOR" }] },
      {
        match: /FROM "Timesheet"/u,
        rows: [
          { id: 9, status: "SUBMITTED", weekStart: "2026-09-14", tutorName: "Ada" },
        ],
      },
    ]);
    const service = createSearchService(client);

    const response = await service.search(
      { id: 1, role: "ORGANISER" },
      { term: "a", categories: ["course", "person", "timesheet"], page: 1, pageSize: 10 },
    );

    expect(response.groups.map((group) => group.category)).toEqual([
      "course",
      "person",
      "timesheet",
    ]);
    expect(response.total).toBe(3);
    // Every query is bounded by a LIMIT/OFFSET pair.
    for (const call of calls) {
      expect(call.sql).toMatch(/LIMIT \$2 OFFSET \$3/u);
      expect(call.parameters[0]).toBe("%a%");
      expect(call.parameters[1]).toBe(10);
    }
  });

  it("scopes tutor timesheets to the tutor's own profile id", async () => {
    const { client, calls } = stubClient([
      { match: /FROM "Course"/u, rows: [] },
      {
        match: /FROM "Timesheet"/u,
        rows: [
          { id: 2, status: "RETURNED", weekStart: "2026-09-14", tutorName: "Self" },
        ],
      },
    ]);
    const service = createSearchService(client);

    await service.search(
      { id: 77, role: "TUTOR" },
      { term: "ret", categories: ["course", "timesheet"], page: 1, pageSize: 10 },
    );

    const timesheetCall = calls.find((call) => /FROM "Timesheet"/u.test(call.sql));
    expect(timesheetCall?.sql).toMatch(/t\."tutorId" = \$4/u);
    expect(timesheetCall?.parameters[3]).toBe(77);
  });

  it("never queries people or timesheets for a student request", async () => {
    const { client, calls } = stubClient([
      { match: /FROM "Course"/u, rows: [] },
      { match: /FROM "VolunteerClaim"/u, rows: [{ id: 3, status: "PENDING", courseCode: "C", courseName: "Course" }] },
    ]);
    const service = createSearchService(client);

    // Even if a disallowed category slips through, the service ignores it.
    const response = await service.search(
      { id: 42, role: "STUDENT" },
      {
        term: "co",
        categories: ["course", "volunteer", "person", "timesheet"] as never,
        page: 1,
        pageSize: 10,
      },
    );

    expect(calls.some((call) => /FROM "Profile"/u.test(call.sql))).toBe(false);
    expect(calls.some((call) => /FROM "Timesheet"/u.test(call.sql))).toBe(false);
    const volunteerCall = calls.find((call) =>
      /FROM "VolunteerClaim"/u.test(call.sql),
    );
    expect(volunteerCall?.parameters[3]).toBe(42);
    expect(response.groups.map((group) => group.category)).toEqual(["volunteer"]);
  });

  it("applies the page offset for pagination", async () => {
    const { client, calls } = stubClient([{ match: /FROM "Course"/u, rows: [] }]);
    const service = createSearchService(client);

    await service.search(
      { id: 1, role: "ORGANISER" },
      { term: "co", categories: ["course"], page: 3, pageSize: 5 },
    );

    const courseCall = calls.find((call) => /FROM "Course"/u.test(call.sql));
    expect(courseCall?.parameters[1]).toBe(5);
    expect(courseCall?.parameters[2]).toBe(10);
  });

  it("escapes like wildcards in the search term", async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [] });
    const client: QueryClient = { query: querySpy };
    const service = createSearchService(client);

    await service.search(
      { id: 1, role: "ORGANISER" },
      { term: "50%_x", categories: ["course"], page: 1, pageSize: 10 },
    );

    expect(querySpy.mock.calls[0]![1][0]).toBe("%50\\%\\_x%");
  });
});
