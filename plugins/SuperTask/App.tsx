/**
 * SuperTask - Root component
 *
 * Stack-based navigation for drill-down flows.
 * Reads initial button ID from global (set by index.js before mount),
 * then registers listeners for subsequent presses.
 *
 * @format
 */

import React, {useState, useEffect, useCallback, useRef, useMemo} from 'react';
import {View, Text, ScrollView, Pressable, StyleSheet} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';

import TaskHome from './src/screens/TaskHome';
import ProjectView from './src/screens/ProjectView';
import TaskDetail from './src/screens/TaskDetail';
import TaskAdd from './src/screens/TaskAdd';
import Capture from './src/screens/Capture';
import BatchAdd from './src/screens/BatchAdd';
import AISettings from './src/screens/AISettings';
import Config from './src/screens/Config';
import Diagnostics from './src/screens/Diagnostics';
import {log, logError, getEntries, setListener, exportLog, setDebugMode} from './src/utils/debug';
import {initGestureDetector, clearLinkCache} from './src/utils/gestureDetector';
import {markViewOpen, markViewClosed, setCurrentScreen} from './src/utils/viewState';
import {closePlugin} from './src/utils/closePlugin';
import {loadConfig} from './src/utils/config';
import {getTask as getRegistryTask} from './src/utils/taskRegistry';
import {setConfigLoader, getTask as getApiTask, getProjects} from './src/api/todoist';

declare global {
  var __superTaskButtonId: number | string | null;
  var __superTaskDeepLink: {action: string; taskId?: string; projectId?: string; projectName?: string; focusTab?: string} | null;
  var __superTaskNavigate: ((screen: string, params?: Record<string, any>) => void) | null;
}

type ScreenEntry = {
  name: string;
  params?: Record<string, any>;
  id: number;
};

// Read the initial button ID set by index.js before React mounted
function getInitialScreen(): ScreenEntry {
  // Check for deep link from gesture detector
  const deepLink = global.__superTaskDeepLink;
  if (deepLink) {
    global.__superTaskDeepLink = null; // Consume it
    if (deepLink.action === 'view-task' && deepLink.taskId) {
      return {name: 'deep-link-loading', params: {taskId: deepLink.taskId}, id: 0};
    }
    if (deepLink.action === 'lasso-add') {
      return {name: 'capture-lasso', id: 0};
    }
    if (deepLink.action === 'view-project' && deepLink.projectId) {
      return {name: 'project-view', params: {projectId: deepLink.projectId, projectName: deepLink.projectName || 'Project'}, id: 0};
    }
    if (deepLink.action === 'this-page') {
      return {name: 'task-home', params: {focusTab: deepLink.focusTab || 'today'}, id: 0};
    }
  }

  const raw = global.__superTaskButtonId;
  (global as any).__superTaskButtonId = null; // Consume it -- a stale ID (e.g. 200 from
  // a past lasso capture) must not route a later context re-creation to capture-lasso
  // Coerce to number for comparison -- SDK may pass string or number
  const buttonId = typeof raw === 'string' ? parseInt(raw, 10) || raw : raw;
  if (buttonId === 200) return {name: 'capture-lasso', id: 0};
  if (buttonId === 300) return {name: 'capture-doc', id: 0};
  if (raw === 'config') return {name: 'config', id: 0};
  return {name: 'task-home', id: 0};
}

/**
 * DeepLinkLoader -- transitional screen that resolves a task ID into
 * full task data, then navigates to TaskDetail.
 */
