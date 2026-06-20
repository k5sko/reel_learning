import { useMemo, useState } from 'react'
import { SUBJECTS, getFeedClips } from './data/mockClips.js'
import SubjectInput from './screens/SubjectInput.jsx'
import Feed from './screens/Feed.jsx'
import ClipPlayer from './screens/ClipPlayer.jsx'

export default function App() {
  const [view, setView] = useState('subjects') // 'subjects' | 'feed' | 'player'
  const [selected, setSelected] = useState(SUBJECTS.map((s) => s.name))
  const [playerIndex, setPlayerIndex] = useState(0)

  const feedClips = useMemo(() => getFeedClips(selected), [selected])

  const openPlayer = (i) => {
    setPlayerIndex(i)
    setView('player')
  }
  const navigate = (delta) => {
    setPlayerIndex((i) => Math.min(Math.max(i + delta, 0), feedClips.length - 1))
  }

  return (
    // Phone frame on desktop; fills the viewport on mobile.
    <div className="flex min-h-full items-center justify-center bg-bg-200 sm:p-6">
      <div className="relative flex h-[100dvh] w-full max-w-[420px] flex-col overflow-hidden bg-bg-100 sm:h-[860px] sm:rounded-lg sm:border sm:border-gray-a-200 sm:shadow-modal">
        {view === 'subjects' && (
          <SubjectInput
            selected={selected}
            setSelected={setSelected}
            onFind={() => setView('feed')}
          />
        )}

        {view === 'feed' && (
          <Feed
            clips={feedClips}
            selected={selected}
            focusIndex={playerIndex}
            onOpen={openPlayer}
            onEdit={() => setView('subjects')}
          />
        )}

        {view === 'player' && feedClips[playerIndex] && (
          <ClipPlayer
            clip={feedClips[playerIndex]}
            index={playerIndex}
            total={feedClips.length}
            onClose={() => setView('feed')}
            onNavigate={navigate}
          />
        )}
      </div>
    </div>
  )
}
