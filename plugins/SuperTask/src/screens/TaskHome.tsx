/**
 * TaskHome - shared task workspace with sidebar navigation and sync summary.
 */

import React, {useState, useEffect, useCallback, useRef, useMemo} from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Dimensions,
} from 'react-native';
import {PluginCommAPI, PluginFileAPI, NativePluginManager} from 'sn-plugin-lib';
import {closePlugin} from '../utils/closePlugin';
import {getTasksForNote, getAllTasks as getAllRegistryTasks, getTask as getRegistryTask} from '../utils/taskRegistry';
import {openNote, jumpWithinNote} from '../utils/noteOpener';
import {healRenamedNotes} from '../utils/noteHeal';
import {noteLabel} from '../utils/noteLabel';
import {saveConfig} from '../utils/config';
import {useFontScale} from '../utils/useFontScale';
import {loadConfig, getCachedConfig, resolveDefaultTab} from '../utils/config';
import {getSessionTab, setSessionTab} from '../utils/viewState';
import {getCompletedTasks, refreshCompletedTasks} from '../api/todoist';
import {getCache, fetchTaskData, initTaskCache, subscribeCache, getCachedWorkspace} from '../cache/taskCache';
import {completedData, offlineData, retryOffline, saveOfflineBatch} from '../offline/service';
const workspaceService = require('../offline/service');
const {projectTasks, composerDefaults, sameScope, projectContainers, projectContainerTasks, resolveContainerId, rowIdentity, protectedOccurrence, orderedTasks} = require('../workspace/intents');
import useWorkspaceMutations from '../workspace/useWorkspaceMutations';
const {syncStatusMessage} = require('../offline/status');
const {visibleProjectIds, isProjectVisible} = require('../utils/projectVisibility');
const {isCollectionExpanded, toggleCollectionExpanded} = require('../collections/collapse');
const {isUpcomingThisWeek} = require('../workspace/upcoming');
const {collectionGroups} = require('../collections/model');
const {localDate} = require('../offline/model');
const {splitTitleDescription} = require('../batch/descriptionParser');
import {log, logError} from '../utils/debug';
import TaskSidebar from '../components/NativeTaskSidebar';
import TaskRow, {WorkspaceContext} from '../workspace/WorkspaceTaskRow';
import InlineTaskComposer from '../components/InlineTaskComposer';
import WorkspaceSelectionBar from '../components/WorkspaceSelectionBar';
import DatePicker from '../components/DatePicker';
import ProjectPicker from '../components/ProjectPicker';
import PriorityPicker from '../components/PriorityPicker';
import ProjectOverview from '../components/ProjectOverview';
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
  active?: boolean;
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
function withCurrentAccount(callback: (value: any) => any) {
  const account = getCachedConfig()?.apiToken;
  return (value: any) => {if (account === getCachedConfig()?.apiToken) return callback(value);};
}
function sameTaskReference(left: any, right: any) {
  const aliases = (task: any) => [task.id, task.remoteId, task.localId,
    String(task.id || '').startsWith('remote:') ? String(task.id).slice(7) : null].filter(value => value != null).map(String);
  const reference = new Set(aliases(left));
  return aliases(right).some(id => reference.has(id));
}


