import {
  createRouteError,
  type BulkAllocationCommitInput,
  type BulkAllocationCommitResult,
  type BulkAllocationPreviewItem,
  type BulkAllocationPreviewQuery,
  type BulkAllocationProposal,
  type StaffingRequirementSummary,
} from "../app.js";
import {
  findAllocationCandidates,
  timeRangesOverlap,
  type AllocationCandidate,
  type QueryClient,
} from "./allocation-queries.js";

/** Reads staffing requirements. Deliberately a reader, never a writer. */
type RequirementReader = (query: {
  status?: "OPEN";
}) => Promise<StaffingRequirementSummary[]>;

/** Creates one allocation in its own transaction, rechecking the rules inside it. */
type AllocationWriter = (
  organiserAuth0Id: string,
  input: {
    tutorId: number;
    courseId: number;
    startsAt: Date;
    endsAt: Date;
    minimumMark: number;
    requestedHours: number;
    status?: "PROPOSED" | "CONFIRMED";
    overrideReason?: string;
  },
) => Promise<{ id: number }>;

export interface BulkAllocationService {
  /**
   * What the system would assign, without saving anything.
   *
   * This service is built with a reader and a query client only: it is never
   * given a PrismaClient, which is the only way anything in this codebase
   * writes. Preview therefore cannot save, by construction rather than by
   * promise, and a test pins that by comparing every table before and after.
   */
  preview(
    query: BulkAllocationPreviewQuery,
  ): Promise<BulkAllocationPreviewItem[]>;
  /**
   * Save the confirmed list, one allocation per transaction, rechecking every
   * hard rule at the moment of writing rather than trusting the preview.
   */
  commit(
    organiserAuth0Id: string,
    input: BulkAllocationCommitInput,
  ): Promise<BulkAllocationCommitResult[]>;
}

function toProposal(
  candidate: AllocationCandidate,
  hours: number,
): BulkAllocationProposal {
  return {
    tutorId: candidate.tutorId,
    fullName: candidate.fullName,
    hours,
    mark: candidate.mark ?? 0,
    markBand: candidate.markBand,
    usedHours: candidate.usedHours,
    weeklyLimit: candidate.weeklyLimit,
  };
}

/** What this run has already promised a tutor, before anything is saved. */
interface RunningTotals {
  /** Hours proposed so far in this run, keyed by tutor. */
  hours: Map<number, number>;
  /** Windows proposed so far in this run, keyed by tutor. */
  windows: Map<number, Array<{ startsAt: Date; endsAt: Date }>>;
}

function alreadyBusy(
  totals: RunningTotals,
  tutorId: number,
  startsAt: Date,
  endsAt: Date,
): boolean {
  const windows = totals.windows.get(tutorId) ?? [];
  return windows.some(
    (window) =>
      timeRangesOverlap(window.startsAt, window.endsAt, startsAt, endsAt) === true,
  );
}

function remainingAfterRun(
  totals: RunningTotals,
  candidate: AllocationCandidate,
): number {
  return candidate.remainingHours - (totals.hours.get(candidate.tutorId) ?? 0);
}

function record(
  totals: RunningTotals,
  tutorId: number,
  startsAt: Date,
  endsAt: Date,
  hours: number,
): void {
  totals.hours.set(tutorId, (totals.hours.get(tutorId) ?? 0) + hours);
  totals.windows.set(tutorId, [
    ...(totals.windows.get(tutorId) ?? []),
    { startsAt, endsAt },
  ]);
}

/**
 * Choose who to propose for one requirement, in ranking order.
 *
 * The ranking itself is not redefined here: candidates arrive already ranked by
 * findAllocationCandidates, and this walks that order. A tutor is skipped when
 * they are already proposed for this requirement, when what this run has already
 * promised them leaves too little capacity, or when they are already proposed for
 * an overlapping window. Each choice is recorded so the next one sees its effect.
 */
export function chooseProposals(
  candidates: AllocationCandidate[],
  requirement: { startsAt: Date; endsAt: Date; windowHours: number; tutorsWanted: number },
  totals: RunningTotals,
): BulkAllocationProposal[] {
  const eligible = candidates.filter((candidate) => candidate.isEligible);
  const chosen: BulkAllocationProposal[] = [];
  const takenHere = new Set<number>();

  for (const candidate of eligible) {
    if (chosen.length === requirement.tutorsWanted) {
      break;
    }
    if (takenHere.has(candidate.tutorId)) {
      continue;
    }
    if (remainingAfterRun(totals, candidate) < requirement.windowHours) {
      continue;
    }
    if (
      alreadyBusy(totals, candidate.tutorId, requirement.startsAt, requirement.endsAt)
    ) {
      continue;
    }

    chosen.push(toProposal(candidate, requirement.windowHours));
    takenHere.add(candidate.tutorId);
    record(
      totals,
      candidate.tutorId,
      requirement.startsAt,
      requirement.endsAt,
      requirement.windowHours,
    );
  }

  return chosen;
}

export function emptyRunningTotals(): RunningTotals {
  return { hours: new Map(), windows: new Map() };
}

function unfilledNote(unfilled: number, tutorsWanted: number): string | null {
  if (unfilled === 0) {
    return null;
  }
  const filled = tutorsWanted - unfilled;
  return `${filled} of ${tutorsWanted} ${tutorsWanted === 1 ? "place" : "places"} could be proposed; no further eligible tutor is free for this session.`;
}

