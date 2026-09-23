/**
 * The one definition of what a valid tutor schedule entry looks like.
 *
 * Both entry paths use this: the manual form (through parseTutorTimeSlotInput
 * in src/app.ts) and the timetable import (src/services/timetable-import.ts).
 * The import must produce schedule entries that are indistinguishable from
 * hand-entered ones, and the only way to guarantee that is to validate and
 * normalise them with the same code rather than with a near-copy that drifts.
 *
 * Nothing here reads the request or the database; it takes already-parsed
 * values and returns either the write payload or the message to show.
 */

/** A weekly entry may not span more than one week. */
export const MAX_WEEKLY_TIME_SLOT_MS = 7 * 24 * 60 * 60 * 1000;

/** Label length accepted by the manual form and the import alike. */
export const MAX_TIME_SLOT_LABEL_LENGTH = 120;

/** Kept identical to the message the manual form has always returned. */
export const TIME_SLOT_RULE_MESSAGE =
  "Enter a valid schedule interval, label (up to 120 characters) and weekly recurrence end.";

export type TimeSlotTypeValue = "AVAILABLE" | "BUSY";
export type TimeSlotRecurrenceValue = "WEEKLY";

export interface TimeSlotRuleFields {
  type: unknown;
  /** Parsed start instant, or null when absent/unparseable. */
  startsAt: Date | null;
  /** Parsed end instant, or null when absent/unparseable. */
  endsAt: Date | null;
  /** Raw recurrence value: undefined when the caller sent no key at all. */
  recurrence: unknown;
  /** True when the caller's payload carried a "label" key. */
  labelSupplied: boolean;
  /** The label, already trimmed when it was a string. */
  label: unknown;
  /** True when the caller's payload carried a "recurrenceUntil" key. */
  recurrenceUntilSupplied: boolean;
  /** True when that key was present and not null. Drives validation. */
  recurrenceUntilProvided: boolean;
  /** Parsed repeat-until instant, or null when absent/null/unparseable. */
  recurrenceUntil: Date | null;
}

export interface TimeSlotRuleValue {
  type: TimeSlotTypeValue;
  startsAt: Date;
  endsAt: Date;
  recurrence?: TimeSlotRecurrenceValue;
  label?: string | null;
  recurrenceUntil?: Date | null;
}

export type TimeSlotRuleResult =
  | { error: string }
  | { value: TimeSlotRuleValue };

/**
 * Mirrors the rules the schedule has always enforced, in the same order, so no
 * previously valid entry becomes invalid and no previously rejected one passes.
 */
export function checkTimeSlotRules(
  fields: TimeSlotRuleFields,
): TimeSlotRuleResult {
  const {
    type,
    startsAt,
    endsAt,
    recurrence,
    labelSupplied,
    label,
    recurrenceUntilSupplied,
    recurrenceUntilProvided,
    recurrenceUntil,
  } = fields;

  if (
    (type !== "AVAILABLE" && type !== "BUSY") ||
    !startsAt ||
    !endsAt ||
    endsAt <= startsAt ||
    (recurrence !== undefined && recurrence !== "WEEKLY") ||
    (recurrence === "WEEKLY" &&
      endsAt.valueOf() - startsAt.valueOf() > MAX_WEEKLY_TIME_SLOT_MS) ||
    (labelSupplied &&
      label !== null &&
      (typeof label !== "string" || label.length > MAX_TIME_SLOT_LABEL_LENGTH)) ||
    (recurrenceUntilProvided &&
      (!recurrenceUntil ||
        recurrence !== "WEEKLY" ||
        recurrenceUntil < startsAt))
  ) {
    return { error: TIME_SLOT_RULE_MESSAGE };
  }

  // Presence is preserved deliberately: an explicit null label and an omitted
  // label must keep meaning the same thing they always have.
  return {
    value: {
      type,
      startsAt,
      endsAt,
      ...(recurrence === "WEEKLY" ? { recurrence } : {}),
      ...(labelSupplied ? { label: label as string | null } : {}),
      ...(recurrenceUntilSupplied ? { recurrenceUntil } : {}),
    },
  };
}
