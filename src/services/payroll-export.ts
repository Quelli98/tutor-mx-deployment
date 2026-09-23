import type { PayrollExportRow, WorkloadReportQuery } from "../app.js";

/**
 * The columns of a payroll file, in the one order a payroll parser may rely on.
 * A template that maps by position is the normal way a file like this is read,
 * so the order is a contract: a column added in the middle would move every
 * field to its right under the wrong heading.
 */
export const PAYROLL_COLUMNS = [
  "period_start",
  "period_end",
  "tutor",
  "course_code",
  "course_name",
  "hours",
  "status",
] as const;

/** RFC 4180 quoting: quote only what has to be quoted, and double the quotes. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Hours keep at most two decimals, and never a trailing zero. */
function hours(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The payable lines as a payroll file. Only payable lines are passed in: work an
 * open dispute holds back is deliberately absent rather than present as a zero,
 * because a payroll run must never have to decide for itself whether a row is
 * owed. The header is always written, so a period with nothing payable is still
 * a readable file rather than an empty download.
 */
export function toPayrollCsv(rows: PayrollExportRow[]): string {
  const lines = [PAYROLL_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.periodStart,
        row.periodEnd,
        row.tutor,
        row.courseCode,
        row.courseName,
        hours(row.hours),
        row.status,
      ]
        .map(field)
        .join(","),
    );
  }
  // Every line ends the same way, the header included, so a reader that ignores
  // a trailing empty line and one that does not see the same rows.
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * The name a payroll run saves the file under. It carries the period covered, so
 * a folder of exports says which weeks each file holds without opening them.
 */
export function payrollFilename(query: WorkloadReportQuery): string {
  const week = query.weekStart.toISOString().slice(0, 10);
  return `tutor-mx-payroll-${week}-${query.weeks}-week.csv`;
}
