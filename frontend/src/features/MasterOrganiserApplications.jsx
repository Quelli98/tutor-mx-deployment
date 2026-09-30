import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApiToken } from '../api/client'
import {
  approveOrganiserApplication,
  listOrganiserApplications,
  rejectOrganiserApplication,
} from '../api/organiserApplications'

const FILTERS = ['PENDING', 'APPROVED', 'REJECTED']

function titleCaseStatus(status) {
  if (status === 'PENDING') return 'Pending'
  if (status === 'APPROVED') return 'Approved'
  if (status === 'REJECTED') return 'Rejected'
  return status
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function MasterOrganiserApplications() {
  const tokenOrGetter = useApiToken()
  const [applications, setApplications] = useState([])
  const [filter, setFilter] = useState('PENDING')
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)
  const [reviewReason, setReviewReason] = useState('')

  const loadApplications = useCallback(async () => {
    setStatus('loading')
    setMessage('')
    try {
      setApplications(await listOrganiserApplications(tokenOrGetter))
      setStatus('success')
    } catch (error) {
      setApplications([])
      setStatus('error')
      setMessage(error?.message || 'Organiser applications could not be loaded.')
    }
  }, [tokenOrGetter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadApplications()
  }, [loadApplications])

  const counts = useMemo(() => Object.fromEntries(
    FILTERS.map((candidate) => [candidate, applications.filter((item) => item.status === candidate).length]),
  ), [applications])

  const visible = useMemo(
    () => applications.filter((application) => application.status === filter),
    [applications, filter],
  )

  const replaceApplication = (updated) => {
    if (!updated) return
    setApplications((current) => current.map((item) => item.id === updated.id ? updated : item))
  }

  const handleApprove = async (application) => {
    if (busyId) return
    setBusyId(application.id)
    setMessage('')
    try {
      const updated = await approveOrganiserApplication(application.id, tokenOrGetter)
      replaceApplication(updated)
      setMessage(`${application.applicant.fullName} has been approved as an organiser.`)
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setMessage(error?.message || 'The organiser application could not be approved.')
      await loadApplications()
    } finally {
      setBusyId(null)
    }
  }

  const beginReject = (application) => {
    if (busyId) return
    setRejectingId(application.id)
    setReviewReason('')
    setMessage('')
  }

  const cancelReject = () => {
    if (busyId) return
    setRejectingId(null)
    setReviewReason('')
  }

  const handleReject = async (application) => {
    if (busyId) return
    setBusyId(application.id)
    setMessage('')
    try {
      const updated = await rejectOrganiserApplication(application.id, reviewReason.trim(), tokenOrGetter)
      replaceApplication(updated)
      setRejectingId(null)
      setReviewReason('')
      setMessage(`${application.applicant.fullName}'s organiser application was rejected.`)
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setMessage(error?.message || 'The organiser application could not be rejected.')
      await loadApplications()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main id="main-content" className="dashboard-shell master-organiser-page">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Master Organiser</p>
          <h1>Organiser applications</h1>
          <p className="helper-text">
            Review lecturer registrations for organiser access. Applicants cannot enter the organiser workspace until a Master Organiser approves them.
          </p>
        </div>
      </header>

      <section className="role-card master-organiser-summary" aria-label="Application filters">
        <div className="organiser-application-tabs" role="tablist" aria-label="Filter organiser applications">
          {FILTERS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={filter === candidate}
              className={`organiser-application-tab${filter === candidate ? ' active' : ''}`}
              onClick={() => setFilter(candidate)}
            >
              {titleCaseStatus(candidate)} <span>{counts[candidate] ?? 0}</span>
            </button>
          ))}
        </div>
      </section>

      {status === 'loading' && <p className="status-message loading">Loading organiser applications…</p>}
      {message && <p className={`status-message ${status === 'error' ? 'error' : 'success'}`}>{message}</p>}

      {status !== 'loading' && visible.length === 0 && (
        <section className="role-card">
          <h2>No {titleCaseStatus(filter).toLowerCase()} applications</h2>
          <p className="helper-text">There are no organiser applications in this queue right now.</p>
        </section>
      )}

      <section className="organiser-application-list" aria-live="polite">
        {visible.map((application) => {
          const isBusy = busyId === application.id
          const isRejecting = rejectingId === application.id
          return (
            <article key={application.id} className="role-card organiser-review-card">
              <div className="section-heading-row">
                <div>
                  <p className="section-kicker">Applicant</p>
                  <h2>{application.applicant.fullName}</h2>
                  <p className="helper-text organiser-review-email">{application.applicant.email}</p>
                </div>
                <span className={`organiser-application-badge is-${String(application.status).toLowerCase()}`}>
                  {titleCaseStatus(application.status)}
                </span>
              </div>

              <dl className="organiser-application-details">
                <div><dt>Applied</dt><dd>{formatDate(application.createdAt)}</dd></div>
                {application.reviewedAt && <div><dt>Reviewed</dt><dd>{formatDate(application.reviewedAt)}</dd></div>}
                {application.reviewer && <div><dt>Reviewed by</dt><dd>{application.reviewer.fullName}</dd></div>}
              </dl>

              <div className="organiser-application-copy">
                <strong>Account type</strong>
                <p>Lecturer organiser registration</p>
              </div>

              {application.reviewReason && (
                <div className="organiser-application-copy">
                  <strong>Review note</strong>
                  <p>{application.reviewReason}</p>
                </div>
              )}

              {application.status === 'PENDING' && !isRejecting && (
                <div className="button-row organiser-review-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={Boolean(busyId)}
                    onClick={() => handleApprove(application)}
                  >
                    {isBusy ? 'Approving…' : 'Approve organiser'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={Boolean(busyId)}
                    onClick={() => beginReject(application)}
                  >
                    Reject
                  </button>
                </div>
              )}

              {application.status === 'PENDING' && isRejecting && (
                <div className="organiser-reject-panel">
                  <label htmlFor={`review-reason-${application.id}`}>Review note (optional)</label>
                  <textarea
                    id={`review-reason-${application.id}`}
                    rows="4"
                    maxLength="500"
                    value={reviewReason}
                    onChange={(event) => setReviewReason(event.target.value)}
                    placeholder="Explain why the application was not approved."
                  />
                  <div className="button-row">
                    <button
                      type="button"
                      className="danger-button"
                      disabled={Boolean(busyId)}
                      onClick={() => handleReject(application)}
                    >
                      {isBusy ? 'Rejecting…' : 'Confirm rejection'}
                    </button>
                    <button type="button" className="secondary-button" disabled={Boolean(busyId)} onClick={cancelReject}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </section>
    </main>
  )
}

export default MasterOrganiserApplications
