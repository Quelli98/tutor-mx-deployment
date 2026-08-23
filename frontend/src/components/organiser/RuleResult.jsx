const RESULT_LABELS = Object.freeze({
  pass: { symbol: '\u2713', text: 'Pass' },
  fail: { symbol: '\u2715', text: 'Fail' },
  unknown: { symbol: '?', text: 'Not checked' },
})

export function RuleResult({ label, state = 'unknown', message }) {
  const normalizedState = RESULT_LABELS[state] ? state : 'unknown'
  const result = RESULT_LABELS[normalizedState]

  return (
    <li className={`rule-result rule-result-${normalizedState}`}>
      <span className="rule-result-symbol" aria-hidden="true">
        {result.symbol}
      </span>
      <span>
        <strong>
          {label}: {result.text}
        </strong>
        {message && <span className="rule-result-message">{message}</span>}
      </span>
    </li>
  )
}
