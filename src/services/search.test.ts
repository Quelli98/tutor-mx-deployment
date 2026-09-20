import { describe, expect, it } from "vitest";
import {
  allowedCategoriesForRole,
  clampSearchPage,
  clampSearchPageSize,
  DEFAULT_SEARCH_PAGE_SIZE,
  groupSearchResults,
  isValidSearchTerm,
  linkPathFor,
  MAX_SEARCH_PAGE_SIZE,
  normalizeSearchTerm,
  resolveSearchCategories,
  toCourseResult,
  toPersonResult,
  toTimesheetResult,
  toVolunteerResult,
  type SearchResultItem,
} from "./search.js";

describe("normalizeSearchTerm", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeSearchTerm("  co  ")).toBe("co");
    expect(normalizeSearchTerm("a\tb")).toBe("a b");
  });

  it("returns an empty string for non-string input", () => {
    expect(normalizeSearchTerm(undefined)).toBe("");
    expect(normalizeSearchTerm(42)).toBe("");
    expect(normalizeSearchTerm(null)).toBe("");
  });
});

describe("isValidSearchTerm", () => {
  it("rejects terms below the two character minimum", () => {
    expect(isValidSearchTerm("")).toBe(false);
    expect(isValidSearchTerm("a")).toBe(false);
  });

  it("accepts a term at the minimum length", () => {
    expect(isValidSearchTerm("ab")).toBe(true);
  });

  it("rejects a term over the maximum length", () => {
    expect(isValidSearchTerm("x".repeat(101))).toBe(false);
    expect(isValidSearchTerm("x".repeat(100))).toBe(true);
  });
});

describe("allowedCategoriesForRole", () => {
  it("maps each role to its permitted categories", () => {
    expect(allowedCategoriesForRole("ORGANISER")).toEqual([
      "course",
      "person",
      "timesheet",
    ]);
    expect(allowedCategoriesForRole("TUTOR")).toEqual(["course", "timesheet"]);
    expect(allowedCategoriesForRole("STUDENT")).toEqual(["course", "volunteer"]);
  });
});

describe("resolveSearchCategories", () => {
  it("removes categories the role may not search", () => {
    // A tutor asking for people/timesheets keeps only timesheet.
    expect(resolveSearchCategories("TUTOR", "person,timesheet")).toEqual([
      "timesheet",
    ]);
  });

  it("never widens a student request to another role's categories", () => {
    expect(resolveSearchCategories("STUDENT", "person,timesheet")).toEqual([
      "course",
      "volunteer",
    ]);
  });

  it("defaults to all allowed categories when none are requested", () => {
    expect(resolveSearchCategories("ORGANISER", "")).toEqual([
      "course",
      "person",
      "timesheet",
    ]);
    expect(resolveSearchCategories("ORGANISER", undefined)).toEqual([
      "course",
      "person",
      "timesheet",
    ]);
  });

  it("ignores unknown and duplicate category tokens", () => {
    expect(resolveSearchCategories("ORGANISER", "course,course,bogus")).toEqual([
      "course",
    ]);
  });
});

describe("paging clamps", () => {
  it("clamps the page to at least one", () => {
    expect(clampSearchPage("0")).toBe(1);
    expect(clampSearchPage(-5)).toBe(1);
    expect(clampSearchPage("3")).toBe(3);
    expect(clampSearchPage("not-a-number")).toBe(1);
  });

  it("caps the page size at the maximum", () => {
    expect(clampSearchPageSize("500")).toBe(MAX_SEARCH_PAGE_SIZE);
    expect(clampSearchPageSize(0)).toBe(1);
    expect(clampSearchPageSize(undefined)).toBe(DEFAULT_SEARCH_PAGE_SIZE);
    expect(clampSearchPageSize("10")).toBe(10);
  });
});

describe("linkPathFor", () => {
  it("routes courses by role", () => {
    expect(linkPathFor("course", "ORGANISER")).toBe("/organiser/courses");
    expect(linkPathFor("course", "TUTOR")).toBe("/tutor");
    expect(linkPathFor("course", "STUDENT")).toBe("/student");
  });

  it("routes timesheets by role and volunteers to the student page", () => {
    expect(linkPathFor("timesheet", "ORGANISER")).toBe("/organiser");
    expect(linkPathFor("timesheet", "TUTOR")).toBe("/tutor/forms");
    expect(linkPathFor("person", "ORGANISER")).toBe("/organiser/tutors");
    expect(linkPathFor("volunteer", "STUDENT")).toBe("/student");
  });
});

describe("result mappers", () => {
  it("maps a course without leaking extra fields", () => {
    expect(toCourseResult({ id: 1, code: "COMS3011A", name: "Software Design" }, "ORGANISER")).toEqual(
      {
        id: 1,
        category: "course",
        label: "COMS3011A",
        sublabel: "Software Design",
        linkPath: "/organiser/courses",
      },
    );
  });

  it("maps a person to name and role only, never email", () => {
    const result = toPersonResult(
      { id: 5, fullName: "Ada Tutor", role: "TUTOR" },
      "ORGANISER",
    );
    expect(result).toEqual({
      id: 5,
      category: "person",
      label: "Ada Tutor",
      sublabel: "TUTOR",
      linkPath: "/organiser/tutors",
    });
    expect(JSON.stringify(result)).not.toMatch(/@/u);
  });

  it("labels timesheets differently for organiser and tutor", () => {
    const row = {
      id: 3,
      status: "SUBMITTED",
      weekStart: "2026-09-14T00:00:00.000Z",
      tutorName: "Ada Tutor",
    };
    expect(toTimesheetResult(row, "ORGANISER").label).toBe(
      "Ada Tutor - week of 2026-09-14",
    );
    expect(toTimesheetResult(row, "TUTOR").label).toBe(
      "Timesheet week of 2026-09-14",
    );
  });

  it("maps a volunteer claim to safe course info", () => {
    expect(
      toVolunteerResult(
        { id: 8, status: "PENDING", courseCode: "COMS3011A", courseName: "Software Design" },
        "STUDENT",
      ),
    ).toEqual({
      id: 8,
      category: "volunteer",
      label: "COMS3011A volunteer work",
      sublabel: "Software Design - PENDING",
      linkPath: "/student",
    });
  });
});

describe("groupSearchResults", () => {
  const items: SearchResultItem[] = [
    { id: 1, category: "course", label: "C1", sublabel: "", linkPath: "/x" },
    { id: 2, category: "timesheet", label: "T1", sublabel: "", linkPath: "/y" },
    { id: 3, category: "course", label: "C2", sublabel: "", linkPath: "/x" },
  ];

  it("groups by category in the role's category order", () => {
    const groups = groupSearchResults("ORGANISER", items);
    expect(groups.map((group) => group.category)).toEqual([
      "course",
      "timesheet",
    ]);
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("returns no groups for an empty result set", () => {
    expect(groupSearchResults("STUDENT", [])).toEqual([]);
  });
});
