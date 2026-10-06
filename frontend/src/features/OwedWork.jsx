const ACTION_LABELS = Object.freeze({
  LOG_HOURS: 'Log hours',
  SUBMIT_TIMESHEET: 'Submit timesheet',
  RESUBMIT_TIMESHEET: 'Fix timesheet',
})

function whenText(item) {
  if (item.dueAt) {
    const due = new Date(item.dueAt).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    })
    return item.overdue ? `Was due ${due}` : `Due ${due}`
  }
  const sunday = new Date(`${item.weekEnding}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  return item.overdue ? `Week ended ${sunday}` : `For the week ending ${sunday}`
}

/** "What you owe and when": hours to log and timesheets to submit or fix. */
export default function OwedWork({ obligations }) {
  const overdueCount = obligations.filter((item) => item.overdue).length
  return (
    <section className="role-card owed-work" aria-labelledby="owed-work-heading">
      <div className="setup-card-heading">
        <div>
          <p className="eyebrow">Your to-do list</p>
          <h2 id="owed-work-heading">What you owe</h2>
        </div>
        {obligations.length > 0 && (
          <span className="setup-progress">
            {obligations.length} to do{overdueCount > 0 ? `, ${overdueCount} past due` : ''}
          </span>
        )}
      </div>
      {obligations.length === 0 ? (
        <p>You are up to date. There are no hours to log and no timesheets to submit.</p>
      ) : (
        <ul className="detail-record-list" aria-label="Work you still owe">
          {obligations.map((item) => (
            <li key={`${item.kind}-${item.allocationId ?? item.timesheetId}`}>
              <strong>{item.title}</strong>
              <span className={item.overdue ? 'owed-when overdue' : 'owed-when'}>{whenText(item)}</span>
              <a className="secondary-button" href="/tutor/forms">{ACTION_LABELS[item.kind]}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
