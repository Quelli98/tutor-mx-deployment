import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState, LoadingState } from '../shared/StatusMessage'
import { initials, shortDateTime } from '../../features/organiserHome'
import { OrganiserIcon } from './OrganiserIcon'

const ROWS_SHOWN = 4
const AVATAR_ACCENTS = ['indigo', 'magenta', 'violet', 'navy']

function weekOf(value) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value))
}

function courseCodes(workLogs) {
  return [...new Set(workLogs.map((log) => log.courseCode))].join(', ')
}

// Each tab: how to describe a request, and the decision that needs a written reason.
const TABS = [
  {
    id: 'timesheets',
    label: 'Timesheets',
    type: 'timesheet',
    empty: 'No timesheets waiting.',
    person: (item) => item.tutorName,
    meta: (item) => [courseCodes(item.workLogs), `Week of ${weekOf(item.weekStart)}`, `${item.totalHours} h`].filter(Boolean).join(' · '),
    thing: 'timesheet',
    negative: { decision: 'RETURN', label: 'Return', reasonLabel: 'Return reason', confirm: 'Return timesheet', busy: 'Returning...' },
  },
  {
    id: 'volunteerClaims',
    label: 'Overflow claims',
    type: 'claim',
    empty: 'No overflow claims waiting.',
    person: (item) => item.studentName,
    meta: (item) => `${item.courseCode} · ${shortDateTime(item.startsAt)} · ${item.hours} h`,
    thing: 'claim',
    negative: { decision: 'REJECT', label: 'Reject', reasonLabel: 'Rejection reason', confirm: 'Reject claim', busy: 'Rejecting...' },
  },
  {
    id: 'excuses',
    label: 'Excuses',
    type: 'excuse',
    empty: 'No excuses waiting.',
    person: (item) => item.tutorName,
    meta: (item) => `${item.courseCode} · ${shortDateTime(item.startsAt)}`,
    detail: (item) => `Their reason: ${item.reason}`,
    thing: 'excuse',
    negative: { decision: 'REJECT', label: 'Reject', reasonLabel: 'Rejection reason', confirm: 'Reject excuse', busy: 'Rejecting...' },
  },
  {
    id: 'disputes',
    label: 'Disputes',
    type: 'dispute',
    empty: 'No disputes waiting.',
    person: (item) => item.tutorName || `Tutor #${item.tutorId}`,
    meta: (item) => `Timesheet #${item.timesheetId} · Raised ${shortDateTime(item.createdAt)}`,
    detail: (item) => `Their reason: ${item.reason}`,
    thing: 'dispute',
  },
]

