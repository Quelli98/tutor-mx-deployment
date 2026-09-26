import { useCallback, useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { getWorkloadReport, listStaffingRequirements, listTutors } from '../api/organiser'
import { toIsoDate, yearToDatePeriod } from './organiserHome'

const LOADING = { status: 'loading', data: null }

function settled(result) {
  return result.status === 'fulfilled' ? { status: 'success', data: result.value } : { status: 'error', data: null }
}

/**
 * What Home shows for the selected week: the week's workload report, the report for the year so
 * far (for budget used), each tutor's hours that week and the open staffing requirements. Each
 * part loads and fails on its own, so one unavailable figure does not blank the others.
 */
export function useOrganiserWeek(weekStart) {
  const { getAccessTokenSilently } = useAuth0()
  const weekStartIso = toIsoDate(weekStart)
  const [parts, setParts] = useState({ report: LOADING, yearReport: LOADING, tutors: LOADING, requirements: LOADING })

  const load = useCallback(
    async (isActive = () => true) => {
      setParts({ report: LOADING, yearReport: LOADING, tutors: LOADING, requirements: LOADING })
      const yearToDate = yearToDatePeriod(new Date(`${weekStartIso}T00:00:00`))
      const [report, yearReport, tutors, requirements] = await Promise.allSettled([
        getWorkloadReport({ weekStart: weekStartIso, weeks: 1 }, getAccessTokenSilently),
        getWorkloadReport(yearToDate, getAccessTokenSilently),
        listTutors(getAccessTokenSilently, weekStartIso),
        listStaffingRequirements({ status: 'OPEN' }, getAccessTokenSilently),
      ])
      if (!isActive()) return
      setParts({
        report: settled(report),
        yearReport: settled(yearReport),
        tutors: settled(tutors),
        requirements: settled(requirements),
      })
    },
    [getAccessTokenSilently, weekStartIso],
  )

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(() => active)
    return () => {
      active = false
    }
  }, [load])

  return { ...parts, reload: () => load() }
}