export default function TaskHome({nav, focusTab, initialView, active = true}: Props) {
  const scale = useFontScale();
  // Saved-config snapshot for the FIRST render. On any warm open the config
  // cache is populated, so the tab, filters, and Log button paint correctly
  // immediately instead of mounting on defaults and visibly snapping when
  // the async load lands (e-ink repaint). Cold start falls back to defaults
  // and the loadConfig().then below corrects them (usually behind the
  // loading screen, so still no visible jump).
  const [cfg0] = useState(getCachedConfig);
  const [cached0] = useState(() => getCachedWorkspace());
  const [baseTasks, setTasks] = useState<any[]>(cached0?.tasks || []);
  const [, setProjectMap] = useState<ProjectMap>({});
  const [baseProjects, setProjectList] = useState<any[]>(cached0?.projects || []);
  const [baseCollections, setCollectionList] = useState<any[]>(cached0?.sections || []);
  const [, setCollectionRevision] = useState(0);
  const [containerIntents, setContainerIntents] = useState<any[]>([]);
  const projectList: any[] = useMemo(() => projectContainers(baseProjects, containerIntents, 'project'), [baseProjects, containerIntents]);
  const collectionList: any[] = useMemo(() => projectContainers(baseCollections, containerIntents, 'collection'), [baseCollections, containerIntents]);
  const projectMap: ProjectMap = useMemo(() => Object.fromEntries(projectList.map(project => [String(project.id), project.name])), [projectList]);
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
  const [loading, setLoading] = useState(!cached0);
  const [error, setError] = useState('');
  const [syncInfo, setSyncInfo] = useState<any>(cached0);
  const [jumpError, setJumpError] = useState('');
  const [noteCtx, setNoteCtx] = useState<{fileName: string; pageNum: number; filePath: string} | null>(null);
  const [pageTaskIds, setPageTaskIds] = useState<string[]>([]);
  const [registryNoteTasks, setRegistryNoteTasks] = useState<any[]>([]);
  const [deviceTasks, setDeviceTasks] = useState<any[]>(() => (cached0?.allTasks || []).filter((task: any) => task.source?.filePath).map((task: any) => ({...task, notePath: task.source.filePath, noteFile: task.source.filePath.split('/').pop(), pageNum: task.source.pageNum})));
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [visibilityConfig, setVisibilityConfig] = useState<any>(cfg0 || {});
  const [, setDebugModeOn] = useState(cfg0?.debugMode === true);

  // Done tab: fetched lazily on first visit (separate endpoint, not part of
  // the main cache -- completed history changes rarely and can be large)
  const [doneTasks, setDoneTasks] = useState<any[]>(cached0?.completedTasks || []);
  const [doneLoading, setDoneLoading] = useState(false);
  const [doneError, setDoneError] = useState('');
  const [doneFetched, setDoneFetched] = useState(false);
  // F-030: footer toggle -- show completed-today tasks inline on the Today
  // tab, same row pattern as the Done tab (filled box, Done chip, reopen)
  const [completedExpanded, setCompletedExpanded] = useState<Record<string, boolean>>({});
  const [historyDays, setHistoryDays] = useState(30);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionHistory, setSelectionHistory] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [composer, setComposer] = useState({value: '', projectId: null as string | null, sectionId: null as string | null, dueDate: '', explicit: false, source: null as any});
  const composerSubmission = useRef<any>(null);
  const [creatingDrafts, setCreatingDrafts] = useState<any[]>([]);
  const [actionSheet, setActionSheet] = useState<any>(null);
  const [actionName, setActionName] = useState('');
  const [actionLocation, setActionLocation] = useState({projectId: null as string | null, sectionId: null as string | null});
  const [actionDate, setActionDate] = useState('');
  const [actionLabels, setActionLabels] = useState('');
  const [containerProof, setContainerProof] = useState<any>(null);
  const [containerRetries, setContainerRetries] = useState<any[]>([]);
  const containerRequests = useRef(new Map<string, any>());
  const submissions = useRef(new Map<string, any>());
  const containerIdentity = useRef<any>(null);
  const submissionSequence = useRef(0);
  const mutations = useWorkspaceMutations(async () => {
    const account = getCachedConfig()?.apiToken;
    const data = getCachedWorkspace() || await offlineData(); if (account !== getCachedConfig()?.apiToken) return;
    setSyncInfo(data);
    applyData(data.tasks, data.projects, data.sections);
    const history = data.completedTasks || await completedData(); if (account === getCachedConfig()?.apiToken) setDoneTasks(previous => JSON.stringify(previous) === JSON.stringify(history) ? previous : history);
  }, setError, () => getCachedConfig()?.apiToken);
  const accountRef = useRef(getCachedConfig()?.apiToken);
  const resolvedTab = activeTab.startsWith('project:') ? `project:${resolveContainerId(activeTab.slice(8), projectList)}` : activeTab;
  const activeProject = resolvedTab.startsWith('project:') ? projectList.find(project => String(project.id) === resolvedTab.slice(8)) : null;
  const completedViewKey = activeProject ? `project:${activeProject.localId || activeProject.id}` : resolvedTab;
  const showDone = completedExpanded[completedViewKey] !== false;
  const setShowDone = (update: (value: boolean) => boolean) => setCompletedExpanded(previous => ({...previous, [completedViewKey]: update(previous[completedViewKey] !== false)}));
  const seedTasks = useMemo(() => {
    const seen = new Set();
    return [...baseTasks, ...doneTasks.filter(task => !task.occurrenceHistory || !task.due?.is_recurring), ...creatingDrafts]
      .filter(task => {const id = rowIdentity(task); if (seen.has(id)) return false; seen.add(id); return true;});
  }, [baseTasks, doneTasks, creatingDrafts]);
  const projected: any[] = useMemo(() => projectContainerTasks(projectTasks(orderedTasks(seedTasks), mutations.intents), containerIntents), [seedTasks, mutations.intents, containerIntents]);
  const tasks: any[] = useMemo(() => projected.filter((task: any) => !task.deleted && !task.completed), [projected]);
  const projectedDone: any[] = useMemo(() => projectContainerTasks(projectTasks(doneTasks, mutations.intents), containerIntents).filter((task: any) => task.completed !== false && !task.deleted), [doneTasks, mutations.intents, containerIntents]);
  const optimisticDone: any[] = useMemo(() => projected.filter((task: any) => task.completed && !task.deleted), [projected]);
  useEffect(() => {
    if (!active) return;
    loadConfig().then(withCurrentAccount(config => {setVisibilityConfig(config); setDebugModeOn(config.debugMode === true);})).catch(() => {});
  }, [active]);

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
    loadConfig().then(withCurrentAccount(config => {
      // Cold-start default-tab corrector. A deep-link focusTab or live
      // session tab wins over the config default (F-038).
      if (!initialView && !focusTab && !getSessionTab()) {
        setActiveTab(normalizeTaskView(resolveDefaultTab(config)));
      }
      setVisibilityConfig(config);
      
      setDebugModeOn(config.debugMode === true);
    }));

    // Device-tab data is a fast local registry read, independent of note
    // context -- run it immediately and in parallel. It used to be
    // serialized BEHIND the ~3s getElements scan below, leaving the
    // (possibly default) Device tab on a false "no tasks" empty state.
    (async () => {
      const account = getCachedConfig()?.apiToken;
      try {
        const allReg = await getAllRegistryTasks();
        if (account !== getCachedConfig()?.apiToken) return;
        setDeviceTasks(allReg);
        log('TaskHome', `Registry: ${allReg.length} total device tasks`);
      } catch (e: any) {
        log('TaskHome', `Device registry read failed: ${e.message}`);
      } finally {
        if (account === getCachedConfig()?.apiToken) setDeviceLoaded(true);
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
        const account = getCachedConfig()?.apiToken;
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
        if (account === getCachedConfig()?.apiToken) setRegistryNoteTasks(regTasks);


      } catch (e: any) {
        log('TaskHome', `Page context detection failed: ${e.message}`);
      }
    })();
  }, [focusTab, initialView]);

  useEffect(() => {
    if (!active || activeTab !== 'note' || !noteCtx) return;
    let cancelled = false;
    const {filePath, pageNum} = noteCtx;
    PluginFileAPI.getElements(pageNum, filePath).then((response: any) => {
      try {
        if (!cancelled && response?.success && response.result) {
          const ids = response.result.filter((element: any) => element.type === 600 && element.link?.destPath?.startsWith('supertask://task/'))
            .map((element: any) => element.link.destPath.replace('supertask://task/', ''));
          setPageTaskIds(previous => JSON.stringify(previous) === JSON.stringify(ids) ? previous : ids);
        }
      } finally {response?.result?.forEach((element: any) => element.recycle?.());}
    }).catch(() => {});
    return () => {cancelled = true;};
  }, [active, activeTab, noteCtx]);

  // Apply fetched data to component state. Skips the update entirely when
  // the data matches what is already rendered: the background revalidate
  // otherwise replaces every list row with an identical copy, which on
  // e-ink is a visible full-list flash for nothing. Local mutations
  // (complete/reopen) bypass this via setTasks directly, which leaves the
  // fingerprint stale in the safe direction -- the next fetch differs from
  // it and repaints.
  const dataFp = useRef(cached0 ? JSON.stringify([cached0.tasks, cached0.projects, cached0.sections]) : '');
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
  useEffect(() => {
    if (!active || accountRef.current === getCachedConfig()?.apiToken) return;
    accountRef.current = getCachedConfig()?.apiToken;
    mutations.cancel(); submissions.current.clear(); setCreatingDrafts([]); setContainerIntents([]);
    containerRequests.current.clear(); setContainerRetries([]);
    setComposer({value: '', projectId: null, sectionId: null, dueDate: '', explicit: false, source: null});
    setActionSheet(null); setSelectedIds([]); setSelectionMode(false); setExpandedId(null);
    setDoneTasks([]); setDoneFetched(false); setTasks([]); setProjectList([]); setCollectionList([]); dataFp.current = '';
    setSyncInfo(null); setDeviceTasks([]); setRegistryNoteTasks([]); setHistoryLoading(false); setHistoryDays(30); setHistoryLimit(20); setError(''); setDoneLoading(false);
    const account = getCachedConfig()?.apiToken;
    offlineData().then(data => {if (account === getCachedConfig()?.apiToken) {setSyncInfo(data); applyData(data.tasks, data.projects, data.sections);}}).catch(() => {});
    getAllRegistryTasks().then(items => {if (account === getCachedConfig()?.apiToken) setDeviceTasks(items);}).catch(() => {});
    if (noteCtx?.filePath) getTasksForNote(noteCtx.filePath).then(items => {if (account === getCachedConfig()?.apiToken) setRegistryNoteTasks(items);}).catch(() => {});
  }, [active, mutations, applyData, noteCtx?.filePath]);
  useEffect(() => subscribeCache((data: any) => {
    setSyncInfo(data); setError(''); setLoading(false);
    applyData(data.tasks, data.projects, data.sections);
    if (data.completedTasks) setDoneTasks(previous => JSON.stringify(previous) === JSON.stringify(data.completedTasks) ? previous : data.completedTasks);
    const references = (data.allTasks || []).filter((task: any) => task.source?.filePath).map((task: any) => ({...task, notePath: task.source.filePath,
      noteFile: task.source.filePath.split('/').pop(), pageNum: task.source.pageNum}));
    setDeviceTasks(previous => JSON.stringify(previous) === JSON.stringify(references) ? previous : references);
    if (noteCtx?.filePath) setRegistryNoteTasks(previous => {
      const next = references.filter((task: any) => task.notePath === noteCtx.filePath);
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
  }), [applyData, noteCtx?.filePath]);

  // Reconcile registry: remove entries for tasks no longer in Todoist,
  // then heal any note renames (B-005, once per session, fire-and-forget)
  const reconcileRegistry = useCallback(async (fetchedTasks: any[]) => {
    const account = getCachedConfig()?.apiToken;
    healRenamedNotes(fetchedTasks)
      .then(healedCount => {
        if (healedCount > 0) {
          // Refresh Device tab data so healed paths/labels show immediately
          getAllRegistryTasks().then(withCurrentAccount(setDeviceTasks)).catch(() => {});
        }
      })
      .catch(() => {});
    try {
      const allReg = await getAllRegistryTasks();
      if (account === getCachedConfig()?.apiToken) setDeviceTasks(allReg);
    } catch (syncErr: any) {
      log('TaskHome', `Registry sync failed (non-fatal): ${syncErr.message}`);
    }
  }, []);

  // Fetch via cache layer (used by Refresh button)
  const fetchData = useCallback(async (silent = false) => {
    const account = getCachedConfig()?.apiToken;
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await fetchTaskData();
      if (account !== getCachedConfig()?.apiToken) return;
      if (data) {
        setSyncInfo(data);
        applyData(data.tasks, data.projects, data.sections);
        await reconcileRegistry(data.tasks);
        log('TaskHome', `Loaded ${data.tasks.length} tasks, ${data.projects.length} projects${silent ? ' (silent)' : ''}`);
      } else {
        setError('No Todoist token yet. Tap Settings (top right), then the Setup tab, to add one.');
      }
    } catch (err: any) {
      if (account !== getCachedConfig()?.apiToken) return;
      logError('TaskHome', err);
      setError(err.message);
    } finally {
      if (!silent && account === getCachedConfig()?.apiToken) setLoading(false);
    }
  }, [applyData, reconcileRegistry]);

  // Mount: serve cached data immediately, then refresh in background
  useEffect(() => {
    log('TaskHome', 'MOUNT');
    const account = getCachedConfig()?.apiToken;

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
      if (account !== getCachedConfig()?.apiToken) return;
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
              getAllRegistryTasks().then(withCurrentAccount(setDeviceTasks)).catch(() => {});
            }
          })
          .catch(() => {});
      }

      // Always fetch fresh data (deduplicates with any in-flight prefetch)
      fetchTaskData()
        .then((data: any) => {
          if (account !== getCachedConfig()?.apiToken) return;
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
          if (account !== getCachedConfig()?.apiToken) return;
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
      const account = getCachedConfig()?.apiToken;
      setDoneLoading(true);
      setDoneError('');
      try {
        const items = await getCompletedTasks(30);
        if (account !== getCachedConfig()?.apiToken) return;
        setDoneTasks(items || []);
        setDoneFetched(true);
        log('TaskHome', `Done tab: ${items?.length ?? 0} completed tasks (30d)`);
        // Render durable history first, then refresh its remote cache. A fresh
        // installation's active snapshot cannot contain completed history.
        setDoneLoading(false);
        refreshCompletedTasks(30).then(history => {if (account === getCachedConfig()?.apiToken) {setDoneTasks(history); setDoneError('');}}).catch((cause: any) => {
          if (account === getCachedConfig()?.apiToken) setDoneError(`Showing saved completed history. Refresh failed: ${cause.message}`);
        });
      } catch (err: any) {
        if (account !== getCachedConfig()?.apiToken) return;
        logError('TaskHome', err);
        setDoneError(`Could not load completed tasks: ${err.message}`);
      } finally {
        if (account === getCachedConfig()?.apiToken) setDoneLoading(false);
      }
    })();
  }, [activeTab, showDone, doneFetched, doneLoading]);

  const historyProtected = (task: any) => protectedOccurrence(task, syncInfo?.pendingChanges || []) &&
    !(!task.occurrenceHistory && !task.awaitingRecurrence && mutations.intents.some(intent => intent.kind === 'complete' && intent.completed && intent.ids.includes(String(task.id))));
  const findWorkspaceTask = (id: string) => [...tasks, ...projectedDone, ...optimisticDone].find(task => rowIdentity(task) === id);
  const mutationIds = (ids: string[]) => ids.map(id => findWorkspaceTask(id)).filter(task => task && !historyProtected(task)).map(task => String(task.id));
  const handleReopen = (id: string) => mutations.mutate(mutationIds([id]), {kind: 'complete', completed: false});

  const toggleSelection = (id: string) => setSelectedIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  const clearSelection = () => {setSelectionMode(false); setSelectionHistory(false); setSelectedIds([]);};
  const sel = {selectedIds, busy: false, clearSelection,
    completeOne: (id: string) => selectionMode ? toggleSelection(id) : mutations.mutate([id], {kind: 'complete', completed: true})};


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

  const today = localDate(new Date());

  const isActiveRegistryTask = (reference: any) => {
    const authoritative = projected.find((task: any) => task.id === reference.id) || (syncInfo?.allTasks || tasks).find((task: any) => task.id === reference.id);
    const task = authoritative || reference;
    return !task.completed && !task.deleted && !task.awaitingRecurrence && !task.occurrencePending && !task.remoteMissing;
  };
  const deviceEntries = [...deviceTasks, ...(syncInfo?.allTasks || []).filter((task: any) => task.batchId && task.capturedAt != null),
    ...creatingDrafts].filter((task, index, list) => list.findIndex(value => rowIdentity(value) === rowIdentity(task)) === index);

  // Tasks linked to the current NOTE (any page), each with the page it lives
  // on so the band tells you where you'd jump in a long note (design-home-v2).
  // Sources: supertask:// links scanned on the current page, description
  // back-references (page parsed from "<fileName> p.N"), then registry
  // entries (which carry pageNum and cover not-yet-synced tasks).
  const noteTasks = (() => {
    const seen = new Set<string>();
    const result: Array<{task: any; pageNum?: number}> = [];
    for (const task of tasks) {
      if (noteCtx?.filePath && task.source?.filePath === noteCtx.filePath && !seen.has(task.id)) {
        seen.add(task.id); result.push({task, pageNum: task.source.pageNum});
      }
    }

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

    if (activeTab === 'note') return <ScrollView onScrollBeginDrag={() => setExpandedId(null)}>{renderThisNote()}{renderCompletedSection()}</ScrollView>;
    if (activeTab === 'tomorrow') return renderSimpleTasks(projectFiltered(tasks).filter(task => (task.due?.date || '').slice(0, 10) === tomorrow), 'No tasks due tomorrow');
    if (activeTab === 'inbox') return renderProjectTasks(inboxProject?.id, 'Inbox');
    if (resolvedTab.startsWith('project:')) {
      const id = resolvedTab.slice('project:'.length);
      return renderProjectTasks(id, projectMap[id] || 'Unavailable project');
    }
    if (activeTab === 'today') return renderTodayTab();
    if (activeTab === 'upcoming') return renderUpcomingTab();
    if (activeTab === 'device') return renderDeviceTab();
    if (activeTab === 'done') return renderDoneTab();
    return renderProjectsTab();
  };

  const renderDoneTab = () => {
      if (doneLoading && !doneTasks.length) {
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
    const visibleDone = projectFiltered(projectedDone).filter(task => !task.deleted);
    if (visibleDone.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, {fontSize: Math.round(18 * scale)}]}>Nothing completed in the last 30 days</Text>
        </View>
      );
    }

    const items = groupDoneByBucket(visibleDone.sort((a, b) => (b.occurrenceCompletedAt || b.completed_at || '').localeCompare(a.occurrenceCompletedAt || a.completed_at || '')).slice(0, historyLimit), today);

    return (
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        ListFooterComponent={<Pressable style={styles.historyLink} accessibilityLabel="Load older completed tasks" disabled={historyLoading} onPress={loadMoreHistory}><Text style={styles.headerButtonText}>{historyLoading ? 'Loading history…' : 'Older completed tasks ›'}</Text></Pressable>}
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
      />
    );
  };

  const renderTodayTab = () => {
    // Tasks due today or overdue, grouped by project
    const todayTasks = projectFiltered(tasks).filter(t => {
      const due = (t.due?.date || '').slice(0, 10);
      return due && due <= today;
    });

    const groups: any[] = groupByProject(todayTasks, projectMap);

    return (
      <FlatList
        data={groups}
        ListFooterComponent={renderCompletedSection()}
        onScrollBeginDrag={() => setExpandedId(null)}
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
      />
    );
  };

  const renderUpcomingTab = () => {
    // Tasks due after today, grouped by date bucket
    const visible = projectFiltered(tasks);
    const upcoming = visible
      .filter(t => {
        const due = (t.due?.date || '').slice(0, 10);
        return isUpcomingThisWeek(due, today);
      })
      .sort((a, b) => (a.due?.date || '').localeCompare(b.due?.date || ''));


    if (upcoming.length === 0) {
      return (
        <ScrollView><View style={styles.emptyList}>
          <Text style={[styles.emptyText, {fontSize: Math.round(18 * scale)}]}>No upcoming tasks</Text>
        </View>{renderCompletedSection()}</ScrollView>
      );
    }

    const buckets = groupByDateBucket(upcoming, today);


    return (
      <FlatList
        data={buckets}
        ListFooterComponent={renderCompletedSection()}
        onScrollBeginDrag={() => setExpandedId(null)}
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
      />
    );
  };

  const renderProjectsTab = () => {
    const filtered = projectList.filter(project => shownProjectIds.includes(String(project.id)));
    return <ProjectOverview projects={filtered} tasks={projectFiltered(tasks)} sections={collectionList} selectedIds={selectedIds} TaskComponent={TaskRow} footer={renderCompletedSection()} onScrollBeginDrag={() => setExpandedId(null)}
      onDeselect={ids => setSelectedIds(previous => previous.filter(id => !ids.includes(id)))}
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
    if (deviceEntries.length === 0) {
      return (
        <ScrollView><View style={styles.emptyList}>
          <Text style={[styles.emptyText, {fontSize: Math.round(18 * scale)}]}>No tasks captured on this device</Text>
        </View>{renderCompletedSection()}</ScrollView>
      );
    }

    // Group by full path when known (falls back to bare filename for older
    // registry entries), labeled filesystem-style: "Connor / 1x1" tells you
    // WHERE the note lives, not just its name.
    const byNote: Record<string, {label: string; entries: any[]}> = {};
    for (const dt of deviceEntries) {
      if (!isActiveRegistryTask(dt)) continue;
      const key = dt.notePath || dt.noteFile || dt.source?.filePath || 'Created on this device';
      if (!byNote[key]) {
        byNote[key] = {label: dt.notePath || dt.noteFile || dt.source?.filePath ? noteLabel(dt.notePath || dt.source?.filePath, dt.noteFile) : 'Created on this device', entries: []};
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
        let openPath: string | undefined = dt.notePath || dt.source?.filePath;
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
        ListFooterComponent={renderCompletedSection()}
        onScrollBeginDrag={() => setExpandedId(null)}
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
  const defaults = composerDefaults(resolvedTab, projectList, today, tomorrow, visibilityConfig);
  const requestedLocation = composer.explicit ? composer : defaults;
  const composerLocation = {...requestedLocation,
    projectId: resolveContainerId(requestedLocation.projectId, projectList),
    sectionId: resolveContainerId(requestedLocation.sectionId, collectionList)};
  const destinationLabel = [projectMap[composerLocation.projectId] || 'Inbox',
    collectionList.find(section => section.id === composerLocation.sectionId)?.name].filter(Boolean).join(' / ');
  const contextTasks = resolvedTab.startsWith('project:') ? tasks.filter(task => String(task.project_id) === resolvedTab.slice(8)) :
    activeTab === 'inbox' ? tasks.filter(task => !task.project_id || String(task.project_id) === String(inboxProject?.id)) :
    activeTab === 'today' ? projectFiltered(tasks).filter(task => task.due?.date && task.due.date.slice(0, 10) <= today) :
    activeTab === 'tomorrow' ? projectFiltered(tasks).filter(task => task.due?.date?.slice(0, 10) === tomorrow) :
    activeTab === 'upcoming' ? projectFiltered(tasks).filter(task => isUpcomingThisWeek(task.due?.date, today)) :
    activeTab === 'note' ? noteTasks.map(item => item.task) : activeTab === 'device' ? deviceEntries.filter(isActiveRegistryTask).map(reference => tasks.find(task => rowIdentity(task) === rowIdentity(reference)) || reference) :
    activeTab === 'done' ? projectFiltered(projectedDone) : projectFiltered(tasks);
  const completedItems = [...projectedDone, ...optimisticDone].filter((task, index, list) =>
    list.findIndex(value => rowIdentity(value) === rowIdentity(task)) === index).filter(task => {
      if (resolvedTab.startsWith('project:')) return String(task.project_id) === resolvedTab.slice(8);
      if (activeTab === 'inbox') return !task.project_id || String(task.project_id) === String(inboxProject?.id);
      if (activeTab === 'today') return !!task.due?.date && task.due.date.slice(0, 10) <= today;
      if (activeTab === 'tomorrow') return task.due?.date?.slice(0, 10) === tomorrow;
      if (activeTab === 'note') return !!noteCtx?.filePath && (task.source?.filePath === noteCtx.filePath ||
        registryNoteTasks.some(value => sameTaskReference(value, task)) || noteTasks.some(value => sameTaskReference(value.task, task)));
      if (activeTab === 'device') return !!task.source?.filePath || deviceEntries.some(value => sameTaskReference(value, task));
      if (activeTab === 'upcoming') return isUpcomingThisWeek(task.due?.date, today);
      return isProjectVisible(visibilityConfig, task.project_id, projectList);
    }).sort((a, b) => (b.occurrenceCompletedAt || b.completed_at || '').localeCompare(a.occurrenceCompletedAt || a.completed_at || ''));
  const selectableTasks = (selectionHistory ? activeTab === 'done' ? contextTasks : completedItems : contextTasks).filter((task: any) => !String(task.id).startsWith('ui:') && !historyProtected(task));
  const selectableKey = selectableTasks.map((task: any) => rowIdentity(task)).join('|');
  const excludedKeepProjects = new Set([actionSheet?.id, ...(containerProof?.projects || [])].filter(id => id != null).map(String));
  let excludedChanged = true;
  while (excludedChanged) {
    excludedChanged = false;
    for (const project of projectList) {
      const aliases = [project.id, project.localId].filter(Boolean).map(String);
      if (aliases.some(id => excludedKeepProjects.has(id)) || (project.parent_id && excludedKeepProjects.has(String(project.parent_id)))) {
        for (const id of aliases) if (!excludedKeepProjects.has(id)) {excludedKeepProjects.add(id); excludedChanged = true;}
      }
    }
  }
  const keepProjects = projectList.filter(project => {
    if ([project.id, project.localId].filter(Boolean).some(id => excludedKeepProjects.has(String(id))) || String(project.id).startsWith('ui:')) return false;
    if (project.deleted || project.is_deleted || project.is_archived || project.remoteUnavailable || project.is_read_only || project.is_frozen || project.can_edit === false || project.role === 'viewer') return false;
    return !(project.workspace_id || project.shared || project.is_shared) || project.can_edit === true || ['admin', 'owner', 'member'].includes(project.role);
  });
  const chosenKeepProject = keepProjects.find(project => String(project.id) === String(resolveContainerId(actionSheet?.destinationProjectId, projectList)));
  useEffect(() => {if (selectionMode) setSelectedIds(previous => previous.filter(id => selectableKey.split('|').includes(id)));}, [selectionMode, selectableKey]);
  const loadMoreHistory = () => {
    const total = activeTab === 'done' ? projectFiltered(projectedDone).length : completedItems.length;
    if (historyLimit < total) {setHistoryLimit(value => value + 20); return;}
    if (historyLoading) return;
    const account = getCachedConfig()?.apiToken, days = historyDays + 30;
    setHistoryLoading(true);
    refreshCompletedTasks(days).then(items => {
      if (account !== getCachedConfig()?.apiToken) return;
      setHistoryDays(days); setDoneTasks(items); setDoneError(''); setHistoryLimit(value => value + 20);
    }).catch(() => {if (account === getCachedConfig()?.apiToken) setDoneError('Older history is unavailable. Saved tasks remain visible.');})
      .finally(() => {if (account === getCachedConfig()?.apiToken) setHistoryLoading(false);});
  };
  const openTaskAction = (kind: string, ids: string[]) => {
    if (!ids.length) {setError('Select one or more tasks first.'); return;}
    const task = findWorkspaceTask(ids[0]);
    const targets = mutationIds(ids);
    if (!targets.length) {setError('These recurring occurrences must be changed in Todoist.'); return;}
    setActionDate(task?.due?.date?.slice(0, 10) || '');
    setActionLocation({projectId: task?.project_id || inboxProject?.id || null, sectionId: task?.section_id || null});
    setActionLabels(task?.labels?.join(', ') || '');
    setActionSheet({kind, ids: targets}); setError('');
  };
  const openContainerAction = (kind: 'project' | 'collection', id?: string, projectId?: string) => {
    if (id?.startsWith('ui:') || projectId?.startsWith('ui:')) {setError('This container is still being saved on your device.'); return;}
    id = resolveContainerId(id, kind === 'project' ? projectList : collectionList) || undefined;
    projectId = resolveContainerId(projectId, projectList) || undefined;
    const container = id && (kind === 'project' ? projectList : collectionList).find(value => String(value.id) === id);
    const parent = kind === 'project' ? container : projectList.find(project => String(project.id) === String(projectId || container?.project_id));
    if (parent && (parent.is_inbox_project || parent.inbox_project || parent.isInbox) && kind === 'project') {setError('Inbox is protected from rename and deletion.'); return;}
    if ([container, parent].some(value => value && (value.is_read_only || value.is_frozen || value.can_edit === false || value.role === 'viewer' || ((value.is_shared || value.workspace_id) && value.can_edit !== true)))) {setError('This location requires verified edit permissions.'); return;}
    setActionName(container?.name || ''); setContainerProof(null);
    const sheet = {kind: 'container', containerKind: kind, id, projectId, request: {}, identity: {}, account: getCachedConfig()?.apiToken};
    const pending = [...containerRequests.current.values()].find(value => value.account === sheet.account &&
      resolveContainerId(value.id, kind === 'project' ? projectList : collectionList) === id && !!id && value.containerKind === kind);
    if (pending) {setActionSheet(pending); setActionName(pending.frozen.name); setContainerProof(pending.frozen.proof); return;}
    containerIdentity.current = sheet.identity;
    setActionSheet(sheet);
    if (id) workspaceService.inspectOfflineContainer(kind, id).then((proof: any) => {if (containerIdentity.current === sheet.identity && sheet.account === getCachedConfig()?.apiToken) setContainerProof(proof);}).catch(withCurrentAccount((cause: any) => setError(cause.message)));
  };
  const performContainerAction = async (action: string, mode?: string, retrySheet?: any) => {
    let sheet = retrySheet || actionSheet;
    if (sheet.account !== getCachedConfig()?.apiToken) {setActionSheet(null); return;}
    if (!sheet.frozen) {
      const existing = [...containerRequests.current.values()].find(value => !sheet.id && !value.id && value.account === sheet.account &&
        value.containerKind === sheet.containerKind && value.projectId === sheet.projectId && value.frozen.name === actionName.trim());
      if (existing) sheet = existing;
      else sheet.frozen = {action, mode, name: actionName.trim(), proof: containerProof,
        destinationProjectId: sheet.containerKind === 'project' ? resolveContainerId(sheet.destinationProjectId, projectList) : sheet.projectId};
    }
    if (sheet.saving) return;
    const frozen = sheet.frozen; action = frozen.action; mode = frozen.mode;
    if (action === 'delete' && mode === 'keep' && sheet.containerKind === 'project' && !frozen.destinationProjectId) {setError('Choose a surviving destination project first.'); delete sheet.frozen; return;}
    sheet.saving = true; sheet.error = null;
    if (!sheet.optimisticId) sheet.optimisticId = String(sheet.id || `ui:container:${++submissionSequence.current}`);
    containerRequests.current.set(sheet.optimisticId, sheet);
    setContainerRetries([...containerRequests.current.values()]);
    setActionSheet(null);
    const operation = {sequence: ++submissionSequence.current, scope: sheet.containerKind,
      action: action === 'delete' ? 'delete' : sheet.id ? 'rename' : 'create', id: sheet.optimisticId,
      name: frozen.name, projectId: sheet.projectId, mode,
      destinationProjectId: frozen.destinationProjectId};
    setContainerIntents(previous => [...previous, operation]);
    try {
      let created: any;
      if (action === 'save') {
        if (sheet.id) await (sheet.containerKind === 'project' ? workspaceService.renameOfflineProject : workspaceService.renameOfflineCollection)(sheet.id, frozen.name, sheet.request);
        else if (sheet.containerKind === 'project') created = await workspaceService.createOfflineProject(frozen.name, {}, sheet.request);
        else created = await workspaceService.createOfflineCollection(sheet.projectId, frozen.name, sheet.request);
      } else await workspaceService.deleteOfflineContainer(sheet.containerKind, sheet.id, {mode,
        destinationProjectId: frozen.destinationProjectId,
        confirmCount: frozen.proof.count, scopeToken: frozen.proof.scopeToken, includeUncached: mode === 'delete'}, sheet.request);
      if (sheet.account !== getCachedConfig()?.apiToken) return;
      if (created?.id) {
        const createdId = String(created.id);
        setActiveTab(previous => previous === `project:${operation.id}` ? `project:${createdId}` : previous);
        setComposer(previous => ({...previous, projectId: previous.projectId === operation.id ? createdId : previous.projectId,
          sectionId: previous.sectionId === operation.id ? createdId : previous.sectionId}));
      }
      await refreshSyncSheet();
      containerRequests.current.delete(sheet.optimisticId);
    } catch (cause: any) {if (sheet.account !== getCachedConfig()?.apiToken) return; sheet.error = cause.message || 'Could not confirm the local save.'; setError(sheet.error); await refreshSyncSheet().catch(() => {}); setActionSheet((current: any) => current || sheet);}
    finally {sheet.saving = false; if (sheet.account === getCachedConfig()?.apiToken) setContainerRetries([...containerRequests.current.values()]); setContainerIntents(previous => previous.filter(value => value.sequence !== operation.sequence));}
  };
  const saveComposer = () => {
    if (!composer.value.trim()) return;
    if (composerSubmission.current === composer) return;
    if (activeTab === 'upcoming' && !composerLocation.dueDate) {setError('Choose a calendar date for this Upcoming task.'); return;}
    if (!composerLocation.projectId) {setError('Choose a task destination first.'); return;}
    if (String(composerLocation.projectId).startsWith('ui:') || String(composerLocation.sectionId || '').startsWith('ui:')) {setError('This destination is still being saved locally. Your draft is retained.'); return;}
    const id = `ui:${++submissionSequence.current}`;
    let parsed;
    try {parsed = splitTitleDescription(composer.value);} catch (cause: any) {setError(cause.message); return;}
    composerSubmission.current = composer;
    const draft = {content: parsed.content, description: parsed.description, projectId: composerLocation.projectId,
      sectionId: composerLocation.sectionId, dueDate: composerLocation.dueDate, dueString: composerLocation.dueDate, priority: 1};
    const submission = {draft, request: {}, capturedAt: Date.now(), account: getCachedConfig()?.apiToken,
      source: composer.source};
    submissions.current.set(id, submission);
    setCreatingDrafts(previous => [...previous, {...draft, id, project_id: draft.projectId, section_id: draft.sectionId,
      source: submission.source, capturedAt: submission.capturedAt,
      due: draft.dueDate ? {date: draft.dueDate} : null, syncState: 'pending', savingLocally: true}]);
    setComposer(previous => ({...previous, value: '', source: null}));
    persistComposer(id);
  };
  const persistComposer = async (id: string) => {
    const submission = submissions.current.get(id); if (!submission || submission.saving) return;
    if (submission.account !== getCachedConfig()?.apiToken) return;
    submission.saving = true;
    try {
      await saveOfflineBatch([submission.draft], submission.source, submission.capturedAt, submission.request);
      if (submission.account !== getCachedConfig()?.apiToken) return;
      await refreshSyncSheet();
      setCreatingDrafts(previous => previous.filter(task => task.id !== id)); submissions.current.delete(id);
    } catch {
      if (submission.account !== getCachedConfig()?.apiToken) return;
      setCreatingDrafts(previous => previous.map(task => task.id === id ? {...task, syncState: 'attention', savingLocally: false} : task));
      setError('A new task could not be confirmed on disk. Tap its sync symbol to retry the same save; your draft is retained.');
    } finally {submission.saving = false;}
  };
  const canOrder = (task: any, direction: string) => {
    if (!resolvedTab.startsWith('project:') && activeTab !== 'inbox' && activeTab !== 'projects') return false;
    const siblings = tasks.filter(value => String(value.project_id) === String(task.project_id) &&
      String(value.section_id || '') === String(task.section_id || '') && String(value.parent_id || '') === String(task.parent_id || ''));
    const index = siblings.findIndex(value => value.id === task.id);
    return siblings.every(value => !!value.order_key) && (direction === 'up' ? index > 0 : index >= 0 && index < siblings.length - 1);
  };
  const workspace = {selectedIds, selectionMode, expandedId, toggle: toggleSelection,
    identity: rowIdentity, protectedHistory: historyProtected,
    project: (task: any) => historyProtected(task) ? task : projectTasks([task], mutations.intents)[0],
    canSelect: (task: any) => !historyProtected(task) && (!!task.completed === selectionHistory),
    select: (id: string) => {setSelectionHistory(!!findWorkspaceTask(id)?.completed); setSelectionMode(true); setSelectedIds([id]);},
    expand: (id: string) => setExpandedId(previous => previous === id ? null : id),
    complete: (id: string, completed: boolean) => String(id).startsWith('ui:') ? persistComposer(id) : mutations.mutate(mutationIds([id]), {kind: 'complete', completed}),
    edit: handleTaskPress, action: openTaskAction, canOrder,
    retryCreate: persistComposer,
    order: (id: string, direction: string) => {
      const task = findWorkspaceTask(id); if (!task) return;
      mutations.mutate(tasks.filter(value => sameScope(value, task)).map(value => String(value.id)), {kind: 'order', taskId: String(task.id), direction});
    }};
  const changeView = (view: string) => {
    const next = normalizeTaskView(view);
    sel.clearSelection(); setActiveTab(next); setSessionTab(next);
    setExpandedId(null); setHistoryLimit(20);
    setComposer(previous => previous.value.trim() ? previous : {...previous, explicit: false});
    saveConfig({lastOpenedTab: next}).catch(() => {});
  };
  const counts: Record<string, number> = {today: 0, tomorrow: 0, upcoming: 0, inbox: 0, note: noteTasks.length,
    device: deviceEntries.filter(isActiveRegistryTask).length, done: projectFiltered(doneTasks).length};
  for (const task of projectFiltered(tasks)) {
    const due = (task.due?.date || '').slice(0, 10);
    if (due && due <= today) counts.today++;
    if (due === tomorrow) counts.tomorrow++;
    if (isUpcomingThisWeek(due, today)) counts.upcoming++;
    if (String(task.project_id) === String(inboxProject?.id) || !task.project_id) counts.inbox++;
    counts[task.project_id] = (counts[task.project_id] || 0) + 1;
  }
  const syncMessage = syncStatusMessage(syncInfo || {});
  const refreshSyncSheet = async () => {
    const account = getCachedConfig()?.apiToken;
    const data = await offlineData(); if (account !== getCachedConfig()?.apiToken) return;
    setSyncInfo(data); applyData(data.tasks, data.projects, data.sections);
  };
  const retryChange = async (id: string) => {
    if (syncRetrying) return;
    setSyncRetrying(true); setSyncRetryError('');
    try {await retryOffline(id); await refreshSyncSheet();}
    catch {setSyncRetryError('Could not retry this change. It remains saved on your device.');}
    finally {setSyncRetrying(false);}
  };
  const renderCompletedSection = () => <View accessibilityLabel="Completed section">
    <Pressable accessibilityRole="button" accessibilityLabel="Expand completed tasks" accessibilityState={{expanded: showDone}}
      onPress={() => {setExpandedId(null); setShowDone(value => !value);}}>
      <SectionHeader title={`${showDone ? '⌄' : '›'} Completed`} count={completedItems.length} />
    </Pressable>
    {showDone && completedItems.slice(0, historyLimit).map(task => <TaskRow key={rowIdentity(task)} task={task} checked
      completedAt={task.occurrenceCompletedAt || task.completed_at} onCheckPress={handleReopen} onPress={handleTaskPress}
      onSyncPress={() => setSyncSheetOpen(true)} showProject={projectMap[task.project_id]} showCollection={collectionName(task)} />)}
    {!!doneError && <Text accessibilityRole="alert" style={styles.sheetText}>{doneError}</Text>}
    {showDone && <Pressable accessibilityRole="button" accessibilityLabel="Load older completed tasks" style={styles.historyLink}
      disabled={historyLoading} onPress={loadMoreHistory}><Text style={styles.historyLinkText}>{historyLoading ? 'Loading history…' : 'Older completed tasks ›'}</Text></Pressable>}
  </View>;
  const renderSimpleTasks = (items: any[], empty: string) => items.length ?
    <FlatList data={items} ListFooterComponent={renderCompletedSection()} onScrollBeginDrag={() => setExpandedId(null)} keyExtractor={task => task.id} renderItem={({item}) =>
      <TaskRow task={item} onCheckPress={sel.completeOne} disabled={sel.busy} onPress={handleTaskPress}
        onSyncPress={() => setSyncSheetOpen(true)} showProject={projectMap[item.project_id]} showCollection={collectionName(item)} />} /> :
    <ScrollView><View style={styles.emptyList}><Text style={styles.emptyText}>{empty}</Text></View>{renderCompletedSection()}</ScrollView>;
  const renderProjectTasks = (id: string | undefined, name: string) => {
    if (id && !isProjectVisible(visibilityConfig, id, projectList)) {
      return <View style={styles.centered}><Text style={styles.emptyText}>This project is hidden in Settings. Choose a visible project from the sidebar.</Text></View>;
    }
    const projectTasks = tasks.filter(task => String(task.project_id) === String(id) || ((!id || name === 'Inbox') && !task.project_id));
    const groups = collectionGroups(id || '', projectTasks, collectionList);
    const rows = groups.flatMap((group: any) => [
      {key: `collection:${group.id}`, type: 'collection', group},
      ...(isCollectionExpanded(id || '', group.id) ? (group.tasks.length ? group.tasks.map((task: any) => ({key: task.id, type: 'task', task})) : [{key: `empty:${group.id}`, type: 'empty'}]) : []),
    ]);
    return <View style={styles.body}>
      <FlatList data={rows} keyExtractor={(item: any) => item.key} renderItem={({item}: any) => item.type === 'collection' ?
        <SectionHeader title={item.group.name} count={item.group.tasks.length} expanded={isCollectionExpanded(id || '', item.group.id)} onToggle={() => {toggleCollectionExpanded(id || '', item.group.id); setCollectionRevision(value => value + 1); setExpandedId(null);}} action={item.group.id !== 'unavailable' &&
          !!item.group.id && <Pressable style={styles.iconButton} accessibilityLabel={`Collection menu for ${item.group.name}`} onPress={() => openContainerAction('collection', item.group.id, id)}><Text style={styles.headerButtonText}>•••</Text></Pressable>} /> :
        item.type === 'empty' ? <Text style={styles.emptyCollection}>No active tasks in this collection</Text> :
        <TaskRow task={item.task} onCheckPress={sel.completeOne} disabled={sel.busy} onPress={handleTaskPress} onSyncPress={() => setSyncSheetOpen(true)} showCollection={collectionName(item.task)} />}
        ListFooterComponent={<><Pressable style={styles.newCollection} accessibilityLabel={`New collection in ${name}`} onPress={() => openContainerAction('collection', undefined, id)}><Text style={[styles.newCollectionText, {fontSize: Math.round(15 * scale)}]}>+ New collection</Text></Pressable>{renderCompletedSection()}</>} onScrollBeginDrag={() => setExpandedId(null)} />
    </View>;
  };

  return (
    <WorkspaceContext.Provider value={workspace}>
    <View style={styles.container}>
      {/* Keep the header height stable when the undo action replaces its controls. */}
      <View style={[styles.header, {minHeight: Math.round(22 * scale * 1.3) + 32}]}>
        {selectionMode ? <WorkspaceSelectionBar count={selectedIds.length}
          allSelected={selectedIds.length > 0 && selectedIds.length === selectableTasks.length}
          onCancel={clearSelection} onMove={() => openTaskAction('move', selectedIds)}
          onDate={() => openTaskAction('date', selectedIds)} onMore={() => openTaskAction('more', selectedIds)}
          onSelectAll={() => setSelectedIds(selectedIds.length === selectableTasks.length ? [] : selectableTasks.map((task: any) => rowIdentity(task)))} /> : <>
          <Text style={[styles.title, {fontSize: Math.round(22 * scale)}]}>SuperTask</Text>
          <View style={styles.headerButtons}>
            <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => nav.push('config')}><Text style={styles.headerButtonText}>Settings</Text></Pressable>
            <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={closePlugin}><Text style={styles.headerButtonText}>Close</Text></Pressable>
          </View>
        </>}
      </View>

      {jumpError ? (
        <View style={styles.jumpError}>
          <Text style={styles.jumpErrorText}>{jumpError}</Text>
        </View>
      ) : null}

      {error ? <View style={styles.jumpError}><Text style={styles.jumpErrorText}>{error}</Text></View> : null}
      {creatingDrafts.filter(task => task.syncState === 'attention').map(task => <View key={task.id} style={{padding: 8, flexDirection: 'row', gap: 8}}>
        <Text style={{color: '#000', flex: 1}}>New task needs local save confirmation: {task.content}</Text>
        <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} accessibilityLabel="Retry new task save" onPress={() => persistComposer(task.id)}><Text style={styles.headerButtonText}>Retry</Text></Pressable>
      </View>)}
      {containerRetries.filter(sheet => sheet.error).map(sheet => <View key={sheet.optimisticId} style={{padding: 8, flexDirection: 'row', gap: 8}}>
        <Text style={{color: '#000', flex: 1}}>{sheet.containerKind} change needs local save confirmation: {sheet.frozen.name}</Text>
        <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} disabled={sheet.saving} accessibilityLabel="Retry container save" onPress={() => performContainerAction(sheet.frozen.action, sheet.frozen.mode, sheet)}><Text style={styles.headerButtonText}>Retry</Text></Pressable>
      </View>)}
      {mutations.failures.map(failure => <View key={failure.sequence} style={{padding: 8, flexDirection: 'row', gap: 8}}>
        <Text style={{color: '#000', flex: 1}}>{failure.error}</Text>
        <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} accessibilityLabel="Retry local save" onPress={() => mutations.retry(failure.sequence)}><Text style={styles.headerButtonText}>Retry</Text></Pressable>
      </View>)}
      <View style={styles.workspace}>
        <TaskSidebar activeView={resolvedTab} projects={projectList} visibleProjectIds={shownProjectIds}
          noteAvailable={!!noteCtx} counts={counts} onViewChange={changeView}
          onCreateProject={() => openContainerAction('project')} />
        <View style={styles.body} onTouchStart={event => {if (event.target === event.currentTarget) setExpandedId(null);}}>
          <View style={styles.projectHeading} onTouchStart={() => setExpandedId(null)}><Text style={styles.projectTitle}>{resolvedTab.startsWith('project:') ? projectMap[resolvedTab.slice(8)] || 'Unavailable project' : ({today: 'Today', tomorrow: 'Tomorrow', upcoming: 'Upcoming', inbox: 'Inbox', projects: 'All projects', note: 'This Note', device: 'On Device', done: 'Done'} as Record<string, string>)[activeTab]}</Text>
            <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} accessibilityLabel="List menu" onPress={() => setActionSheet({kind: 'list-menu'})}><Text style={styles.headerButtonText}>…</Text></Pressable></View>
          {!selectionMode && activeTab !== 'done' && <InlineTaskComposer value={composer.value}
            onChangeText={value => setComposer(previous => ({...previous, ...composerLocation, value, explicit: true,
              source: previous.value ? previous.source : activeTab === 'note' && noteCtx ? {filePath: noteCtx.filePath, pageNum: noteCtx.pageNum} : null}))} dueDate={composerLocation.dueDate}
            destinationLabel={destinationLabel} onSubmit={saveComposer}
            onChooseDate={() => {setActionDate(composerLocation.dueDate); setActionSheet({kind: 'composer-date'});}}
            onChooseDestination={() => {setActionLocation({projectId: composerLocation.projectId, sectionId: composerLocation.sectionId}); setActionSheet({kind: 'composer-move'});}} />}
          {renderContent()}

        </View>
      </View>

      <View style={[styles.footer, {height: Math.max(30, Math.round(13 * scale) + 12)}]}>
        <Pressable style={styles.syncSummary} accessibilityRole="button" accessibilityLabel="Open sync summary" accessibilityValue={{text: `${taskCount} tasks, ${syncInfo?.pendingCount || 0} queued. ${syncMessage || 'Sync details'}`}} onPress={() => {setSyncSheetOpen(true); refreshSyncSheet().catch(() => {});}}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.footerText, {fontSize: Math.round(13 * scale)}]}>{taskCount} tasks · {syncInfo?.pendingCount || 0} queued · {syncMessage || 'Sync details'}</Text>
        </Pressable>
        <View style={styles.footerRight}>
          <Pressable style={styles.footerRefresh} accessibilityRole="button" accessibilityLabel="Refresh" onPress={() => {
            sel.clearSelection();
            fetchData(true);
            if (activeTab === 'done' || showDone) {
              refreshCompletedTasks(30).then(withCurrentAccount((items: any[]) => {setDoneTasks(items); setDoneError('');})).catch(withCurrentAccount((err: any) => setDoneError(`History refresh failed: ${err.message}`)));
            }
          }}>
            <Text style={[styles.headerButtonText, {fontSize: Math.round(14 * scale)}]}>Refresh</Text>
          </Pressable>
        </View>
      </View>
      <Modal visible={!!actionSheet} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={() => setActionSheet(null)}>
        <View style={[styles.sheetBackdrop, {width: Dimensions.get('screen').width, height: Dimensions.get('screen').height}]}><View style={styles.sheet}>
          <View style={styles.projectHeading}><Text style={styles.projectTitle}>{actionSheet?.kind === 'container' ? `${actionSheet.id ? 'Edit' : 'New'} ${actionSheet.containerKind}` : 'Task actions'}</Text>
            <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => setActionSheet(null)} accessibilityLabel="Close task actions"><Text style={styles.headerButtonText}>Close</Text></Pressable></View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            {actionSheet?.kind === 'list-menu' && <View style={styles.actionRow}>
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} accessibilityLabel="Select tasks" onPress={() => {setSelectionHistory(activeTab === 'done'); setSelectionMode(true); setActionSheet(null);}}><Text style={styles.headerButtonText}>Select tasks</Text></Pressable>
              {activeTab !== 'done' && <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => {setSelectionHistory(true); setSelectionMode(true); setActionSheet(null);}}><Text style={styles.headerButtonText}>Select completed history</Text></Pressable>}
              {resolvedTab.startsWith('project:') && <>
                <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => openContainerAction('project', resolvedTab.slice(8))}><Text style={styles.headerButtonText}>Rename or delete project</Text></Pressable>
                <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => openContainerAction('collection', undefined, resolvedTab.slice(8))}><Text style={styles.headerButtonText}>New collection</Text></Pressable>
              </>}
            </View>}
            {actionSheet?.kind === 'container' ? <>
              {!!actionSheet.frozen ? <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => performContainerAction(actionSheet.frozen.action, actionSheet.frozen.mode)}><Text style={styles.headerButtonText}>Retry same container change</Text></Pressable> : <>
              <View style={styles.inputRow}><TextInput accessibilityLabel={`${actionSheet.containerKind} name`} style={{flex: 1, borderWidth: 1, color: '#000', padding: 12, minHeight: 48, fontSize: Math.round(16 * scale)}} value={actionName} onChangeText={setActionName} />
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} disabled={!actionName.trim()} onPress={() => performContainerAction('save')}><Text style={styles.headerButtonText}>Save name</Text></Pressable></View>
              {!!actionSheet.id && <>
                <Text style={styles.sheetText}>{containerProof ? containerProof.countIsMinimum ? `At least ${containerProof.count} saved tasks. Deleting all includes uncached and completed tasks in this ${actionSheet.containerKind}.` : `${containerProof.count} tasks in this ${actionSheet.containerKind}.` : 'Checking saved contents…'}</Text>
                {!!containerProof?.reason && <Text style={styles.sheetText}>{containerProof.reason}</Text>}
                {!containerProof?.canKeep && !!containerProof?.keepReason && <Text style={styles.sheetText}>{containerProof.keepReason}</Text>}
                {!containerProof?.canKeep && <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => {
                  const sheet = actionSheet;
                  workspaceService.verifyOfflineContainer(sheet.containerKind, sheet.id).then((proof: any) => {if (containerIdentity.current === sheet.identity && sheet.account === getCachedConfig()?.apiToken) setContainerProof(proof);}).catch((cause: any) => {if (containerIdentity.current === sheet.identity && sheet.account === getCachedConfig()?.apiToken) setError(cause.message);});
                }}><Text style={styles.headerButtonText}>Verify full contents online</Text></Pressable>}
                {actionSheet.containerKind === 'project' && <>
                  <Text style={styles.sheetText}>Keep tasks: choose a surviving destination project. Tasks stay together in No collection.</Text>
                  <ProjectPicker projects={keepProjects} selectedId={chosenKeepProject?.id || null} requireExplicit
                    onChange={destinationProjectId => setActionSheet((sheet: any) => ({...sheet, destinationProjectId, confirm: null}))} />
                </>}
                <View style={styles.actionRow}><Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} disabled={!containerProof?.canKeep || (actionSheet.containerKind === 'project' && !chosenKeepProject)} onPress={() => setActionSheet((sheet: any) => ({...sheet, confirm: 'keep'}))}><Text style={styles.headerButtonText}>Delete container; keep tasks</Text></Pressable>
                <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} disabled={!containerProof?.allowed} onPress={() => setActionSheet((sheet: any) => ({...sheet, confirm: 'delete'}))}><Text style={styles.headerButtonText}>Delete container and ALL its tasks</Text></Pressable></View>
                {!!actionSheet.confirm && <View style={{borderWidth: 1, padding: 12, gap: 8}}><Text style={styles.sheetText}>{actionSheet.confirm === 'delete' ? `Confirm permanent deletion of this ${actionSheet.containerKind} and ALL contained tasks, including any completed or uncached tasks. Other devices may still hold unsynced changes.` : `Confirm deleting this container while keeping ${containerProof?.count || 0} verified tasks in ${actionSheet.containerKind === 'project' ? chosenKeepProject?.name || 'the selected project' : projectMap[actionSheet.projectId] || 'their project'}, No collection. Parent and child task relationships are preserved.`}</Text>
                  <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} disabled={actionSheet.confirm === 'keep' && (!containerProof?.canKeep || (actionSheet.containerKind === 'project' && !chosenKeepProject))} onPress={() => performContainerAction('delete', actionSheet.confirm)}><Text style={styles.headerButtonText}>Confirm deletion</Text></Pressable></View>}
              </>}
              </>}
            </> : null}
            {(actionSheet?.kind === 'date' || actionSheet?.kind === 'composer-date') && <DatePicker value={actionDate} onClose={() => setActionSheet(null)} onChange={date => {
              if (actionSheet.kind === 'composer-date') setComposer(previous => ({...previous, ...composerLocation, dueDate: date, explicit: true}));
              else mutations.mutate(actionSheet.ids, {kind: 'edit', patch: {due: date ? {date, is_recurring: false} : null}});
            }} />}
            {(actionSheet?.kind === 'move' || actionSheet?.kind === 'composer-move') && <>
              <ProjectPicker projects={projectList.filter(project => !String(project.id).startsWith('ui:'))} sections={collectionList.filter(section => !String(section.id).startsWith('ui:'))} selectedId={actionLocation.projectId} selectedSectionId={actionLocation.sectionId}
                onChange={projectId => setActionLocation({projectId, sectionId: null})} onSectionChange={sectionId => setActionLocation(previous => ({...previous, sectionId}))} />
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} disabled={!actionLocation.projectId} onPress={() => {
                if (actionSheet.kind === 'composer-move') setComposer(previous => ({...previous, ...composerLocation, ...actionLocation, explicit: true}));
                else mutations.mutate(actionSheet.ids, {kind: 'edit', patch: {project_id: actionLocation.projectId, section_id: actionLocation.sectionId}});
                setActionSheet(null);
              }}><Text style={styles.headerButtonText}>Use this location</Text></Pressable>
            </>}
            {actionSheet?.kind === 'priority' && <PriorityPicker value={0} onChange={priority => {mutations.mutate(actionSheet.ids, {kind: 'edit', patch: {priority}}); setActionSheet(null);}} />}
            {actionSheet?.kind === 'more' && <View style={styles.actionRow}>
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => setActionSheet((sheet: any) => ({...sheet, kind: 'priority'}))}><Text style={styles.headerButtonText}>Priority</Text></Pressable>
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => setActionSheet((sheet: any) => ({...sheet, kind: 'labels'}))}><Text style={styles.headerButtonText}>Labels</Text></Pressable>
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => {mutations.mutate(actionSheet.ids, {kind: 'complete', completed: !selectionHistory}); setActionSheet(null); clearSelection();}}><Text style={styles.headerButtonText}>{selectionHistory ? 'Reopen selected' : 'Complete selected'}</Text></Pressable>
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => setActionSheet((sheet: any) => ({...sheet, kind: 'delete'}))}><Text style={styles.headerButtonText}>Delete selected</Text></Pressable>
            </View>}
            {actionSheet?.kind === 'labels' && <>
              <Text style={styles.sheetText}>Replace labels on selected tasks. Separate names with commas; leave empty to clear.</Text>
              <View style={styles.inputRow}><TextInput accessibilityLabel="Labels" value={actionLabels} onChangeText={setActionLabels} style={{flex: 1, minHeight: 48, borderWidth: 1, padding: 8, color: '#000'}} />
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => {mutations.mutate(actionSheet.ids, {kind: 'edit', patch: {labels: [...new Set(actionLabels.split(',').map(label => label.trim()).filter(Boolean))]}}); setActionSheet(null);}}><Text style={styles.headerButtonText}>Apply labels</Text></Pressable></View>
            </>}
            {actionSheet?.kind === 'delete' && <><Text style={styles.sheetText}>Delete {actionSheet.ids.length} selected task{actionSheet.ids.length === 1 ? '' : 's'}? This also syncs to Todoist.</Text>
              <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => {mutations.mutate(actionSheet.ids, {kind: 'delete'}); setActionSheet(null); clearSelection();}}><Text style={styles.headerButtonText}>Confirm delete</Text></Pressable></>}
          </ScrollView>
        </View></View>
      </Modal>
      <Modal visible={syncSheetOpen} transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={() => setSyncSheetOpen(false)}>
        <View style={[styles.sheetBackdrop, {width: Dimensions.get('screen').width, height: Dimensions.get('screen').height}]}><View style={styles.sheet}>
          <View style={styles.projectHeading}><Text style={styles.projectTitle}>Sync summary</Text>
            <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => setSyncSheetOpen(false)} accessibilityLabel="Close sync summary"><Text style={styles.headerButtonText}>Close</Text></Pressable></View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.sheetText}>{syncMessage || 'No saved changes are waiting to sync.'}</Text>
            <Text style={styles.sheetText}>{syncInfo?.timestamp ? `Last successful sync: ${new Date(syncInfo.timestamp).toLocaleString()}` : 'No successful sync yet.'}</Text>
            {syncInfo?.warning ? <Text style={styles.sheetText}>{syncInfo.warning}</Text> : null}
            {syncInfo?.otherAccountStores > 0 ? <Text style={styles.sheetText}>Tasks for another configured token are retained separately. Switch back to that token to resume them.</Text> : null}
            {(syncInfo?.syncNotices || []).map((notice: any, index: number) => <Text style={styles.sheetText} key={notice.id || index}>{typeof notice === 'string' ? notice : notice.message || 'Sync needs attention. Review this task in Todoist.'}</Text>)}
            {(syncInfo?.pendingChanges || []).map((change: any) => <View style={styles.queuedChange} key={change.uuid || `${change.kind}:${change.id}`}>
              <Text style={styles.sheetText}>{syncChangeLabel(change.kind)} · {change.task?.content || change.collection?.name || 'Saved change'}</Text>
              <Text style={styles.sheetText}>{change.state === 'attention' ? syncStatusMessage({syncError: change.error}) || 'Needs attention' : change.state === 'sending' ? 'Syncing or waiting for acknowledgement' : 'Waiting to sync'}</Text>
              {change.error && /^(This task|This project|This collection|This older queued|A collection|Todoist acknowledged|No command)/.test(change.error) ? <Text style={styles.sheetText}>{change.error}</Text> : null}
              {change.task && !change.task.deleted ? <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} onPress={() => {setSyncSheetOpen(false); nav.push('task-detail', {task: change.task, projects: projectList});}}><Text style={styles.headerButtonText}>Task details</Text></Pressable> : null}
              {change.error ? <Pressable style={({pressed}) => [styles.headerButton, pressed && styles.pressed]} disabled={syncRetrying} accessibilityLabel="Retry saved change" onPress={() => retryChange(change.id)}><Text style={styles.headerButtonText}>Retry</Text></Pressable> : null}
            </View>)}
            {syncRetryError ? <Text style={styles.sheetText}>{syncRetryError}</Text> : null}
          </ScrollView>
        </View></View>
      </Modal>

    </View>
    </WorkspaceContext.Provider>
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
    arr.forEach(t => items.push({key: `done-${rowIdentity(t)}`, type: 'task', task: t}));
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
  pressed: {backgroundColor: '#eeeeee'},
  workspace: {flex: 1, flexDirection: 'row'},
  projectHeading: {minHeight: 56, padding: 12, gap: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#000'},
  projectTitle: {flex: 1, fontSize: 20, fontWeight: '700', color: '#000'},
  emptyCollection: {padding: 16, fontSize: 15, color: '#000'},
  newCollection: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, alignSelf: 'stretch', backgroundColor: '#fff'},
  newCollectionText: {fontSize: 15, color: '#000', fontWeight: '700'},
  syncSummary: {minWidth: 0, flex: 1, alignSelf: 'stretch', justifyContent: 'center', paddingRight: 10},
  sheetBackdrop: {flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'center'},
  sheet: {width: '90%', maxWidth: 720, maxHeight: '85%', flexShrink: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#000'},
  sheetScroll: {flexGrow: 0, flexShrink: 1},
  footerRefresh: {alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 8},
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
    borderBottomWidth: 1,
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
  iconButton: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'},
  emptyList: {padding: 24},
  historyLink: {minHeight: 48, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: 16},
  historyLinkText: {fontSize: 14, color: '#555'},
  actionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center'},
  inputRow: {flexDirection: 'row', gap: 12, alignItems: 'center'},
  headerButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 0,
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
    borderBottomWidth: 1,
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
    borderBottomWidth: 1,
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
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    borderColor: '#999999',
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
    paddingHorizontal: 12,
    paddingVertical: 0,
    borderTopWidth: 1,
    borderTopColor: '#000000',
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 13,
    color: '#555555',
  },
});
