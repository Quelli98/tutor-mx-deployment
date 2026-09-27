import { describe, expect, it, vi } from "vitest";
import {
  createAcademicTermService,
  parseAcademicTermInput,
  toDateOnly,
} from "./academic-terms.js";

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

const validTerm = { name: 'Term 1', startsOn: '2030-01-01', endsOn: '2030-03-01' };
const savedTerm = {
  id: 7, ...validTerm,
  startsOn: new Date('2030-01-01T00:00:00Z'), endsOn: new Date('2030-03-01T00:00:00Z'),
  year: 2030, termNumber: 1, published: true,
  teachingBreaks: [{ startsOn: '2030-02-01', endsOn: '2030-02-03', label: 'Break' }],
};
function termStore() {
  const academicTerm = {
    findMany: vi.fn().mockResolvedValue([savedTerm]),
    findUnique: vi.fn().mockResolvedValue(savedTerm),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async ({ data }) => ({ ...savedTerm, ...data })),
    update: vi.fn().mockImplementation(async ({ data }) => ({ ...savedTerm, ...data })),
    delete: vi.fn().mockResolvedValue(savedTerm),
  };
  return { academicTerm, service: createAcademicTermService({ academicTerm }) };
}

describe('academic-term validation and persistence regressions', () => {
  it.each([
    { name: 5 }, { name: 'x'.repeat(121) }, { startsOn: 2030 },
    { startsOn: '2030-02-30' }, { endsOn: '2030-13-01' },
    { year: '2030', termNumber: 1 }, { year: 2030.5, termNumber: 1 },
    { year: 2101, termNumber: 1 }, { year: 2030, termNumber: '1' },
    { year: 2030, termNumber: 1.5 }, { year: 2030, termNumber: 0 },
    { termNumber: 1 }, { year: null, termNumber: 1 },
    { teachingBreaks: {} }, { teachingBreaks: [null] },
    { teachingBreaks: [{ startsOn: '2030-02-03', endsOn: '2030-02-01' }] },
    { teachingBreaks: [{ startsOn: '2030-02-01', endsOn: 'bad' }] },
  ])('rejects invalid input %j', (fields) => {
    expect(parseAcademicTermInput({ ...validTerm, ...fields })).toHaveProperty('error');
  });

  it('keeps explicit clearing separate from omitted optional fields', () => {
    expect(parseAcademicTermInput({ ...validTerm, name: ' Term 1 ', year: null, termNumber: null,
      published: false, teachingBreaks: [] })).toEqual({ value: {
      ...validTerm, year: null, termNumber: null, published: false, teachingBreaks: [],
    } });
    expect(parseAcademicTermInput(validTerm)).toEqual({ value: validTerm });
  });

  it('normalises teaching-break labels and supports unlabelled breaks', () => {
    const dates = { startsOn: '2030-02-01', endsOn: '2030-02-02' };
    expect(parseAcademicTermInput({ ...validTerm, teachingBreaks: [
      { ...dates, label: ' Break ' }, { ...dates, label: ' ' }, dates,
    ] })).toEqual({ value: { ...validTerm, teachingBreaks: [
      { ...dates, label: 'Break' }, dates, dates,
    ] } });
  });

  it('serialises dates and publishes only visible terms', async () => {
    const { service, academicTerm } = termStore();
    academicTerm.findMany.mockResolvedValue([
      savedTerm, { ...savedTerm, id: 8, published: false, teachingBreaks: null },
      { ...savedTerm, id: 9, teachingBreaks: [null, 'bad', {},
        { startsOn: '2030-02-01', endsOn: '2030-02-02' }] },
    ]);
    const rows = await service.list();
    expect(rows[0]).toMatchObject({ ...validTerm, published: true, teachingBreaks: savedTerm.teachingBreaks });
    expect(rows[1]!.teachingBreaks).toEqual([]);
    expect(rows[2]!.teachingBreaks).toEqual([{ startsOn: '2030-02-01', endsOn: '2030-02-02' }]);
    expect((await service.listPublished()).map((row) => row.id)).toEqual([7, 9]);
  });

  it('creates an unpublished term with default empty breaks', async () => {
    const { service, academicTerm } = termStore();
    await expect(service.create(validTerm)).resolves.toMatchObject({ published: false, teachingBreaks: [] });
    expect(academicTerm.create).toHaveBeenCalledWith(expect.objectContaining({ data: {
      name: validTerm.name, startsOn: savedTerm.startsOn, endsOn: savedTerm.endsOn,
      published: false, teachingBreaks: [],
    } }));
  });

  it('creates a structured, published term and checks its unique year/number', async () => {
    const { service, academicTerm } = termStore();
    await service.create({ ...validTerm, year: 2030, termNumber: 1, published: true,
      teachingBreaks: savedTerm.teachingBreaks });
    expect(academicTerm.findFirst).toHaveBeenLastCalledWith({ where: { year: 2030, termNumber: 1 }, select: { id: true } });
    expect(academicTerm.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      year: 2030, termNumber: 1, published: true, teachingBreaks: savedTerm.teachingBreaks,
    }) }));
  });

  it.each(['create', 'update'] as const)('refuses overlapping dates during %s', async (operation) => {
    const { service, academicTerm } = termStore();
    academicTerm.findFirst.mockResolvedValueOnce({ id: 9 });
    const action = operation === 'create' ? service.create(validTerm) : service.update(7, validTerm);
    await expect(action).rejects.toThrow('Terms may not overlap');
    expect(academicTerm.create).not.toHaveBeenCalled();
    expect(academicTerm.update).not.toHaveBeenCalled();
  });

  it.each(['create', 'update'] as const)('refuses duplicate year and term during %s', async (operation) => {
    const { service, academicTerm } = termStore();
    academicTerm.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9 });
    const input = { ...validTerm, year: 2030, termNumber: 1 };
    await expect(operation === 'create' ? service.create(input) : service.update(7, input))
      .rejects.toThrow('Year 2030 term 1 is already assigned');
    expect(academicTerm.create).not.toHaveBeenCalled();
    expect(academicTerm.update).not.toHaveBeenCalled();
  });

  it('refuses to update a missing term', async () => {
    const { service, academicTerm } = termStore();
    academicTerm.findUnique.mockResolvedValueOnce(null);
    await expect(service.update(77, validTerm)).rejects.toThrow('Term not found');
    expect(academicTerm.update).not.toHaveBeenCalled();
  });

  it('preserves publication, breaks and year/term when only dates or name change', async () => {
    const { service, academicTerm } = termStore();
    await expect(service.update(7, { ...validTerm, name: 'Renamed' })).resolves.toMatchObject({
      name: 'Renamed', published: true, year: 2030, termNumber: 1, teachingBreaks: savedTerm.teachingBreaks,
    });
    expect(academicTerm.update.mock.calls[0]![0].data).toEqual({
      name: 'Renamed', startsOn: savedTerm.startsOn, endsOn: savedTerm.endsOn,
    });
    expect(academicTerm.findFirst).toHaveBeenLastCalledWith({
      where: { id: { not: 7 }, year: 2030, termNumber: 1 }, select: { id: true },
    });
  });

  it('allows explicitly clearing breaks, unpublishing and clearing the year/term pair', async () => {
    const { service } = termStore();
    await expect(service.update(7, { ...validTerm, published: false, teachingBreaks: [], year: null, termNumber: null }))
      .resolves.toMatchObject({ published: false, teachingBreaks: [], year: null, termNumber: null });
  });

  it('removes the requested term and propagates a failed deletion', async () => {
    const { service, academicTerm } = termStore();
    await service.remove(7);
    expect(academicTerm.delete).toHaveBeenCalledWith({ where: { id: 7 } });
    academicTerm.delete.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(service.remove(7)).rejects.toThrow('Database unavailable');
  });
});
