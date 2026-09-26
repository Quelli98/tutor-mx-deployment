import books from '../../assets/organiser/photos/books.webp'
import code from '../../assets/organiser/photos/code.webp'
import desk from '../../assets/organiser/photos/desk.webp'
import lecture from '../../assets/organiser/photos/lecture.webp'
import library from '../../assets/organiser/photos/library.webp'
import notebook from '../../assets/organiser/photos/notebook.webp'
import terminal from '../../assets/organiser/photos/terminal.webp'
import whiteboard from '../../assets/organiser/photos/whiteboard.webp'

// Public-domain (CC0) photos from StockSnap and rawpixel, found through Openverse.
const PHOTOS = { books, code, desk, lecture, library, notebook, terminal, whiteboard }
const ROTATION = ['library', 'lecture', 'code', 'notebook', 'whiteboard', 'desk', 'books', 'terminal']

// A course gets a picture of what it is about when its name says so.
const TOPICS = [
  [/program|algorithm|coding|software dev|web|mobile/i, 'code'],
  [/operating|system|network|architecture|organi[sz]ation|compil/i, 'terminal'],
  [/database|data|information|analytics/i, 'desk'],
  [/math|calcul|algebra|statistic|analysis|discrete|probability|logic/i, 'notebook'],
  [/design|project|engineering/i, 'whiteboard'],
  [/graphic|visual|vision|image|game/i, 'desk'],
]

export function coverPhotoFor(course, index) {
  const topic = TOPICS.find(([pattern]) => pattern.test(course.name ?? ''))
  return PHOTOS[topic ? topic[1] : ROTATION[index % ROTATION.length]]
}

export function photoAt(index) {
  return PHOTOS[ROTATION[index % ROTATION.length]]
}
