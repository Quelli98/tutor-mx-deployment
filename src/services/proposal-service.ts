import { createHash } from 'node:crypto';
import {
  findAllocationCandidates,
  toNaiveUtcText,
  type AllocationCandidate,
  type QueryClient,
} from './allocation-queries.js';
import { createRouteError } from '../http/errors.js';
import {
  inPlanningTransaction,
  exactFields,
  instant,
  invalid,
  positiveId,
  requireProfile,
  type PlanningStore,
} from './planning-store.js';
import { requiredHoursFor } from './staffing-requirement-service.js';
import { createScenarioService, type ScenarioService } from './scenario-service.js';
import { writeAudit } from './audit-service.js';

export const PROPOSAL_PRESETS = [
  'BALANCED',
  'STRONGEST_MATCH',
  'FAIR_WORKLOAD',
  'BUDGET_AWARE',
] as const;
export type ProposalPreset = (typeof PROPOSAL_PRESETS)[number];

type Requirement = {
  id: number;
  courseId: number;
  courseCode: string;
  startsAt: Date;
  endsAt: Date;
  tutorsNeeded: number;
  hourlyRate: number | null;
  budget: number | null;
};

type PlanItem = {
  id?: number;
  sourceAllocationId: number | null;
  tutorId: number;
  tutorName: string;
  courseId: number;
  courseCode: string;
  startsAt: Date;
  endsAt: Date;
  allocatedHours: number;
  minimumMark: number;
  locked: boolean;
  excused?: boolean;
};

type CourseFinance = {
  id: number;
  code: string;
  hourlyRate: number | null;
  budget: number | null;
};

type CandidateExplanation = {
  tutorId: number;
  fullName: string;
  eligible: boolean;
  chosen: boolean;
  hardFailures: string[];
  softScore: number | null;
  factors: string[];
  reason: string;
};

type ProposalAssignment = {
  requirementId: number;
  courseId: number;
  courseCode: string;
  tutorId: number;
  tutorName: string;
  startsAt: string;
  endsAt: string;
  allocatedHours: number;
  minimumMark: number;
  explanation: CandidateExplanation[];
};

type ScenarioDetail = Awaited<ReturnType<ScenarioService['get']>>;

const comparisonToken = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const HOUR = 3_600_000;
const TOLERANCE = 0.009;
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The four strategies use the same hard rules and the same objective inputs.
 * Only the soft weights change. This keeps the strategy lab comparable and
 * deterministic rather than quietly switching business rules per preset.
 */
const PRESET_WEIGHTS: Record<
  ProposalPreset,
  { shortage: number; mark: number; fairness: number; budget: number }
> = {
  BALANCED: { shortage: 0.4, mark: 0.3, fairness: 0.2, budget: 0.1 },
  STRONGEST_MATCH: { shortage: 0.2, mark: 0.65, fairness: 0.1, budget: 0.05 },
  FAIR_WORKLOAD: { shortage: 0.25, mark: 0.15, fairness: 0.55, budget: 0.05 },
  BUDGET_AWARE: { shortage: 0.25, mark: 0.1, fairness: 0.1, budget: 0.55 },
};

function overlapHours(item: PlanItem, startsAt: Date, endsAt: Date) {
  const overlap = Math.max(
    0,
    Math.min(+item.endsAt, +endsAt) - Math.max(+item.startsAt, +startsAt),
  );
  const itemDuration = +item.endsAt - +item.startsAt;
  if (overlap <= 0 || itemDuration <= 0) return 0;
  // Same definition used by Scenario Compare: allocated hours contribute in
  // proportion to the part of the session that overlaps the requirement.
  return item.allocatedHours * (overlap / itemDuration);
}

function monday(value: Date) {
  const result = new Date(value);
  result.setUTCHours(0, 0, 0, 0);
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function sameWeek(first: Date, second: Date) {
  return +monday(first) === +monday(second);
}

function preset(raw: unknown): ProposalPreset {
  if (
    typeof raw !== 'string' ||
    !PROPOSAL_PRESETS.includes(raw as ProposalPreset)
  ) {
    invalid('Choose Balanced, Strongest Match, Fair Workload or Budget Aware.');
  }
  return raw as ProposalPreset;
}

function name(raw: unknown) {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 120) {
    invalid('Enter a proposal name of 1–120 characters.');
  }
  return raw.trim();
}

function reason(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    raw.trim().length < 3 ||
    raw.trim().length > 500
  ) {
    invalid('Enter a short reason (3–500 characters).');
  }
  return raw.trim();
}

function isExcused(item: PlanItem, currentLive: PlanItem[]) {
  return currentLive.some(live => live.excused && live.sourceAllocationId === item.sourceAllocationId &&
    live.tutorId === item.tutorId && live.courseId === item.courseId &&
    +live.startsAt === +item.startsAt && +live.endsAt === +item.endsAt &&
    live.allocatedHours === item.allocatedHours && live.minimumMark === item.minimumMark);
}

