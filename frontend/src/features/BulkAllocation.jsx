import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  commitBulkAllocations,
  listStaffingRequirements,
  previewBulkAllocations,
} from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'

const DEFAULT_MINIMUM_MARK = '65'

function safeErrorMessage(error, fallback) {
  if (error?.code === 'PROFILE_NOT_FOUND') {
    return 'We could not find your organiser profile. Ask an administrator to check your account.'
  }
  if (error?.code === 'ROLE_MISMATCH') {
    return 'Your account does not have organiser access.'
  }
  if (error?.code === 'BULK_ALLOCATION_UNAVAILABLE') {
    return 'Bulk allocation is not available right now. Try again later.'
  }
  if (error?.code === 'VALIDATION_ERROR') {
    return error?.message || fallback
  }
  return fallback
}

function formatDateTime(isoValue) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoValue))
}

/** One row of the review step: who is proposed, and what the organiser did with it. */
function planKey(requirementId, proposedTutorId) {
  return `${requirementId}:${proposedTutorId}`
}

export default function BulkAllocation() {
  const { getAccessTokenSilently } = useAuth0()

  const [status, setStatus] = useState('loading')
  const [requirements, setRequirements] = useState([])
  const [errorMessage, setErrorMessage] = useState('')

  const [selectedIds, setSelectedIds] = useState([])
  const [minimumMark, setMinimumMark] = useState(DEFAULT_MINIMUM_MARK)

  const [previewStatus, setPreviewStatus] = useState('idle')
  const [previewItems, setPreviewItems] = useState([])
  const [plan, setPlan] = useState({})
  const [actionError, setActionError] = useState('')

  const [commitStatus, setCommitStatus] = useState('idle')
  const [results, setResults] = useState([])

  const loadRequirements = useCallback(
    async (isActive = () => true) => {
      setStatus('loading')
      setErrorMessage('')

      try {
        // Only open requirements can be staffed, and the shortage tells us how
        // many places each one still needs. The server works both out.
        const result = await listStaffingRequirements({ status: 'OPEN' }, getAccessTokenSilently)
        if (!isActive()) return

        setRequirements(result.filter((requirement) => requirement.shortageTutors > 0))
        setStatus('success')
      } catch (err) {
        if (!isActive()) return

        setRequirements([])
        setErrorMessage(safeErrorMessage(err, 'Staffing requirements could not be loaded safely.'))
        setStatus('error')
      }
    },
    [getAccessTokenSilently],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRequirements(() => active)
    return () => {
      active = false
    }
  }, [loadRequirements])

  function toggleRequirement(requirementId) {
    setSelectedIds((current) =>
      current.includes(requirementId)
        ? current.filter((id) => id !== requirementId)
        : [...current, requirementId],
    )
  }

  async function handlePreview(event) {
    event.preventDefault()
    if (selectedIds.length === 0) return

    setPreviewStatus('loading')
    setActionError('')
    setResults([])

    try {
      const items = await previewBulkAllocations(
        { requirementIds: selectedIds, minimumMark: Number(minimumMark) },
        getAccessTokenSilently,
      )
      setPreviewItems(items)
      // Every proposal starts included, with the proposed tutor accepted.
      setPlan(
        Object.fromEntries(
          items.flatMap((item) =>
            item.proposals.map((proposal) => [
              planKey(item.requirementId, proposal.tutorId),
              { include: true, tutorId: proposal.tutorId, reason: '' },
            ]),
          ),
        ),
      )
      setPreviewStatus('success')
    } catch (err) {
      setPreviewItems([])
      setActionError(safeErrorMessage(err, 'The preview could not be produced safely.'))
      setPreviewStatus('error')
    }
  }

  function updatePlan(key, changes) {
    setPlan((current) => ({ ...current, [key]: { ...current[key], ...changes } }))
  }

  const includedRows = previewItems.flatMap((item) =>
    item.proposals
      .map((proposal) => ({
        item,
        proposal,
        key: planKey(item.requirementId, proposal.tutorId),
      }))
      .filter(({ key }) => plan[key]?.include),
  )

  // A changed tutor needs a reason; the server refuses one without it, so the
  // button stays disabled rather than sending a request that cannot succeed.
  const missingReason = includedRows.some(
    ({ key, proposal }) =>
      plan[key].tutorId !== proposal.tutorId && !plan[key].reason.trim(),
  )

  async function handleCommit() {
    if (includedRows.length === 0 || missingReason || commitStatus === 'saving') return

    setCommitStatus('saving')
    setActionError('')

    try {
      const saved = await commitBulkAllocations(
        {
          minimumMark: Number(minimumMark),
          items: includedRows.map(({ item, proposal, key }) => ({
            requirementId: item.requirementId,
            tutorId: plan[key].tutorId,
            proposedTutorId: proposal.tutorId,
            ...(plan[key].tutorId === proposal.tutorId
              ? {}
              : { overrideReason: plan[key].reason.trim() }),
          })),
        },
        getAccessTokenSilently,
      )
      setResults(saved)
      setPreviewItems([])
      setPlan({})
      setPreviewStatus('idle')
      await loadRequirements()
    } catch (err) {
      setActionError(safeErrorMessage(err, 'The allocations could not be saved safely.'))
    } finally {
      setCommitStatus('idle')
    }
  }

  function tutorNameFor(item, tutorId) {
    return (
      [...item.proposals, ...item.alternatives].find(
        (candidate) => candidate.tutorId === tutorId,
      )?.fullName ?? `Tutor ${tutorId}`
    )
  }

  return (
    <main id="main-content" className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Organiser workspace</p>
          <h1>Bulk allocation</h1>
          <p className="helper-text">
            Choose staffing requirements, see what would be assigned, adjust it, then confirm.
            Nothing is saved until you confirm.
          </p>
        </div>
      </header>

      {status === 'loading' && (
        <LoadingState
          title="Loading staffing requirements..."
          message="Please wait while we load the requirements that still need filling."
        />
      )}

      {status === 'error' && (
        <ErrorState
          title="Staffing requirements unavailable"
          message={errorMessage}
          onRetry={() => loadRequirements()}
        />
      )}

      {status === 'success' && requirements.length === 0 && (
        <EmptyState
          title="Nothing needs filling"
          message="Every open staffing requirement is already covered."
        />
      )}

      {status === 'success' && requirements.length > 0 && (
        <section className="role-card" aria-labelledby="bulk-choose-heading">
          <form onSubmit={handlePreview} noValidate>
            <h2 id="bulk-choose-heading">Choose requirements</h2>

            <ul className="bulk-choice-list">
              {requirements.map((requirement) => (
                <li key={requirement.id} className="checkbox-field">
                  <input
                    id={`bulk-requirement-${requirement.id}`}
                    type="checkbox"
                    checked={selectedIds.includes(requirement.id)}
                    onChange={() => toggleRequirement(requirement.id)}
                  />
                  <label htmlFor={`bulk-requirement-${requirement.id}`}>
                    {requirement.courseCode}, {formatDateTime(requirement.startsAt)} to{' '}
                    {formatDateTime(requirement.endsAt)}
                    <span className="helper-text">
                      {requirement.shortageHours} tutor hours short,{' '}
                      {requirement.shortageTutors}{' '}
                      {requirement.shortageTutors === 1 ? 'tutor' : 'tutors'} needed
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="field-group">
              <label htmlFor="bulk-minimum-mark">Minimum mark (%)</label>
              <input
                id="bulk-minimum-mark"
                type="number"
                min="0"
                max="100"
                step="any"
                value={minimumMark}
                onChange={(event) => setMinimumMark(event.target.value)}
              />
            </div>

            <div className="button-row">
              <button
                className="primary-button"
                type="submit"
                disabled={selectedIds.length === 0 || previewStatus === 'loading'}
              >
                {previewStatus === 'loading' ? 'Previewing...' : 'Preview allocations'}
              </button>
            </div>
          </form>
        </section>
      )}

      {actionError && (
        <p className="status-note danger" role="alert">
          {actionError}
        </p>
      )}

      {previewStatus === 'success' && previewItems.length > 0 && (
        <section className="role-card" aria-labelledby="bulk-preview-heading">
          <h2 id="bulk-preview-heading">Preview</h2>
          <p className="helper-text">
            <strong>Ranked by mark band, then who is least busy that week.</strong> Nothing
            here is saved yet.
          </p>

          {previewItems.map((item) => (
            <article key={item.requirementId} className="bulk-preview-item">
              <h3>
                {item.courseCode}
                <span className="helper-text">
                  {' '}
                  {formatDateTime(item.startsAt)} to {formatDateTime(item.endsAt)},{' '}
                  {item.windowHours} hours
                </span>
              </h3>

              {item.proposals.length === 0 ? (
                <p className="empty-inline" role="status">
                  No eligible tutor could be proposed for this session.
                </p>
              ) : (
                <ul className="bulk-proposal-list">
                  {item.proposals.map((proposal) => {
                    const key = planKey(item.requirementId, proposal.tutorId)
                    const row = plan[key] ?? { include: true, tutorId: proposal.tutorId, reason: '' }
                    const changed = row.tutorId !== proposal.tutorId

                    return (
                      <li key={proposal.tutorId} className="bulk-proposal">
                        <div className="checkbox-field">
                          <input
                            id={`bulk-include-${key}`}
                            type="checkbox"
                            checked={row.include}
                            onChange={() => updatePlan(key, { include: !row.include })}
                          />
                          <label htmlFor={`bulk-include-${key}`}>
                            Include {tutorNameFor(item, row.tutorId)}
                          </label>
                        </div>

                        <ul
                          className="candidate-chips"
                          aria-label={`Why ${proposal.fullName} is proposed`}
                        >
                          <li className="summary-pill">Mark {proposal.mark}%</li>
                          <li className="summary-pill">
                            {proposal.usedHours} of {proposal.weeklyLimit} hours used that week
                          </li>
                          <li className="summary-pill">{proposal.hours} tutor hours</li>
                        </ul>

                        <div className="field-group">
                          <label htmlFor={`bulk-tutor-${key}`}>Tutor</label>
                          <select
                            id={`bulk-tutor-${key}`}
                            value={row.tutorId}
                            disabled={!row.include}
                            onChange={(event) =>
                              updatePlan(key, { tutorId: Number(event.target.value) })
                            }
                          >
                            <option value={proposal.tutorId}>
                              {proposal.fullName} (proposed)
                            </option>
                            {/* Only eligible tutors are ever offered here. */}
                            {item.alternatives.map((alternative) => (
                              <option key={alternative.tutorId} value={alternative.tutorId}>
                                {alternative.fullName}
                              </option>
                            ))}
                          </select>
                        </div>

                        {changed && row.include && (
                          <div className="field-group">
                            <label htmlFor={`bulk-reason-${key}`}>
                              Why this tutor instead?
                            </label>
                            <textarea
                              id={`bulk-reason-${key}`}
                              value={row.reason}
                              onChange={(event) =>
                                updatePlan(key, { reason: event.target.value })
                              }
                              aria-invalid={!row.reason.trim()}
                              aria-describedby={
                                row.reason.trim() ? undefined : `bulk-reason-error-${key}`
                              }
                            />
                            {!row.reason.trim() && (
                              <p id={`bulk-reason-error-${key}`} className="error-text">
                                Give a reason for choosing a different tutor.
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {item.note && (
                <p className="status-note" role="status">
                  {item.note}
                </p>
              )}
            </article>
          ))}

          <div className="button-row">
            <button
              className="primary-button"
              type="button"
              onClick={handleCommit}
              disabled={includedRows.length === 0 || missingReason || commitStatus === 'saving'}
            >
              {commitStatus === 'saving'
                ? 'Saving allocations...'
                : `Confirm ${includedRows.length} ${includedRows.length === 1 ? 'allocation' : 'allocations'}`}
            </button>
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section className="role-card" aria-labelledby="bulk-results-heading">
          <h2 id="bulk-results-heading">Results</h2>
          <ul className="bulk-result-list">
            {results.map((result) => (
              <li key={`${result.requirementId}:${result.tutorId}`} className="bulk-result">
                <span className={`fill-state fill-${result.outcome === 'saved' ? 'fully-filled' : 'unfilled'}`}>
                  {result.outcome === 'saved' ? 'Saved' : 'Not saved'}
                </span>
                <span className="helper-text">
                  Requirement {result.requirementId}, tutor {result.tutorId}
                  {result.message ? `: ${result.message}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
