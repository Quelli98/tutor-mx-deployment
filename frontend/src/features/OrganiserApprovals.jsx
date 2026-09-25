import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  decideExcuse,
  decideTimesheet,
  decideVolunteerClaim,
  listOrganiserApprovals,
  listTimesheetDisputes,
  resolveTimesheetDispute,
} from '../api/organiser'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function approvalError(error, loading = false) {
  if (
    error?.code === 'TIMESHEET_DECISION_CONFLICT' ||
    error?.code === 'VOLUNTEER_CLAIM_DECISION_CONFLICT' ||
    error?.code === 'EXCUSE_DECISION_CONFLICT' ||
    error?.code === 'TIMESHEET_DISPUTE_CONFLICT'
  ) {
    return 'This request changed before your decision was saved. The queue has been refreshed.'
  }
  if (error?.code === 'PROFILE_NOT_FOUND' || error?.code === 'ORGANISER_PROFILE_NOT_FOUND') {
    return 'Your organiser profile could not be found. Ask an administrator to check your account.'
  }
  if (error?.code === 'ROLE_MISMATCH') {
    return 'Your account does not have organiser access.'
  }
  return loading
    ? 'We could not load the approval queue. Please try again.'
    : 'We could not confirm the decision. Refresh the queue before trying again.'
}