function plannedWeekUsage(
  candidate: AllocationCandidate,
  draftItems: PlanItem[],
  currentLive: PlanItem[],
  weekOf: Date,
) {
  // candidate.usedHours contains the whole live selected week, including work
  // outside this proposal window. Replace only the live slice represented in
  // this planning context with the draft slice, so scenario edits/removals and
  // newly proposed work are counted once rather than double-counted.
  const liveContextHours = currentLive
    .filter(
      (item) =>
        item.tutorId === candidate.tutorId && sameWeek(item.startsAt, weekOf) && !isExcused(item, currentLive),
    )
    .reduce((sum, item) => sum + item.allocatedHours, 0);
  const draftContextHours = draftItems
    .filter(
      (item) =>
        item.tutorId === candidate.tutorId && sameWeek(item.startsAt, weekOf) && !isExcused(item, currentLive),
    )
    .reduce((sum, item) => sum + item.allocatedHours, 0);
  return round(Math.max(0, candidate.usedHours - liveContextHours) + draftContextHours);
}

function softScore(
  candidate: AllocationCandidate,
  chosenPreset: ProposalPreset,
  draftItems: PlanItem[],
  currentLive: PlanItem[],
  weekOf: Date,
) {
  const weights = PRESET_WEIGHTS[chosenPreset];
  const mark = (candidate.mark ?? 0) / 100;
  const planned = plannedWeekUsage(candidate, draftItems, currentLive, weekOf);
  const fairness =
    candidate.weeklyLimit > 0
      ? Math.max(0, 1 - planned / candidate.weeklyLimit)
      : 0;
  return round(mark * weights.mark + fairness * weights.fairness);
}

function factors(
  candidate: AllocationCandidate,
  chosenPreset: ProposalPreset,
  draftItems: PlanItem[],
  currentLive: PlanItem[],
  weekOf: Date,
) {
  const planned = plannedWeekUsage(candidate, draftItems, currentLive, weekOf);
  const remaining = Math.max(0, candidate.weeklyLimit - planned);
  const values = [
    `${candidate.mark ?? 'No'}% course mark`,
    `${round(planned)} of ${round(candidate.weeklyLimit)} selected-week hours planned`,
    `${round(remaining)} selected-week hours remaining`,
  ];
  if (chosenPreset === 'STRONGEST_MATCH') {
    values.push('Strongest Match gives the greatest soft weight to course mark.');
  }
  if (chosenPreset === 'FAIR_WORKLOAD') {
    values.push('Fair Workload gives the greatest soft weight to unused weekly capacity.');
  }
  if (chosenPreset === 'BUDGET_AWARE') {
    values.push('Budget Aware gives the greatest requirement-priority weight to lower projected cost.');
  }
  if (chosenPreset === 'BALANCED') {
    values.push('Balanced spreads soft weight across shortage, mark, workload and budget pressure.');
  }
  return values;
}

function candidateOrder(
  candidates: AllocationCandidate[],
  chosenPreset: ProposalPreset,
  draftItems: PlanItem[],
  currentLive: PlanItem[],
  weekOf: Date,
) {
  return [...candidates].sort(
    (first, second) =>
      softScore(second, chosenPreset, draftItems, currentLive, weekOf) -
        softScore(first, chosenPreset, draftItems, currentLive, weekOf) ||
      (second.mark ?? 0) - (first.mark ?? 0) ||
      first.tutorId - second.tutorId,
  );
}

function planClash(
  items: PlanItem[],
  tutorId: number,
  startsAt: Date,
  endsAt: Date,
  currentLive: PlanItem[],
) {
  return items.some(
    (item) =>
      item.tutorId === tutorId &&
      !isExcused(item, currentLive) &&
      +item.startsAt < +endsAt &&
      +item.endsAt > +startsAt,
  );
}

function externalScheduleClash(
  candidate: AllocationCandidate,
  currentLive: PlanItem[],
) {
  if (!candidate.reasonCodes.includes('schedule-clash')) return false;
  if (!candidate.clashDetails.length) return true;
  return candidate.clashDetails.some((clash) => {
    if (clash.kind !== 'allocation') return true;
    const startsAt = +new Date(clash.startsAt);
    const endsAt = +new Date(clash.endsAt);
    // Scenario publishing replaces live allocations inside its window before it
    // rechecks the final draft. Ignore those old identities here and let the
    // draft items below decide whether the clash still exists. Carry-in/outside
    // allocations are not in currentLive, so they remain hard clashes.
    return !currentLive.some(
      (item) =>
        item.tutorId === candidate.tutorId &&
        +item.startsAt === startsAt &&
        +item.endsAt === endsAt,
    );
  });
}

function hardFailuresForCandidate(
  candidate: AllocationCandidate,
  draftItems: PlanItem[],
  currentLive: PlanItem[],
  startsAt: Date,
  endsAt: Date,
  requestedHours: number,
) {
  const failures = candidate.reasonCodes.filter(
    (value) => value === 'insufficient-mark',
  ) as string[];
  if (externalScheduleClash(candidate, currentLive)) failures.push('schedule-clash');
  if (planClash(draftItems, candidate.tutorId, startsAt, endsAt, currentLive)) {
    failures.push('schedule-clash');
  }
  const planned =
    plannedWeekUsage(candidate, draftItems, currentLive, startsAt) + requestedHours;
  if (planned > candidate.weeklyLimit + TOLERANCE) {
    failures.push('hour-limit-exceeded');
  }
  return [...new Set(failures)];
}

function coverageHours(
  items: PlanItem[],
  carryIn: PlanItem[],
  requirement: Requirement,
) {
  return round(
    [...items, ...carryIn]
      .filter((item) => item.courseId === requirement.courseId && !item.excused)
      .reduce(
        (sum, item) =>
          sum + overlapHours(item, requirement.startsAt, requirement.endsAt),
        0,
      ),
  );
}