export function createBulkAllocationService(
  queryClient: QueryClient,
  listRequirements: RequirementReader,
  createAllocation: AllocationWriter,
): BulkAllocationService {
  async function openRequirementsById(
    requirementIds: number[],
  ): Promise<Map<number, StaffingRequirementSummary>> {
    const open = await listRequirements({ status: "OPEN" });
    const wanted = new Set(requirementIds);
    return new Map(
      open
        .filter((requirement) => wanted.has(requirement.id))
        .map((requirement) => [requirement.id, requirement]),
    );
  }

  return {
    async preview(query) {
      const requirements = await openRequirementsById(query.requirementIds);
      // Planned in a fixed order so the same request always previews the same way.
      const ordered = [...requirements.values()].sort(
        (first, second) =>
          first.startsAt.localeCompare(second.startsAt) || first.id - second.id,
      );
      const totals = emptyRunningTotals();
      const items: BulkAllocationPreviewItem[] = [];

      for (const requirement of ordered) {
        const startsAt = new Date(requirement.startsAt);
        const endsAt = new Date(requirement.endsAt);
        const candidates = await findAllocationCandidates(queryClient, {
          courseId: requirement.courseId,
          startsAt,
          endsAt,
          minimumMark: query.minimumMark,
          requestedHours: requirement.windowHours,
        });

        const proposals = chooseProposals(
          candidates,
          {
            startsAt,
            endsAt,
            windowHours: requirement.windowHours,
            tutorsWanted: requirement.shortageTutors,
          },
          totals,
        );
        const proposed = new Set(proposals.map((proposal) => proposal.tutorId));
        const unfilled = requirement.shortageTutors - proposals.length;

        items.push({
          requirementId: requirement.id,
          courseId: requirement.courseId,
          courseCode: requirement.courseCode,
          courseName: requirement.courseName,
          startsAt: requirement.startsAt,
          endsAt: requirement.endsAt,
          windowHours: requirement.windowHours,
          shortageHours: requirement.shortageHours,
          tutorsWanted: requirement.shortageTutors,
          proposals,
          unfilled,
          note: unfilledNote(unfilled, requirement.shortageTutors),
          // Only eligible tutors, so the screen cannot offer anyone the rules
          // would refuse. Anyone already proposed here is left out.
          alternatives: candidates
            .filter(
              (candidate) =>
                candidate.isEligible && !proposed.has(candidate.tutorId),
            )
            .map((candidate) => toProposal(candidate, requirement.windowHours)),
        });
      }

      return items;
    },

    async commit(organiserAuth0Id, input) {
      const requirements = await openRequirementsById(
        input.items.map((item) => item.requirementId),
      );
      const results: BulkAllocationCommitResult[] = [];

      for (const item of input.items) {
        const requirement = requirements.get(item.requirementId);
        if (!requirement) {
          results.push({
            requirementId: item.requirementId,
            tutorId: item.tutorId,
            outcome: "failed",
            code: "STAFFING_REQUIREMENT_NOT_FOUND",
            message:
              "That staffing requirement is no longer open, so nothing was saved for it.",
          });
          continue;
        }

        // The organiser says whether they changed the suggestion; it is never
        // inferred from a fresh ranking, which shifts as earlier items save.
        const changed = item.tutorId !== item.proposedTutorId;
        const reason = item.overrideReason?.trim();
        if (changed && !reason) {
          results.push({
            requirementId: item.requirementId,
            tutorId: item.tutorId,
            outcome: "failed",
            code: "OVERRIDE_REASON_REQUIRED",
            message:
              "Choosing a different tutor needs a reason, so nothing was saved for this item.",
          });
          continue;
        }

        try {
          // Course, times and hours come from the requirement, never from the
          // request, and createAllocation rechecks every hard rule inside its
          // own transaction, so one failure leaves the others saved.
          const allocation = await createAllocation(organiserAuth0Id, {
            tutorId: item.tutorId,
            courseId: requirement.courseId,
            startsAt: new Date(requirement.startsAt),
            endsAt: new Date(requirement.endsAt),
            minimumMark: input.minimumMark,
            requestedHours: requirement.windowHours,
            status: "CONFIRMED",
            ...(changed && reason ? { overrideReason: reason } : {}),
          });

          results.push({
            requirementId: item.requirementId,
            tutorId: item.tutorId,
            outcome: "saved",
            allocationId: allocation.id,
          });
        } catch (value) {
          const routeError = value as { status?: number; code?: string; message?: string };
          if (typeof routeError?.status === "number" && routeError.code) {
            results.push({
              requirementId: item.requirementId,
              tutorId: item.tutorId,
              outcome: "failed",
              code: routeError.code,
              message: routeError.message ?? "This allocation could not be saved.",
            });
            continue;
          }
          // An unexpected failure is reported without detail, and the rest of
          // the run still goes ahead.
          results.push({
            requirementId: item.requirementId,
            tutorId: item.tutorId,
            outcome: "failed",
            code: "INTERNAL_ERROR",
            message: "This allocation could not be saved.",
          });
        }
      }

      if (results.length === 0) {
        throw createRouteError(
          400,
          "VALIDATION_ERROR",
          "Select at least one allocation to save.",
        );
      }

      return results;
    },
  };
}
