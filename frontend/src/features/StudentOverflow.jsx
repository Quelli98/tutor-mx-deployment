import { useCallback, useEffect, useState } from 'react'
import { getStudentOverflowWork } from '../api/studentOverflow'
import { EmptyState, ErrorState, LoadingState, SuccessState } from '../components/shared/StatusMessage'
import { volunteerForWork } from '../api/studentVolunteer'
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog'

function formatDateTime(value) {
    return new Intl.DateTimeFormat( 'en-ZA', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value))
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

export function StudentOverflow({ loadWorkItems = getStudentOverflowWork, claimWork = volunteerForWork }) {
    const [workItems, setWorkItems] = useState([])
    const [status, setStatus] = useState('loading')
    const [errorMessage, setErrorMessage] = useState('')

    const [selectedWork, setSelectedWork] = useState(null)
    const [claimStatus, setClaimStatus] = useState('idle')
    const [claimMessage, setClaimMessage] = useState('')

    const loadWork = useCallback(async () => {
        setStatus('loading')
        setErrorMessage('')

        try {
            const items = await loadWorkItems()
            setWorkItems(Array.isArray(items) ? items : [])
            setStatus('success')
        } catch {
            setWorkItems([])
            setErrorMessage('Available volunteer work could not be loaded.')
            setStatus('error')
        }
    }, [loadWorkItems])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadWork()
    }, [loadWork])

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
            const claimedWork = await claimWork(selectedWork.id)

            setWorkItems((currentItems) =>
                currentItems.map((work) =>
                    work.id === claimedWork.id
                       ? {
                        ...work,
                        status: claimedWork.status,
                       }
                    : work,
                ),
            )
            setClaimStatus('success')
            setClaimMessage(  `You successfully volunteered for ${selectedWork.courseCode}.`,)
        } catch (error) {
            if (error?.code === 'WORK_NOT_AVAILABLE') {
                setClaimStatus('error')
                setClaimMessage( 'This work item is no longer available.', )
                return
            }

            setClaimStatus('error')
            setClaimMessage( 'We could not complete your volunteer request. Please try again.',)
        }
    }

    const hasClosedWork = workItems.some((work) => work.status !== 'OPEN')

    return (
        <main id="main-content" className="dashboard-shell student-overflow-page">
            <header className="dashboard-header">
                <div>
                    <p className="eyebrow">Tutor Mx</p>
                    <h1>Available volunteer work</h1>
                    <p className="helper-text">
                        Find open work to volunteer for.
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

            {claimStatus === 'success' && (
                <SuccessState title="Volunteer request successful" message={claimMessage} />
            )}

            {claimStatus === 'error' && (
                <ErrorState title="Volunteer request unsuccessful" message={claimMessage} onRetry={handleConfirmVolunteer} />
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
