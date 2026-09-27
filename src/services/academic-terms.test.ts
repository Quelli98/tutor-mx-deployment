import { describe, expect, it, vi } from "vitest";
import {
  createAcademicTermService,
  parseAcademicTermInput,
  toDateOnly,
} from "./academic-terms";

describe("academic-terms service", () => {
  describe("toDateOnly", () => {
    it("formats a UTC date as YYYY-MM-DD", () => {
      expect(toDateOnly(new Date("2030-09-02T00:00:00.000Z"))).toBe("2030-09-02");
    });
  });

  describe("parseAcademicTermInput", () => {
    it("rejects non-object input", () => {
      expect(parseAcademicTermInput(null)).toHaveProperty("error");
      expect(parseAcademicTermInput("string")).toHaveProperty("error");
      expect(parseAcademicTermInput([])).toHaveProperty("error");
    });

    it("rejects unrecognised fields", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "2030-01-01",
        endsOn: "2030-03-01",
        unknown: "field",
      });
      expect(result).toHaveProperty("error");
    });

    it("validates term name length", () => {
      const result = parseAcademicTermInput({
        name: "",
        startsOn: "2030-01-01",
        endsOn: "2030-03-01",
      });
      expect(result).toHaveProperty("error");
    });

    it("validates date format", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "invalid",
        endsOn: "2030-03-01",
      });
      expect(result).toHaveProperty("error");
    });

    it("validates end date is after start date", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "2030-03-01",
        endsOn: "2030-01-01",
      });
      expect(result).toHaveProperty("error");
    });

    it("validates year range", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "2030-01-01",
        endsOn: "2030-03-01",
        year: 1999,
        termNumber: 1,
      });
      expect(result).toHaveProperty("error");
    });

    it("validates term number range", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "2030-01-01",
        endsOn: "2030-03-01",
        year: 2030,
        termNumber: 5,
      });
      expect(result).toHaveProperty("error");
    });

    it("requires both year and termNumber or neither", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "2030-01-01",
        endsOn: "2030-03-01",
        year: 2030,
      });
      expect(result).toHaveProperty("error");
    });

    it("validates published is boolean", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "2030-01-01",
        endsOn: "2030-03-01",
        published: "yes",
      });
      expect(result).toHaveProperty("error");
    });

    it("accepts valid input", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "2030-01-01",
        endsOn: "2030-03-01",
        year: 2030,
        termNumber: 1,
        published: true,
      });
      expect(result).toHaveProperty("value");
      if ("value" in result) {
        expect(result.value.name).toBe("Term 1");
      }
    });

    it("validates teaching breaks", () => {
      const result = parseAcademicTermInput({
        name: "Term 1",
        startsOn: "2030-01-01",
        endsOn: "2030-03-01",
        teachingBreaks: [{ startsOn: "invalid" }],
      });
      expect(result).toHaveProperty("error");
    });
  });

  describe("createAcademicTermService", () => {
    it("lists terms", async () => {
      const mockPrisma = {
        academicTerm: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn(),
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      };
      const service = createAcademicTermService(mockPrisma);
      const result = await service.list();
      expect(result).toEqual([]);
    });

    it("lists published terms", async () => {
      const mockPrisma = {
        academicTerm: {
          findMany: vi.fn().mockResolvedValue([]),
          findUnique: vi.fn(),
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
      };
      const service = createAcademicTermService(mockPrisma);
      const result = await service.listPublished();
      expect(result).toEqual([]);
    });
  });
});
