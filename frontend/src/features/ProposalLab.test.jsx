import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ProposalLab from './ProposalLab'

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  compare: vi.fn(),
  generate: vi.fn(),
  explain: vi.fn(),
  adjust: vi.fn(),
  listScenarios: vi.fn(),
}))
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: mocks.token }) }))
vi.mock('../api/proposals', () => ({
  compareProposalStrategies: mocks.compare,
  generateProposal: mocks.generate,
  getProposalExplanations: mocks.explain,
  adjustProposal: mocks.adjust,
}))
vi.mock('../api/planning', () => ({ listScenarios: mocks.listScenarios }))

const explanationRows = [
  { tutorId: 3, fullName: 'Tutor Three', eligible: true, chosen: true, hardFailures: [], softScore: 0.72, factors: ['95% course mark', '2 of 10 selected-week hours planned', 'Balanced spreads soft weight across shortage, mark, workload and budget pressure.'], reason: 'Chosen in this proposal: mark, clash and selected-week capacity currently pass.' },
  { tutorId: 2, fullName: 'Tutor Two', eligible: true, chosen: false, hardFailures: [], softScore: 0.65, factors: ['80% course mark'], reason: 'Why not: all hard rules currently pass, but this tutor has a lower soft score for this preset.' },
  { tutorId: 4, fullName: 'Busy Tutor', eligible: false, chosen: false, hardFailures: ['schedule-clash'], softScore: null, factors: [], reason: 'Why not: hard rule failed (schedule-clash).' },
]
const assignment = {
  id: 5,
  requirementId: 10,
  courseCode: 'COMS',
  tutorName: 'Tutor Three',
  tutorId: 3,
  startsAt: '2030-10-08T08:00:00.000Z',
  endsAt: '2030-10-08T10:00:00.000Z',
  explanation: explanationRows,
}
const metrics = (extra = {}) => ({ proposedAssignments: 1, coveredTutorHours: 2, allocatedHours: 6, shortageHours: 0, projectedAddedSpend: 200, projectedCost: 600, workload: [{ tutorId:3, tutorName:'Tutor Three', hours:4 }, { tutorId:2, tutorName:'Tutor Two', hours:2 }], ...extra })
const comparison = [
  { preset: 'BALANCED', metrics: metrics(), assignments: [assignment] },
  { preset: 'STRONGEST_MATCH', metrics: metrics({ projectedCost: 650 }), assignments: [assignment] },
  { preset: 'FAIR_WORKLOAD', metrics: metrics({ workload: [{ tutorId:3,tutorName:'Tutor Three',hours:3 },{ tutorId:2,tutorName:'Tutor Two',hours:3 }] }), assignments: [assignment] },
  { preset: 'BUDGET_AWARE', metrics: metrics({ proposedAssignments: 0, allocatedHours: 4, shortageHours: 2, projectedAddedSpend: 0, projectedCost: 400 }), assignments: [] },
]
const explanations = { preset: 'BALANCED', assignments: [assignment] }
const generated = { scenario: { id: 4, version: 3, name: 'October proposal' }, items: [], proposal: { shortages: [{ courseCode: 'MATH', hours: 2 }] } }
const drafts = [{ id:12, name:'Locked October plan', version:5, startsAt:'2030-10-07T08:00:00.000Z', endsAt:'2030-10-14T08:00:00.000Z' }]

function renderLab() {
  return render(<MemoryRouter><ProposalLab /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listScenarios.mockResolvedValue(drafts)
  mocks.compare.mockResolvedValue(comparison)
  mocks.generate.mockResolvedValue(generated)
  mocks.explain.mockResolvedValue(explanations)
  mocks.adjust.mockResolvedValue({ scenario: { id: 4, version: 4 }, items: [] })
})

it('compares all four presets with workload, explanations and draft-only save actions', async () => {
  renderLab()
  await waitFor(() => expect(mocks.listScenarios).toHaveBeenCalledWith('DRAFT', mocks.token))
  fireEvent.click(screen.getByRole('button', { name: 'Compare all strategies' }))
  const table = await screen.findByRole('region', { name: 'Strategy impact comparison' })
  await waitFor(() => expect(mocks.compare).toHaveBeenCalledWith({ name: 'Whole-school proposal', startsAt: expect.any(String), endsAt: expect.any(String) }, mocks.token))
  expect(within(table).getAllByRole('button', { name: 'Save this strategy as Scenario' })).toHaveLength(4)
  expect(within(table).getAllByText('Tutor Three: 4 h · Tutor Two: 2 h').length).toBeGreaterThan(0)
  expect(within(table).getByText('R 400.00')).toBeInTheDocument()

  fireEvent.click(within(table).getAllByRole('button', { name: 'Review why' })[0])
  const review = screen.getByLabelText('Balanced explanation')
  expect(within(review).getByText(/Hard rules: Pass — mark, clash and selected-week capacity/)).toBeInTheDocument()
  expect(within(review).getByText('95% course mark')).toBeInTheDocument()

  fireEvent.click(within(table).getAllByRole('button', { name: 'Save this strategy as Scenario' })[3])
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ preset: 'BUDGET_AWARE' }), mocks.token))
  expect(mocks.explain).toHaveBeenCalledWith(4, mocks.token)
  expect(screen.getByText(/saved as a normal draft Scenario/i)).toBeInTheDocument()
  expect(screen.getByText('MATH: 2 h short')).toBeInTheDocument()
})

