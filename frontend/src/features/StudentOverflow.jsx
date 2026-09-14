import { useCallback, useEffect, useState } from 'react'
import { getStudentOverflowWork } from '../api/studentOverflow'
import { EmptyState, ErrorState, LoadingState, SuccessState } from '../components/shared/StatusMessage'
import { getVolunteerRequests, volunteerForWork } from '../api/studentVolunteer'
import { getPublicHolidays } from '../api/publicHolidays'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'
import { useApiToken } from '../api/client'

function formatDateTime(value) {
    return new Intl.DateTimeFormat( 'en-ZA', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value))
}

function formatDate(value) {
    return new Intl.DateTimeFormat('en-ZA', {
        dateStyle: 'medium',
    }).format(new Date(`${value}T00:00:00.000Z`))
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

function WorkCard({ work, onVolunteer }) {
    const isOpen = work.status === 'OPEN'

    return (
        <article className="work-card">
            <div className="work-card-header">
                <div>
                    <p className="work-course-code">{work.courseCode}</p>
                    <h2>{work.courseName}</h2>
                </div>

                <span className={`work-status ${isOpen ? 'open' : 'closed'}`}>
                    {isOpen ? 'Open' : 'Closed'}
                </span>
            </div>

            <dl className="work-details">
                <div>
                    <dt>Date and time</dt>
                    <dd>
                        {formatDateTime(work.startsAt)} -{' '} {formatDateTime(work.endsAt)}
                    </dd>
                </div>

                <div>
                    <dt>Expected hours</dt>
                    <dd>{work.hours} hours</dd>
                </div>

                <div>
                    <dt>Availability</dt>
                    <dd>{isOpen ? 'Available to volunteer' : 'No longer available'}</dd>
                </div>
            </dl>

            {isOpen ? (
                <button type="button" className="primary-button" onClick={() => onVolunteer(work)}>Volunteer</button>
            ) : (
                <button type="button" className="secondary-button" disabled>Unavailable</button>
            )}
        </article>
    )
}

function RequestCard({ request }) {
    return (
        <article className="work-card">
            <div className="work-card-header">
                <div>
                    <p className="work-course-code">{request.courseCode}</p>
                    <h2>{request.courseName}</h2>
                </div>

                <span className={`work-status request-${String(request.status).toLowerCase()}`}>
                    {requestStatusLabel(request.status)}
                </span>
            </div>

            <dl className="work-details">
                <div>
                    <dt>Date and time</dt>
                    <dd>
                        {formatDateTime(request.startsAt)} -{' '} {formatDateTime(request.endsAt)}
                    </dd>
                </div>

                <div>
                    <dt>Expected hours</dt>
                    <dd>{request.hours} hours</dd>
                </div>

                {request.reviewReason ? (
                    <div>
                        <dt>Review note</dt>
                        <dd>{request.reviewReason}</dd>
                    </div>
                ) : null}
            </dl>
        </article>
    )
}

export function StudentOverflow({ loadWorkItems, claimWork, loadRequests, loadHolidays }) {
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

    const resolvedLoadWorkItems = loadWorkItems ?? defaultLoadWorkItems
    const resolvedClaimWork = claimWork ?? defaultClaimWork
    const resolvedLoadRequests = loadRequests ?? defaultLoadRequests
    const resolvedLoadHolidays = loadHolidays ?? defaultLoadHolidays

    const [workItems, setWorkItems] = useState([])
    const [status, setStatus] = useState('loading')
    const [errorMessage, setErrorMessage] = useState('')

    const [requests, setRequests] = useState([])
    const [requestsStatus, setRequestsStatus] = useState('loading')

    const [selectedWork, setSelectedWork] = useState(null)
    const [claimStatus, setClaimStatus] = useState('idle')
    const [claimMessage, setClaimMessage] = useState('')

    const [holidays, setHolidays] = useState([])
    const [holidaysStatus, setHolidaysStatus] = useState('idle')
    const [holidaysSource, setHolidaysSource] = useState('external')
    const [holidaysRetrievedAt, setHolidaysRetrievedAt] = useState(null)

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

    const hasClosedWork = workItems.some((work) => work.status !== 'OPEN')
    const visibleHolidays = upcomingHolidays(holidays)

    return (
        <main id="main-content" className="dashboard-shell student-overflow-page">
            <header className="dashboard-header">
                <div>
                    <p className="eyebrow">Student workspace</p>
                    <h1>Available volunteer work</h1>
                    <p className="helper-text">
                        Find open tutoring work, volunteer and follow each request outcome.
                    </p>
                </div>
            </header>

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
                <section className="work-list" aria-label="Available volunteer work">
                    {workItems.map((work) => (
                        <WorkCard key={work.id} work={work} onVolunteer={handleVolunteer} />))}
                </section>
            )}

            {status === 'success' && hasClosedWork && workItems.length > 0 && (
                <p className="status-note" role="status">
                    Some work items are no longer available and cannot be volunteered for.
                </p>
            )}

            <section className="my-requests" aria-labelledby="my-volunteer-requests-heading">
                <h2 id="my-volunteer-requests-heading">My volunteer requests</h2>

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
                    <div className="work-list">
                        {requests.map((request) => (
                            <RequestCard key={request.id} request={request} />))}
                    </div>
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

            {status === 'success' && (
                <section className="public-holidays-section" aria-label="Upcoming public holidays">
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

            {claimStatus === 'success' && (
                <SuccessState title="Volunteer request successful" message={claimMessage} />
            )}

            {claimStatus === 'error' && (
                <ErrorState
                    title="Volunteer request unsuccessful"
                    message={claimMessage}
                    onRetry={selectedWork ? handleConfirmVolunteer : undefined}
                />
            )}

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
        </main>
        )
    }
