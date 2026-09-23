// Corrections and the declaration that answers them can land in the same
// second, so ties are broken by what has to be read first.
const EVENT_ORDER = {
  SUBMITTED: 0,
  RETURN: 1,
  CORRECTION: 2,
  DECLARATION: 3,
  DISPUTE: 4,
  RESOLUTION: 5,
}

export function formatMoment(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function hoursLabel(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100) / 100}h` : 'no hours recorded'
}

function descriptionLabel(value) {
  return value === null || value === undefined || value === '' ? 'no description' : value
}

/**
 * The whole correction surface of one week as a single ordered story: what was
 * submitted, why it came back, what the tutor changed, what they declared, and
 * any objection raised along the way. Everything comes from the one history
 * read, so the timeline and the forms can never disagree about the state of the
 * week.
 */
export function buildTimeline(history) {
  if (!history) return []

  const events = []
  const { timesheet, revisions, declarations, disputes } = history

  if (timesheet.submittedAt) {
    events.push({
      key: 'submitted',
      kind: 'SUBMITTED',
      at: timesheet.submittedAt,
      title: 'Sent for review',
      detail: '',
    })
  }

  for (const revision of revisions) {
    if (revision.kind === 'RETURN') {
      events.push({
        key: `return-${revision.id}`,
        kind: 'RETURN',
        at: revision.createdAt,
        title: 'Returned by the organiser',
        detail: revision.reason ? `Note: ${revision.reason}` : '',
      })
    } else {
      events.push({
        key: `correction-${revision.id}`,
        kind: 'CORRECTION',
        at: revision.createdAt,
        title: 'Corrected',
        detail: `${hoursLabel(revision.previousHours)} to ${hoursLabel(revision.newHours)}: "${descriptionLabel(revision.previousDescription)}" to "${descriptionLabel(revision.newDescription)}"`,
      })
    }
  }

  for (const declaration of declarations) {
    events.push({
      key: `declaration-${declaration.id}`,
      kind: 'DECLARATION',
      at: declaration.declaredAt,
      title: 'Declaration acknowledged',
      detail: `Wording version ${declaration.statementVersion}`,
    })
  }

  for (const dispute of disputes) {
    events.push({
      key: `dispute-${dispute.id}`,
      kind: 'DISPUTE',
      at: dispute.createdAt,
      title: 'Dispute raised',
      detail: `Reason: ${dispute.reason}`,
    })
    if (dispute.resolvedAt) {
      events.push({
        key: `resolution-${dispute.id}`,
        kind: 'RESOLUTION',
        at: dispute.resolvedAt,
        title: 'Dispute answered',
        detail: dispute.resolutionReason ? `Answer: ${dispute.resolutionReason}` : '',
      })
    }
  }

  return events.sort((first, second) => {
    const firstAt = Date.parse(first.at)
    const secondAt = Date.parse(second.at)
    if (firstAt !== secondAt) return firstAt - secondAt
    return EVENT_ORDER[first.kind] - EVENT_ORDER[second.kind]
  })
}
