import { useCallback, useEffect, useRef, useState } from 'react'
import { listClips } from './api.js'
import { decorateClip } from './lib/clips.js'
import { saveLesson } from './lib/memoryApi.js'
import CreateClips from './screens/CreateClips.jsx'
import Feed from './screens/Feed.jsx'
import ClipPlayer from './screens/ClipPlayer.jsx'
import MemoryGraph from './screens/MemoryGraph.jsx'
import Toast from './components/Toast.jsx'

export default function App() {
  const [view, setView] = useState('create') // 'create' | 'feed' | 'player' | 'graph'
  const [clips, setClips] = useState([])
  const [libraryCount, setLibraryCount] = useState(0)
  const [scoped, setScoped] = useState(false) // feed showing one topic vs whole library
  const [playerIndex, setPlayerIndex] = useState(0)
  const [toast, setToast] = useState(null)
  const [graphRefresh, setGraphRefresh] = useState(0)
  const [highlightIds, setHighlightIds] = useState([])
  const returnView = useRef('feed')

  const loadCount = useCallback(async () => {
    try {
      const { clips: all } = await listClips()
      setLibraryCount(all.length)
    } catch {
      setLibraryCount(0)
    }
  }, [])

  useEffect(() => {
    loadCount()
  }, [loadCount])

  // Show the feed scoped to one job (a topic) or the whole library (jobId=null).
  const showFeed = async (jobId) => {
    try {
      const { clips: raw } = await listClips(jobId)
      setClips(raw.map(decorateClip))
    } catch {
      setClips([])
    }
    setScoped(!!jobId)
    setPlayerIndex(0)
    setView('feed')
  }

  const openPlayer = (i) => {
    setPlayerIndex(i)
    setView('player')
  }
  const navigate = (delta) => {
    setPlayerIndex((i) => Math.min(Math.max(i + delta, 0), clips.length - 1))
  }

  const openGraph = useCallback(() => {
    setView((v) => {
      if (v !== 'graph') returnView.current = v
      return 'graph'
    })
  }, [])

  // Save a watched clip as a lesson -> kicks off the memory pipeline (Claude
  // extracts memory points, Redis recalls related ones, connections persisted).
  // Interests come from the clip's own tags (real clips carry them).
  const handleSaveLesson = useCallback(
    async (clip) => {
      const result = await saveLesson({
        title: clip.title,
        subject: clip.subjectTag,
        channel: clip.channel,
        description: clip.description,
        interests: clip.tags && clip.tags.length ? clip.tags : [clip.subjectTag],
      })
      setHighlightIds(result.newNodeIds || [])
      setGraphRefresh((n) => n + 1)
      const n = result.addedNodes?.length || 0
      setToast({
        message: `Committed to memory · ${n} point${n === 1 ? '' : 's'} added`,
        action: { label: 'View Graph', onClick: openGraph },
      })
      return result
    },
    [openGraph],
  )

  const onSaveError = useCallback((e) => {
    setToast({ tone: 'error', message: `Couldn’t save lesson. ${e.message}` })
  }, [])

  return (
    <div className="flex min-h-full items-center justify-center bg-bg-200 sm:p-6">
      <div className="relative flex h-[100dvh] w-full max-w-[420px] flex-col overflow-hidden bg-bg-100 sm:h-[860px] sm:rounded-lg sm:border sm:border-gray-a-200 sm:shadow-modal">
        {view === 'create' && (
          <CreateClips
            libraryCount={libraryCount}
            onBrowse={async () => {
              await loadCount()
              await showFeed(null) // whole library
            }}
            onDone={async (jobId) => {
              await loadCount()
              await showFeed(jobId) // only the topic just generated
            }}
          />
        )}

        {view === 'feed' && (
          <Feed
            clips={clips}
            scoped={scoped}
            focusIndex={playerIndex}
            onOpen={openPlayer}
            onEdit={() => setView('create')}
            onShowAll={() => showFeed(null)}
            onOpenGraph={openGraph}
            onSaveLesson={handleSaveLesson}
            onSaveError={onSaveError}
          />
        )}

        {view === 'player' && clips[playerIndex] && (
          <ClipPlayer
            clip={clips[playerIndex]}
            index={playerIndex}
            total={clips.length}
            onClose={() => setView('feed')}
            onNavigate={navigate}
            onOpenGraph={openGraph}
            onSaveLesson={handleSaveLesson}
            onSaveError={onSaveError}
          />
        )}

        {view === 'graph' && (
          <MemoryGraph
            onClose={() => setView(returnView.current)}
            refreshKey={graphRefresh}
            highlightIds={highlightIds}
          />
        )}

        <Toast toast={toast} onDismiss={() => setToast(null)} />
      </div>
    </div>
  )
}