function DeepLinkLoader({taskId, nav}: {taskId: string; nav: any}) {
  const [status, setStatus] = useState('Loading task...');

  useEffect(() => {
    (async () => {
      log('DeepLink', `Loading task ${taskId}`);
      setConfigLoader(loadConfig);

      try {
        // Fetch task and projects in parallel (single task by ID, not all tasks)
        const [taskResult, projectsResult] = await Promise.allSettled([
          getApiTask(taskId),
          getProjects(),
        ]);

        const projects = projectsResult.status === 'fulfilled' ? (projectsResult.value || []) : [];
        if (projectsResult.status === 'rejected') {
          log('DeepLink', `Projects fetch failed: ${projectsResult.reason?.message}`);
        }

        if (taskResult.status === 'fulfilled' && taskResult.value) {
          log('DeepLink', 'Found task from Todoist/cache');
          nav.replace('task-detail', {task: taskResult.value, projects});
          return;
        }
        if (taskResult.status === 'rejected') {
          log('DeepLink', `API fetch failed: ${taskResult.reason?.message}`);
        }

        // Fallback: build minimal task object from registry
        const regTask = await getRegistryTask(taskId);
        if (regTask) {
          log('DeepLink', 'Found task in registry');
          nav.replace('task-detail', {
            task: {id: taskId, content: regTask.content, description: '', priority: 1},
            projects,
          });
          return;
        }

        // Not found anywhere
        log('DeepLink', `Task ${taskId} not found`);
        setStatus(`Task not found: ${taskId}`);
        setTimeout(() => nav.resetTo('task-home'), 2000);
      } catch (e: any) {
        logError('DeepLink', e);
        setStatus(`Error: ${e.message}`);
        setTimeout(() => nav.resetTo('task-home'), 2000);
      }
    })();
  }, [taskId, nav]);

  return (
    <View style={{flex: 1, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center', padding: 24}}>
      <Text style={{fontSize: 16, fontWeight: '700', color: '#000000'}}>{status}</Text>
    </View>
  );
}

let navIdCounter = 0;

// Permission explainer (Chauvet 3.29.44+): shown once per process while the
// folder group (read + write) is not granted. Stateless on purpose -- the
// plugin cannot persist a "shown" flag before it has write permission, and
// once the folder is granted the check itself says "don't show". "Not now"
// suppresses it for the rest of the process only.

function App(): React.JSX.Element {
  const [screenStack, setScreenStack] = useState<ScreenEntry[]>([getInitialScreen()]);
  const [error, setError] = useState<string | null>(null);
  const [, setDebugLog] = useState<string[]>([]);
  const [exportStatus, setExportStatus] = useState('');
  const resetToRef = useRef<((name: string, params?: Record<string, any>) => void) | undefined>(undefined);
  const initialScreenName = useRef(screenStack[0].name).current;

  const push = useCallback((name: string, params?: Record<string, any>) => {
    log('App', `push: ${name} params=${params ? Object.keys(params).join(',') : 'none'}`);
    setScreenStack(prev => [...prev, {name, params, id: ++navIdCounter}]);
  }, []);

  const pop = useCallback(() => {
    setScreenStack(prev => {
      if (prev.length <= 1) return prev;
      log('App', `pop: back to ${prev[prev.length - 2].name}`);
      return prev.slice(0, -1);
    });
  }, []);

  const replace = useCallback((name: string, params?: Record<string, any>) => {
    log('App', `replace: ${name}`);
    setScreenStack(prev => [...prev.slice(0, -1), {name, params, id: ++navIdCounter}]);
  }, []);

  const resetTo = useCallback((name: string, params?: Record<string, any>) => {
    log('App', `resetTo: ${name}`);
    setScreenStack([{name, params, id: ++navIdCounter}]);
  }, []);

  resetToRef.current = resetTo;

  useEffect(() => {
    setListener(setDebugLog);
    loadConfig().then(config => {
      if (config.debugMode) setDebugMode(true);
    }).catch((failure: any) => setError(failure.message));

    const initial = global.__superTaskButtonId;
    log('App', `MOUNT -- initial buttonId=${JSON.stringify(initial)} screen=${initialScreenName}`);
    markViewOpen('app-mount'); // App only mounts with the view showing (B-031 tracking)

    // Gesture detector is initialized in index.js (before mount) so
    // long-press detection works even on a fresh note view. We still
    // call init here as a guard in case index.js init was too early.
    initGestureDetector();

    // Expose a navigate callback so the gesture detector can route
    // directly when the App is already mounted (re-show via showPluginView).
    // For first-mount, getInitialScreen() reads the global instead.
    global.__superTaskNavigate = (screen: string, params?: Record<string, any>) => {
      log('App', `__superTaskNavigate: ${screen} params=${params ? Object.keys(params).join(',') : 'none'}`);
      resetToRef.current?.(screen, params);
    };

    // Register listeners for subsequent button presses (e.g., switching
    // between tasks and config without closing the plugin view)
    const configSub = PluginManager.registerConfigButtonListener({
      onClick: () => {
        log('App', 'CONFIG button pressed (listener)');
        markViewOpen('config-listener'); // (B-031 tracking)
        resetToRef.current?.('config');
      },
    });

    const buttonSub = PluginManager.registerButtonListener({
      onButtonPress: (event: any) => {
        const raw = event?.id;
        const id = typeof raw === 'string' ? parseInt(raw, 10) || raw : raw;
        log('App', `BUTTON pressed raw=${JSON.stringify(raw)} id=${id} (listener)`);
        markViewOpen('button-listener'); // (B-031 tracking)
        clearLinkCache(); // plugin session may change page links (F-027)
        if (id === 200) {
          resetToRef.current?.('capture-lasso');
        } else if (id === 300) {
          resetToRef.current?.('capture-doc');
        } else {
          resetToRef.current?.('task-home');
        }
      },
    });

    return () => {
      log('App', 'UNMOUNT -- removing listeners');
      markViewClosed('app-unmount');
      global.__superTaskNavigate = null;
      if (configSub?.remove) configSub.remove();
      if (buttonSub?.remove) buttonSub.remove();
    };
  }, [initialScreenName]);

  const current = screenStack[screenStack.length - 1];
  const canGoBack = screenStack.length > 1;

  useEffect(() => {
    log('App', `SCREEN changed: "${current.name}" stackDepth=${screenStack.length} params=${current.params ? Object.keys(current.params).join(',') : 'none'}`);
    setCurrentScreen(current.name); // B-031: names the screen in pen-through-view logs
  }, [current.name, current.params, screenStack.length]);
  const nav = useMemo(() => ({push, pop, replace, resetTo, canGoBack}), [push, pop, replace, resetTo, canGoBack]);

  // Show debug log on error or when navigated to
  if (error || current.name === 'debug') {
    return (
      <View style={styles.container}>
        <View style={styles.debugHeader}>
          <Text style={styles.debugTitle}>
            {error ? 'Error' : 'Debug Log'}
          </Text>
          <View style={styles.debugButtons}>
            <Pressable
              style={styles.debugButton}
              onPress={async () => {
                setExportStatus('Uploading...');
                const result = await exportLog();
                setExportStatus(result);
              }}>
              <Text style={styles.debugButtonText}>Upload Log</Text>
            </Pressable>
            <Pressable
              style={styles.debugButton}
              onPress={() => { setError(null); resetTo('task-home'); }}>
              <Text style={styles.debugButtonText}>Tasks</Text>
            </Pressable>
            <Pressable
              style={styles.debugButton}
              onPress={() => closePlugin()}>
              <Text style={styles.debugButtonText}>Close</Text>
            </Pressable>
          </View>
        </View>
        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}
        {exportStatus ? (
          <Text style={styles.exportStatus}>{exportStatus}</Text>
        ) : null}
        <ScrollView style={styles.debugScroll}>
          {getEntries().map((entry, i) => (
            <Text key={i} style={styles.debugEntry}>{entry}</Text>
          ))}
          {getEntries().length === 0 && (
            <Text style={styles.debugEntry}>No log entries yet.</Text>
          )}
        </ScrollView>
      </View>
    );
  }

  const isOverlay = false;

  return (
    <View style={[styles.container, isOverlay && styles.containerOverlay]}>
      {screenStack.filter(entry => entry.id === current.id || entry.name === 'task-home' || entry.name === 'task-add' || entry.name === 'task-batch').map(entry => {
        const active = entry.id === current.id;
        return <View key={entry.id} style={active ? styles.screen : styles.hiddenScreen}
          pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active}
          importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
          {entry.name === 'task-home' && (
            <TaskHome key={entry.id} nav={nav} active={active} focusTab={entry.params?.focusTab} />
          )}
          {entry.name === 'project-view' && (
            <ProjectView key={entry.id} nav={nav} projectId={entry.params?.projectId} projectName={entry.params?.projectName} />
          )}
          {entry.name === 'task-detail' && (
            <TaskDetail key={entry.id} nav={nav} task={entry.params?.task} projects={entry.params?.projects} />
          )}
          {entry.name === 'task-add' && (
            <TaskAdd
              key={entry.id}
              nav={nav}
              projects={entry.params?.projects || []}
              defaultProjectId={entry.params?.defaultProjectId}
              defaultSectionId={entry.params?.defaultSectionId}
              initialContent={entry.params?.initialContent}
              initialDescription={entry.params?.initialDescription}
              captureMode={entry.params?.captureMode}
              noteContext={entry.params?.noteContext}
              capturedAt={entry.params?.capturedAt}
            />
          )}
          {entry.name === 'capture-lasso' && (
            <Capture key={entry.id} mode="lasso" nav={nav} />
          )}
          {entry.name === 'task-batch' && <BatchAdd key={entry.id} nav={nav} active={active}
            projects={entry.params?.projects || []} defaultProjectId={entry.params?.defaultProjectId}
            defaultSectionId={entry.params?.defaultSectionId}
            initialContent={entry.params?.initialContent} initialDescription={entry.params?.initialDescription}
            noteContext={entry.params?.noteContext} capturedAt={entry.params?.capturedAt} preview={entry.params?.preview}
            initialRows={entry.params?.initialRows} captureMode={entry.params?.captureMode} />}
          {entry.name === 'ai-settings' && <AISettings key={entry.id} nav={nav} />}
          {entry.name === 'capture-doc' && (
            <Capture key={entry.id} mode="doc" nav={nav} />
          )}
          {entry.name === 'deep-link-loading' && (
            <DeepLinkLoader key={entry.id} taskId={entry.params?.taskId} nav={nav} />
          )}
          {entry.name === 'config' && (
            <Config key={entry.id} onNavigate={(s: string) => resetTo(s)} nav={nav} />
          )}
          {entry.name === 'diagnostics' && (
            <Diagnostics key={entry.id} nav={nav} />
          )}
        </View>;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  // Hidden forms retain their local draft/confirmation state but cannot take
  // touches, occupy layout space, or enter the accessibility focus order.
  screen: {flex: 1},
  hiddenScreen: {display: 'none'},
  containerOverlay: {
    backgroundColor: 'transparent',
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  debugTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
  },
  debugButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  debugButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  debugButtonText: {
    fontSize: 14,
    color: '#000000',
  },
  errorText: {
    padding: 16,
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
    backgroundColor: '#f0f0f0',
  },
  debugScroll: {
    flex: 1,
    padding: 12,
  },
  debugEntry: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#000000',
    marginBottom: 4,
    lineHeight: 16,
  },
  exportStatus: {
    padding: 8,
    fontSize: 13,
    color: '#000000',
    backgroundColor: '#e8e8e8',
    textAlign: 'center',
  },
});

export default App;
