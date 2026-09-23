import { describe, expect, it } from "vitest";
import type { PayrollExportRow } from "../app.js";
import {
  PAYROLL_COLUMNS,
  payrollFilename,
  toPayrollCsv,
} from "./payroll-export.js";

/**
 * The file itself, with no database involved: payroll reads this by position, so
 * the order of the columns and the shape of every field are the contract.
 */

function row(overrides: Partial<PayrollExportRow> = {}): PayrollExportRow {
  return {
    periodStart: "2030-09-02",
    periodEnd: "2030-09-08",
    tutorId: 7,
    tutor: "Ada Tutor",
    courseCode: "COMS3011",
    courseName: "Software Design Project",
    hours: 2.5,
    status: "APPROVED",
    held: false,
    ...overrides,
  };
}

/** The lines of a file, read the way a payroll parser reads them. */
function lines(csv: string): string[] {
  return csv.split("\r\n").filter((line) => line !== "");
}

const header = "period_start,period_end,tutor,course_code,course_name,hours,status";

describe("the payroll file", () => {
  it("writes the agreed columns in the agreed order", () => {
    expect(lines(toPayrollCsv([row()]))[0]).toBe(header);
    expect([...PAYROLL_COLUMNS]).toEqual(header.split(","));
  });

  it("writes one line per payable row, in the order it was given them", () => {
    const csv = toPayrollCsv([
      row({ tutor: "Ada Tutor" }),
      row({ tutor: "Ben Tutor", hours: 3 }),
    ]);

    expect(lines(csv)).toEqual([
      header,
      "2030-09-02,2030-09-08,Ada Tutor,COMS3011,Software Design Project,2.5,APPROVED",
      "2030-09-02,2030-09-08,Ben Tutor,COMS3011,Software Design Project,3,APPROVED",
    ]);
  });

  it("is still a readable file when nothing is payable", () => {
    // A period with no approved work is an answer, not an empty download.
    expect(lines(toPayrollCsv([]))).toEqual([header]);
  });

  it("marks every line as approved", () => {
    const data = lines(toPayrollCsv([row(), row({ tutor: "Ben Tutor" })]))[1];

    expect(data.endsWith(",APPROVED")).toBe(true);
  });

  it("prints hours without trailing zeros", () => {
    const [, whole, half, quarters] = lines(
      toPayrollCsv([
        row({ hours: 3 }),
        row({ hours: 2.5 }),
        row({ hours: 1.25 }),
      ]),
    );

    expect(whole.split(",")[5]).toBe("3");
    expect(half.split(",")[5]).toBe("2.5");
    expect(quarters.split(",")[5]).toBe("1.25");
  });

  it("quotes a name that holds a comma or a quote, and doubles the quote", () => {
    const [, data] = lines(
      toPayrollCsv([row({ tutor: 'Nkosi, "Nate"' })]),
    );

    expect(data).toContain('"Nkosi, ""Nate"""');
  });

  it("keeps a line to one line even when a field holds a break", () => {
    // A parser reading line by line must not see half a row.
    const csv = toPayrollCsv([row({ courseName: "Software\nDesign" })]);

    expect(lines(csv)).toHaveLength(2);
    expect(lines(csv)[1]).toContain('"Software\nDesign"');
  });

  it("gives every line as many fields as the header", () => {
    const rows = [
      row(),
      row({ tutor: 'Nkosi, "Nate"', courseName: "Software, Design" }),
      row({ hours: 12.5 }),
    ];

    for (const line of lines(toPayrollCsv(rows)).slice(1)) {
      // Counted outside quotes, which is what a positional parser does.
      const fields = line.match(/(?:^|,)(?:"(?:[^"]|"")*"|[^,]*)/g) ?? [];
      expect(fields).toHaveLength(PAYROLL_COLUMNS.length);
    }
  });

  it("ends every line the same way", () => {
    expect(toPayrollCsv([row()]).endsWith("\r\n")).toBe(true);
  });
});

describe("the downloaded name", () => {
  it("names the period the file covers", () => {
    expect(
      payrollFilename({
        weekStart: new Date("2030-09-02T00:00:00.000Z"),
        weeks: 4,
      }),
    ).toBe("tutor-mx-payroll-2030-09-02-4-week.csv");
  });

  it("stays a value a header can carry without escaping", () => {
    // The name goes into Content-Disposition: quotes, commas or newlines there
    // would end the filename early or break the header.
    const name = payrollFilename({
      weekStart: new Date("2030-09-02T00:00:00.000Z"),
      weeks: 52,
    });

    expect(name).toMatch(/^[a-z0-9.-]+$/);
  });
});
