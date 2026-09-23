-- Sprint 3 Member 2: a session window cannot be longer than one working day.
--
-- Nothing bounded the window itself. "Allocation_valid_period" only requires the
-- end to be after the start, and "Allocation_hours_within_window" only caps the
-- hours against the window, so a 1 September to 1 October booking carrying two
-- hours satisfied every rule. It reached production: a tutor's excuse dropdown
-- was empty because that session's start had silently moved a month into the
-- past while its end stayed put.
--
-- Eight hours is a working day's worth of contact time. It is double the longest
-- window recorded so far (four hours), so it constrains nothing real, while a
-- window that spans days becomes impossible to save.
--
-- Deliberately not added: a rule that a session or requirement must be in the
-- future. Editing a past allocation is legitimate.

-- Existing historical rows are preserved. NOT VALID enforces the bound on new
-- and updated rows without rejecting an environment that contains older,
-- longer sessions. Clean up historical records through an explicit reviewed
-- data correction before validating the constraint in a later migration.

ALTER TABLE "Allocation"
  ADD CONSTRAINT "Allocation_within_maximum_session_length"
  CHECK (
    EXTRACT(EPOCH FROM ("endsAt" - "startsAt")) / 3600 <= 8
  ) NOT VALID;

-- The same bound on staffing requirements, where an unbounded window is worse
-- rather than merely wrong: required hours are derived as window x tutorsNeeded,
-- so a month-long requirement would report about 1,440 hours short and send the
-- bulk allocator trying to book 722 hours per tutor - which the allocation
-- rules above would then refuse one by one.
--
ALTER TABLE "StaffingRequirement"
  ADD CONSTRAINT "StaffingRequirement_within_maximum_session_length"
  CHECK (
    EXTRACT(EPOCH FROM ("endsAt" - "startsAt")) / 3600 <= 8
  ) NOT VALID;
