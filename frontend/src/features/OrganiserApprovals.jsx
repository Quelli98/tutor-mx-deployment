import { useState } from 'react'
import StudentSickNoteQueue from './StudentSickNoteQueue'
import { EmptyState, ErrorState, LoadingState } from '../components/shared/StatusMessage'
import { useOrganiserApprovals } from './useOrganiserApprovals'

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function OrganiserApprovals() {
  const [studentPending, setStudentPending] = useState(0)
  const {
    status,
    queues,
    error,
    message,
    pendingKey,
    reasons,
    reasonErrors,
    disputeError,
    totalPending,
    loadApprovals,
    updateReason,
    submitDecision,
    submitDisputeResolution,
  } = useOrganiserApprovals()

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
          <span className="summary-pill" aria-label={`${totalPending + studentPending} pending approvals`}>
            {totalPending + studentPending} pending
          </span>
        )}
      </header>

      <StudentSickNoteQueue onCountChange={setStudentPending}/>
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
