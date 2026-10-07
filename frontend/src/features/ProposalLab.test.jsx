import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import ProposalLab from './ProposalLab'

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  preview: vi.fn(),
  compare: vi.fn(),
  generate: vi.fn(),
  explain: vi.fn(),
  adjust: vi.fn(),
}))
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => ({ getAccessTokenSilently: mocks.token }) }))
vi.mock('../api/proposals', () => ({
  previewProposal: mocks.preview,
  compareProposalStrategies: mocks.compare,
  generateProposal: mocks.generate,
  getProposalExplanations: mocks.explain,
  adjustProposal: mocks.adjust,
}))

const comparison = [
  { preset: 'BALANCED', metrics: { proposedAssignments: 2, coveredTutorHours: 4, shortageHours: 0, projectedAddedSpend: 400 } },
  { preset: 'STRONGEST_MATCH', metrics: { proposedAssignments: 2, coveredTutorHours: 4, shortageHours: 0, projectedAddedSpend: 400 } },
  { preset: 'BUDGET_AWARE', metrics: { proposedAssignments: 1, coveredTutorHours: 2, shortageHours: 2, projectedAddedSpend: 100 } },
]
const explanations = {
  preset: 'BALANCED',
  assignments: [
    {
      id: 5,
      courseCode: 'COMS',
      tutorName: 'Tutor Three',
      startsAt: '2030-10-08T08:00:00.000Z',
      endsAt: '2030-10-08T10:00:00.000Z',
      explanation: [
        { tutorId: 3, fullName: 'Tutor Three', eligible: true, chosen: true, reason: 'Chosen because all hard rules pass and this tutor has the highest deterministic soft score.' },
        { tutorId: 2, fullName: 'Tutor Two', eligible: true, chosen: false, reason: 'Why not: all hard rules pass, but this tutor has a lower soft score.' },
        { tutorId: 4, fullName: 'Busy Tutor', eligible: false, chosen: false, reason: 'Why not: schedule-clash.' },
      ],
    },
  ],
}
const generated = { scenario: { id: 4, version: 2, name: 'October proposal' }, items: [], proposal: { shortages: [{ courseCode: 'MATH', hours: 2 }] } }

function renderLab() {
  return render(<MemoryRouter><ProposalLab /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.compare.mockResolvedValue(comparison)
  mocks.generate.mockResolvedValue(generated)
  mocks.explain.mockResolvedValue(explanations)
  mocks.adjust.mockResolvedValue({ scenario: { id: 4, version: 3 }, items: [] })
})

it('compares presets side by side on identical inputs and saves a chosen strategy as a draft scenario', async () => {
  renderLab()
  fireEvent.click(screen.getByRole('button', { name: 'Compare all strategies' }))
  const table = await screen.findByRole('region', { name: 'Strategy impact comparison' })
  await waitFor(() => expect(mocks.compare).toHaveBeenCalledWith({ name: 'Whole-school proposal', startsAt: expect.any(String), endsAt: expect.any(String) }, mocks.token))
  expect(within(table).getByText('R 100.00')).toBeInTheDocument()
  expect(within(table).getAllByRole('button', { name: 'Save this strategy as Scenario' })).toHaveLength(3)

  fireEvent.click(within(table).getAllByRole('button', { name: 'Save this strategy as Scenario' })[2])
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ preset: 'BUDGET_AWARE' }), mocks.token))
  expect(mocks.explain).toHaveBeenCalledWith(4, mocks.token)
  expect(screen.getByText(/saved as a normal draft Scenario/i)).toBeInTheDocument()
  expect(screen.getByText('MATH: 2 h short')).toBeInTheDocument()
})

it('explains Why this Tutor and Why not, lists only eligible replacements and saves a reasoned adjustment', async () => {
  renderLab()
  fireEvent.click(screen.getByRole('button', { name: 'Generate Proposal' }))
  await screen.findByRole('region', { name: 'Proposal assignments' })
  expect(screen.getByText(/highest deterministic soft score/)).toBeInTheDocument()

  fireEvent.click(screen.getByText('Why not the others?'))
  expect(screen.getByText(/lower soft score/)).toBeInTheDocument()
  expect(screen.getByText('Busy Tutor:')).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Proposal assignment'), { target: { value: '5' } })
  const replacement = screen.getByLabelText('Eligible replacement Tutor')
  const options = within(replacement).getAllByRole('option')
  expect(options.map((o) => o.textContent)).toEqual(['Choose Tutor', 'Tutor Two'])
  fireEvent.change(replacement, { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Balances the team workload' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save eligible adjustment' }))

  await waitFor(() => expect(mocks.adjust).toHaveBeenCalledWith(4, { version: 2, itemId: 5, tutorId: 2, reason: 'Balances the team workload' }, mocks.token))
  expect(screen.getByText(/saved with its reason/i)).toBeInTheDocument()
})

it('surfaces generation failures without saving a scenario', async () => {
  mocks.generate.mockRejectedValueOnce(new Error('Planning window too large'))
  renderLab()
  fireEvent.click(screen.getByRole('button', { name: 'Generate Proposal' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Planning window too large')
  expect(mocks.explain).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: 'Proposal assignments' })).not.toBeInTheDocument()
})