async function requirements(client: QueryClient, startsAt: Date, endsAt: Date) {
  const { rows } = await client.query<Requirement>(
    `SELECT r."id",r."courseId",c."code" AS "courseCode",r."startsAt",r."endsAt",r."tutorsNeeded",c."hourlyRate"::float8 AS "hourlyRate",c."budget"::float8 AS budget
     FROM "StaffingRequirement" r
     JOIN "Course" c ON c."id"=r."courseId"
     WHERE r."status"='OPEN' AND r."startsAt">=$1::timestamp AND r."endsAt"<=$2::timestamp
     ORDER BY r."startsAt",r."id" LIMIT 201`,
    [toNaiveUtcText(startsAt), toNaiveUtcText(endsAt)],
  );
  if (rows.length > 200) {
    throw createRouteError(
      422,
      'PROPOSAL_TOO_LARGE',
      'Choose a smaller planning window (maximum 200 open requirements).',
    );
  }
  return rows.map((row) => ({
    ...row,
    startsAt: new Date(row.startsAt),
    endsAt: new Date(row.endsAt),
  }));
}

async function courseFinances(client: QueryClient) {
  const { rows } = await client.query<CourseFinance>(
    `SELECT "id","code","hourlyRate"::float8 AS "hourlyRate","budget"::float8 AS budget
     FROM "Course" ORDER BY "id" LIMIT 5001`,
  );
  if (rows.length > 5000) {
    throw createRouteError(
      422,
      'PROPOSAL_TOO_LARGE',
      'Choose a smaller planning context.',
    );
  }
  return rows;
}

async function liveItems(client: QueryClient, startsAt: Date, endsAt: Date) {
  const { rows } = await client.query<PlanItem>(
    `SELECT a."id",a."id" AS "sourceAllocationId",a."tutorId",p."fullName" AS "tutorName",a."courseId",c."code" AS "courseCode",a."startsAt",a."endsAt",a."allocatedHours"::float8 AS "allocatedHours",a."minimumMark"::float8 AS "minimumMark",false AS "locked",EXISTS(SELECT 1 FROM "Excuse" e WHERE e."allocationId"=a."id" AND e."status"='APPROVED' AND e."occurrenceStatus"='EXCUSED') AS excused
     FROM "Allocation" a
     JOIN "Profile" p ON p."id"=a."tutorId"
     JOIN "Course" c ON c."id"=a."courseId"
     WHERE a."status"='CONFIRMED'
       AND a."startsAt">=$1::timestamp AND a."startsAt"<$2::timestamp
     ORDER BY a."startsAt",a."id" LIMIT 201`,
    [toNaiveUtcText(startsAt), toNaiveUtcText(endsAt)],
  );
  if (rows.length > 200) {
    throw createRouteError(
      422,
      'PROPOSAL_TOO_LARGE',
      'Choose a smaller planning context.',
    );
  }
  return rows.map((item) => ({
    ...item,
    startsAt: new Date(item.startsAt),
    endsAt: new Date(item.endsAt),
    allocatedHours: Number(item.allocatedHours),
    minimumMark: Number(item.minimumMark),
  }));
}

async function carryInItems(client: QueryClient, startsAt: Date) {
  const { rows } = await client.query<PlanItem>(
    `SELECT a."id",a."id" AS "sourceAllocationId",a."tutorId",p."fullName" AS "tutorName",a."courseId",c."code" AS "courseCode",a."startsAt",a."endsAt",a."allocatedHours"::float8 AS "allocatedHours",a."minimumMark"::float8 AS "minimumMark",false AS "locked"
     FROM "Allocation" a
     JOIN "Profile" p ON p."id"=a."tutorId"
     JOIN "Course" c ON c."id"=a."courseId"
     WHERE a."status"='CONFIRMED'
       AND a."startsAt"<$1::timestamp AND a."endsAt">$1::timestamp
       AND NOT EXISTS(
         SELECT 1 FROM "Excuse" e
         WHERE e."allocationId"=a."id" AND e."status"='APPROVED' AND e."occurrenceStatus"='EXCUSED'
       )
     ORDER BY a."startsAt",a."id" LIMIT 201`,
    [toNaiveUtcText(startsAt)],
  );
  if (rows.length > 200) {
    throw createRouteError(
      422,
      'PROPOSAL_TOO_LARGE',
      'Choose a smaller planning context.',
    );
  }
  return rows.map((item) => ({
    ...item,
    startsAt: new Date(item.startsAt),
    endsAt: new Date(item.endsAt),
    allocatedHours: Number(item.allocatedHours),
    minimumMark: Number(item.minimumMark),
  }));
}

function requirementOrder(
  rows: Requirement[],
  chosenPreset: ProposalPreset,
  base: PlanItem[],
  carryIn: PlanItem[],
) {
  const weights = PRESET_WEIGHTS[chosenPreset];
  const finiteRates = rows
    .map((row) => row.hourlyRate)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const minRate = finiteRates.length ? Math.min(...finiteRates) : 0;
  const maxRate = finiteRates.length ? Math.max(...finiteRates) : 0;

  const priority = (row: Requirement) => {
    const required = requiredHoursFor(row.startsAt, row.endsAt, row.tutorsNeeded);
    const shortage = Math.max(0, required - coverageHours(base, carryIn, row));
    const shortageScore = required > 0 ? Math.min(1, shortage / required) : 0;
    const budgetScore =
      row.hourlyRate === null
        ? 0
        : maxRate === minRate
          ? 1
          : 1 - (row.hourlyRate - minRate) / (maxRate - minRate);
    return weights.shortage * shortageScore + weights.budget * budgetScore;
  };

  return [...rows].sort(
    (first, second) =>
      priority(second) - priority(first) ||
      +first.startsAt - +second.startsAt ||
      first.id - second.id,
  );
}

