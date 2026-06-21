import { useCallback, useEffect, useState } from 'react'
import { listClips } from './api.js'
import { decorateClip } from './lib/clips.js'
import CreateClips from './screens/CreateClips.jsx'
import Feed from './screens/Feed.jsx'
import ClipPlayer from './screens/ClipPlayer.jsx'

export default function App() {
  const [view, setView] = useState('create') // 'create' | 'feed' | 'player'
  const [clips, setClips] = useState([])
  const [playerIndex, setPlayerIndex] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const { clips: raw } = await listClips()
      setClips(raw.map(decorateClip))
    } catch {
      setClips([])
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const openPlayer = (i) => {
    setPlayerIndex(i)
    setView('player')
  }
  const navigate = (delta) => {
    setPlayerIndex((i) => Math.min(Math.max(i + delta, 0), clips.length - 1))
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg-200 sm:p-6">
      <div className="relative flex h-[100dvh] w-full max-w-[420px] flex-col overflow-hidden bg-bg-100 sm:h-[860px] sm:rounded-lg sm:border sm:border-gray-a-200 sm:shadow-modal">
        {view === 'create' && (
          <CreateClips
            libraryCount={clips.length}
            onBrowse={() => {
              setPlayerIndex(0)
              setView('feed')
            }}
            onDone={async () => {
              await refresh()
              setPlayerIndex(0)
              setView('feed')
            }}
          />
        )}

        {view === 'feed' && (
          <Feed
            clips={clips}
            focusIndex={playerIndex}
            onOpen={openPlayer}
            onEdit={() => setView('create')}
          />
        )}

        {view === 'player' && clips[playerIndex] && (
          <ClipPlayer
            clip={clips[playerIndex]}
            index={playerIndex}
            total={clips.length}
            onClose={() => setView('feed')}
            onNavigate={navigate}
          />
        )}
      </div>
    </div>
  )
}
