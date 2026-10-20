import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getStudentOverflowWork } from '../api/studentOverflow'
import { listOwnTimeSlots } from '../api/availability'
import { EmptyState, ErrorState, LoadingState, SuccessState } from '../components/shared/StatusMessage'
import { getVolunteerRequests, volunteerForWork, withdrawVolunteerRequest } from '../api/studentVolunteer'
import { getPublicHolidays } from '../api/publicHolidays'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import { useApiToken } from '../api/client'
import { StatTile } from '../components/shared/StatTile'
import { OrganiserIcon } from '../components/organiser/OrganiserIcon'
import { StudentHero } from '../components/student/StudentHero'
import { StudentSchedule } from '../components/student/StudentSchedule'
import { courseTones, sameDay, splitRequests, studentSummary, workByDay } from './studentHome'

function shortWhen(value) {
    const date = new Date(value)
    return `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

function formatDateTime(value) {
    return new Intl.DateTimeFormat( 'en-ZA', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value))
}

/** A session on one day reads "Thu 8 Oct 2026 · 10:00–12:00"; one that crosses midnight keeps both dates. */
function sessionWindow(startsAt, endsAt) {
    const start = new Date(startsAt)
    const end = new Date(endsAt)
    if (start.toDateString() !== end.toDateString()) {
        return `${formatDateTime(startsAt)} – ${formatDateTime(endsAt)}`
    }
    const time = (value) => value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
    const day = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    return `${day} · ${time(start)}–${time(end)}`
}

function formatDate(value) {
    return new Intl.DateTimeFormat('en-ZA', {
        dateStyle: 'medium',
    }).format(new Date(`${value}T00:00:00.000Z`))
}

const clock = (value) => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

/** "14:15–17:00"; a session that runs past midnight names the day it ends. */
function timeWindow(startsAt, endsAt) {
    const start = new Date(startsAt)
    const end = new Date(endsAt)
    if (start.toDateString() === end.toDateString()) return `${clock(start)}–${clock(end)}`
    return `${clock(start)} – ${end.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock(end)}`
}

function longDay(date) {
    return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** "Today, Tuesday 6 October", "Tomorrow, …" or just the day. */
function dayHeading(date, now = new Date()) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    if (sameDay(date, now)) return `Today, ${longDay(date)}`
    if (sameDay(date, tomorrow)) return `Tomorrow, ${longDay(date)}`
    return longDay(date)
}

function upcomingHolidays(holidays) {
    const today = new Date().toISOString().slice(0, 10)
    return holidays
        .filter((h) => h.date >= today)
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(0, 6)
}

const REQUEST_STATUS_LABELS = {
    PENDING: 'Pending',
    ACCEPTED: 'Approved',
    REJECTED: 'Rejected',
    WITHDRAWN: 'Withdrawn',
}

function requestStatusLabel(status) {
    return REQUEST_STATUS_LABELS[status] ?? 'Pending'
}

function WorkRow({ work, tone, onVolunteer }) {
    const isOpen = work.status === 'OPEN'
    const start = new Date(work.startsAt)
    const titleId = `open-work-${work.id}-title`
    const metaId = `open-work-${work.id}-meta`

    return (
        <article className={`student-row ${tone}`} aria-labelledby={titleId}>
            <span className="student-date-tile" aria-hidden="true">
                <span>{start.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                <strong>{start.getDate()}</strong>
            </span>
            <div className="student-row-words">
                <p className="student-row-title" id={titleId}>
                    <span className="student-code">{work.courseCode}</span>{' '}
                    <strong>{work.courseName}</strong>
                </p>
                <p className="student-row-meta" id={metaId}>
                    <span className="visually-hidden">{longDay(start)},</span>{' '}
                    <span className="student-row-time">
                        <OrganiserIcon name="clock" size={14} />
                        {timeWindow(work.startsAt, work.endsAt)}
                    </span>{' '}
                    <span>{work.hours} hours</span>{' '}
                    {isOpen && work.closesAt && <span>Closes {shortWhen(work.closesAt)}</span>}
                    {!isOpen && <span className="student-row-unavailable">No longer available</span>}
                </p>
            </div>
            {isOpen ? (
                <button
                    type="button"
                    className="primary-button student-row-action"
                    aria-describedby={`${titleId} ${metaId}`}
                    onClick={() => onVolunteer(work)}
                >
                    Volunteer
                </button>
            ) : (
                <button type="button" className="secondary-button student-row-action" disabled>Unavailable</button>
            )}
        </article>
    )
}

function RequestRow({ request, tone, onWithdraw }) {
    const titleId = `volunteer-request-${request.id}-title`

    return (
        <article className={`student-row student-request-row ${tone}`} aria-labelledby={titleId}>
            <div className="student-row-words">
                <p className="student-row-title" id={titleId}>
                    <span className="student-code">{request.courseCode}</span>{' '}
                    <strong>{request.courseName}</strong>
                </p>
                <p className="student-row-meta">
                    <span className={`student-status status-${String(request.status).toLowerCase()}`}>
                        {requestStatusLabel(request.status)}
                    </span>{' '}
                    <span>{sessionWindow(request.startsAt, request.endsAt)}</span>{' '}
                    <span>{request.hours} hours</span>
                </p>
                {request.reviewReason ? (
                    <p className="student-row-note">
                        <span className="student-row-note-label">Note</span>{' '}
                        <span>{request.reviewReason}</span>
                    </p>
                ) : null}
            </div>
            {request.status === 'PENDING' ? (
                <button
                    type="button"
                    className="secondary-button student-row-action"
                    aria-describedby={titleId}
                    onClick={() => onWithdraw(request)}
                >
                    Withdraw
                </button>
            ) : null}
        </article>
    )
}

const REQUEST_TABS = [
    { id: 'current', label: 'Current', empty: 'Nothing is waiting for an organiser or coming up. Earlier requests are under Past.' },
    { id: 'past', label: 'Past', empty: 'Finished, withdrawn and unsuccessful requests will appear here.' },
]

export function StudentOverflow({ loadWorkItems, claimWork, loadRequests, loadHolidays, withdrawRequest, loadSchedule, studentName = null }) {
    const tokenOrGetter = useApiToken()

    const defaultLoadWorkItems = useCallback(
        () => getStudentOverflowWork(tokenOrGetter),
        [tokenOrGetter],
    )

    const defaultClaimWork = useCallback(
        (workId) => volunteerForWork(workId, tokenOrGetter),
        [tokenOrGetter],
    )

    const defaultLoadRequests = useCallback(
        () => getVolunteerRequests(tokenOrGetter),
        [tokenOrGetter],
    )

    const defaultLoadHolidays = useCallback(
        () => getPublicHolidays(tokenOrGetter),
        [tokenOrGetter],
    )

    const defaultWithdrawRequest = useCallback(
        (requestId) => withdrawVolunteerRequest(requestId, tokenOrGetter),
        [tokenOrGetter],
    )

    const resolvedLoadWorkItems = loadWorkItems ?? defaultLoadWorkItems
    const resolvedClaimWork = claimWork ?? defaultClaimWork
    const resolvedLoadRequests = loadRequests ?? defaultLoadRequests
    const resolvedLoadHolidays = loadHolidays ?? defaultLoadHolidays
    const resolvedWithdrawRequest = withdrawRequest ?? defaultWithdrawRequest

    const defaultLoadSchedule = useCallback(
        () => listOwnTimeSlots(tokenOrGetter),
        [tokenOrGetter],
    )
    const resolvedLoadSchedule = loadSchedule ?? defaultLoadSchedule
    const [schedule, setSchedule] = useState({ status: 'loading', data: [] })

    useEffect(() => {
        let active = true
        resolvedLoadSchedule()
            .then((slots) => { if (active) setSchedule({ status: 'success', data: Array.isArray(slots) ? slots : [] }) })
            .catch(() => { if (active) setSchedule({ status: 'error', data: [] }) })
        return () => { active = false }
    }, [resolvedLoadSchedule])

    const [workItems, setWorkItems] = useState([])
    const [status, setStatus] = useState('loading')
    const [errorMessage, setErrorMessage] = useState('')

    const [requests, setRequests] = useState([])
    const [requestsStatus, setRequestsStatus] = useState('loading')

    const [selectedWork, setSelectedWork] = useState(null)
    const [claimStatus, setClaimStatus] = useState('idle')
    const [claimMessage, setClaimMessage] = useState('')

    const [requestTab, setRequestTab] = useState(null)
    const requestTabRefs = useRef({})

    const [withdrawTarget, setWithdrawTarget] = useState(null)
    const [withdrawStatus, setWithdrawStatus] = useState('idle')
    const [withdrawMessage, setWithdrawMessage] = useState('')

    const [holidays, setHolidays] = useState([])
    const [holidaysStatus, setHolidaysStatus] = useState('idle')
    const [holidaysSource, setHolidaysSource] = useState('external')
    const [holidaysRetrievedAt, setHolidaysRetrievedAt] = useState(null)

    // When a confirmed action removes the button that opened the dialog, the
    // shared dialog cannot restore focus to it, so the outcome message takes
    // focus instead of leaving the keyboard user at the top of the document.
    const claimStatusRef = useRef(null)
    const withdrawStatusRef = useRef(null)

    const loadWork = useCallback(async () => {
        setStatus('loading')
        setErrorMessage('')

        try {
            const items = await resolvedLoadWorkItems()
            setWorkItems(Array.isArray(items) ? items : [])
            setStatus('success')
        } catch {
            setWorkItems([])
            setErrorMessage('Available volunteer work could not be loaded.')
            setStatus('error')
        }
    }, [resolvedLoadWorkItems])

    const loadRequestsList = useCallback(async () => {
        setRequestsStatus('loading')

        try {
            const items = await resolvedLoadRequests()
            setRequests(Array.isArray(items) ? items : [])
            setRequestsStatus('success')
        } catch {
            setRequests([])
            setRequestsStatus('error')
        }
    }, [resolvedLoadRequests])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadWork()
    }, [loadWork])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadRequestsList()
    }, [loadRequestsList])

    const loadHolidaysList = useCallback(async () => {
        setHolidaysStatus('loading')
        try {
            const result = await resolvedLoadHolidays()
            setHolidays(Array.isArray(result?.holidays) ? result.holidays : [])
            setHolidaysSource(result?.source === 'external' ? 'external' : 'fallback')
            setHolidaysRetrievedAt(result?.retrievedAt ?? null)
            setHolidaysStatus('success')
        } catch {
            setHolidays([])
            setHolidaysSource('fallback')
            setHolidaysRetrievedAt(null)
            setHolidaysStatus('error')
        }
    }, [resolvedLoadHolidays])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadHolidaysList()
    }, [loadHolidaysList])

    useEffect(() => {
        // A generic failure keeps the dialog open, and focus must stay in it;
        // every other outcome hides the dialog, so the message takes focus.
        if (
            claimStatus === 'success' ||
            (claimStatus === 'error' && !selectedWork)
        ) {
            claimStatusRef.current?.focus()
        }
    }, [claimStatus, selectedWork])

    useEffect(() => {
        if (
            withdrawStatus === 'success' ||
            (withdrawStatus === 'error' && !withdrawTarget)
        ) {
            withdrawStatusRef.current?.focus()
        }
    }, [withdrawStatus, withdrawTarget])

    const handleVolunteer = (work) => {
        if (work.status !== 'OPEN') {
           return
        }

        setSelectedWork(work)
        setClaimStatus('idle')
        setClaimMessage('')
    }

    const handleCancelVolunteer = () => {
        if (claimStatus === 'pending') {
        return
        }

        setSelectedWork(null)
        setClaimStatus('idle')
        setClaimMessage('')
    }

    const handleConfirmVolunteer = async () => {
        if (!selectedWork || claimStatus === 'pending'){
            return
        }

        setClaimStatus('pending')
        setClaimMessage('')

        try {
            const volunteerRequest = await resolvedClaimWork(selectedWork.id)

            setWorkItems((currentItems) =>
                currentItems.filter(
                    (work) => work.id !== volunteerRequest.overflowWorkId,
                ),
            )
            const requestStatus = requestStatusLabel(volunteerRequest.status)
            setClaimStatus('success')
            setClaimMessage(
                `Your volunteer request for ${selectedWork.courseCode} is ${requestStatus.toLowerCase()}.`,
            )
            // Refresh the persisted request list so the outcome reflects the
            // server state instead of only local frontend state.
            await loadRequestsList()
        } catch (error) {
            if (
                error?.code === 'OPEN_WORK_UNAVAILABLE' ||
                error?.code === 'WORK_NOT_AVAILABLE'
            ) {
                setClaimStatus('error')
                setClaimMessage(
                    'This work item is no longer available. The latest list has been loaded so you can choose another item.',
                )
                setSelectedWork(null)
                await Promise.all([loadWork(), loadRequestsList()])
                return
            }

            if (error?.code === 'VOLUNTEER_REQUEST_DUPLICATE') {
                setClaimStatus('error')
                setClaimMessage(
                    'You have already submitted a volunteer request for this work item.',
                )
                setSelectedWork(null)
                await Promise.all([loadWork(), loadRequestsList()])
                return
            }

            if (error?.code === 'VOLUNTEER_REQUEST_CONFLICT') {
                setClaimStatus('error')
                setClaimMessage(
                    'This volunteer request conflicts with the latest work status. The latest lists have been loaded.',
                )
                setSelectedWork(null)
                await Promise.all([loadWork(), loadRequestsList()])
                return
            }

            setClaimStatus('error')
            setClaimMessage(
                'We could not complete your volunteer request. Please try again.',
            )
        }
    }

    const handleWithdraw = (request) => {
        if (request.status !== 'PENDING' || withdrawStatus === 'pending') {
            return
        }

        setWithdrawTarget(request)
        setWithdrawStatus('idle')
        setWithdrawMessage('')
    }

    const handleCancelWithdraw = () => {
        if (withdrawStatus === 'pending') {
            return
        }

        setWithdrawTarget(null)
        setWithdrawStatus('idle')
        setWithdrawMessage('')
    }

    const handleConfirmWithdraw = async () => {
        if (!withdrawTarget || withdrawStatus === 'pending') {
            return
        }

        setWithdrawStatus('pending')
        setWithdrawMessage('')

        try {
            const withdrawn = await resolvedWithdrawRequest(withdrawTarget.id)

            // Show the server-confirmed withdrawal straight away, then refresh
            // both work items and requests so stale local state cannot survive.
            setRequests((currentRequests) =>
                currentRequests.map((request) =>
                    request.id === withdrawn.id
                        ? {
                              ...request,
                              status: withdrawn.status,
                              reviewReason: withdrawn.reviewReason,
                              updatedAt: withdrawn.updatedAt,
                          }
                        : request,
                ),
            )
            setWithdrawStatus('success')
            setWithdrawMessage(
                `Your volunteer request for ${withdrawTarget.courseCode} has been withdrawn.`,
            )
            // Refresh both lists; if either fails, keep the server-confirmed outcome
            // but do not claim the refresh succeeded.
            try {
                await Promise.all([loadWork(), loadRequestsList()])
            } catch {
                // Refresh failed but withdrawal succeeded; outcome message is already shown
            }
        } catch (error) {
            if (error?.code === 'VOLUNTEER_REQUEST_CONFLICT') {
                setWithdrawStatus('error')
                setWithdrawMessage(
                    'This request changed on the server, for example an organiser already approved or rejected it. The latest lists have been loaded.',
                )
                setWithdrawTarget(null)
                try {
                    await Promise.all([loadWork(), loadRequestsList()])
                } catch {
                    // Refresh failed; error message is already shown
                }
                return
            }

            if (error?.code === 'VOLUNTEER_REQUEST_NOT_FOUND') {
                setWithdrawStatus('error')
                setWithdrawMessage(
                    'This request is no longer available to withdraw. The latest lists have been loaded.',
                )
                setWithdrawTarget(null)
                try {
                    await Promise.all([loadWork(), loadRequestsList()])
                } catch {
                    // Refresh failed; error message is already shown
                }
                return
            }

            setWithdrawStatus('error')
            setWithdrawMessage(
                'We could not withdraw this request. Please try again.',
            )
        }
    }

    const hasClosedWork = workItems.some((work) => work.status !== 'OPEN')
    const visibleHolidays = upcomingHolidays(holidays)
    const summary = useMemo(
        () => studentSummary({
            workItems: status === 'success' ? workItems : [],
            requests: requestsStatus === 'success' ? requests : [],
        }),
        [requests, requestsStatus, status, workItems],
    )
    const figure = (ready, failed, compute) => {
        if (failed) return { value: '—', sub: 'Could not be loaded' }
        if (!ready) return { value: '…', sub: 'Loading…' }
        return compute()
    }
    const requestsReady = requestsStatus === 'success'
    const requestsFailed = requestsStatus === 'error'

    const tones = useMemo(
        () => courseTones([...workItems, ...requests].map((item) => item.courseCode)),
        [requests, workItems],
    )
    const workDays = useMemo(() => workByDay(workItems), [workItems])
    const requestGroups = useMemo(() => splitRequests(requests), [requests])
    // Until the student picks a tab, show Past when nothing is current.
    const shownRequestTab = requestTab ?? (
        requestGroups.current.length === 0 && requestGroups.past.length > 0 ? 'past' : 'current'
    )

    function onRequestTabKeyDown(event, index) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const step = event.key === 'ArrowRight' ? 1 : REQUEST_TABS.length - 1
        const next = REQUEST_TABS[(index + step) % REQUEST_TABS.length]
        setRequestTab(next.id)
        requestTabRefs.current[next.id]?.focus()
    }

    return (
        <main id="main-content" className="dashboard-shell student-home student-overflow-page">
            <h1 className="visually-hidden">Student workspace</h1>

            <StudentHero
                name={studentName}
                summary={summary}
                workReady={status === 'success'}
                requestsReady={requestsReady}
            />

            <section className="home-section" aria-labelledby="student-glance-heading">
                <div className="home-section-heading">
                    <h2 id="student-glance-heading">At a glance</h2>
                </div>
                <ul className="stat-grid">
                    <StatTile
                        label="Open work"
                        icon="megaphone"
                        tone="accent-pink"
                        {...figure(status === 'success', status === 'error', () => ({
                            value: String(summary.openCount),
                            sub: summary.openCount > 0 ? 'Sessions looking for volunteers' : 'Nothing open right now',
                        }))}
                    />
                    <StatTile
                        label="Awaiting a decision"
                        icon="clock"
                        tone="accent-orchid"
                        {...figure(requestsReady, requestsFailed, () => ({
                            value: String(summary.pendingCount),
                            sub: 'Requests an organiser will review',
                        }))}
                    />
                    <StatTile
                        label="Coming up"
                        icon="calendar"
                        tone="accent-blue"
                        {...figure(requestsReady, requestsFailed, () => ({
                            value: String(summary.upcomingCount),
                            sub: summary.nextSession ? `Next: ${shortWhen(summary.nextSession.startsAt)}` : 'No approved sessions ahead',
                        }))}
                    />
                    <StatTile
                        label="Volunteer hours"
                        icon="chart-column"
                        tone="accent-coral"
                        {...figure(requestsReady, requestsFailed, () => ({
                            value: `${summary.approvedHours} h`,
                            sub: 'From sessions you were approved for',
                        }))}
                    />
                </ul>
            </section>

            <div className="home-split student-home-split">
                <div className="student-home-main">
                    <section className="home-card student-open-work" aria-labelledby="available-work-heading">
                        <div className="home-card-heading">
                            <div>
                                <h2 id="available-work-heading" tabIndex={-1}>Available volunteer work</h2>
                                <p className="helper-text">Sessions an organiser has opened for student volunteers.</p>
                            </div>
                            {status === 'success' && workItems.length > 0 && (
                                <span className="student-count-chip">{workItems.length} listed</span>
                            )}
                        </div>

                        {claimStatus === 'success' && (
                            <div ref={claimStatusRef} tabIndex={-1}>
                                <SuccessState title="Volunteer request successful" message={claimMessage} />
                            </div>
                        )}

                        {claimStatus === 'error' && (
                            <div ref={claimStatusRef} tabIndex={-1}>
                                <ErrorState
                                    title="Volunteer request unsuccessful"
                                    message={claimMessage}
                                    onRetry={selectedWork ? handleConfirmVolunteer : undefined}
                                />
                            </div>
                        )}

                        {status === 'loading' && (
                            <LoadingState
                                title="Loading available work..."
                                message="Please wait while we find open volunteer opportunities."
                            />
                        )}

                        {status === 'error' && (
                            <ErrorState
                                title="Unable to load volunteer work"
                                message={errorMessage}
                                onRetry={loadWork}
                            />
                        )}

                        {status === 'success' && workItems.length === 0 && (
                            <EmptyState
                                title="No open volunteer work"
                                message="There are currently no open volunteer opportunities. Please check again later."
                            />
                        )}

                        {status === 'success' && workItems.length > 0 && (
                            <ol className="student-work-days" aria-label="Available volunteer work by day">
                                {workDays.map((day) => (
                                    <li key={day.key}>
                                        <h3 className="student-day-label">{dayHeading(day.date)}</h3>
                                        <ul className="student-rows">
                                            {day.items.map((work) => (
                                                <li key={work.id}>
                                                    <WorkRow work={work} tone={tones.get(work.courseCode)} onVolunteer={handleVolunteer} />
                                                </li>
                                            ))}
                                        </ul>
                                    </li>
                                ))}
                            </ol>
                        )}

                        {status === 'success' && hasClosedWork && workItems.length > 0 && (
                            <p className="status-note" role="status">
                                Some work items are no longer available and cannot be volunteered for.
                            </p>
                        )}
                    </section>

                    <section className="home-card my-requests" aria-labelledby="my-volunteer-requests-heading">
                        <div className="home-card-heading">
                            <h2 id="my-volunteer-requests-heading">My volunteer requests</h2>
                        </div>

                        {withdrawStatus === 'success' && (
                            <div ref={withdrawStatusRef} tabIndex={-1}>
                                <SuccessState title="Volunteer request withdrawn" message={withdrawMessage} />
                            </div>
                        )}

                        {withdrawStatus === 'error' && (
                            <div ref={withdrawStatusRef} tabIndex={-1}>
                                <ErrorState
                                    title="Withdrawal unsuccessful"
                                    message={withdrawMessage}
                                    onRetry={withdrawTarget ? handleConfirmWithdraw : undefined}
                                />
                            </div>
                        )}

                        {requestsStatus === 'loading' && (
                            <p className="status-note" role="status">
                                Loading your volunteer requests…
                            </p>
                        )}

                        {requestsStatus === 'success' && requests.length === 0 && (
                            <p className="status-note" role="status">
                                You have not submitted any volunteer requests yet.
                            </p>
                        )}

                        {requestsStatus === 'success' && requests.length > 0 && (
                            <>
                                <div className="approval-tabs student-request-tabs" role="tablist" aria-label="Volunteer requests">
                                    {REQUEST_TABS.map((entry, index) => {
                                        const count = requestGroups[entry.id].length
                                        const selected = entry.id === shownRequestTab
                                        return (
                                            <button
                                                key={entry.id}
                                                ref={(element) => { requestTabRefs.current[entry.id] = element }}
                                                type="button"
                                                role="tab"
                                                id={`student-requests-tab-${entry.id}`}
                                                aria-selected={selected}
                                                aria-controls={`student-requests-panel-${entry.id}`}
                                                tabIndex={selected ? 0 : -1}
                                                className={`approval-tab${selected ? ' active' : ''}`}
                                                onClick={() => setRequestTab(entry.id)}
                                                onKeyDown={(event) => onRequestTabKeyDown(event, index)}
                                            >
                                                <span>{entry.label}</span>
                                                <span className="approval-tab-count" aria-hidden="true">{count}</span>
                                                <span className="visually-hidden">, {count} {count === 1 ? 'request' : 'requests'}</span>
                                            </button>
                                        )
                                    })}
                                </div>
                                {REQUEST_TABS.map((entry) => (
                                    <div
                                        key={entry.id}
                                        id={`student-requests-panel-${entry.id}`}
                                        role="tabpanel"
                                        aria-labelledby={`student-requests-tab-${entry.id}`}
                                        hidden={entry.id !== shownRequestTab}
                                    >
                                        {requestGroups[entry.id].length === 0 ? (
                                            <p className="home-empty">{entry.empty}</p>
                                        ) : (
                                            <ul className="student-rows">
                                                {requestGroups[entry.id].map((request) => (
                                                    <li key={request.id}>
                                                        <RequestRow request={request} tone={tones.get(request.courseCode)} onWithdraw={handleWithdraw} />
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                ))}
                            </>
                        )}

                        {requestsStatus === 'error' && (
                            <div className="inline-status-action" role="alert">
                                <p className="status-note">
                                    Your volunteer requests could not be loaded.
                                </p>
                                <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={loadRequestsList}
                                >
                                    Retry requests
                                </button>
                            </div>
                        )}
                    </section>
                </div>

                <div className="student-home-side">
                    <StudentSchedule slots={schedule} requests={requestsReady ? requests : []} />

                    {status === 'success' && (
                        <section className="home-card public-holidays-section" aria-label="Upcoming public holidays">
                            <h2>Upcoming public holidays</h2>
                            <p className="helper-text">
                                Public holidays may affect session scheduling.
                            </p>

                            {holidaysStatus === 'success' && holidaysSource === 'external' && (
                                <p className="holiday-source-note">
                                    <span className="holiday-source-badge">External data</span>
                                    {holidaysRetrievedAt ? (
                                        <span>Updated {formatDateTime(holidaysRetrievedAt)}</span>
                                    ) : null}
                                </p>
                            )}

                            {holidaysStatus === 'loading' && (
                                <p className="status-note" role="status">Loading public holidays…</p>
                            )}

                            {holidaysStatus === 'error' && (
                                <p className="status-note" role="status">
                                    Public holiday information is temporarily unavailable.
                                </p>
                            )}

                            {holidaysStatus === 'success' && holidaysSource === 'fallback' && holidays.length === 0 && (
                                <p className="status-note" role="status">
                                    Public holiday information is temporarily unavailable.
                                </p>
                            )}

                            {holidaysStatus === 'success' && visibleHolidays.length === 0 && holidaysSource !== 'fallback' && (
                                <p className="status-note" role="status">No upcoming public holidays.</p>
                            )}

                            {holidaysStatus === 'success' && visibleHolidays.length > 0 && (
                                <ul className="public-holidays-list">
                                    {visibleHolidays.map((holiday) => (
                                        <li key={`${holiday.date}-${holiday.name}`} className="public-holiday-item">
                                            <span className="holiday-date">{formatDate(holiday.date)}</span>
                                            <span className="holiday-name">{holiday.name}</span>
                                            {holiday.nationalHoliday && (
                                                <span className="holiday-badge" aria-label="National holiday">National</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )}
                </div>
            </div>

            {selectedWork && claimStatus !== 'success' && (
                <ConfirmationDialog open title="Confirm volunteer" onConfirm={handleConfirmVolunteer} onCancel={handleCancelVolunteer} isPending={claimStatus === 'pending'} >
                <p> Are you sure you want to volunteer for this work? </p>

                <dl className="confirmation-details">
                    <div>
                        <dt>Course</dt>
                        <dd> {selectedWork.courseCode} —{' '} {selectedWork.courseName} </dd>
                    </div>

                    <div>
                        <dt>Date and time</dt>
                        <dd> {formatDateTime(selectedWork.startsAt)} –{' '} {formatDateTime(selectedWork.endsAt)} </dd>
                    </div>

                    <div>
                        <dt>Expected hours</dt>
                        <dd>{selectedWork.hours} hours</dd>
                    </div>
                </dl>

                </ConfirmationDialog>
            )}

            {withdrawTarget && withdrawStatus !== 'success' && (
                <ConfirmationDialog
                    open
                    title="Confirm withdrawal"
                    confirmLabel="Withdraw"
                    onConfirm={handleConfirmWithdraw}
                    onCancel={handleCancelWithdraw}
                    isPending={withdrawStatus === 'pending'}
                >
                <p> Are you sure you want to withdraw this volunteer request? </p>

                <dl className="confirmation-details">
                    <div>
                        <dt>Course</dt>
                        <dd> {withdrawTarget.courseCode} —{' '} {withdrawTarget.courseName} </dd>
                    </div>

                    <div>
                        <dt>Date and time</dt>
                        <dd> {formatDateTime(withdrawTarget.startsAt)} –{' '} {formatDateTime(withdrawTarget.endsAt)} </dd>
                    </div>

                    <div>
                        <dt>Expected hours</dt>
                        <dd>{withdrawTarget.hours} hours</dd>
                    </div>
                </dl>

                </ConfirmationDialog>
            )}
        </main>
        )
    }