function proposalMetrics(
  items: PlanItem[],
  assignments: ProposalAssignment[],
  requirementsRows: Requirement[],
  finances: CourseFinance[],
  carryIn: PlanItem[],
) {
  const shortageHours = round(
    requirementsRows.reduce((sum, requirement) => {
      const required = requiredHoursFor(
        requirement.startsAt,
        requirement.endsAt,
        requirement.tutorsNeeded,
      );
      return (
        sum + Math.max(0, required - coverageHours(items, carryIn, requirement))
      );
    }, 0),
  );

  const usedCourses = finances.filter((course) =>
    items.some((item) => item.courseId === course.id),
  );
  const courses = usedCourses.map((course) => {
    const hours = round(
      items
        .filter((item) => item.courseId === course.id)
        .reduce((sum, item) => sum + item.allocatedHours, 0),
    );
    const projectedCost =
      course.hourlyRate === null ? null : round(hours * course.hourlyRate);
    return {
      courseId: course.id,
      courseCode: course.code,
      hours,
      hourlyRate: course.hourlyRate,
      budget: course.budget,
      projectedCost,
      budgetRemaining:
        projectedCost === null || course.budget === null
          ? null
          : round(course.budget - projectedCost),
    };
  });

  const projectedCost = courses.some((course) => course.projectedCost === null)
    ? null
    : round(
        courses.reduce(
          (sum, course) => sum + (course.projectedCost as number),
          0,
        ),
      );

  const proposedCosts = assignments.map((assignment) => {
    const finance = finances.find((course) => course.id === assignment.courseId);
    return finance?.hourlyRate === null || finance?.hourlyRate === undefined
      ? null
      : assignment.allocatedHours * finance.hourlyRate;
  });
  const projectedAddedSpend = proposedCosts.some((value) => value === null)
    ? null
    : round(proposedCosts.reduce<number>((sum, value) => sum + Number(value), 0));

  const tutorIds = [...new Set(items.map((item) => item.tutorId))];
  const workload = tutorIds
    .map((tutorId) => ({
      tutorId,
      tutorName: items.find((item) => item.tutorId === tutorId)!.tutorName,
      hours: round(
        items
          .filter((item) => item.tutorId === tutorId)
          .reduce((sum, item) => sum + item.allocatedHours, 0),
      ),
    }))
    .sort((first, second) => first.tutorId - second.tutorId);
  const workloadHours = workload.map((row) => row.hours);
  const workloadSpread = workloadHours.length
    ? round(Math.max(...workloadHours) - Math.min(...workloadHours))
    : 0;

  return {
    proposedAssignments: assignments.length,
    // Legacy field kept for clients/tests: hours newly proposed by this engine.
    coveredTutorHours: round(
      assignments.reduce((sum, assignment) => sum + assignment.allocatedHours, 0),
    ),
    // Same meaning as Scenario Compare's `hours`: all draft allocated hours.
    allocatedHours: round(items.reduce((sum, item) => sum + item.allocatedHours, 0)),
    shortageHours,
    projectedAddedSpend,
    projectedCost,
    workload,
    workloadSpread,
    courses,
  };
}

