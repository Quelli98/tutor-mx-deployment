import { OrganiserIcon } from '../organiser/OrganiserIcon'

/**
 * One dashboard figure: a label, a large value beside a picture, and a line of
 * context. The picture is an illustration (`art`) or a small line icon
 * (`icon`, coloured by an accent `tone`).
 */
export function StatTile({ label, value, sub, art, icon, tone = 'accent-blue' }) {
  return (
    <li className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <div className="stat-tile-figures">
        <p className="stat-tile-value">{value}</p>
        {icon
          ? <span className={`stat-tile-icon ${tone}`} aria-hidden="true"><OrganiserIcon name={icon} size={22} /></span>
          : <img className="stat-tile-art" src={art} alt="" width="96" height="72" />}
      </div>
      <p className="stat-tile-sub">{sub}</p>
    </li>
  )
}
