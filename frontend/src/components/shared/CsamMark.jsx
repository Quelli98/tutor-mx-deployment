// The faceted hexagon from the official CSAM logo, traced as 24 facets.
const FACETS = [
  ['#FD5E9D', '22.5,63.8 15,51 22.5,38.2 45,51'],
  ['#D143FB', '45,76.5 30,76.5 22.5,63.8 45,51'],
  ['#FE639F', '22.5,38.2 30,25.5 45,25.5 45,51'],
  ['#8E01A8', '67.5,63.8 60,76.5 45,76.5 45,51'],
  ['#FB3B85', '60,25.5 67.5,38.2 45,51 45,25.5'],
  ['#FC2590', '67.5,38.2 75,51 67.5,63.8 45,51'],
  ['#3201C4', '90,76.5 60,76.5 67.5,63.8'],
  ['#FD2DA4', '75,51 90,76.5 67.5,63.8'],
  ['#E951FB', '45,0 45,25.5 30,25.5'],
  ['#EF2BC4', '45,0 60,25.5 45,25.5'],
  ['#FE649A', '0,76.5 15,51 22.5,63.8'],
  ['#EB50F2', '30,76.5 0,76.5 22.5,63.8'],
  ['#F85859', '22.5,38.2 15,51 0,25.5'],
  ['#FD746B', '30,25.5 22.5,38.2 0,25.5'],
  ['#FC7FF8', '45,0 30,25.5 0,25.5'],
  ['#FA7B6A', '15,51 0,76.5 0,25.5'],
  ['#CE44FD', '45,102 30,76.5 45,76.5'],
  ['#8D06B9', '45,102 45,76.5 60,76.5'],
  ['#2701E0', '90,76.5 45,102 60,76.5'],
  ['#E859FD', '45,102 0,76.5 30,76.5'],
  ['#FE4D90', '90,25.5 67.5,38.2 60,25.5'],
  ['#FD2F94', '90,25.5 75,51 67.5,38.2'],
  ['#FC48AB', '90,25.5 90,76.5 75,51'],
  ['#F94EC8', '45,0 90,25.5 60,25.5'],
]

export function CsamMark({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 90 102" aria-hidden="true" focusable="false">
      {FACETS.map(([fill, points]) => (
        // A hairline stroke in the facet's own colour hides anti-aliasing seams between facets.
        <polygon key={points} points={points} fill={fill} stroke={fill} strokeWidth="0.5" strokeLinejoin="round" />
      ))}
    </svg>
  )
}