async function build(
  client: QueryClient,
  startsAt: Date,
  endsAt: Date,
  chosenPreset: ProposalPreset,
  base: PlanItem[],
  currentLive: PlanItem[],
) {
  // Preserve excused live identities for Scenario history and cost/workload
  // metrics, but do not count unchanged excused rows as active staffing/busy time.
  base = base.map(item => ({ ...item, excused: isExcused(item, currentLive) }));
  const [rawRequirements, finances, carryIn] = await Promise.all([
    requirements(client, startsAt, endsAt),
    courseFinances(client),
    carryInItems(client, startsAt),
  ]);
  // Ignore malformed/unsupported requirement durations consistently in both
  // assignment generation and impact metrics. The allocation UI already caps
  // one assignment at 8 hours, so an invalid row must not inflate shortage.
  const validRequirements = rawRequirements.filter((requirement) => {
    const duration = (+requirement.endsAt - +requirement.startsAt) / HOUR;
    return duration > 0 && duration <= 8;
  });
  const orderedRequirements = requirementOrder(
    validRequirements,
    chosenPreset,
    base,
    carryIn,
  );
  const items = [...base];
  const assignments: ProposalAssignment[] = [];
  const shortages: Array<{
    requirementId: number;
    courseCode: string;
    hours: number;
    explanation: CandidateExplanation[];
  }> = [];

  for (const requirement of orderedRequirements) {
    const duration = round((+requirement.endsAt - +requirement.startsAt) / HOUR);
    if (duration <= 0 || duration > 8) continue;

    let assigned = coverageHours(items, carryIn, requirement);
    const required = requiredHoursFor(
      requirement.startsAt,
      requirement.endsAt,
      requirement.tutorsNeeded,
    );
    const usedForRequirement = new Set(
      items
        .filter(
          (item) =>
            item.courseId === requirement.courseId &&
            !item.excused &&
            overlapHours(item, requirement.startsAt, requirement.endsAt) > 0,
        )
        .map((item) => item.tutorId),
    );

    let lastExplanations: CandidateExplanation[] = [];
    while (assigned + TOLERANCE < required) {
      // Fill only the remaining tutor-hours. Existing/manual coverage may be
      // partial, so always adding a full session could overstaff the draft.
      const assignmentHours = round(Math.min(duration, required - assigned));
      const candidates = await findAllocationCandidates(client, {
        courseId: requirement.courseId,
        startsAt: requirement.startsAt,
        endsAt: requirement.endsAt,
        minimumMark: 50,
        requestedHours: assignmentHours,
      });

      const explanations: CandidateExplanation[] = candidates.map((candidate) => {
        const hardFailures = hardFailuresForCandidate(
          candidate,
          items,
          currentLive,
          requirement.startsAt,
          requirement.endsAt,
          assignmentHours,
        );
        if (usedForRequirement.has(candidate.tutorId)) {
          hardFailures.push('already-assigned-to-requirement');
        }
        const eligible = hardFailures.length === 0;
        return {
          tutorId: candidate.tutorId,
          fullName: candidate.fullName,
          eligible,
          chosen: false,
          hardFailures,
          softScore: eligible
            ? softScore(
                candidate,
                chosenPreset,
                items,
                currentLive,
                requirement.startsAt,
              )
            : null,
          factors: factors(
            candidate,
            chosenPreset,
            items,
            currentLive,
            requirement.startsAt,
          ),
          reason: eligible
            ? 'Eligible; ranked by the selected preset after all hard rules pass.'
            : `Why not: hard rule failed (${hardFailures.join(', ')}).`,
        };
      });

      lastExplanations = explanations;
      const eligible = candidateOrder(
        candidates.filter(
          (candidate) =>
            explanations.find(
              (explanation) => explanation.tutorId === candidate.tutorId,
            )?.eligible,
        ),
        chosenPreset,
        items,
        currentLive,
        requirement.startsAt,
      );
      const chosen = eligible[0];
      if (!chosen) break;

      const chosenExplanation = explanations.find(
        (explanation) => explanation.tutorId === chosen.tutorId,
      )!;
      chosenExplanation.chosen = true;
      chosenExplanation.reason =
        'Chosen because mark, clash and selected-week capacity all pass and this tutor has the highest deterministic soft score for this preset.';
      for (const explanation of explanations) {
        if (explanation.eligible && !explanation.chosen) {
          explanation.reason =
            explanation.softScore === chosenExplanation.softScore
              ? 'Why not: the soft score is tied; course mark, then Tutor ID breaks the tie deterministically.'
              : 'Why not: all hard rules pass, but this tutor has a lower deterministic soft score than the chosen tutor for this preset.';
        }
      }

      const item: PlanItem = {
        sourceAllocationId: null,
        tutorId: chosen.tutorId,
        tutorName: chosen.fullName,
        courseId: requirement.courseId,
        courseCode: requirement.courseCode,
        startsAt: requirement.startsAt,
        endsAt: requirement.endsAt,
        allocatedHours: assignmentHours,
        minimumMark: 50,
        locked: false,
      };
      items.push(item);
      usedForRequirement.add(chosen.tutorId);
      assigned = coverageHours(items, carryIn, requirement);
      assignments.push({
        requirementId: requirement.id,
        courseId: requirement.courseId,
        courseCode: requirement.courseCode,
        tutorId: chosen.tutorId,
        tutorName: chosen.fullName,
        startsAt: requirement.startsAt.toISOString(),
        endsAt: requirement.endsAt.toISOString(),
        allocatedHours: assignmentHours,
        minimumMark: 50,
        explanation: explanations,
      });
    }

    if (assigned + TOLERANCE < required) {
      shortages.push({
        requirementId: requirement.id,
        courseCode: requirement.courseCode,
        hours: round(required - assigned),
        explanation: lastExplanations,
      });
    }
  }

  return {
    preset: chosenPreset,
    weights: PRESET_WEIGHTS[chosenPreset],
    assignments,
    shortages,
    metrics: proposalMetrics(
      items,
      assignments,
      validRequirements,
      finances,
      carryIn,
    ),
  };
}

function compactIds(ids: number[]) {
  const values = [...new Set(ids)].sort((first, second) => first - second);
  const parts: string[] = [];
  for (let index = 0; index < values.length; ) {
    const start = values[index]!;
    let end = start;
    while (index + 1 < values.length && values[index + 1] === end + 1) {
      index += 1;
      end = values[index]!;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }
  return parts.join(',');
}

function parseGeneratedIds(notes: string) {
  if (/Proposal item ids:\s*none\b/i.test(notes)) return new Set<number>();
  const raw = notes.match(/Proposal item ids:\s*([0-9,-]+)/i)?.[1];
  if (!raw) return null;
  const result = new Set<number>();
  for (const part of raw.split(',')) {
    const [firstText, lastText] = part.split('-');
    const first = Number(firstText);
    const last = lastText === undefined ? first : Number(lastText);
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 1 ||
      last < first ||
      last - first > 500
    ) {
      return null;
    }
    for (let value = first; value <= last; value += 1) result.add(value);
  }
  return result;
}

function presetFromNotes(notes: unknown): ProposalPreset {
  const value = String(notes).match(/Generated by ([A-Z_]+) proposal preset/)?.[1];
  return PROPOSAL_PRESETS.includes(value as ProposalPreset)
    ? (value as ProposalPreset)
    : 'BALANCED';
}

