import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  approveTimesheets,
  decideExcuse,
  decideTimesheet,
  decideVolunteerClaim,
  listOrganiserApprovals,
  listTimesheetDisputes,
  resolveTimesheetDispute,
} from '../api/organiser'

export function approvalError(error, loading = false) {
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

/**
 * The organiser's four approval queues (timesheets, volunteer claims, excuses and timesheet
 * disputes) and the decisions on them. Shared by the Approvals page and the "Needs your
 * approval" card on Home, so both follow the same rules: a reason is required to return,
 * reject or resolve, one decision runs at a time, and a conflict refreshes the queue.
 */
export function useOrganiserApprovals({ onDecision } = {}) {
  const { getAccessTokenSilently } = useAuth0()
  const [status, setStatus] = useState('loading')
  const [queues, setQueues] = useState({ timesheets: [], volunteerClaims: [], excuses: [], disputes: [] })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingKey, setPendingKey] = useState('')
  const [reasons, setReasons] = useState({})
  const [reasonErrors, setReasonErrors] = useState({})
  const [disputeError, setDisputeError] = useState('')
  const [selectedTimesheetIds, setSelectedTimesheetIds] = useState([])
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
        // A selection can only hold timesheets that are still waiting.
        const waiting = new Set(approvals.value.timesheets.map((timesheet) => timesheet.id))
        setSelectedTimesheetIds((current) => current.filter((id) => waiting.has(id)))
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

  function clearReason(key) {
    setReasons((current) => ({ ...current, [key]: '' }))
    setReasonErrors((current) => ({ ...current, [key]: '' }))
  }

  async function submitDecision({ type, id, decision, personName }) {
    if (busyRef.current) return false
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
      return false
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
      await onDecision?.()
      setMessage(
        decision === 'APPROVE'
          ? `${personName}'s request was approved.`
          : `${personName}'s request was ${decision === 'RETURN' ? 'returned' : 'rejected'}.`,
      )
      setReasons((current) => ({ ...current, [key]: '' }))
      return true
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
      return false
    } finally {
      busyRef.current = false
      setPendingKey('')
    }
  }

  async function submitDisputeResolution({ id, tutorName }) {
    if (busyRef.current) return false
    const decision = 'RESOLVE'
    const key = `dispute-${id}`
    const reason = reasons[key]?.trim() ?? ''
    if (!reason) {
      setReasonErrors((current) => ({
        ...current,
        [key]: 'A resolution reason is required.',
      }))
      return false
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
      return true
    } catch (decisionError) {
      setError(approvalError(decisionError))
      if (decisionError?.code === 'TIMESHEET_DISPUTE_CONFLICT') {
        await loadApprovals({ silent: true })
      }
      return false
    } finally {
      busyRef.current = false
      setPendingKey('')
    }
  }

  function toggleTimesheet(id) {
    setSelectedTimesheetIds((current) =>
      current.includes(id) ? current.filter((selected) => selected !== id) : [...current, id],
    )
    setMessage('')
  }

  function selectAllTimesheets(selectAll) {
    setSelectedTimesheetIds(selectAll ? queues.timesheets.map((timesheet) => timesheet.id) : [])
    setMessage('')
  }

  /**
   * Approves every selected timesheet in one request. The server decides each
   * on its own, so a sheet that changed meanwhile is reported without holding
   * up the rest. Returning still happens one sheet at a time, with a reason.
   */
  async function approveSelectedTimesheets() {
    if (busyRef.current || selectedTimesheetIds.length === 0) return false
    busyRef.current = true
    setPendingKey('timesheet-bulk-APPROVE')
    setMessage('')
    setError('')
    try {
      const results = await approveTimesheets(selectedTimesheetIds, getAccessTokenSilently)
      const approved = new Set(results.filter((result) => result.outcome === 'approved').map((result) => result.timesheetId))
      const failed = results.filter((result) => result.outcome === 'failed')
      setQueues((current) => ({ ...current, timesheets: current.timesheets.filter((item) => !approved.has(item.id)) }))
      setSelectedTimesheetIds((current) => current.filter((id) => !approved.has(id)))
      await loadApprovals({ silent: true })
      if (approved.size > 0) await onDecision?.()
      if (approved.size > 0) {
        setMessage(`${approved.size} ${approved.size === 1 ? 'timesheet was' : 'timesheets were'} approved.`)
      }
      if (failed.length > 0) {
        setError(
          `${failed.length} ${failed.length === 1 ? 'timesheet was' : 'timesheets were'} not approved: ${failed[0].message}`,
        )
      }
      return failed.length === 0
    } catch (decisionError) {
      setError(approvalError(decisionError))
      await loadApprovals({ silent: true })
      return false
    } finally {
      busyRef.current = false
      setPendingKey('')
    }
  }

  const totalPending = queues.timesheets.length + queues.volunteerClaims.length + queues.excuses.length + queues.disputes.length

  return {
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
    clearReason,
    submitDecision,
    submitDisputeResolution,
    selectedTimesheetIds,
    toggleTimesheet,
    selectAllTimesheets,
    approveSelectedTimesheets,
  }
}