it('uses an existing draft as the proposal starting point so its locks are preserved', async () => {
  renderLab()
  const base = await screen.findByLabelText('Starting draft / locks (optional)')
  fireEvent.change(base, { target: { value: '12' } })
  expect(screen.getByLabelText('Planning from')).toHaveValue('2030-10-07T10:00')
  fireEvent.click(screen.getByRole('button', { name: 'Compare all strategies' }))
  await waitFor(() => expect(mocks.compare).toHaveBeenCalledWith(expect.objectContaining({ baseScenarioId:12, startsAt:'2030-10-07T08:00:00.000Z', endsAt:'2030-10-14T08:00:00.000Z' }), mocks.token))
  fireEvent.click(screen.getByRole('button', { name: 'Generate Proposal' }))
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ baseScenarioId:12 }), mocks.token))
})

it('explains hard and soft factors, lists only eligible replacements and saves a reasoned adjustment', async () => {
  renderLab()
  fireEvent.click(screen.getByRole('button', { name: 'Generate Proposal' }))
  const cockpit = await screen.findByRole('region', { name: 'Proposal assignments' })
  expect(within(cockpit).getByText(/Hard rules: Pass — mark, clash and selected-week capacity/)).toBeInTheDocument()
  expect(within(cockpit).getByText(/Soft score: 0.72/)).toBeInTheDocument()
  expect(within(cockpit).getByText(/Balanced spreads soft weight/)).toBeInTheDocument()

  fireEvent.click(within(cockpit).getByText('Why not the others?'))
  expect(within(cockpit).getByText(/lower soft score/)).toBeInTheDocument()
  expect(within(cockpit).getByText('Busy Tutor:')).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Proposal assignment'), { target: { value: '5' } })
  const replacement = screen.getByLabelText('Eligible replacement Tutor')
  expect(within(replacement).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose Tutor', 'Tutor Two'])
  fireEvent.change(replacement, { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Balances the team workload' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save eligible adjustment' }))

  await waitFor(() => expect(mocks.adjust).toHaveBeenCalledWith(4, { version: 3, itemId: 5, tutorId: 2, reason: 'Balances the team workload' }, mocks.token))
  expect(screen.getByText(/saved with its reason/i)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open Scenario planning' })).toHaveAttribute('href', '/organiser/scenarios?scenario=4')
})

it('surfaces generation failures without saving a scenario', async () => {
  mocks.generate.mockRejectedValueOnce(new Error('Planning window too large'))
  renderLab()
  fireEvent.click(screen.getByRole('button', { name: 'Generate Proposal' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Planning window too large')
  expect(mocks.explain).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: 'Proposal assignments' })).not.toBeInTheDocument()
})

it('discards a comparison when its planning window changes', async () => {
  renderLab()
  fireEvent.click(screen.getByRole('button', { name: 'Compare all strategies' }))
  await screen.findByRole('region', { name: 'Strategy impact comparison' })
  fireEvent.change(screen.getByLabelText('Planning from'), { target: { value: '2030-10-10T10:00' } })
  expect(screen.queryByRole('region', { name: 'Strategy impact comparison' })).not.toBeInTheDocument()
})

it('sends the comparison token when saving and shows unfilled requirement reasons', async () => {
  mocks.compare.mockResolvedValueOnce([{ ...comparison[0], comparisonToken: 'a'.repeat(64), assignments: [], shortages: [{ requirementId: 9, courseCode: 'MATH', hours: 2, explanation: [explanationRows[2]] }] }])
  renderLab()
  fireEvent.click(screen.getByRole('button', { name: 'Compare all strategies' }))
  const table = await screen.findByRole('region', { name: 'Strategy impact comparison' })
  fireEvent.click(within(table).getByRole('button', { name: 'Review why' }))
  expect(screen.getByText('Why is this requirement unfilled?')).toBeInTheDocument()
  expect(screen.getByText(/hard rule failed \(schedule-clash\)/)).toBeInTheDocument()
  fireEvent.click(within(table).getByRole('button', { name: 'Save this strategy as Scenario' }))
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ comparisonToken: 'a'.repeat(64) }), mocks.token))
})