export function createProposalService(
  store: PlanningStore,
  scenarios: ScenarioService,
  scenarioFactory: (store: PlanningStore) => ScenarioService = createScenarioService,
) {
  const outerStore = store;
  const outerScenarios = scenarios;
  async function context(raw: unknown) {
    const input = exactFields(raw, [
      'name',
      'startsAt',
      'endsAt',
      'preset',
      'baseScenarioId',
      'comparisonToken',
    ]);
    if (input.comparisonToken !== undefined && (typeof input.comparisonToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.comparisonToken))) invalid('Compare the strategies again before saving.');
    const startsAt = instant(input.startsAt);
    const endsAt = instant(input.endsAt);
    const chosenPreset = preset(input.preset);
    if (
      endsAt <= startsAt ||
      +endsAt - +startsAt > 28 * 24 * HOUR ||
      startsAt <= new Date()
    ) {
      invalid('Choose a future planning window of up to 28 days.');
    }
    let baseScenarioId: number | null = null;
    if (input.baseScenarioId !== undefined && input.baseScenarioId !== null) {
      baseScenarioId = positiveId(input.baseScenarioId);
    }
    return {
      name: name(
        input.name ?? `${chosenPreset.replaceAll('_', ' ')} proposal`,
      ),
      startsAt,
      endsAt,
      chosenPreset,
      baseScenarioId,
      expectedComparisonToken: input.comparisonToken,
    };
  }

  function validatedBaseItems(
    detail: ScenarioDetail,
    startsAt: Date,
    endsAt: Date,
  ) {
    if (
      +new Date(detail.scenario.startsAt) !== +startsAt ||
      +new Date(detail.scenario.endsAt) !== +endsAt
    ) {
      invalid('The base scenario must use the same planning window.');
    }
    if (detail.scenario.status !== 'DRAFT') {
      throw createRouteError(
        409,
        'SCENARIO_READ_ONLY',
        'Choose a Draft scenario when using existing locks as the proposal starting point.',
      );
    }
    return (detail.items as PlanItem[]).map((item) => ({
      ...item,
      startsAt: new Date(item.startsAt),
      endsAt: new Date(item.endsAt),
    }));
  }

  async function resolveBase(
    subject: string,
    startsAt: Date,
    endsAt: Date,
    baseScenarioId: number | null,
    store: PlanningStore = outerStore,
    scenarios: ScenarioService = outerScenarios,
  ) {
    const currentLive = await liveItems(store, startsAt, endsAt);
    if (!baseScenarioId) return { base: currentLive, currentLive, detail: null };
    const detail = await scenarios.get(subject, baseScenarioId);
    return {
      base: validatedBaseItems(detail, startsAt, endsAt),
      currentLive,
      detail,
    };
  }

  async function preview(subject: string, raw: unknown) {
    const proposalContext = await context(raw);
    await requireProfile(store, subject, 'ORGANISER');
    const { base, currentLive } = await resolveBase(
      subject,
      proposalContext.startsAt,
      proposalContext.endsAt,
      proposalContext.baseScenarioId,
    );
    return build(
      store,
      proposalContext.startsAt,
      proposalContext.endsAt,
      proposalContext.chosenPreset,
      base,
      currentLive,
    );
  }

  return {
    preview,

    async compare(subject: string, raw: unknown) {
      const input = exactFields(raw, [
        'name',
        'startsAt',
        'endsAt',
        'baseScenarioId',
      ]);
      const comparisonContext = await context({
        ...input,
        name: input.name ?? 'Strategy comparison',
        preset: 'BALANCED',
      });
      await requireProfile(store, subject, 'ORGANISER');

      // Capture one base draft and one serializable database snapshot, then run
      // every preset against that exact same school state. Four independent
      // preview requests could otherwise observe different requirements or live
      // allocations while an Organiser is comparing strategies.
      const baseDetail = comparisonContext.baseScenarioId
        ? await scenarios.get(subject, comparisonContext.baseScenarioId)
        : null;
      const baseItems = baseDetail
        ? validatedBaseItems(
            baseDetail,
            comparisonContext.startsAt,
            comparisonContext.endsAt,
          )
        : null;
      const result = await store.transaction(async (client) => {
        const currentLive = await liveItems(
          client,
          comparisonContext.startsAt,
          comparisonContext.endsAt,
        );
        const base = baseItems ?? currentLive;
        const rows: (Awaited<ReturnType<typeof build>> & { comparisonToken: string })[] = [];
        for (const chosenPreset of PROPOSAL_PRESETS) {
          const built = await build(client, comparisonContext.startsAt, comparisonContext.endsAt, chosenPreset, base, currentLive);
          rows.push({ ...built, comparisonToken: comparisonToken({ base, currentLive, built }) });
        }
        return rows;
      });

      if (baseDetail && comparisonContext.baseScenarioId) {
        const latest = await scenarios.get(
          subject,
          comparisonContext.baseScenarioId,
        );
        if (latest.scenario.version !== baseDetail.scenario.version) {
          throw createRouteError(
            409,
            'SCENARIO_STALE',
            'The starting draft changed during strategy comparison. Refresh and compare again.',
          );
        }
      }
      return result;
    },

    async generate(subject: string, raw: unknown) {
      return inPlanningTransaction(outerStore, async client => {
        const store: PlanningStore = { query: client.query.bind(client), transaction: work => work(client) };
        const scenarios = scenarioFactory(store);
      const proposalContext = await context(raw);
      await requireProfile(store, subject, 'ORGANISER');
      const { base, currentLive, detail: baseDetail } = await resolveBase(
        subject,
        proposalContext.startsAt,
        proposalContext.endsAt,
        proposalContext.baseScenarioId,
        store,
        scenarios,
      );

      // Build first. A validation/query failure therefore does not leave an empty
      // proposal Scenario behind.
      const built = await build(
        store,
        proposalContext.startsAt,
        proposalContext.endsAt,
        proposalContext.chosenPreset,
        base,
        currentLive,
      );

      if (proposalContext.expectedComparisonToken !== undefined && proposalContext.expectedComparisonToken !== comparisonToken({ base, currentLive, built })) {
        throw createRouteError(409, 'PROPOSAL_COMPARISON_STALE', 'School data or the starting draft changed. Compare all strategies again before saving the chosen result.');
      }
      if (base.length + built.assignments.length > 200) {
        throw createRouteError(422, 'PROPOSAL_TOO_LARGE', 'Choose a smaller planning window (maximum 200 draft assignments).');
      }
      let created: ScenarioDetail;
      if (baseDetail && proposalContext.baseScenarioId) {
        const duplicated = await scenarios.change(
          subject,
          proposalContext.baseScenarioId,
          {
            action: 'duplicate',
            version: baseDetail.scenario.version,
            name: proposalContext.name,
          },
        );
        if ('deleted' in duplicated) {
          throw createRouteError(
            500,
            'PROPOSAL_SCENARIO_FAILED',
            'The proposal scenario could not be created.',
          );
        }
        created = duplicated;
      } else {
        created = await scenarios.create(subject, {
          name: proposalContext.name,
          notes: `Generated by ${proposalContext.chosenPreset} proposal preset.`,
          startsAt: proposalContext.startsAt.toISOString(),
          endsAt: proposalContext.endsAt.toISOString(),
        });
      }

      let detail = created;
      const generatedItemIds: number[] = [];
      for (const assignment of built.assignments) {
        const beforeIds = new Set(
          (detail.items as PlanItem[])
            .map((item) => item.id)
            .filter((id): id is number => Number.isSafeInteger(id)),
        );
        const changed = await scenarios.change(subject, detail.scenario.id, {
          action: 'save-item',
          version: detail.scenario.version,
          item: {
            id: null,
            tutorId: assignment.tutorId,
            courseId: assignment.courseId,
            startsAt: assignment.startsAt,
            endsAt: assignment.endsAt,
            allocatedHours: assignment.allocatedHours,
            minimumMark: assignment.minimumMark,
          },
        });
        if ('deleted' in changed) {
          throw createRouteError(
            500,
            'PROPOSAL_SCENARIO_FAILED',
            'The proposal scenario could not be updated.',
          );
        }
        detail = changed;
        const added = (detail.items as PlanItem[]).find(
          (item) => item.id !== undefined && !beforeIds.has(item.id),
        );
        if (added?.id !== undefined) generatedItemIds.push(added.id);
      }

      // A duplicated base scenario keeps its own notes, so stamp the selected
      // preset and a compact set of generated item IDs after proposal saves.
      // This lets the explanation route avoid mislabelling pre-existing manual
      // scenario items as engine suggestions.
      const marker = compactIds(generatedItemIds);
      const note = `Generated by ${proposalContext.chosenPreset} proposal preset. Proposal item ids: ${marker || 'none'}.`;
      const metadataChanged = await scenarios.change(subject, detail.scenario.id, {
        action: 'metadata',
        version: detail.scenario.version,
        name: detail.scenario.name,
        notes: note,
      });
      if ('deleted' in metadataChanged) {
        throw createRouteError(
          500,
          'PROPOSAL_SCENARIO_FAILED',
          'The proposal scenario could not be finalised.',
        );
      }
      detail = metadataChanged;

      return {
        scenario: detail.scenario,
        items: detail.items,
        proposal: built,
      };
      });
    },

    async explain(subject: string, id: number) {
      await requireProfile(store, subject, 'ORGANISER');
      const detail = await scenarios.get(subject, positiveId(id));
      const chosenPreset = presetFromNotes(detail.scenario.notes);
      const generatedIds = parseGeneratedIds(String(detail.scenario.notes));
      const allItems = (detail.items as PlanItem[]).map((item) => ({
        ...item,
        startsAt: new Date(item.startsAt),
        endsAt: new Date(item.endsAt),
      }));
      const generated = generatedIds
        ? allItems.filter((item) => item.id !== undefined && generatedIds.has(item.id))
        : allItems.filter((item) => item.sourceAllocationId === null && !item.locked);
      const currentLive = await liveItems(
        store,
        new Date(detail.scenario.startsAt),
        new Date(detail.scenario.endsAt),
      );
      const assignments = [];

      for (const item of generated) {
        const otherItems = allItems.filter((other) => other.id !== item.id);
        const candidates = await findAllocationCandidates(store, {
          courseId: item.courseId,
          startsAt: new Date(item.startsAt),
          endsAt: new Date(item.endsAt),
          minimumMark: item.minimumMark,
          requestedHours: item.allocatedHours,
          excludeAllocationId: item.sourceAllocationId ?? undefined,
        });

        const explanations: CandidateExplanation[] = candidates.map((candidate) => {
          const hardFailures = hardFailuresForCandidate(
            candidate,
            otherItems,
            currentLive,
            new Date(item.startsAt),
            new Date(item.endsAt),
            item.allocatedHours,
          );
          const eligible = hardFailures.length === 0;
          const chosen = candidate.tutorId === item.tutorId;
          return {
            tutorId: candidate.tutorId,
            fullName: candidate.fullName,
            eligible,
            chosen,
            hardFailures,
            softScore: eligible
              ? softScore(
                  candidate,
                  chosenPreset,
                  otherItems,
                  currentLive,
                  new Date(item.startsAt),
                )
              : null,
            factors: factors(
              candidate,
              chosenPreset,
              otherItems,
              currentLive,
              new Date(item.startsAt),
            ),
            reason: chosen
              ? eligible
                ? 'Chosen in this proposal: mark, clash and selected-week capacity currently pass.'
                : `Chosen earlier, but current hard rules now fail (${hardFailures.join(', ')}). Refresh and review before publishing.`
              : eligible
                ? 'Eligible alternative: compare the current soft score and factors. The saved choice may reflect an organiser adjustment or earlier data.'
                : `Why not: hard rule failed (${hardFailures.join(', ')}).`,
          };
        });

        if (!explanations.some((explanation) => explanation.chosen)) {
          explanations.unshift({
            tutorId: item.tutorId,
            fullName: item.tutorName,
            eligible: false,
            chosen: true,
            hardFailures: ['current-candidate-unavailable'],
            softScore: null,
            factors: [],
            reason:
              'Chosen earlier, but this Tutor is no longer a current eligible candidate for this course. Refresh and review before publishing.',
          });
        }

        assignments.push({
          ...item,
          startsAt: new Date(item.startsAt).toISOString(),
          endsAt: new Date(item.endsAt).toISOString(),
          explanation: explanations,
        });
      }

      return {
        preset: chosenPreset,
        scenario: detail.scenario,
        assignments,
      };
    },

    async adjust(subject: string, id: number, raw: unknown) {
      return inPlanningTransaction(outerStore, async client => {
        const store: PlanningStore = { query: client.query.bind(client), transaction: work => work(client) };
        const scenarios = scenarioFactory(store);
      const input = exactFields(raw, [
        'version',
        'itemId',
        'tutorId',
        'reason',
      ]);
      const adjustmentReason = reason(input.reason);
      const detail = await scenarios.get(subject, positiveId(id));
      const item = (detail.items as PlanItem[]).find(
        (candidate) => candidate.id === positiveId(input.itemId),
      );
      if (!item) {
        throw createRouteError(
          404,
          'PROPOSAL_ITEM_NOT_FOUND',
          'This proposal assignment is no longer available.',
        );
      }
      if (item.locked) {
        throw createRouteError(
          409,
          'ITEM_LOCKED',
          'Unlock this assignment before changing it.',
        );
      }

      const tutorId = positiveId(input.tutorId);
      const candidates = await findAllocationCandidates(store, {
        courseId: item.courseId,
        startsAt: new Date(item.startsAt),
        endsAt: new Date(item.endsAt),
        minimumMark: item.minimumMark,
        requestedHours: item.allocatedHours,
        excludeAllocationId: item.sourceAllocationId ?? undefined,
      });
      const candidate = candidates.find((value) => value.tutorId === tutorId);
      const otherItems = (detail.items as PlanItem[])
        .filter((value) => value.id !== item.id)
        .map((value) => ({
          ...value,
          startsAt: new Date(value.startsAt),
          endsAt: new Date(value.endsAt),
        }));
      const currentLive = await liveItems(
        store,
        new Date(detail.scenario.startsAt),
        new Date(detail.scenario.endsAt),
      );
      const hardFailures = candidate
        ? hardFailuresForCandidate(
            candidate,
            otherItems,
            currentLive,
            new Date(item.startsAt),
            new Date(item.endsAt),
            item.allocatedHours,
          )
        : ['current-candidate-unavailable'];
      if (!candidate || hardFailures.length > 0) {
        throw createRouteError(
          409,
          'PROPOSAL_RULE_FAILED',
          'Choose another Tutor who currently passes mark, clash and selected-week capacity rules in both live data and this draft.',
        );
      }

      const changed = await scenarios.change(subject, id, {
        action: 'save-item',
        version: positiveId(input.version),
        item: {
          id: item.id,
          tutorId: candidate.tutorId,
          courseId: item.courseId,
          startsAt: new Date(item.startsAt).toISOString(),
          endsAt: new Date(item.endsAt).toISOString(),
          allocatedHours: item.allocatedHours,
          minimumMark: item.minimumMark,
        },
      });
      if ('deleted' in changed) {
        throw createRouteError(
          500,
          'PROPOSAL_SCENARIO_FAILED',
          'The proposal scenario could not be updated.',
        );
      }
      const actor = await requireProfile(store, subject, 'ORGANISER');
      await writeAudit(
        store,
        actor.id,
        'PROPOSAL_MANUAL_ADJUSTMENT',
        'scenario',
        id,
        { id, items: [item] },
        {
          id,
          items: [{ ...item, tutorId: candidate.tutorId }],
        },
        adjustmentReason,
      );
      return changed;
      });
    },

  };
}

export type ProposalService = ReturnType<typeof createProposalService>;