export default function OrganiserApprovals() {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [queues, setQueues] = useState({ timesheets: [], volunteerClaims: [], excuses: [], disputes: [] })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingKey, setPendingKey] = useState('')
  const [reasons, setReasons] = useState({})
  const [reasonErrors, setReasonErrors] = useState({})
  const [disputeError, setDisputeError] = useState('')
  const busyRef = useRef(false)
  const loadVersion = useRef(0)

  const loadApprovals = useCallback(
    async ({ silent = false, clearError = false } = {}) => {
      const version = ++loadVersion.current
      if (!silent) setStatus('loading')
      if (!silent || clearError) setError('')
      try {
        const [approvals, disputes] = await Promise.allSettled([
          listOrganiserApprovals(getAccessTokenSilently),
          listTimesheetDisputes(getAccessTokenSilently),
        ])
        if (version !== loadVersion.current) return
        if (approvals.status === 'rejected') throw approvals.reason
        setQueues((current) => ({ ...approvals.value, disputes: disputes.status === 'fulfilled' ? disputes.value : current.disputes }))
        setDisputeError(disputes.status === 'rejected' ? 'Disputes could not be loaded. Other approvals are available.' : '')
        setStatus('success')
      } catch (loadError) {
        if (version !== loadVersion.current) return
        setError(silent ? 'The queue could not be refreshed. Your saved decisions are unchanged; refresh before reviewing more requests.' : approvalError(loadError, true))
        if (!silent) setStatus('error')
      }
    },
    [getAccessTokenSilently],
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadApprovals()
    return () => { loadVersion.current += 1 }
  }, [loadApprovals])

  function updateReason(key, value) {
    setReasons((current) => ({ ...current, [key]: value }))
    setReasonErrors((current) => ({ ...current, [key]: '' }))
    setMessage('')
    setError('')
  }

  async function submitDecision({ type, id, decision, personName }) {
    if (busyRef.current) return
    const key = `${type}-${id}`
    const negativeDecision = decision === 'RETURN' || decision === 'REJECT'
    const reason = reasons[key]?.trim() ?? ''
    if (negativeDecision && !reason) {
      setReasonErrors((current) => ({
        ...current,
        [key]:
          decision === 'RETURN'
            ? 'Add a reason for returning this timesheet.'
            : type === 'excuse'
              ? 'Add a reason for rejecting this excuse.'
              : 'Add a reason for rejecting this claim.',
      }))
      return
    }

    busyRef.current = true
    setPendingKey(`${key}-${decision}`)
    setMessage('')
    setError('')
    try {
      if (type === 'timesheet') {
        await decideTimesheet(
          { timesheetId: id, decision, ...(reason ? { reason } : {}) },
          getAccessTokenSilently,
        )
      } else if (type === 'excuse') {
        // The existing decision endpoint, reused as it is.
        await decideExcuse(
          { excuseId: id, decision, ...(reason ? { reason } : {}) },
          getAccessTokenSilently,
        )
      } else {
        await decideVolunteerClaim(
          { claimId: id, decision, ...(reason ? { reason } : {}) },
          getAccessTokenSilently,
        )
      }
      const collection = type === 'timesheet' ? 'timesheets' : type === 'excuse' ? 'excuses' : 'volunteerClaims'
      setQueues((current) => ({ ...current, [collection]: current[collection].filter((item) => item.id !== id) }))
      await loadApprovals({ silent: true })
      setMessage(
        decision === 'APPROVE'
          ? `${personName}'s request was approved.`
          : `${personName}'s request was ${decision === 'RETURN' ? 'returned' : 'rejected'}.`,
      )
      setReasons((current) => ({ ...current, [key]: '' }))
    } catch (decisionError) {
      setError(approvalError(decisionError))
      if (
        decisionError?.code === 'TIMESHEET_DECISION_CONFLICT' ||
        decisionError?.code === 'VOLUNTEER_CLAIM_DECISION_CONFLICT' ||
        // A decision someone else already made: show the server's state rather
        // than letting the card sit there as though it worked twice.
        decisionError?.code === 'EXCUSE_DECISION_CONFLICT'
      ) {
        await loadApprovals({ silent: true })
      }
    } finally {
      busyRef.current = false
      setPendingKey('')
    }
  }

  async function submitDisputeResolution({ id, tutorName }) {
    if (busyRef.current) return
    const decision = 'RESOLVE'
    const key = `dispute-${id}`
    const reason = reasons[key]?.trim() ?? ''
    if (!reason) {
      setReasonErrors((current) => ({
        ...current,
        [key]: 'A resolution reason is required.',
      }))
      return
    }

    busyRef.current = true
    setPendingKey(`${key}-${decision}`)
    setMessage('')
    setError('')
    try {
      await resolveTimesheetDispute(
        { disputeId: id, resolutionReason: reason },
        getAccessTokenSilently,
      )
      setQueues((current) => ({ ...current, disputes: current.disputes.filter((item) => item.id !== id) }))
      await loadApprovals({ silent: true })
      setMessage(`${tutorName || 'The tutor'}'s dispute was resolved. The timesheet status is unchanged.`)
      setReasons((current) => ({ ...current, [key]: '' }))
    } catch (decisionError) {
      setError(approvalError(decisionError))
      if (decisionError?.code === 'TIMESHEET_DISPUTE_CONFLICT') {
        await loadApprovals({ silent: true })
      }
    } finally {
      busyRef.current = false
      setPendingKey('')
    }
  }

  const totalPending = queues.timesheets.length + queues.volunteerClaims.length + queues.excuses.length + queues.disputes.length

  return (
    <main id="main-content" className="dashboard-shell organiser-approvals">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Organiser review</p>
          <h1>Approvals</h1>
          <p className="helper-text">
            Review timesheets, volunteer claims, excuses and disputes in one place.
          </p>
        </div>
        {status === 'success' && (
          <span className="summary-pill" aria-label={`${totalPending} pending approvals`}>
            {totalPending} pending
          </span>
        )}
      </header>

      {message && <p className="status-note" role="status">{message}</p>}
      {error && status !== 'error' && <div className="approval-notice" role="alert"><p>{error}</p><button type="button" className="secondary-button" disabled={Boolean(pendingKey)} onClick={() => loadApprovals({ silent: true, clearError: true })}>Refresh queue</button></div>}

      {status === 'loading' && (
        <LoadingState title="Loading approvals..." message="Fetching the latest pending requests." />
      )}
      {status === 'error' && (
        <ErrorState title="Approvals unavailable" message={error} onRetry={loadApprovals} />
      )}

      {status === 'success' && (
        <div className="approval-sections">
          <section className="role-card" aria-labelledby="timesheet-approvals-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Tutor submissions</p>
                <h2 id="timesheet-approvals-heading">Timesheets</h2>
              </div>
              <span className="count-badge">{queues.timesheets.length}</span>
            </div>

            {queues.timesheets.length === 0 ? (
              <EmptyState
                title="No timesheets waiting"
                message="Submitted tutor timesheets will appear here for review."
              />
            ) : (
              <div className="approval-list">
                {queues.timesheets.map((timesheet) => {
                  const key = `timesheet-${timesheet.id}`
                  const busy = Boolean(pendingKey)
                  return (
                    <article className="approval-card" key={timesheet.id}>
                      <div className="approval-card-header">
                        <div>
                          <h3>{timesheet.tutorName}</h3>
                          <p>{timesheet.tutorEmail}</p>
                        </div>
                        <span className="status-badge status-submitted">Submitted</span>
                      </div>
                      <dl className="approval-facts">
                        <div><dt>Week starting</dt><dd>{formatDate(timesheet.weekStart)}</dd></div>
                        <div><dt>Total</dt><dd>{timesheet.totalHours} hours</dd></div>
                        <div><dt>Submitted</dt><dd>{timesheet.submittedAt ? formatDateTime(timesheet.submittedAt) : 'Not recorded'}</dd></div>
                      </dl>
                      <div className="responsive-table-wrap">
                        <table className="data-table compact-table">
                          <thead><tr><th>Course</th><th>Date</th><th>Hours</th><th>Work completed</th></tr></thead>
                          <tbody>
                            {timesheet.workLogs.map((log) => (
                              <tr key={log.id}>
                                <td>{log.courseCode}</td>
                                <td>{formatDate(log.workDate)}</td>
                                <td>{log.hours}</td>
                                <td>{log.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="approval-decision">
                        <div className="field-group">
                          <label htmlFor={`${key}-reason`}>Return reason</label>
                          <textarea
                            id={`${key}-reason`}
                            rows="2"
                            maxLength={1000}
                            value={reasons[key] ?? ''}
                            onChange={(event) => updateReason(key, event.target.value)}
                            disabled={busy}
                            aria-invalid={Boolean(reasonErrors[key])}
                            aria-describedby={reasonErrors[key] ? `${key}-reason-error` : undefined}
                            placeholder="Required only when returning"
                          />
                          {reasonErrors[key] && <p id={`${key}-reason-error`} className="error-text">{reasonErrors[key]}</p>}
                        </div>
                        <div className="approval-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => submitDecision({ type: 'timesheet', id: timesheet.id, decision: 'RETURN', personName: timesheet.tutorName })}
                          >
                            {pendingKey === `${key}-RETURN` ? 'Returning...' : 'Return for correction'}
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={busy}
                            onClick={() => submitDecision({ type: 'timesheet', id: timesheet.id, decision: 'APPROVE', personName: timesheet.tutorName })}
                          >
                            {pendingKey === `${key}-APPROVE` ? 'Approving...' : 'Approve timesheet'}
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="role-card" aria-labelledby="claim-approvals-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Student volunteers</p>
                <h2 id="claim-approvals-heading">Overflow claims</h2>
              </div>
              <span className="count-badge">{queues.volunteerClaims.length}</span>
            </div>

            {queues.volunteerClaims.length === 0 ? (
              <EmptyState
                title="No overflow claims waiting"
                message="Student volunteer claims will appear here while the work remains open."
              />
            ) : (
              <div className="approval-list">
                {queues.volunteerClaims.map((claim) => {
                  const key = `claim-${claim.id}`
                  const busy = Boolean(pendingKey)
                  return (
                    <article className="approval-card" key={claim.id}>
                      <div className="approval-card-header">
                        <div>
                          <h3>{claim.studentName}</h3>
                          <p>{claim.studentEmail}</p>
                        </div>
                        <span className="status-badge status-pending">Pending</span>
                      </div>
                      <p className="approval-course"><strong>{claim.courseCode}</strong> · {claim.courseName}</p>
                      <dl className="approval-facts">
                        <div><dt>Session</dt><dd>{formatDateTime(claim.startsAt)}</dd></div>
                        <div><dt>Hours</dt><dd>{claim.hours}</dd></div>
                        <div><dt>Claimed</dt><dd>{formatDateTime(claim.createdAt)}</dd></div>
                      </dl>
                      <div className="approval-decision">
                        <div className="field-group">
                          <label htmlFor={`${key}-reason`}>Rejection reason</label>
                          <textarea
                            id={`${key}-reason`}
                            rows="2"
                            maxLength={1000}
                            value={reasons[key] ?? ''}
                            onChange={(event) => updateReason(key, event.target.value)}
                            disabled={busy}
                            aria-invalid={Boolean(reasonErrors[key])}
                            aria-describedby={reasonErrors[key] ? `${key}-reason-error` : undefined}
                            placeholder="Required only when rejecting"
                          />
                          {reasonErrors[key] && <p id={`${key}-reason-error`} className="error-text">{reasonErrors[key]}</p>}
                        </div>
                        <div className="approval-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => submitDecision({ type: 'claim', id: claim.id, decision: 'REJECT', personName: claim.studentName })}
                          >
                            {pendingKey === `${key}-REJECT` ? 'Rejecting...' : 'Reject claim'}
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={busy}
                            onClick={() => submitDecision({ type: 'claim', id: claim.id, decision: 'APPROVE', personName: claim.studentName })}
                          >
                            {pendingKey === `${key}-APPROVE` ? 'Approving...' : 'Approve claim'}
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="role-card" aria-labelledby="excuse-approvals-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Tutor excuses</p>
                <h2 id="excuse-approvals-heading">Excuses</h2>
              </div>
              <span className="count-badge">{queues.excuses.length}</span>
            </div>

            {queues.excuses.length === 0 ? (
              <EmptyState
                title="No excuses waiting"
                message="Excuses appear here while a tutor is asking to be released from a session."
              />
            ) : (
              <div className="approval-list">
                {queues.excuses.map((excuse) => {
                  const key = `excuse-${excuse.id}`
                  const busy = Boolean(pendingKey)
                  return (
                    <article className="approval-card" key={excuse.id}>
                      <div className="approval-card-header">
                        <div>
                          <h3>{excuse.tutorName}</h3>
                          <p>{excuse.tutorEmail}</p>
                        </div>
                        <span className="status-badge status-pending">Pending</span>
                      </div>
                      <p className="approval-course"><strong>{excuse.courseCode}</strong> · {excuse.courseName}</p>
                      <dl className="approval-facts">
                        <div><dt>Session</dt><dd>{formatDateTime(excuse.startsAt)}</dd></div>
                        <div><dt>Asked</dt><dd>{formatDateTime(excuse.createdAt)}</dd></div>
                        <div><dt>Their reason</dt><dd>{excuse.reason}</dd></div>
                      </dl>
                      <div className="approval-decision">
                        <div className="field-group">
                          <label htmlFor={`${key}-reason`}>Rejection reason</label>
                          <textarea
                            id={`${key}-reason`}
                            rows="2"
                            maxLength={1000}
                            value={reasons[key] ?? ''}
                            onChange={(event) => updateReason(key, event.target.value)}
                            disabled={busy}
                            aria-invalid={Boolean(reasonErrors[key])}
                            aria-describedby={reasonErrors[key] ? `${key}-reason-error` : undefined}
                            placeholder="Required only when rejecting"
                          />
                          {reasonErrors[key] && <p id={`${key}-reason-error`} className="error-text">{reasonErrors[key]}</p>}
                        </div>
                        <div className="approval-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => submitDecision({ type: 'excuse', id: excuse.id, decision: 'REJECT', personName: excuse.tutorName })}
                          >
                            {pendingKey === `${key}-REJECT` ? 'Rejecting...' : 'Reject excuse'}
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={busy}
                            onClick={() => submitDecision({ type: 'excuse', id: excuse.id, decision: 'APPROVE', personName: excuse.tutorName })}
                          >
                            {pendingKey === `${key}-APPROVE` ? 'Approving...' : 'Approve excuse'}
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="role-card" aria-labelledby="dispute-approvals-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Timesheet objections</p>
                <h2 id="dispute-approvals-heading">Disputes</h2>
              </div>
              <span className="count-badge">{queues.disputes.length}</span>
            </div>

            {disputeError && <div className="approval-notice" role="alert"><p>{disputeError}</p><button type="button" className="secondary-button" disabled={Boolean(pendingKey)} onClick={() => loadApprovals({ silent: true, clearError: true })}>Retry disputes</button></div>}
            {queues.disputes.length === 0 && !disputeError ? (
              <EmptyState
                title="No disputes waiting"
                message="Tutor disputes over timesheet decisions will appear here."
              />
            ) : (
              <div className="approval-list">
                {queues.disputes.map((dispute) => {
                  const key = `dispute-${dispute.id}`
                  const busy = Boolean(pendingKey)
                  return (
                    <article className="approval-card" key={dispute.id}>
                      <div className="approval-card-header">
                        <div>
                          <h3>{dispute.tutorName || `Tutor #${dispute.tutorId}`}</h3>
                          <p>{dispute.tutorEmail}</p>
                        </div>
                        <span className="status-badge status-pending">Disputed</span>
                      </div>
                      <dl className="approval-facts">
                        <div><dt>Timesheet</dt><dd>#{dispute.timesheetId}</dd></div>
                        <div><dt>Raised</dt><dd>{formatDateTime(dispute.createdAt)}</dd></div>
                      </dl>
                      <p className="approval-reason"><strong>Reason:</strong> {dispute.reason}</p>
                      <div className="approval-decision">
                        <div className="field-group">
                          <label htmlFor={`${key}-reason`}>Resolution reason</label>
                          <p className="helper-text">Record your response to the objection. Resolving it leaves the timesheet status unchanged.</p>
                          <textarea
                            id={`${key}-reason`}
                            rows="2"
                            maxLength={1000}
                            value={reasons[key] ?? ''}
                            onChange={(event) => updateReason(key, event.target.value)}
                            disabled={busy}
                            aria-invalid={Boolean(reasonErrors[key])}
                            aria-describedby={reasonErrors[key] ? `${key}-reason-error` : undefined}
                            placeholder="Required: explain your decision"
                          />
                          {reasonErrors[key] && <p id={`${key}-reason-error`} className="error-text">{reasonErrors[key]}</p>}
                        </div>
                        <div className="approval-actions">
                          <button type="button" className="primary-button" disabled={busy || Boolean(disputeError)}
                            onClick={() => submitDisputeResolution({ id: dispute.id, tutorName: dispute.tutorName || `Tutor #${dispute.tutorId}` })}>
                            {pendingKey === `${key}-RESOLVE` ? 'Resolving...' : 'Resolve dispute'}
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
