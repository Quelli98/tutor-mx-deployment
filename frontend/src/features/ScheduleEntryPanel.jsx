import { useState } from 'react'
import AvailabilityForm from './AvailabilityForm'
import TimetableImport from './TimetableImport'

export default function ScheduleEntryPanel({ tokenOrGetter, onChanged, role = 'TUTOR' }) {
  const [scheduleVersion, setScheduleVersion] = useState(0)
  const [activeTab, setActiveTab] = useState('manual')
  function tabKeys(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'manual' : event.key === 'End' ? 'import' : activeTab === 'manual' ? 'import' : 'manual'
    setActiveTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }
  function changed() { setScheduleVersion(value => value + 1); onChanged?.() }
  return (
      <section className="role-card tutor-form-card" aria-labelledby="add-to-timetable-heading">
        <div>
          <h2 id="add-to-timetable-heading">Add to my timetable</h2>
          <p className="helper-text">
            Import your classes from a file or add them manually. Both methods update the same calendar and {role === 'STUDENT' ? 'record when you are busy.' : 'block allocations during those times.'}
          </p>
        </div>
        <div className="timetable-tabs" role="tablist" aria-label="Timetable entry methods" onKeyDown={tabKeys}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'manual'}
            tabIndex={activeTab === 'manual' ? 0 : -1}
            aria-controls="tab-panel-manual"
            id="tab-manual"
            className={`timetable-tab-button${activeTab === 'manual' ? ' active' : ''}`}
            onClick={() => setActiveTab('manual')}
          >
            Add manually
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'import'}
            tabIndex={activeTab === 'import' ? 0 : -1}
            aria-controls="tab-panel-import"
            id="tab-import"
            className={`timetable-tab-button${activeTab === 'import' ? ' active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            Import timetable
          </button>
        </div>
        <div
          role="tabpanel"
          id="tab-panel-manual"
          aria-labelledby="tab-manual"
          hidden={activeTab !== 'manual'}
        >
          <AvailabilityForm role={role} showCalendar={role !== 'STUDENT'} onChanged={onChanged} refreshVersion={scheduleVersion} tokenOrGetter={tokenOrGetter} />
        </div>
        <div
          role="tabpanel"
          id="tab-panel-import"
          aria-labelledby="tab-import"
          hidden={activeTab !== 'import'}
        >
          <TimetableImport
            tokenOrGetter={tokenOrGetter}
            onImported={changed}
          />
        </div>
      </section>
  )
}
