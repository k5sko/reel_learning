import { useCallback, useEffect, useRef, useState } from 'react'
import { listClips, recsysFeedback, recsysOnboard, recsysRecommend, recsysSession } from './api.js'
import { decorateClip } from './lib/clips.js'
import { saveLesson } from './lib/memoryApi.js'
import CreateClips from './screens/CreateClips.jsx'
import Onboarding from './screens/Onboarding.jsx'
import Feed from './screens/Feed.jsx'
import KnowledgeMap from './screens/KnowledgeMap.jsx'
import Progress from './screens/Progress.jsx'
import TabBar from './components/TabBar.jsx'
import Toast from './components/Toast.jsx'

export default function App() {
  const [tab, setTab] = useState('learn') // learn | foryou | watch | progress | map
  const [clips, setClips] = useState([])
  const [libraryCount, setLibraryCount] = useState(0)
  const [scoped, setScoped] = useState(false) // feed showing one topic vs whole library
  const [playerIndex, setPlayerIndex] = useState(0)
  const [toast, setToast] = useState(null)
  const [graphRefresh, setGraphRefresh] = useState(0)
  const [highlightIds, setHighlightIds] = useState([])
  // First-open style capture seeds P(fit). Persisted so it only shows once.
  const [needsOnboard, setNeedsOnboard] = useState(() => !localStorage.getItem('rl_onboarded'))
  const returnTab = useRef('foryou') // where the Map tab's close button returns to

  // Recommender state: a library map (id -> raw clip) the recommender's clip_ids resolve against,
  // a re-entrancy guard for the one-at-a-time fetch, and whether a recsys session is active.
  const libraryRef = useRef(new Map())
  const clipsRef = useRef([])
  const loadingMoreRef = useRef(false)
  const recsysReadyRef = useRef(false)
  useEffect(() => {
    clipsRef.current = clips
  }, [clips])

  // Refresh the whole-library map (also powers the "Browse library" count).
  const refreshLibrary = useCallback(async () => {
    try {
      const { clips: all } = await listClips()
      libraryRef.current = new Map(all.map((c) => [c.id, c]))
      setLibraryCount(all.length)
      return libraryRef.current
    } catch {
      return libraryRef.current
    }
  }, [])

  const loadCount = refreshLibrary

  useEffect(() => {
    loadCount()
  }, [loadCount])

  // Load the feed scoped to one job (a topic) or the whole library (jobId=null),
  // and land on the For You tab.
  const showFeed = async (jobId) => {
    try {
      const { clips: raw } = await listClips(jobId)
      setClips(raw.map(decorateClip))
    } catch {
      setClips([])
    }
    setScoped(!!jobId)
    setPlayerIndex(0)
    setTab('foryou')
  }

  const openGraph = useCallback(() => {
    setTab((cur) => {
      if (cur !== 'map') returnTab.current = cur
      return 'map'
    })
  }, [])

  // Bottom-bar tab selection. "For You" lazy-loads the whole library the first
  // time if no session feed is loaded yet; "Map" remembers where to return.
  const selectTab = useCallback(
    async (t) => {
      if (t === 'foryou' && clips.length === 0) {
        await showFeed(null)
        return
      }
      if (t === 'map') {
        openGraph()
        return
      }
      setTab(t)
    },
    [clips.length, openGraph],
  )

  // Save a watched clip as a lesson -> kicks off the memory pipeline (Claude
  // extracts memory points, Redis recalls related ones, connections persisted).
  const handleSaveLesson = useCallback(
    async (clip) => {
      const result = await saveLesson({
        title: clip.title,
        subject: clip.subjectTag,
        channel: clip.channel,
        description: clip.description,
        interests: clip.tags && clip.tags.length ? clip.tags : [clip.subjectTag],
      })
      // saving a lesson is a strong positive -> shift the user's style vector toward this clip
      if (recsysReadyRef.current) {
        recsysFeedback({ clip_id: clip.id, saved: true }).catch(() => {})
      }
      setHighlightIds(result.newNodeIds || [])
      setGraphRefresh((n) => n + 1)
      const n = result.addedNodes?.length || 0
      setToast({
        message: `Committed to memory · ${n} point${n === 1 ? '' : 's'} added`,
        action: { label: 'View Map', onClick: openGraph },
      })
      return result
    },
    [openGraph],
  )

  const onSaveError = useCallback((e) => {
    setToast({ tone: 'error', message: `Couldn’t save lesson. ${e.message}` })
  }, [])

  // Grow the feed by ONE recommender-chosen clip (excludes what's already shown). Called when the
  // user nears the end of the feed -> the next video is picked by the recommender, one at a time.
  const appendRecommended = useCallback(async () => {
    if (loadingMoreRef.current || !recsysReadyRef.current) return
    loadingMoreRef.current = true
    try {
      const shown = clipsRef.current.map((c) => c.id)
      let rec = await recsysRecommend({ exclude: shown, n: 1 })
      let item = rec.items && rec.items[0]
      if (!item) {
        // corpus may still be processing (auto-query kicked a clip job) -> refresh + retry once
        await refreshLibrary()
        rec = await recsysRecommend({ exclude: shown, n: 1, refresh: true })
        item = rec.items && rec.items[0]
      }
      if (!item) return
      let raw = libraryRef.current.get(item.clip_id)
      if (!raw) {
        await refreshLibrary()
        raw = libraryRef.current.get(item.clip_id)
      }
      if (!raw) return
      const decorated = {
        ...decorateClip(raw),
        recsysChannel: item.channel, // uploader (recsys P(fit) key) — distinct from display channel
        recNode: item.node,
        pGood: item.p_good,
        pFit: item.p_fit,
        recScore: item.score,
      }
      setClips((prev) => (prev.some((c) => c.id === decorated.id) ? prev : [...prev, decorated]))
    } catch {
      /* recommender optional — leave the feed as-is */
    } finally {
      loadingMoreRef.current = false
    }
  }, [refreshLibrary])

  // Build the For You feed FROM the recommender (clip 1 onward), ranked across the whole corpus for
  // the session's goal — not just the session's videos in clipper order. Falls back to the
  // clipper-ordered feed if the recommender has nothing yet (clips still processing).
  const decorateRecItem = (it) => {
    const raw = libraryRef.current.get(it.clip_id)
    return raw
      ? {
          ...decorateClip(raw),
          recsysChannel: it.channel,
          recNode: it.node, // DAG node this clip serves -> watch credits its mastery
          pGood: it.p_good,
          pFit: it.p_fit,
          recScore: it.score,
        }
      : null
  }
  const seedRecsysFeed = useCallback(async (fallbackJobIds, k = 1) => {
    try {
      const rec = await recsysRecommend({ exclude: [], n: k })
      const decorated = (rec.items || []).map(decorateRecItem).filter(Boolean)
      if (decorated.length) {
        setClips(decorated)
        setScoped(true)
        setPlayerIndex(0)
        setTab('foryou')
        return true
      }
    } catch {
      /* fall through to the clipper-ordered feed */
    }
    await showFeed(fallbackJobIds)
    return false
  }, [refreshLibrary])

  // Report watch engagement for a clip the user scrolled past (moves the user's style vector).
  const onWatched = useCallback((clip, watchRatio) => {
    if (!recsysReadyRef.current || !clip) return
    // clip_id -> style EMA ; node -> mastery credit (advances the DAG)
    recsysFeedback({ clip_id: clip.id, watch_ratio: watchRatio, node: clip.recNode }).catch(() => {})
  }, [])

  const completeOnboard = useCallback(async (axes) => {
    try {
      await recsysOnboard(axes)
    } catch {
      /* recsys optional */
    }
    localStorage.setItem('rl_onboarded', '1')
    setNeedsOnboard(false)
  }, [])
  const skipOnboard = useCallback(() => {
    localStorage.setItem('rl_onboarded', '1')
    setNeedsOnboard(false)
  }, [])

  const immersive = tab === 'foryou'

  if (needsOnboard) {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg-200 sm:p-6">
        <div className="relative flex h-[100dvh] w-full max-w-[420px] flex-col overflow-hidden bg-bg-100 sm:h-[860px] sm:rounded-lg sm:border sm:border-gray-a-200 sm:shadow-modal">
          <Onboarding onComplete={completeOnboard} onSkip={skipOnboard} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg-200 sm:p-6">
      <div className="relative flex h-[100dvh] w-full max-w-[420px] flex-col overflow-hidden bg-bg-100 sm:h-[860px] sm:rounded-lg sm:border sm:border-gray-a-200 sm:shadow-modal">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {tab === 'learn' && (
            <CreateClips
              libraryCount={libraryCount}
              onBrowse={() => showFeed(null)}
              onDone={async (jobIds, goals) => {
                await refreshLibrary()
                recsysReadyRef.current = false
                if (goals && goals.length) {
                  try {
                    await recsysSession(goals)
                    recsysReadyRef.current = true
                  } catch {
                    /* recsys optional */
                  }
                }
                // recsys-ordered feed from clip 1 (falls back to clipper order if empty); else plain feed
                if (recsysReadyRef.current) await seedRecsysFeed(jobIds, 1)
                else await showFeed(jobIds)
              }}
            />
          )}

          {tab === 'foryou' && (
            <Feed
              clips={clips}
              scoped={scoped}
              focusIndex={playerIndex}
              onEdit={() => setTab('learn')}
              onShowAll={() => showFeed(null)}
              onOpenGraph={openGraph}
              onSaveLesson={handleSaveLesson}
              onSaveError={onSaveError}
              onNeedMore={appendRecommended}
              onWatched={onWatched}
            />
          )}

          {tab === 'progress' && <Progress onBrowse={() => showFeed(null)} />}

          {tab === 'map' && (
            <KnowledgeMap onClose={() => setTab(returnTab.current)} refreshKey={graphRefresh} />
          )}
        </div>

        <TabBar tab={tab} onSelect={selectTab} dark={immersive} />

        <Toast toast={toast} onDismiss={() => setToast(null)} />
      </div>
    </div>
  )
}
