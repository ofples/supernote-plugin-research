/**
 * TaskHome - shared task workspace with sidebar navigation and sync summary.
 */

import React, {useState, useEffect, useCallback, useRef} from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import {PluginCommAPI, PluginFileAPI, NativePluginManager} from 'sn-plugin-lib';
import {closePlugin} from '../utils/closePlugin';
import {getTasksForNote, getAllTasks as getAllRegistryTasks, getTask as getRegistryTask} from '../utils/taskRegistry';
import {openNote, jumpWithinNote} from '../utils/noteOpener';
import {healRenamedNotes} from '../utils/noteHeal';
import {noteLabel} from '../utils/noteLabel';
import {saveConfig} from '../utils/config';
import {useFontScale} from '../utils/useFontScale';
import {Check} from '../components/settings';
import {loadConfig, getCachedConfig, resolveDefaultTab} from '../utils/config';
import {getSessionTab, setSessionTab} from '../utils/viewState';
import {reopenTask, getCompletedTasks, refreshCompletedTasks} from '../api/todoist';
import {getCache, fetchTaskData, invalidateCache, initTaskCache, subscribeCache} from '../cache/taskCache';
import {completedData, offlineData, retryOffline} from '../offline/service';
const {syncStatusMessage} = require('../offline/status');
const {visibleProjectIds, isProjectVisible} = require('../utils/projectVisibility');
const {collectionGroups} = require('../collections/model');
const {localDate} = require('../offline/model');
import {log, logError} from '../utils/debug';
import TaskSidebar from '../components/TaskSidebar';
import TaskRow from '../components/TaskRow';
import ProjectOverview from '../components/ProjectOverview';
import SelectionBar from '../components/SelectionBar';
import {useTaskSelection} from '../utils/useTaskSelection';
import SectionHeader from '../components/SectionHeader';
import Chip from '../components/Chip';

type Nav = {
  push: (name: string, params?: Record<string, any>) => void;
  pop: () => void;
  resetTo: (name: string) => void;
  canGoBack: boolean;
};

type Props = {
  nav: Nav;
  initialView?: string;
  focusTab?: string; // deep-link target tab; overrides the config default
};

const VIEW_KEYS = ['today', 'tomorrow', 'upcoming', 'inbox', 'note', 'projects', 'device', 'done'];
export function normalizeTaskView(value?: string): string {
  if (value === 'pending') return 'today';
  if (value === 'this-note') return 'note';
  return value && (VIEW_KEYS.includes(value) || /^project:.+/.test(value)) ? value : 'today';
}
export function syncChangeLabel(kind: string): string {
  return ({create: 'Create task', complete: 'Complete task', recurring_complete: 'Complete recurring occurrence',
    reopen: 'Reopen task', update: 'Edit task', move: 'Move task', delete: 'Delete task', collection_create: 'Create collection'} as Record<string, string>)[kind] || 'Saved change';
}

type ProjectMap = Record<string, string>;