function ApprovalRow({ tab, item, index, approvals, openKey, onOpen, onClose }) {
  const person = tab.person(item)
  const key = `${tab.type}-${item.id}`
  const busy = Boolean(approvals.pendingKey)
  const writing = openKey === key
  const reasonId = `home-${key}-reason`
  const errorId = `${reasonId}-error`
  const negative = tab.negative
  const isDispute = tab.type === 'dispute'

  async function decide(decision) {
    const done = await approvals.submitDecision({ type: tab.type, id: item.id, decision, personName: person })
    if (done) onClose()
  }

  async function resolve() {
    const done = await approvals.submitDisputeResolution({ id: item.id, tutorName: person })
    if (done) onClose()
  }

  return (
    <li className="approval-row">
      <div className="approval-row-main">
        <span className={`home-avatar accent-${AVATAR_ACCENTS[index % AVATAR_ACCENTS.length]}`} aria-hidden="true">
          {initials(person)}
        </span>
        <div className="approval-row-words">
          <p className="approval-row-name">{person}</p>
          <p className="approval-row-meta">{tab.meta(item)}</p>
          {tab.detail && <p className="approval-row-detail">{tab.detail(item)}</p>}
        </div>
        {!writing && (
          <div className="approval-row-actions">
            {isDispute ? (
              <button type="button" className="secondary-button" disabled={busy} onClick={() => onOpen(key)} aria-label={`Resolve ${person}'s dispute`}>
                Resolve
              </button>
            ) : (
              <>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => onOpen(key)} aria-label={`${negative.label} ${person}'s ${tab.thing}`}>
                  {negative.label}
                </button>
                <button type="button" className="primary-button" disabled={busy} onClick={() => decide('APPROVE')} aria-label={`Approve ${person}'s ${tab.thing}`}>
                  <OrganiserIcon name="check" size={16} />
                  {approvals.pendingKey === `${key}-APPROVE` ? 'Approving...' : 'Approve'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {writing && (
        <div className="approval-row-reason">
          <label htmlFor={reasonId}>{isDispute ? 'Resolution reason' : negative.reasonLabel}</label>
          <textarea
            id={reasonId}
            rows="2"
            maxLength={1000}
            value={approvals.reasons[key] ?? ''}
            onChange={(event) => approvals.updateReason(key, event.target.value)}
            disabled={busy}
            aria-invalid={Boolean(approvals.reasonErrors[key])}
            aria-describedby={approvals.reasonErrors[key] ? errorId : undefined}
            placeholder={isDispute ? 'Explain your decision. The timesheet status stays the same.' : 'Tell them what to change'}
          />
          {approvals.reasonErrors[key] && <p id={errorId} className="error-text">{approvals.reasonErrors[key]}</p>}
          <div className="approval-row-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => { approvals.clearReason(key); onClose() }}>
              Cancel
            </button>
            {isDispute ? (
              <button type="button" className="primary-button" disabled={busy || Boolean(approvals.disputeError)} onClick={resolve}>
                {approvals.pendingKey === `${key}-RESOLVE` ? 'Resolving...' : 'Resolve dispute'}
              </button>
            ) : (
              <button type="button" className="primary-button" disabled={busy} onClick={() => decide(negative.decision)}>
                {approvals.pendingKey === `${key}-${negative.decision}` ? negative.busy : negative.confirm}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * "Needs your approval": the four approval queues as tabs, with the first few requests of the
 * open tab and their decisions. The full queue, with every detail, is on the Approvals page.
 */
export function HomeApprovals({ approvals }) {
  const [activeTab, setActiveTab] = useState('timesheets')
  const [openKey, setOpenKey] = useState('')
  const tabRefs = useRef({})
  const tab = TABS.find((entry) => entry.id === activeTab)
  const items = approvals.queues[tab.id] ?? []

  function choose(id) {
    setActiveTab(id)
    setOpenKey('')
  }

  function onTabKeyDown(event, index) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    choose(next.id)
    tabRefs.current[next.id]?.focus()
  }

  return (
    <section className="home-card" aria-labelledby="home-approvals-heading">
      <div className="home-card-heading">
        <h2 id="home-approvals-heading" className="card-title">
          <span className="card-title-icon accent-magenta"><OrganiserIcon name="check" size={18} /></span>
          Needs your approval
        </h2>
        <Link className="see-all-link" to="/organiser/approvals" aria-label="See all approvals">
          See all
        </Link>
      </div>

      {approvals.status === 'loading' && <LoadingState title="Loading approvals..." message="Fetching the latest pending requests." />}
      {approvals.status === 'error' && (
        <ErrorState title="Approvals unavailable" message={approvals.error} onRetry={() => approvals.loadApprovals()} />
      )}

      {approvals.status === 'success' && (
        <>
          <div className="approval-tabs" role="tablist" aria-label="Approval queues">
            {TABS.map((entry, index) => {
              const count = approvals.queues[entry.id]?.length ?? 0
              const selected = entry.id === activeTab
              return (
                <button
                  key={entry.id}
                  ref={(element) => { tabRefs.current[entry.id] = element }}
                  type="button"
                  role="tab"
                  id={`home-approvals-tab-${entry.id}`}
                  aria-selected={selected}
                  aria-controls="home-approvals-panel"
                  tabIndex={selected ? 0 : -1}
                  className={`approval-tab${selected ? ' active' : ''}`}
                  onClick={() => choose(entry.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  <span>{entry.label}</span>
                  <span className="approval-tab-count" aria-hidden="true">{count}</span>
                  <span className="visually-hidden">, {count} waiting</span>
                </button>
              )
            })}
          </div>

          {approvals.message && <p className="status-note" role="status">{approvals.message}</p>}
          {approvals.error && (
            <div className="approval-notice" role="alert">
              <p>{approvals.error}</p>
              <button type="button" className="secondary-button" disabled={Boolean(approvals.pendingKey)} onClick={() => approvals.loadApprovals({ silent: true, clearError: true })}>
                Refresh queue
              </button>
            </div>
          )}
          {tab.id === 'disputes' && approvals.disputeError && (
            <div className="approval-notice" role="alert">
              <p>{approvals.disputeError}</p>
              <button type="button" className="secondary-button" disabled={Boolean(approvals.pendingKey)} onClick={() => approvals.loadApprovals({ silent: true, clearError: true })}>
                Retry disputes
              </button>
            </div>
          )}

          <div id="home-approvals-panel" role="tabpanel" aria-labelledby={`home-approvals-tab-${tab.id}`}>
            {items.length === 0 ? (
              <p className="home-empty">{tab.empty}</p>
            ) : (
              <ul className="approval-rows">
                {items.slice(0, ROWS_SHOWN).map((item, index) => (
                  <ApprovalRow
                    key={item.id}
                    tab={tab}
                    item={item}
                    index={index}
                    approvals={approvals}
                    openKey={openKey}
                    onOpen={setOpenKey}
                    onClose={() => setOpenKey('')}
                  />
                ))}
              </ul>
            )}
            {items.length > ROWS_SHOWN && (
              <Link className="home-more-link" to="/organiser/approvals">
                See all {items.length} {tab.label.toLowerCase()}
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  )
}
