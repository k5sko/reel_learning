import { useCallback, useEffect, useRef, useState } from 'react'
import { listClips, recsysFeedback, recsysOnboard, recsysRecommend, recsysSession } from './api.js'
import { decorateClip } from './lib/clips.js'
import { saveLesson } from './lib/memoryApi.js'
import CreateClips from './screens/CreateClips.jsx'
import Onboarding from './screens/Onboarding.jsx'
import Feed from './screens/Feed.jsx'
import KnowledgeMap from './screens/KnowledgeMap.jsx'
import Practice from './screens/Practice.jsx'
import Progress from './screens/Progress.jsx'
import TabBar from './components/TabBar.jsx'
import Toast from './components/Toast.jsx'

export default function App() {
  const [tab, setTab] = useState('learn') // learn | foryou | watch | progress | map
  const [clips, setClips] = useState([])
  const [libraryCount, setLibraryCount] = useState(0)
  const [playerIndex, setPlayerIndex] = useState(0)
  const [toast, setToast] = useState(null)
  const [graphRefresh, setGraphRefresh] = useState(0)
  const [highlightIds, setHighlightIds] = useState([])
  // First-open style capture seeds P(fit). Persisted so it only shows once.
  const [needsOnboard, setNeedsOnboard] = useState(() => !localStorage.getItem('rl_onboarded'))
  const [loadingMore, setLoadingMore] = useState(false) // next batch in flight -> feed shows a quiz
  const returnTab = useRef('foryou') // where the Map tab's close button returns to

  // Recommender state: a library map (id -> raw clip) the recommender's clip_ids resolve against,
  // a re-entrancy guard for the one-at-a-time fetch, and whether a recsys session is active.
  const libraryRef = useRef(new Map())
  const shownIdsRef = useRef(new Set()) // clip ids already in the feed — updated SYNCHRONOUSLY (no
  // effect lag) so the recommender's exclude list is never stale -> no duplicate clips
  const loadingMoreRef = useRef(false)
  const recsysReadyRef = useRef(true) // the ONLY feed is the recommender (profile lives in Redis)

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
      if (t === 'foryou') {
        if (clips.length === 0) await openFeed()
        else setTab('foryou')
        return
      }
      if (t === 'map') {
        openGraph()
        return
      }
      setTab(t)
    },
    // openFeed omitted: it's stable (useCallback []) and defined later -> listing it would TDZ-throw
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setLoadingMore(true)
    try {
      const n = 2 + Math.floor(Math.random() * 3) // 2..4 per batch: 1 round-trip, shared LLM rating
      const shown = [...shownIdsRef.current]
      let rec = await recsysRecommend({ exclude: shown, n })
      let items = rec.items || []
      if (!items.length) {
        // corpus may still be processing (auto-query kicked a clip job) -> refresh + retry once
        await refreshLibrary()
        rec = await recsysRecommend({ exclude: shown, n, refresh: true })
        items = rec.items || []
      }
      const batch = []
      for (const it of items) {
        if (shownIdsRef.current.has(it.clip_id)) continue
        let raw = libraryRef.current.get(it.clip_id)
        if (!raw) {
          await refreshLibrary()
          raw = libraryRef.current.get(it.clip_id)
        }
        if (!raw) continue
        shownIdsRef.current.add(it.clip_id) // mark shown synchronously -> exclude never stale
        batch.push({
          ...decorateClip(raw),
          recsysChannel: it.channel,
          recNode: it.node,
          pGood: it.p_good,
          pFit: it.p_fit,
          recScore: it.score,
        })
      }
      if (batch.length) setClips((prev) => [...prev, ...batch])
    } catch {
      /* recommender optional — leave the feed as-is */
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [refreshLibrary])

  // THE feed = the recommender. First clip from the persisted profile (goals/DAG in Redis); the rest
  // stream one-at-a-time as the user scrolls. Empty (no goals yet) -> Feed shows its empty state.
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
  const openFeed = useCallback(async () => {
    // First 7 clips = RANDOM library clips (instant) — we don't care about their pick, and it avoids
    // the slow first recommend (corpus build + LLM style rating). The recommender batch prefetches in
    // the background while these play, then takes over.
    let lib = libraryRef.current
    if (!lib.size) lib = await refreshLibrary()
    const ids = [...lib.keys()]
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
    const seed = ids.slice(0, 7).map((id) => decorateClip(lib.get(id)))
    shownIdsRef.current = new Set(seed.map((c) => c.id))
    setClips(seed)
    setPlayerIndex(0)
    setTab('foryou')
  }, [refreshLibrary])

  // Report watch engagement for a clip the user scrolled past (moves the user's style vector).
  // Scrolled past a clip. node -> mastery credit (they watched the material). For STYLE: liked/saved
  // already sent positive; otherwise it's a soft discard -> push style away from this clip.
  const onWatched = useCallback((clip, watchRatio, engaged = true) => {
    if (!recsysReadyRef.current || !clip) return
    recsysFeedback({
      clip_id: clip.id,
      node: clip.recNode,
      watch_ratio: watchRatio,
      disliked: !engaged,
    }).catch(() => {})
  }, [])

  // Like is a real signal — pull the user's style toward this clip.
  const onLike = useCallback((clip) => {
    if (!recsysReadyRef.current || !clip) return
    recsysFeedback({ clip_id: clip.id, node: clip.recNode, liked: true }).catch(() => {})
  }, [])

  // Quiz answer for a node -> mastery (pass up / fail down). diagnostic=true (prereq check) records
  // mastery without expanding deeper (one level only).
  const onQuizResult = useCallback((node, passed, diagnostic = false) => {
    if (!recsysReadyRef.current || !node) return
    recsysFeedback({ node, problem_passed: passed, diagnostic }).catch(() => {})
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
                await openFeed() // recommender feed from the (now-updated) profile
              }}
            />
          )}

          {tab === 'foryou' && (
            <Feed
              clips={clips}
              focusIndex={playerIndex}
              onEdit={() => setTab('learn')}
              onOpenGraph={openGraph}
              onSaveLesson={handleSaveLesson}
              onSaveError={onSaveError}
              onNeedMore={appendRecommended}
              onWatched={onWatched}
              onLike={onLike}
              onQuizResult={onQuizResult}
              loadingMore={loadingMore}
              streaming
            />
          )}

          {tab === 'practice' && <Practice />}

          {tab === 'progress' && <Progress onBrowse={() => setTab('learn')} />}

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
