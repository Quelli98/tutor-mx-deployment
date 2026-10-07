export function DensityToggle({ compact, onChange }) {
  return <label className="density-toggle"><input type="checkbox" checked={compact} onChange={e => onChange(e.target.checked)}/>Compact mode</label>
}
