import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { resolveDestination } from '../api/navigation'

/** Historical deep links must check current ownership before entering a workflow. */
export default function TargetGate({ targetType }) {
  const { targetId } = useParams()
  return <ResolvedTarget key={`${targetType}:${targetId}`} targetType={targetType} targetId={targetId} />
}

function ResolvedTarget({ targetType, targetId }) {
  const { getAccessTokenSilently } = useAuth0()
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let active = true
    resolveDestination({ targetType, targetId: Number(targetId) }, getAccessTokenSilently)
      .then(result => { if (active) setState({ path: result.linkPath }) })
      .catch(() => { if (active) setState({ unavailable: true }) })
    return () => { active = false }
  }, [targetType, targetId, getAccessTokenSilently])
  if (state.path) return <Navigate to={state.path} replace />
  return <main id="main-content" className="dashboard-shell"><section className="role-card" role={state.loading ? 'status' : 'alert'}><h1>{state.loading ? 'Checking access...' : 'Item unavailable'}</h1>{state.unavailable && <p>This item was removed or you no longer have permission to open it.</p>}</section></main>
}
