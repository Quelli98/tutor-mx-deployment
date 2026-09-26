import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReportCharts } from './ReportCharts'

const course = (courseId, courseCode, extra) => ({
  courseId,
  courseCode,
  courseName: courseCode,
  allocatedHours: 24,
  approvedWorkedHours: 18,
  hourlyRate: 30,
  budget: 5000,
  spend: 540,
  committed: 720,
  budgetRemaining: 4460,
  ...extra,
})

const tutor = (tutorId, fullName, shareOfAllocatedHours, extra) => ({
  tutorId,
  fullName,
  capacityHours: 40,
  allocatedHours: 6,
  approvedWorkedHours: 4,
  shareOfAllocatedHours,
  ...extra,
})

describe('ReportCharts', () => {
  it('draws the four charts from the report, with a written summary for each', () => {
    render(
      <ReportCharts
        courses={[course(1, 'COMS3011'), course(2, 'COMS2002', { spend: 5400, budgetRemaining: -400 }), course(3, 'COMS3009', { hourlyRate: null, spend: null, committed: null, budgetRemaining: null })]}
        tutors={[tutor(7, 'Sam Tutor', 0.75), tutor(8, 'Ash Tutor', 0.25, { capacityHours: null })]}
      />,
    )

    for (const title of ['Hours by course', 'Budget used', 'Share of the work', 'Tutor hours and limits']) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    expect(screen.getByText(/allocated hours beside approved worked hours/i)).toBeInTheDocument()

    const budget = screen.getByText('Budget used').closest('figure')
    expect(within(budget).getByText('11%')).toBeInTheDocument()
    expect(within(budget).getByText('108%')).toBeInTheDocument()
    expect(within(budget).getByText('no rate yet')).toBeInTheDocument()

    const share = screen.getByText('Share of the work').closest('figure')
    expect(within(share).getByText('75%')).toBeInTheDocument()
    expect(within(share).getByText('25%')).toBeInTheDocument()
  })

  it('leaves the exact figures to the tables and adds no table of its own', () => {
    render(<ReportCharts courses={[course(1, 'COMS3011')]} tutors={[tutor(7, 'Sam Tutor', 1)]} />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('24 h')).not.toBeInTheDocument()
  })

  it('says so when no hours were allocated in the period', () => {
    render(<ReportCharts courses={[]} tutors={[tutor(7, 'Sam Tutor', 0, { allocatedHours: 0 })]} />)

    expect(screen.getByText('No hours were allocated in this period.')).toBeInTheDocument()
    expect(screen.queryByText('Hours by course')).not.toBeInTheDocument()
  })
})