export default function TaskHome({nav, focusTab, initialView}: Props) {
  const scale = useFontScale();
  // Saved-config snapshot for the FIRST render. On any warm open the config
  // cache is populated, so the tab, filters, and Log button paint correctly
  // immediately instead of mounting on defaults and visibly snapping when
  // the async load lands (e-ink repaint). Cold start falls back to defaults
  // and the loadConfig().then below corrects them (usually behind the
  // loading screen, so still no visible jump).
  const [cfg0] = useState(getCachedConfig);
  const [tasks, setTasks] = useState<any[]>([]);
  const [projectMap, setProjectMap] = useState<ProjectMap>({});
  const [projectList, setProjectList] = useState<any[]>([]);
  const [collectionList, setCollectionList] = useState<any[]>([]);
  const collectionName = (task: any) => task.section_id ? collectionList.find(section => section.id === task.section_id)?.name || 'Unavailable collection' : undefined;
  // Tab resolution (F-038): session memory > deep-link focusTab > configured
  // default ('last' resolves to the persisted lastOpenedTab). Session memory
  // is the tab the user was on before another screen pushed over TaskHome;
  // it outranks focusTab because the nav-stack entry keeps its original
  // focusTab param across pop-remounts, and a mid-session tab switch must
  // survive viewing a task. Fresh deep-link opens are unaffected: the session
  // tab is cleared whenever the plugin view closes.
  const [activeTab, setActiveTab] = useState(() => normalizeTaskView(initialView || getSessionTab() || focusTab || resolveDefaultTab(cfg0)));
  const [syncSheetOpen, setSyncSheetOpen] = useState(() => (getSessionTab() || focusTab || resolveDefaultTab(cfg0)) === 'pending');
  const [syncRetrying, setSyncRetrying] = useState(false);
  const [syncRetryError, setSyncRetryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncInfo, setSyncInfo] = useState<any>(null);
  const [jumpError, setJumpError] = useState('');
  const [noteCtx, setNoteCtx] = useState<{fileName: string; pageNum: number; filePath: string} | null>(null);
  const [pageTaskIds, setPageTaskIds] = useState<string[]>([]);
  const [registryNoteTasks, setRegistryNoteTasks] = useState<any[]>([]);
  const [deviceTasks, setDeviceTasks] = useState<any[]>([]);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [visibilityConfig, setVisibilityConfig] = useState<any>(cfg0 || {});
  const [debugMode, setDebugModeOn] = useState(cfg0?.debugMode === true);

  // Done tab: fetched lazily on first visit (separate endpoint, not part of
  // the main cache -- completed history changes rarely and can be large)
  const [doneTasks, setDoneTasks] = useState<any[]>([]);
  const [doneLoading, setDoneLoading] = useState(false);
  const [doneError, setDoneError] = useState('');
  const [doneFetched, setDoneFetched] = useState(false);
  // F-030: footer toggle -- show completed-today tasks inline on the Today
  // tab, same row pattern as the Done tab (filled box, Done chip, reopen)
  const [showDone, setShowDone] = useState(cfg0?.showDoneTasks === true);

  // B-033 (SNDEV-69): the plugin view appears via partial refresh, and the
  // mostly-white first frames leave the note's top half ghosting through
  // until a later repaint touches those pixels. The SDK's native module has
  // an unwrapped invalidatePluginView() ("Refresh plugin view"); fire it ONCE,
  // shortly after the first real content commit (loading -> false), so the
  // frame the user actually looks at is the one that gets the full repaint.
  // Config-gated (refreshOnOpen, default on) because the visible cost is
  // only knowable on-device.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (loading || refreshedRef.current) return;
    refreshedRef.current = true;
    if (cfg0?.refreshOnOpen === false) {
      log('TaskHome', 'B-033 refresh-on-open: disabled by config');
      return;
    }
    const fn = (NativePluginManager as any)?.invalidatePluginView;
    if (typeof fn !== 'function') {
      log('TaskHome', 'B-033 refresh-on-open: invalidatePluginView unavailable');
      return;
    }
    const t = setTimeout(() => {
      try {
        fn.call(NativePluginManager);
        log('TaskHome', 'B-033 refresh-on-open: invalidatePluginView() fired');
      } catch (e: any) {
        log('TaskHome', `B-033 refresh-on-open failed: ${e.message}`);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [loading, cfg0?.refreshOnOpen]);

  // Load default tab from config and detect current page on mount
  useEffect(() => {
    // Cold-start corrector: on warm opens these all match the cfg0-seeded
    // initial state, and every setter bails without a re-render (primitives
    // compare equal; the array setter returns prev on deep-equality).
    loadConfig().then(config => {
      // Cold-start default-tab corrector. A deep-link focusTab or live
      // session tab wins over the config default (F-038).
      if (!initialView && !focusTab && !getSessionTab()) {
        setActiveTab(normalizeTaskView(resolveDefaultTab(config)));
      }
      setVisibilityConfig(config);
      setShowDone(config.showDoneTasks === true);
      setDebugModeOn(config.debugMode === true);
    });

    // Device-tab data is a fast local registry read, independent of note
    // context -- run it immediately and in parallel. It used to be
    // serialized BEHIND the ~3s getElements scan below, leaving the
    // (possibly default) Device tab on a false "no tasks" empty state.
    (async () => {
      try {
        const allReg = await getAllRegistryTasks();
        setDeviceTasks(allReg);
        log('TaskHome', `Registry: ${allReg.length} total device tasks`);
      } catch (e: any) {
        log('TaskHome', `Device registry read failed: ${e.message}`);
      } finally {
        setDeviceLoaded(true);
      }
    })();

    // Detect current note/page, scan for supertask links, read registry
    (async () => {
      try {
        const fp: any = await PluginCommAPI.getCurrentFilePath();
        const pn: any = await PluginCommAPI.getCurrentPageNum();
        const filePath = fp?.result || '';
        const pageNum = pn?.result ?? 0;
        if (!fp?.success || !pn?.success || !filePath.toLowerCase().endsWith('.note')) return;

        const fileName = filePath.split('/').pop()?.replace('.note', '') || '';
        log('TaskHome', 'Note context available');

        // B-033 mitigation A: read the (fast, local) registry FIRST and
        // commit it together with the note context in one synchronous block,
        // so the This Note band paints once instead of twice. The ~3s
        // element scan below then adds page chips as a single later commit.
        let regTasks: any[] = [];
        try {
          regTasks = await getTasksForNote(filePath);
          log('TaskHome', `Registry: ${regTasks.length} tasks in this note`);
        } catch (e: any) {
          log('TaskHome', `Registry read failed: ${e.message}`);
        }
        setNoteCtx({fileName, pageNum, filePath});
        setRegistryNoteTasks(regTasks);

        // Scan page elements for supertask:// links
        try {
          const elemResult: any = await PluginFileAPI.getElements(pageNum, filePath);
          if (elemResult?.success && elemResult.result) {
            const linkElements = elemResult.result.filter(
              (el: any) => el.type === 600 && el.link?.destPath?.startsWith('supertask://task/')
            );
            const ids = linkElements.map((el: any) => {
              const path = el.link.destPath;
              return path.replace('supertask://task/', '');
            });
            setPageTaskIds(ids);
            log('TaskHome', `Found ${ids.length} supertask links on page`);

            // Recycle elements to free native memory
            elemResult.result.forEach((el: any) => {
              if (el.recycle) el.recycle();
            });
          }
        } catch (e: any) {
          log('TaskHome', `Element scan failed: ${e.message}`);
        }
      } catch (e: any) {
        log('TaskHome', `Page context detection failed: ${e.message}`);
      }
    })();
  }, [focusTab, initialView]);

  // Apply fetched data to component state. Skips the update entirely when
  // the data matches what is already rendered: the background revalidate
  // otherwise replaces every list row with an identical copy, which on
  // e-ink is a visible full-list flash for nothing. Local mutations
  // (complete/reopen) bypass this via setTasks directly, which leaves the
  // fingerprint stale in the safe direction -- the next fetch differs from
  // it and repaints.
  const dataFp = useRef('');
  const applyData = useCallback((fetchedTasks: any[], fetchedProjects: any[], fetchedSections: any[] = []) => {
    const fp = JSON.stringify([fetchedTasks, fetchedProjects, fetchedSections]);
    if (fp === dataFp.current) {
      log('TaskHome', 'Fetched data unchanged -- skipping repaint');
      return;
    }
    dataFp.current = fp;
    const pMap: ProjectMap = {};
    (fetchedProjects || []).forEach((p: any) => { pMap[p.id] = p.name; });
    setProjectMap(pMap);
    setProjectList(fetchedProjects || []);
    setCollectionList(fetchedSections || []);
    setTasks((fetchedTasks || []).filter(task => !task.completed && !task.deleted && !task.remoteMissing));
  }, []);
  useEffect(() => subscribeCache((data: any) => {
    setSyncInfo(data); setError(''); setLoading(false);
    applyData(data.tasks, data.projects, data.sections);
    getAllRegistryTasks().then(setDeviceTasks).catch(() => {});
    completedData().then(setDoneTasks).catch(() => {});
    if (noteCtx?.filePath) getTasksForNote(noteCtx.filePath).then(setRegistryNoteTasks).catch(() => {});
  }), [applyData, noteCtx?.filePath]);

  // Reconcile registry: remove entries for tasks no longer in Todoist,
  // then heal any note renames (B-005, once per session, fire-and-forget)
  const reconcileRegistry = useCallback(async (fetchedTasks: any[]) => {
    healRenamedNotes(fetchedTasks)
      .then(healedCount => {
        if (healedCount > 0) {
          // Refresh Device tab data so healed paths/labels show immediately
          getAllRegistryTasks().then(setDeviceTasks).catch(() => {});
        }
      })
      .catch(() => {});
    try {
      const allReg = await getAllRegistryTasks();
      setDeviceTasks(allReg);
    } catch (syncErr: any) {
      log('TaskHome', `Registry sync failed (non-fatal): ${syncErr.message}`);
    }
  }, []);

  // Fetch via cache layer (used by Refresh button)
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await fetchTaskData();
      if (data) {
        setSyncInfo(data);
        applyData(data.tasks, data.projects, data.sections);
        await reconcileRegistry(data.tasks);
        log('TaskHome', `Loaded ${data.tasks.length} tasks, ${data.projects.length} projects${silent ? ' (silent)' : ''}`);
      } else {
        setError('No Todoist token yet. Tap Settings (top right), then the Setup tab, to add one.');
      }
    } catch (err: any) {
      logError('TaskHome', err);
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyData, reconcileRegistry]);

  // Mount: serve cached data immediately, then refresh in background
  useEffect(() => {
    log('TaskHome', 'MOUNT');

    (async () => {
      // Stale-while-revalidate: render from cache if available. On a cold
      // start the in-memory cache is empty but initTaskCache() serves the
      // last session's disk snapshot (hydration starts in index.js, so this
      // await usually resolves instantly) -- the list paints immediately
      // instead of holding on the loading screen.
      let cached = getCache();
      if (!cached) {
        cached = await initTaskCache();
      }
      if (cached) {
        setSyncInfo(cached);
        log('TaskHome', `Cache hit: ${cached.tasks.length} tasks (age: ${Date.now() - cached.timestamp}ms)`);
        applyData(cached.tasks, cached.projects, cached.sections);
        setLoading(false);
        // Kick the heal from cached data NOW instead of after the network
        // fetch -- the rename probe is seconds-slow already, and waiting on
        // the fetch added 3+ more (device log 2026-08-15 20:40). HEAL ONLY:
        // the reconcile's stale-prune must never run against cached data,
        // or a capture newer than the cache gets its registry entry deleted.
        // The post-fetch reconcile joins this heal via the in-flight guard.
        healRenamedNotes(cached.tasks)
          .then(healedCount => {
            if (healedCount > 0) {
              getAllRegistryTasks().then(setDeviceTasks).catch(() => {});
            }
          })
          .catch(() => {});
      }

      // Always fetch fresh data (deduplicates with any in-flight prefetch)
      fetchTaskData()
        .then((data: any) => {
          if (data) {
            setSyncInfo(data);
            applyData(data.tasks, data.projects, data.sections);
            reconcileRegistry(data.tasks);
            log('TaskHome', `Fresh data: ${data.tasks.length} tasks, ${data.projects.length} projects`);
          } else if (!cached) {
            setError('No Todoist token yet. Tap Settings (top right), then the Setup tab, to add one.');
          }
          setLoading(false);
        })
        .catch((err: any) => {
          logError('TaskHome', err);
          if (!cached) setError(err.message);
          setLoading(false);
        });
    })();
  }, [applyData, reconcileRegistry]);

  // Lazy-fetch completed tasks on first Done-tab visit or when the
  // show-done filter is enabled
  useEffect(() => {
    if ((activeTab !== 'done' && !showDone) || doneFetched || doneLoading) return;
    (async () => {
      setDoneLoading(true);
      setDoneError('');
      try {
        const items = await getCompletedTasks(30);
        setDoneTasks(items || []);
        setDoneFetched(true);
        log('TaskHome', `Done tab: ${items?.length ?? 0} completed tasks (30d)`);
        // Render durable history first, then refresh its remote cache. A fresh
        // installation's active snapshot cannot contain completed history.
        setDoneLoading(false);
        refreshCompletedTasks(30).then(setDoneTasks).catch(() => {
          setDoneError('Showing saved completed history. Todoist history could not be refreshed right now.');
        });
      } catch (err: any) {
        logError('TaskHome', err);
        setDoneError(`Could not load completed tasks: ${err.message}`);
      } finally {
        setDoneLoading(false);
      }
    })();
  }, [activeTab, showDone, doneFetched, doneLoading]);

  const toggleShowDone = () => {
    const v = !showDone;
    setShowDone(v);
    saveConfig({showDoneTasks: v}).catch(() => {});
    log('TaskHome', `Show done: ${v ? 'on' : 'off'}`);
  };

  const handleReopen = async (taskId: string) => {
    log('TaskHome', `REOPEN pressed taskId=${taskId}`);
    try {
      await reopenTask(taskId);
      log('TaskHome', `REOPEN success taskId=${taskId}`);
      setDoneTasks(prev => prev.filter(t => t.id !== taskId));
      invalidateCache();
      fetchData(true); // pull the reopened task back into the active lists
    } catch (err: any) {
      logError('TaskHome', err);
      const message = err?.code === 'RECURRING_UNDO_UNSUPPORTED'
        ? 'This recurring completion has already synced. Undo it in Todoist; the next occurrence stays active.'
        : 'Could not reopen this task. Your task state is preserved; retry when sync is available.';
      setDoneError(message); setError(message);
    }
  };

  const sel = useTaskSelection('TaskHome', {
    onCompleted: async ids => {
      dataFp.current = '';
      setTasks(prev => prev.filter(task => !ids.includes(task.id)));
      setDeviceTasks(prev => prev.filter(task => !ids.includes(task.id)));
      setRegistryNoteTasks(prev => prev.filter(task => !ids.includes(task.id)));
      // The authoritative state retains note references and recurring series.
      // Read it again after persistence so a server-provided next occurrence
      // can reappear immediately, even if the completion callback ran last.
      const data = await offlineData().catch(() => null);
      if (data) {setSyncInfo(data); applyData(data.tasks, data.projects, data.sections);}
      completedData().then(setDoneTasks).catch(() => {});
      getAllRegistryTasks().then(setDeviceTasks).catch(() => {});
      if (noteCtx?.filePath) getTasksForNote(noteCtx.filePath).then(setRegistryNoteTasks).catch(() => {});
    },
    onUndone: async () => {
      dataFp.current = '';
      const data = await offlineData().catch(() => null);
      if (data) {setSyncInfo(data); applyData(data.tasks, data.projects, data.sections);}
      completedData().then(setDoneTasks).catch(() => {});
      getAllRegistryTasks().then(setDeviceTasks).catch(() => {});
      if (noteCtx?.filePath) getTasksForNote(noteCtx.filePath).then(setRegistryNoteTasks).catch(() => {});
    },
    onError: msg => setError(msg),
  });

  // Jump straight into a note at a task's page. Registry pages are 0-based,
  // the intent is 1-based; openNote() closes the plugin view itself.
  const handleOpenNote = async (path: string, pageNum0?: number, taskId?: string) => {
    const intentPage = (pageNum0 ?? -1) + 1; // unknown page -> 0 = last-used
    const sameNote = noteCtx?.filePath === path;
    log('TaskHome', `OPEN NOTE page0=${pageNum0 ?? 'unknown'} intent=${intentPage} sameNote=${sameNote}`);
    setJumpError('');
    // 0.1.65 (SNDEV-70): same-note jumps use jumpToPage -- purpose-built,
    // no activity churn, and the case intent re-targeting never handled
    // reliably. Falls through to the openNote path (native openFile, then
    // intent) when unavailable or config-gated off.
    if (sameNote && pageNum0 !== undefined) {
      const jump = await jumpWithinNote(pageNum0);
      if (jump.success) return;
      log('TaskHome', `jumpWithinNote unavailable/failed (${jump.error}) -- using openNote path`);
    }
    openNote(path, intentPage).then(async result => {
      if (result.success) return;
      log('TaskHome', `openNote failed: ${result.error}`);
      // A missing file usually means the note was just renamed and the heal
      // probe is still in flight (it takes seconds -- one getElements per
      // candidate; seen racing a tap on device 2026-08-15). Join the heal,
      // re-read the registry path, and retry once before giving up.
      if (taskId && /not found/i.test(result.error || '')) {
        setJumpError('Note not found -- checking for a rename...');
        try {
          const healed = await healRenamedNotes(tasks);
          const entry = await getRegistryTask(taskId);
          if (entry?.notePath && entry.notePath !== path) {
            log('TaskHome', `OPEN NOTE retry after heal (${healed} healed): ${entry.notePath}`);
            setJumpError('');
            const retry = await openNote(entry.notePath, (entry.pageNum ?? (pageNum0 ?? -1)) + 1);
            if (retry.success) return;
            log('TaskHome', `openNote retry failed: ${retry.error}`);
          }
        } catch (e: any) {
          log('TaskHome', `Heal-retry failed: ${e.message}`);
        }
      }
      // Failure leaves the plugin view open, so timers run and the
      // banner reliably clears
      setJumpError(result.error || 'Could not open note');
      setTimeout(() => setJumpError(''), 6000);
    });
  };

  const handleTaskPress = (task: any) => {
    log('TaskHome', `TASK pressed id=${task.id}`);
    nav.push('task-detail', {task, projects: projectList});
  };

  const handleAddTask = async () => {
    log('TaskHome', 'ADD TASK pressed');
    const config = await loadConfig();
    nav.push('task-add', {projects: projectList, defaultProjectId: config.defaultProjectId, defaultSectionId: config.defaultSectionId});
  };

  const today = localDate(new Date());

  const isActiveRegistryTask = (reference: any) => {
    const authoritative = (syncInfo?.allTasks || tasks).find((task: any) => task.id === reference.id);
    const task = authoritative || reference;
    return !task.completed && !task.deleted && !task.awaitingRecurrence && !task.occurrencePending && !task.remoteMissing;
  };

  // Tasks linked to the current NOTE (any page), each with the page it lives
  // on so the band tells you where you'd jump in a long note (design-home-v2).
  // Sources: supertask:// links scanned on the current page, description
  // back-references (page parsed from "<fileName> p.N"), then registry
  // entries (which carry pageNum and cover not-yet-synced tasks).
  const noteTasks = (() => {
    const seen = new Set<string>();
    const result: Array<{task: any; pageNum?: number}> = [];

    // 1. Tasks whose IDs were found as supertask:// links on the current page
    for (const id of pageTaskIds) {
      const match = tasks.find(t => t.id === id);
      if (match && !seen.has(match.id)) {
        seen.add(match.id);
        result.push({task: match, pageNum: noteCtx?.pageNum});
      }
    }

    // 2. Tasks matched by description back-reference anywhere in this note
    if (noteCtx?.fileName) {
      const escaped = noteCtx.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const refRe = new RegExp(`${escaped}(?:\\.note)? p\\.(\\d+)`);
      for (const t of tasks) {
        if (seen.has(t.id) || !t.description) continue;
        const m = t.description.match(refRe);
        if (m) {
          seen.add(t.id);
          result.push({task: t, pageNum: parseInt(m[1], 10)});
        }
      }
    }

    // 3. Registry entries for this note (carry pageNum; cover pending-sync tasks)
    for (const rt of registryNoteTasks) {
      if (!isActiveRegistryTask(rt)) continue;
      if (!seen.has(rt.id)) {
        seen.add(rt.id);
        const full = tasks.find(t => t.id === rt.id);
        result.push({
          task: full || {...rt, _registryOnly: !rt.syncState},
          pageNum: rt.pageNum,
        });
      }
    }

    return result.sort((a, b) => (a.pageNum ?? 0) - (b.pageNum ?? 0));
  })();

  const renderThisNote = () => {
    if (!noteCtx) return <View style={styles.centered}><Text style={styles.emptyText}>Open a note to see its tasks</Text></View>;
    if (!noteTasks.length) return <View style={styles.centered}><Text style={styles.emptyText}>No active tasks in this note</Text></View>;

    return (
      <View style={styles.thisPage}>
        <View style={styles.thisPageHeader}>
          <Text style={[styles.thisPageTitle, {fontSize: Math.round(13 * scale)}]}>This Note</Text>
          <Chip label={String(noteTasks.length)} />
          {noteCtx ? <Text style={styles.thisPageNote}>{noteLabel(noteCtx.filePath, noteCtx.fileName)}</Text> : null}
        </View>
        {noteTasks.map(({task, pageNum}, i) => (
          <View key={task.id}>
            {i > 0 && <View style={styles.thisPageSeparator} />}
            <TaskRow
              task={task}
              selected={sel.selectedIds.includes(task.id)}
              onCheckPress={sel.completeOne}
              disabled={sel.busy}
              onSyncPress={() => setSyncSheetOpen(true)}
              onPress={handleTaskPress}
              showProject={projectMap[task.project_id]} showCollection={collectionName(task)}
              pageNum={pageNum}
              // Jump button only for tasks on a DIFFERENT page -- you're
              // already looking at the current one
              onOpenNote={
                noteCtx && pageNum !== undefined && pageNum !== noteCtx.pageNum
                  ? () => handleOpenNote(noteCtx.filePath, pageNum, task.id)
                  : undefined
              }
            />
          </View>
        ))}
      </View>
    );
  };

  // Build sections based on active tab
  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.loadingText, {fontSize: Math.round(16 * scale)}]}>Loading tasks...</Text>
        </View>
      );
    }

    if (error && !syncInfo) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }

    if (activeTab === 'note') return <ScrollView>{renderThisNote()}</ScrollView>;
    if (activeTab === 'tomorrow') return renderSimpleTasks(projectFiltered(tasks).filter(task => (task.due?.date || '').slice(0, 10) === tomorrow), 'No tasks due tomorrow');
    if (activeTab === 'inbox') return renderProjectTasks(inboxProject?.id, 'Inbox');
    if (activeTab.startsWith('project:')) {
      const id = activeTab.slice('project:'.length);
      return renderProjectTasks(id, projectMap[id] || 'Unavailable project');
    }
    if (activeTab === 'today') return renderTodayTab();
    if (activeTab === 'upcoming') return renderUpcomingTab();
    if (activeTab === 'device') return renderDeviceTab();
    if (activeTab === 'done') return renderDoneTab();
    return renderProjectsTab();
  };

  const renderDoneTab = () => {
    if (doneLoading) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.loadingText, {fontSize: Math.round(16 * scale)}]}>Loading completed tasks...</Text>
        </View>
      );
    }
    if (doneError && !doneTasks.length) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{doneError}</Text>
        </View>
      );
    }
    const visibleDone = projectFiltered(doneTasks).filter(task => !task.deleted);
    if (visibleDone.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, {fontSize: Math.round(18 * scale)}]}>Nothing completed in the last 30 days</Text>
        </View>
      );
    }

    const items = groupDoneByBucket(visibleDone, today);

    return (
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        renderItem={({item}) => {
          if (item.type === 'header') {
            return <SectionHeader title={item.title} count={item.count} />;
          }
          // Tap on the filled box reopens -- completion is fully recoverable
          return (
            <TaskRow
              task={item.task}
              checked
              completedAt={item.task.completed_at}
              onCheckPress={handleReopen}
              onSyncPress={() => setSyncSheetOpen(true)}
              onPress={handleTaskPress}
              showProject={projectMap[item.task.project_id]} showCollection={collectionName(item.task)}
            />
          );
        }}
        ItemSeparatorComponent={({leadingItem}) =>
          leadingItem?.type !== 'header' ? <View style={styles.separator} /> : null
        }
      />
    );
  };

  const renderTodayTab = () => {
    // Tasks due today or overdue, grouped by project
    const todayTasks = projectFiltered(tasks).filter(t => {
      const due = (t.due?.date || '').slice(0, 10);
      return due && due <= today;
    });

    const doneTodayCount = showDone
      ? projectFiltered(doneTasks).filter(t => (t.completed_at || '').slice(0, 10) === today).length
      : 0;
    if (todayTasks.length === 0 && doneTodayCount === 0) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, {fontSize: Math.round(18 * scale)}]}>No tasks due today</Text>
        </View>
      );
    }

    // Group by project
    const groups: any[] = groupByProject(todayTasks, projectMap);

    // F-030: completed-today section, same pattern as the Done tab
    if (showDone) {
      const doneToday = projectFiltered(doneTasks).filter(
        t => (t.completed_at || '').slice(0, 10) === today,
      );
      if (doneToday.length > 0) {
        groups.push({key: 'header-done-today', type: 'header', title: 'Completed Today', count: doneToday.length});
        doneToday.forEach(t => groups.push({key: `done-${t.id}`, type: 'doneTask', task: t}));
      }
    }

    return (
      <FlatList
        data={groups}
        keyExtractor={item => item.key}
        renderItem={({item}) => {
          if (item.type === 'header') {
            return (
              <SectionHeader
                title={item.title}
                count={item.count}
                onPress={item.projectId ? () => changeView(`project:${item.projectId}`) : undefined}
              />
            );
          }
          if (item.type === 'doneTask') {
            return (
              <TaskRow
                task={item.task}
                checked
                completedAt={item.task.completed_at}
                onCheckPress={handleReopen}
                onSyncPress={() => setSyncSheetOpen(true)}
                onPress={handleTaskPress}
                showProject={projectMap[item.task.project_id]} showCollection={collectionName(item.task)}
              />
            );
          }
          return (
            <TaskRow
              task={item.task}
              selected={sel.selectedIds.includes(item.task.id)}
              onCheckPress={sel.completeOne}
              disabled={sel.busy}
              onSyncPress={() => setSyncSheetOpen(true)}
              onPress={handleTaskPress}
              showCollection={collectionName(item.task)}
            />
          );
        }}
        ItemSeparatorComponent={({leadingItem}) =>
          leadingItem?.type !== 'header' ? <View style={styles.separator} /> : null
        }
      />
    );
  };

  const renderUpcomingTab = () => {
    // Tasks due after today, grouped by date bucket
    const visible = projectFiltered(tasks);
    const upcoming = visible
      .filter(t => {
        const due = (t.due?.date || '').slice(0, 10);
        return due && due > today;
      })
      .sort((a, b) => (a.due?.date || '').localeCompare(b.due?.date || ''));

    const noDue = visible.filter(t => !t.due?.date);

    if (upcoming.length === 0 && noDue.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, {fontSize: Math.round(18 * scale)}]}>No upcoming tasks</Text>
        </View>
      );
    }

    const buckets = groupByDateBucket(upcoming, today);
    if (noDue.length > 0) {
      buckets.push({key: 'header-nodate', type: 'header' as const, title: 'No Date', count: noDue.length});
      noDue.forEach(t => buckets.push({key: t.id, type: 'task' as const, task: t}));
    }

    return (
      <FlatList
        data={buckets}
        keyExtractor={item => item.key}
        renderItem={({item}) => {
          if (item.type === 'header') {
            return <SectionHeader title={item.title} count={item.count} />;
          }
          return (
            <TaskRow
              task={item.task}
              selected={sel.selectedIds.includes(item.task.id)}
              onCheckPress={sel.completeOne}
              disabled={sel.busy}
              onSyncPress={() => setSyncSheetOpen(true)}
              onPress={handleTaskPress}
              showProject={projectMap[item.task.project_id]} showCollection={collectionName(item.task)}
            />
          );
        }}
        ItemSeparatorComponent={({leadingItem}) =>
          leadingItem?.type !== 'header' ? <View style={styles.separator} /> : null
        }
      />
    );
  };

  const renderProjectsTab = () => {
    const filtered = projectList.filter(project => shownProjectIds.includes(String(project.id)));
    return <ProjectOverview projects={filtered} tasks={projectFiltered(tasks)} sections={collectionList} selectedIds={[]}
      onSelect={sel.completeOne} onTask={handleTaskPress} busy={sel.busy} onSyncPress={() => setSyncSheetOpen(true)}
      onProject={project => changeView(`project:${project.id}`)} />;
  };

  const renderDeviceTab = () => {
    // Don't claim "no tasks" before the registry read lands -- blank beats
    // a false empty state that flips (the read is local and fast, so this
    // is at most one frame)
    if (!deviceLoaded) {
      return <View style={styles.centered} />;
    }
    if (deviceTasks.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, {fontSize: Math.round(18 * scale)}]}>No tasks captured on this device</Text>
        </View>
      );
    }

    // Group by full path when known (falls back to bare filename for older
    // registry entries), labeled filesystem-style: "Connor / 1x1" tells you
    // WHERE the note lives, not just its name.
    const byNote: Record<string, {label: string; entries: any[]}> = {};
    for (const dt of deviceTasks) {
      if (!isActiveRegistryTask(dt)) continue;
      const key = dt.notePath || dt.noteFile || 'Unknown';
      if (!byNote[key]) {
        byNote[key] = {label: noteLabel(dt.notePath, dt.noteFile), entries: []};
      }
      byNote[key].entries.push(dt);
    }

    // Build flat list with headers
    const items: any[] = [];
    for (const [key, group] of Object.entries(byNote)) {
      items.push({type: 'header', key: `h-${key}`, title: group.label, count: group.entries.length});
      for (const dt of group.entries) {
        // Try to find the full Todoist task for richer display
        const fullTask = tasks.find(t => t.id === dt.id);
        // Jump target: stored full path, or same-directory guess for legacy
        // entries (mirrors TaskDetail's View Note fallback)
        let openPath: string | undefined = dt.notePath;
        if (!openPath && dt.noteFile && noteCtx?.filePath) {
          openPath = noteCtx.filePath.substring(0, noteCtx.filePath.lastIndexOf('/') + 1) + dt.noteFile;
        }
        items.push({
          type: 'task',
          key: dt.id,
          task: fullTask || {...dt, _registryOnly: !dt.syncState},
          pageNum: dt.pageNum,
          openPath,
        });
      }
    }

    return (
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        renderItem={({item}) => {
          if (item.type === 'header') {
            return <SectionHeader title={item.title} count={item.count} />;
          }
          // Page number rides in the row's chip line -- the old outboard
          // p.N column misaligned Device rows against every other tab.
          return (
            <TaskRow
              task={item.task}
              selected={sel.selectedIds.includes(item.task.id)}
              onCheckPress={sel.completeOne}
              disabled={sel.busy}
              onSyncPress={() => setSyncSheetOpen(true)}
              onPress={handleTaskPress}
              showProject={projectMap[item.task.project_id]} showCollection={collectionName(item.task)}
              pageNum={item.pageNum}
              onOpenNote={
                item.openPath
                  ? () => handleOpenNote(item.openPath, item.pageNum, item.task.id)
                  : undefined
              }
            />
          );
        }}
        ItemSeparatorComponent={({leadingItem}) =>
          leadingItem?.type !== 'header' ? <View style={styles.separator} /> : null
        }
      />
    );
  };

  const shownProjectIds: string[] = visibleProjectIds(visibilityConfig, projectList);
  const projectFiltered = (list: any[]) => list.filter(task => !task.deleted &&
    (!task.project_id || isProjectVisible(visibilityConfig, task.project_id, projectList)));
  const taskCount = projectFiltered(tasks).length;
  const inboxProject = projectList.find(project => project.is_inbox_project || project.inbox_project || project.isInbox || String(project.name).toLowerCase() === 'inbox');
  const nextDay = new Date(); nextDay.setDate(nextDay.getDate() + 1);
  const tomorrow = localDate(nextDay);
  const changeView = (view: string) => {
    const next = normalizeTaskView(view);
    sel.clearSelection(); setActiveTab(next); setSessionTab(next);
    saveConfig({lastOpenedTab: next}).catch(() => {});
  };
  const counts: Record<string, number> = {today: 0, tomorrow: 0, upcoming: 0, inbox: 0, note: noteTasks.length,
    device: deviceTasks.filter(isActiveRegistryTask).length, done: projectFiltered(doneTasks).length};
  for (const task of projectFiltered(tasks)) {
    const due = (task.due?.date || '').slice(0, 10);
    if (due && due <= today) counts.today++;
    if (due === tomorrow) counts.tomorrow++;
    if (due > today || !due) counts.upcoming++;
    if (String(task.project_id) === String(inboxProject?.id) || !task.project_id) counts.inbox++;
    counts[task.project_id] = (counts[task.project_id] || 0) + 1;
  }
  const syncMessage = syncStatusMessage(syncInfo || {});
  const refreshSyncSheet = async () => {
    const data = await offlineData(); setSyncInfo(data); applyData(data.tasks, data.projects, data.sections);
  };
  const retryChange = async (id: string) => {
    if (syncRetrying) return;
    setSyncRetrying(true); setSyncRetryError('');
    try {await retryOffline(id); await refreshSyncSheet();}
    catch {setSyncRetryError('Could not retry this change. It remains saved on your device.');}
    finally {setSyncRetrying(false);}
  };
  const renderSimpleTasks = (items: any[], empty: string) => items.length ?
    <FlatList data={items} keyExtractor={task => task.id} renderItem={({item}) =>
      <TaskRow task={item} onCheckPress={sel.completeOne} disabled={sel.busy} onPress={handleTaskPress}
        onSyncPress={() => setSyncSheetOpen(true)} showProject={projectMap[item.project_id]} showCollection={collectionName(item)} />} /> :
    <View style={styles.centered}><Text style={styles.emptyText}>{empty}</Text></View>;
  const renderProjectTasks = (id: string | undefined, name: string) => {
    if (id && !isProjectVisible(visibilityConfig, id, projectList)) {
      return <View style={styles.centered}><Text style={styles.emptyText}>This project is hidden in Settings. Choose a visible project from the sidebar.</Text></View>;
    }
    const projectTasks = tasks.filter(task => String(task.project_id) === String(id) || ((!id || name === 'Inbox') && !task.project_id));
    const groups = collectionGroups(id || '', projectTasks, collectionList);
    const rows = groups.flatMap((group: any) => [
      {key: `collection:${group.id}`, type: 'collection', group},
      ...(group.tasks.length ? group.tasks.map((task: any) => ({key: task.id, type: 'task', task})) : [{key: `empty:${group.id}`, type: 'empty'}]),
    ]);
    return <View style={styles.body}>
      <View style={styles.projectHeading}><Text style={styles.projectTitle}>{name}</Text>
        <Pressable style={styles.headerButton} accessibilityLabel={`Add task to ${name}`} onPress={() => nav.push('task-add', {projects: projectList, defaultProjectId: id})}><Text style={styles.headerButtonText}>+ Task</Text></Pressable></View>
      <FlatList data={rows} keyExtractor={(item: any) => item.key} renderItem={({item}: any) => item.type === 'collection' ?
        <SectionHeader title={item.group.name} count={item.group.tasks.length} action={item.group.id !== 'unavailable' &&
          <Pressable style={styles.headerButton} accessibilityLabel={`Add task to ${item.group.name}`} onPress={() => nav.push('task-add', {projects: projectList, defaultProjectId: id, defaultSectionId: item.group.id || null})}><Text style={styles.headerButtonText}>+ Task</Text></Pressable>} /> :
        item.type === 'empty' ? <Text style={styles.emptyCollection}>No active tasks in this collection</Text> :
        <TaskRow task={item.task} onCheckPress={sel.completeOne} disabled={sel.busy} onPress={handleTaskPress} onSyncPress={() => setSyncSheetOpen(true)} showCollection={collectionName(item.task)} />} />
    </View>;
  };

  return (
    <View style={styles.container}>
      {/* Keep the header height stable when the undo action replaces its controls. */}
      <View style={[styles.header, {minHeight: Math.round(22 * scale * 1.3) + 32}]}>
        {/* Undo remains available until dismissed or the view changes. */}
        {sel.active ? (
          <SelectionBar
            count={sel.selectedIds.length}
            undoCount={sel.undoIds.length}
            busy={sel.busy}
            onComplete={sel.completeSelected}
            onClear={sel.clearSelection}
            onUndo={sel.undo}
            onDismiss={sel.dismissUndo}
          />
        ) : (
          <>
            <Text style={[styles.title, {fontSize: Math.round(22 * scale)}]}>SuperTask</Text>
            <View style={styles.headerButtons}>
              {/* Primary action is the only inverted button. Log/Diag moved to
                  Settings > Debugging -- five identical header buttons had no
                  hierarchy (design-home-v2.md). Debug mode restores the Log
                  button here (its Settings hint promises exactly that). */}
              <Pressable style={[styles.headerButton, styles.headerButtonPrimary]} onPress={handleAddTask}>
                <Text style={[styles.headerButtonText, styles.headerButtonPrimaryText]}>+ New</Text>
              </Pressable>
              <Pressable style={styles.headerButton} onPress={async () => {
                const config = await loadConfig();
                nav.push('task-batch', {projects: projectList, defaultProjectId: config.defaultProjectId, defaultSectionId: config.defaultSectionId});
              }}>
                <Text style={styles.headerButtonText}>+ Batch</Text>
              </Pressable>
              {debugMode && (
                <Pressable style={styles.headerButton} onPress={() => { log('TaskHome', 'LOG pressed'); nav.push('debug'); }}>
                  <Text style={styles.headerButtonText}>Log</Text>
                </Pressable>
              )}
              <Pressable style={styles.headerButton} onPress={() => { log('TaskHome', 'SETTINGS pressed'); nav.push('config'); }}>
                <Text style={styles.headerButtonText}>Settings</Text>
              </Pressable>
              <Pressable style={styles.headerButton} onPress={() => { log('TaskHome', 'CLOSE pressed'); closePlugin(); }}>
                <Text style={styles.headerButtonText}>Close</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      {jumpError ? (
        <View style={styles.jumpError}>
          <Text style={styles.jumpErrorText}>{jumpError}</Text>
        </View>
      ) : null}

      {error ? <View style={styles.jumpError}><Text style={styles.jumpErrorText}>{error}</Text></View> : null}
      <View style={styles.workspace}>
        <TaskSidebar activeView={activeTab} projects={projectList} visibleProjectIds={shownProjectIds}
          noteAvailable={!!noteCtx} counts={counts} onViewChange={changeView} />
        <View style={styles.body}>{renderContent()}</View>
      </View>

      <View style={styles.footer}>
        <Pressable style={styles.syncSummary} accessibilityRole="button" accessibilityLabel="Open sync summary" onPress={() => {setSyncSheetOpen(true); refreshSyncSheet().catch(() => {});}}>
          <Text style={[styles.footerText, {fontSize: Math.round(13 * scale)}]}>{taskCount} tasks · {syncInfo?.pendingCount || 0} queued · Sync details</Text>
          {syncMessage ? <Text style={styles.footerText}>{syncMessage}</Text> : null}
        </Pressable>
        <View style={styles.footerRight}>
          <Pressable style={styles.footerToggle} onPress={toggleShowDone} hitSlop={8}>
            <Check checked={showDone} size={20} />
            <Text style={[styles.footerText, {fontSize: Math.round(13 * scale)}]}>Show done</Text>
          </Pressable>
          <Pressable onPress={() => {
            sel.clearSelection();
            fetchData(true);
            if (activeTab === 'done' || showDone) {
              refreshCompletedTasks(30).then(setDoneTasks).catch((err: any) => setDoneError(`History refresh failed: ${err.message}`));
            }
          }} hitSlop={8}>
            <Text style={[styles.footerRefresh, {fontSize: Math.round(14 * scale)}]}>Refresh</Text>
          </Pressable>
        </View>
      </View>
      <Modal visible={syncSheetOpen} transparent onRequestClose={() => setSyncSheetOpen(false)}>
        <View style={styles.sheetBackdrop}><View style={styles.sheet}>
          <View style={styles.projectHeading}><Text style={styles.projectTitle}>Sync summary</Text>
            <Pressable style={styles.headerButton} onPress={() => setSyncSheetOpen(false)} accessibilityLabel="Close sync summary"><Text style={styles.headerButtonText}>Close</Text></Pressable></View>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <Text style={styles.sheetText}>{syncMessage || 'No saved changes are waiting to sync.'}</Text>
            <Text style={styles.sheetText}>{syncInfo?.timestamp ? `Last successful sync: ${new Date(syncInfo.timestamp).toLocaleString()}` : 'No successful sync yet.'}</Text>
            {syncInfo?.warning ? <Text style={styles.sheetText}>{syncInfo.warning}</Text> : null}
            {syncInfo?.otherAccountStores > 0 ? <Text style={styles.sheetText}>Tasks for another configured token are retained separately. Switch back to that token to resume them.</Text> : null}
            {(syncInfo?.syncNotices || []).map((notice: any, index: number) => <Text style={styles.sheetText} key={notice.id || index}>{typeof notice === 'string' ? notice : notice.message || 'Sync needs attention. Review this task in Todoist.'}</Text>)}
            {(syncInfo?.pendingChanges || []).map((change: any) => <View style={styles.queuedChange} key={change.uuid || `${change.kind}:${change.id}`}>
              <Text style={styles.sheetText}>{syncChangeLabel(change.kind)} · {change.task?.content || change.collection?.name || 'Saved change'}</Text>
              <Text style={styles.sheetText}>{change.state === 'attention' ? syncStatusMessage({syncError: change.error}) || 'Needs attention' : change.state === 'sending' ? 'Syncing or waiting for acknowledgement' : 'Waiting to sync'}</Text>
              {change.error && /^(This task|This project|This collection|This older queued|A collection|Todoist acknowledged|No command)/.test(change.error) ? <Text style={styles.sheetText}>{change.error}</Text> : null}
              {change.task && !change.task.deleted ? <Pressable style={styles.headerButton} onPress={() => {setSyncSheetOpen(false); nav.push('task-detail', {task: change.task, projects: projectList});}}><Text style={styles.headerButtonText}>Task details</Text></Pressable> : null}
              {change.error ? <Pressable style={styles.headerButton} disabled={syncRetrying} accessibilityLabel="Retry saved change" onPress={() => retryChange(change.id)}><Text style={styles.headerButtonText}>Retry</Text></Pressable> : null}
            </View>)}
            {syncRetryError ? <Text style={styles.sheetText}>{syncRetryError}</Text> : null}
          </ScrollView>
        </View></View>
      </Modal>

    </View>
  );
}

// Group completed tasks into recency buckets (newest first)
function groupDoneByBucket(doneTasks: any[], today: string): any[] {
  const yesterday = localDate(new Date(new Date(today + 'T00:00:00').getTime() - 86400000));
  const weekAgo = localDate(new Date(new Date(today + 'T00:00:00').getTime() - 7 * 86400000));

  const sorted = [...doneTasks].sort((a, b) =>
    (b.completed_at || '').localeCompare(a.completed_at || ''));

  const buckets: {today: any[]; yesterday: any[]; week: any[]; earlier: any[]} = {
    today: [], yesterday: [], week: [], earlier: [],
  };
  for (const t of sorted) {
    const d = (t.completed_at || '').slice(0, 10);
    if (d === today) buckets.today.push(t);
    else if (d === yesterday) buckets.yesterday.push(t);
    else if (d >= weekAgo) buckets.week.push(t);
    else buckets.earlier.push(t);
  }

  const items: any[] = [];
  const pushBucket = (key: string, title: string, arr: any[]) => {
    if (!arr.length) return;
    items.push({key: `header-${key}`, type: 'header', title, count: arr.length});
    arr.forEach(t => items.push({key: `done-${t.id}`, type: 'task', task: t}));
  };
  pushBucket('dtoday', 'Today', buckets.today);
  pushBucket('dyesterday', 'Yesterday', buckets.yesterday);
  pushBucket('dweek', 'This Week', buckets.week);
  pushBucket('dearlier', 'Earlier', buckets.earlier);
  return items;
}

// Group tasks by project, returning interleaved header + task items
function groupByProject(tasks: any[], projectMap: Record<string, string>): any[] {
  const groups: Record<string, any[]> = {};

  tasks.forEach(t => {
    const pid = t.project_id || 'inbox';
    if (!groups[pid]) groups[pid] = [];
    groups[pid].push(t);
  });

  const items: any[] = [];
  Object.entries(groups).forEach(([pid, projectTasks]) => {
    items.push({
      key: `header-${pid}`,
      type: 'header',
      title: projectMap[pid] || 'Inbox',
      count: projectTasks.length,
      projectId: pid,
    });
    projectTasks
      .sort((a, b) => (a.due?.date || '').localeCompare(b.due?.date || ''))
      .forEach(t => items.push({key: t.id, type: 'task', task: t}));
  });

  return items;
}

// Group tasks into date buckets: Tomorrow, This Week, Later
function groupByDateBucket(tasks: any[], today: string): any[] {
  const todayDate = new Date(today + 'T00:00:00');
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDate(tomorrow);

  // End of this week (Sunday)
  const endOfWeek = new Date(todayDate);
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
  const endOfWeekStr = localDate(endOfWeek);

  const buckets: {tomorrow: any[]; thisWeek: any[]; later: any[]} = {
    tomorrow: [],
    thisWeek: [],
    later: [],
  };

  tasks.forEach(t => {
    const due = (t.due?.date || '').slice(0, 10);
    if (due === tomorrowStr) {
      buckets.tomorrow.push(t);
    } else if (due <= endOfWeekStr) {
      buckets.thisWeek.push(t);
    } else {
      buckets.later.push(t);
    }
  });

  const items: any[] = [];
  if (buckets.tomorrow.length) {
    items.push({key: 'header-tomorrow', type: 'header', title: 'Tomorrow', count: buckets.tomorrow.length});
    buckets.tomorrow.forEach(t => items.push({key: t.id, type: 'task', task: t}));
  }
  if (buckets.thisWeek.length) {
    items.push({key: 'header-thisweek', type: 'header', title: 'This Week', count: buckets.thisWeek.length});
    buckets.thisWeek.forEach(t => items.push({key: t.id, type: 'task', task: t}));
  }
  if (buckets.later.length) {
    items.push({key: 'header-later', type: 'header', title: 'Later', count: buckets.later.length});
    buckets.later.forEach(t => items.push({key: t.id, type: 'task', task: t}));
  }

  return items;
}

const styles = StyleSheet.create({
  workspace: {flex: 1, flexDirection: 'row'},
  projectHeading: {minHeight: 56, padding: 12, gap: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#000'},
  projectTitle: {flex: 1, fontSize: 20, fontWeight: '700', color: '#000'},
  emptyCollection: {padding: 16, fontSize: 15, color: '#000'},
  syncSummary: {flex: 1, minHeight: 44, justifyContent: 'center', paddingRight: 10},
  sheetBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#fff', maxHeight: '80%', borderWidth: 2, borderColor: '#000'},
  sheetContent: {padding: 16, gap: 12},
  sheetText: {fontSize: 16, color: '#000'},
  queuedChange: {paddingVertical: 12, borderTopWidth: 1, borderColor: '#000', gap: 8},
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
  headerButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
  },
  headerButtonPrimary: {
    backgroundColor: '#000000',
  },
  headerButtonPrimaryText: {
    color: '#ffffff',
  },
  jumpError: {
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#000000',
  },
  jumpErrorText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  thisPage: {
    borderBottomWidth: 2,
    borderBottomColor: '#000000',
    backgroundColor: '#ffffff',
  },
  thisPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  thisPageTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  thisPageNote: {
    fontSize: 13,
    color: '#555555',
    flexShrink: 1,
  },
  thisPageSeparator: {
    height: 1,
    backgroundColor: '#000000',
    marginLeft: 66,
  },
  body: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666666',
  },
  errorText: {
    fontSize: 16,
    color: '#000000',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 18,
    color: '#666666',
  },
  separator: {
    height: 1,
    backgroundColor: '#000000',
    marginLeft: 66,
  },
  projectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  projectName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
  },
  projectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectCount: {
    fontSize: 14,
    color: '#666666',
  },
  projectArrow: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#000000',
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  footerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 13,
    color: '#555555',
  },
  footerRefresh: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
});
