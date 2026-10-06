/** One dashboard figure: a label, a large value beside a small picture, and a line of context. */
export function StatTile({ label, value, sub, art }) {
  return (
    <li className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <div className="stat-tile-figures">
        <p className="stat-tile-value">{value}</p>
        <img className="stat-tile-art" src={art} alt="" width="96" height="72" />
      </div>
      <p className="stat-tile-sub">{sub}</p>
    </li>
  )
}
