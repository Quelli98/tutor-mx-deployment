import { describe, expect, it } from "vitest";
import { normalizeTutorRole } from "./contract.js";

describe("normalizeTutorRole", () => {
  it.each([
    ["organizer", "ORGANISER"],
    [" ORGANISER ", "ORGANISER"],
    ["mentor", "TUTOR"],
    ["tutor", "TUTOR"],
    ["learner", "STUDENT"],
    ["student", "STUDENT"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeTutorRole(input)).toBe(expected);
  });

  it.each([null, undefined, 7, "ADMIN", ""])(
    "rejects an unsupported role value",
    (input) => {
      expect(normalizeTutorRole(input)).toBeNull();
    },
  );
});
