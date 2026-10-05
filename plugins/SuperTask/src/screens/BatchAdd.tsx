import React, {useEffect, useRef, useState} from 'react';
import {View, Text, TextInput, Pressable, ScrollView, StyleSheet} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {closePlugin} from '../utils/closePlugin';
import {saveOfflineBatch} from '../offline/service';
import {refineBatch, refinementError} from '../batch/refine';
import ProjectPicker from '../components/ProjectPicker';
import {useLocations} from '../collections/useLocations';
import PriorityPicker from '../components/PriorityPicker';
import DatePicker from '../components/DatePicker';
import {useFontScale} from '../utils/useFontScale';
const {fromText, mergeNext, splitRow, MAX_TASKS} = require('../batch/model');
const {localDate} = require('../offline/model');
const {makeDefaults, inheritDefaults, initializeProposalRow, changeDefault, editRow, resetRowField,
  replaceSplitParts, mergeOverrides, reconcileRefinement} = require('../batch/assignments');

type Props = {nav: any; active?: boolean; initialContent?: string; initialDescription?: string; initialRows?: any[]; captureMode?: 'lasso' | 'doc';
  projects: any[]; defaultProjectId?: string; defaultSectionId?: string; noteContext?: any; capturedAt?: number; preview?: string};

export default function BatchAdd({nav, active = true, initialContent = '', initialDescription = '', initialRows, captureMode,
  projects: initialProjects, defaultProjectId, defaultSectionId, noteContext, capturedAt = Date.now(), preview}: Props) {
  const {projects, sections} = useLocations(initialProjects);
  const scale = useFontScale();
  const scaledText = {fontSize: 15 * scale, lineHeight: 22 * scale};
  const scaledLabel = {fontSize: 16 * scale};
  const scaledTitle = {fontSize: 24 * scale};
  const scaledTaskTitle = {fontSize: 18 * scale};
  const scaledInput = {fontSize: 18 * scale, minHeight: 44 * scale};
  const scaledStatus = {fontSize: 16 * scale};
  const scaledPrimary = {fontSize: 17 * scale};
  const nextId = useRef(0);
  const defaultsRef = useRef(makeDefaults({projectId: defaultProjectId, sectionId: defaultSectionId}));
  const [defaults, setDefaults] = useState(defaultsRef.current);
  const decorate = (values: any[]) => values.map(row => {
    const rowId = row.rowId ?? `batch-row-${++nextId.current}`;
    if (typeof rowId === 'number') nextId.current = Math.max(nextId.current, rowId);
    return {...row, rowId, overrides: {...row.overrides}, labels: [...(row.labels || [])]};
  });
  const [rows, setRows] = useState<any[]>(() => decorate(initialRows?.length
    ? initialRows.map(row => initializeProposalRow({description: initialDescription, selected: true, ...row}, defaultsRef.current))
    : fromText(initialContent, {...defaultsRef.current, description: initialDescription, overrides: {}})));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [createdTasks, setCreatedTasks] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | number | null>(null);
  const [dateRow, setDateRow] = useState<string | number | null>(null);
  const [batchDateOpen, setBatchDateOpen] = useState(false);
  const [undo, setUndo] = useState<any[] | null>(null);
  const [postCreateAction, setPostCreateAction] = useState('prompt');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showBatchLocation, setShowBatchLocation] = useState(false);
  const [showBatchPriority, setShowBatchPriority] = useState(false);
  const [showBatchLabels, setShowBatchLabels] = useState(false);
  const [activeNoteContext, setActiveNoteContext] = useState(noteContext);
  const [activePreview, setActivePreview] = useState(preview);
  const [showAiSetupHint, setShowAiSetupHint] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const request = useRef({});
  const autoBackTimer = useRef<any>(null);
  const captureTime = useRef(capturedAt).current;
  const selected = rows.filter(row => row.selected);
  const locked = busy || attempted || saved;
  const cancelRefinement = (message = 'AI refinement stopped. Original rows were kept.') => {
    const activeController = controller.current;
    if (!activeController) return;
    activeController.abort();
    if (controller.current === activeController) {
      controller.current = null;
      working.current = false;
      if (alive.current) {setBusy(false); setStatus(message);}
    }
  };
  useEffect(() => {
    if (!active) {return;}
    let current = true;
    setConfigLoaded(false);
    import('../utils/config').then(async configModule => {
      const config = await configModule.loadConfig();
      if (alive.current && current) {
        if (config.postCreateAction) setPostCreateAction(config.postCreateAction);
        setShowAiSetupHint(!config.aiApiKey?.trim() && config.aiSetupHintDismissed !== true);
        setConfigLoaded(true);
      }
    }).catch(() => {if (alive.current && current) setConfigLoaded(true);});
    return () => {current = false;};
  }, [active]);
  useEffect(() => {
    const sub = PluginManager.registerPluginLifeListener({onMsg: (message: any) => {
      if (message.state >= 3) cancelRefinement();
    }});
    return () => {alive.current = false; controller.current?.abort(); if (autoBackTimer.current) clearTimeout(autoBackTimer.current); sub?.remove();};
  }, []);

  const update = (index: number, values: any) => setRows(prev => prev.map((row, i) => i === index ? {...row, ...values} : row));
  const edit = (index: number, field: string, value: any) => setRows(prev => prev.map((row, i) => i === index ? editRow(row, field, value) : row));
  const applyDefault = (field: string, value: any) => {
    const result = changeDefault(rows, defaultsRef.current, field, value);
    defaultsRef.current = result.defaults;
    setDefaults(result.defaults);
    setRows(result.rows);
    setStatus('');
  };
  const resetField = (index: number, field: string) => update(index, resetRowField(rows[index], field, defaultsRef.current));
  const safely = (action: () => any[]) => {
    try {setRows(action()); setStatus('');} catch (error: any) {setStatus(error.message);}
  };
  const merge = (index: number) => safely(() => {
    const merged = mergeOverrides(rows[index], rows[index + 1]);
    const result = mergeNext(rows, index);
    const descriptions = [...new Set([rows[index].description, rows[index + 1].description].filter(Boolean))];
    return result.map((row: any, i: number) => i === index ? {...row, overrides: merged.overrides,
      instructions: merged.instructions, description: descriptions.join('\n'),
      projectId: merged.projectId, sectionId: merged.sectionId, dueString: merged.dueString, priority: merged.priority, labels: merged.labels} : row);
  });
  const split = (index: number) => safely(() => {
    const parts = splitRow(rows, index);
    if (parts.length === rows.length) return parts;
    return decorate(replaceSplitParts(rows, index, parts));
  });
  const addRow = () => {
    if (rows.length >= MAX_TASKS) return;
    const row = inheritDefaults(fromText('New task', {description: '', selected: true, overrides: {}})[0], defaultsRef.current);
    setRows(prev => [...prev, ...decorate([row])]);
  };

  const refine = async () => {
    if (working.current || attempted || saved) return;
    if (!selected.length) {setStatus('Select at least one row to refine.'); return;}
    const previous = rows;
    const abort = new AbortController();
    controller.current = abort; working.current = true; setBusy(true);
    setStatus('Refining with OpenAI… Original rows are kept until a valid result arrives.');
    const timer = setTimeout(() => cancelRefinement('AI timed out. Original rows were kept.'), 90000);
    try {
      const proposals = await refineBatch(selected.map(row => ({...row, rowId: String(row.rowId)})), projects, captureTime,
        selected.length === rows.length ? activePreview : undefined, abort.signal, sections);
      if (!alive.current || abort.signal.aborted || controller.current !== abort) return;
      const refined = reconcileRefinement(selected, proposals);
      setUndo(previous);
      setRows(decorate([...refined, ...previous.filter(row => !row.selected)]));
      setStatus('AI suggestions ready. Check titles, dates and projects before saving.');
    } catch (error: any) {
      if (alive.current && controller.current === abort) setStatus(abort.signal.aborted ? 'AI refinement stopped. Original rows were kept.' : refinementError(error));
    } finally {
      clearTimeout(timer);
      if (controller.current === abort) {controller.current = null; working.current = false; if (alive.current) setBusy(false);}
    }
  };

  const dismissAiSetupHint = async () => {
    try {
      const configModule = await import('../utils/config');
      if (!alive.current) return;
      if (await configModule.saveConfig({aiSetupHintDismissed: true})) {if (alive.current) setShowAiSetupHint(false);}
      else if (alive.current) setStatus('Could not save the AI setup hint preference.');
    } catch {
      if (alive.current) setStatus('Could not save the AI setup hint preference.');
    }
  };
  const goBack = () => {
    if (autoBackTimer.current) {clearTimeout(autoBackTimer.current); autoBackTimer.current = null;}
    if (captureMode) closePlugin();
    else if (nav?.canGoBack) nav.pop();
    else nav?.resetTo?.('task-home');
  };
  const addAnother = () => {
    request.current = {};
    setCreatedTasks([]); setRows(decorate(fromText('New task', {...defaultsRef.current, description: '', overrides: {}, instructions: {}})));
    setActivePreview(undefined); setActiveNoteContext(undefined);
    setUndo(null); setSaved(false); setAttempted(false); setExpanded(null); setStatus('');
  };
  const save = async () => {
    if (working.current || saved) return;
    if (!configLoaded) {setStatus('Loading saved settings…'); return;}
    if (!selected.length || selected.some(row => !row.content.trim())) {setStatus('Select at least one task; every selected title must be filled in.'); return;}
    working.current = true; setBusy(true); setAttempted(true); setStatus('Saving the batch on this device…');
    try {
      const result = await saveOfflineBatch(selected, activeNoteContext, captureTime, request.current);
      if (alive.current) {
        setSaved(true);
        setCreatedTasks(result);
        setStatus(`Saved ${result.length} task${result.length === 1 ? '' : 's'} on this device. Sync starts while SuperTask is open and resumes next time you open it.`);
        if (postCreateAction === 'auto-back') autoBackTimer.current = setTimeout(() => {if (alive.current) goBack();}, 500);
      }
    } catch (error: any) {
      if (alive.current) {
        if (error?.uncertainCommit === true) {
          setStatus(`${error.message} Retry keeps the same task identities. Open Tasks to inspect any saved work.`);
        } else {
          request.current = {};
          setAttempted(false);
          setStatus(`${error.message} No tasks were saved. Correct the batch and try again.`);
        }
      }
    } finally {working.current = false; if (alive.current) setBusy(false);}
  };

  const today = () => localDate(new Date());
  const tomorrow = () => {const date = new Date(); date.setDate(date.getDate() + 1); return localDate(date);};
  return <View style={s.page}>
    <View style={s.header}><Text style={[s.title, scaledTitle]}>{saved ? 'Tasks saved' : 'Review tasks'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Done' : 'Cancel'} style={s.button} onPress={() => {cancelRefinement(); goBack();}} disabled={busy && !controller.current}><Text style={[s.label, scaledLabel]}>{saved ? 'Done' : 'Cancel'}</Text></Pressable>
    </View>
    {!saved && <>
      <View style={s.intro}>
        <Text style={[s.text, scaledText]}>One task per row. Edit recognition, merge wrapped lines, or insert line breaks and split. Handwriting remains unchanged.</Text>
        <Text style={[s.text, scaledText]}>Captured {localDate(new Date(captureTime))}. {selected.length} of {rows.length} selected.</Text>
      </View>
      {!locked && <View style={s.controls}>
        <View style={s.actions}>
          <Pressable style={s.button} onPress={() => setRows(prev => prev.map(row => ({...row, selected: true})))}><Text style={[s.label, scaledLabel]}>Select all</Text></Pressable>
          <Pressable style={s.button} onPress={() => setRows(prev => prev.map(row => ({...row, selected: false})))}><Text style={[s.label, scaledLabel]}>Select none</Text></Pressable>
          <Pressable style={s.button} onPress={addRow} disabled={rows.length >= MAX_TASKS}><Text style={[s.label, scaledLabel]}>Add row</Text></Pressable>
        </View>
        <View style={s.actions}>
          {['Today', 'Tomorrow', 'Custom date', 'No date'].map(label => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Set selected rows ${label.toLowerCase()}`} style={s.button} onPress={() => {
            if (label === 'Custom date') setBatchDateOpen(true);
            else applyDefault('dueString', label === 'Today' ? today() : label === 'Tomorrow' ? tomorrow() : '');
          }}><Text style={[s.label, scaledLabel]}>{label}</Text></Pressable>)}
        </View>
        {batchDateOpen && <DatePicker value={defaults.dueString} onChange={dueString => applyDefault('dueString', dueString)} onClose={() => setBatchDateOpen(false)} />}
        <View style={s.actions}>
          <Pressable accessibilityRole="button" accessibilityState={{expanded: showBatchLocation}} style={s.button} onPress={() => setShowBatchLocation(!showBatchLocation)}>
            <Text style={[s.label, scaledLabel]}>Project: {projects.find((p: any) => p.id === defaults.projectId)?.name || 'Inbox'}{defaults.sectionId ? ` / ${sections.find((section: any) => section.id === defaults.sectionId)?.name || 'Collection'}` : ''}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{expanded: showBatchPriority}} style={s.button} onPress={() => setShowBatchPriority(!showBatchPriority)}>
            <Text style={[s.label, scaledLabel]}>Priority: P{5 - defaults.priority}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{expanded: showBatchLabels}} style={s.button} onPress={() => setShowBatchLabels(!showBatchLabels)}>
            <Text style={[s.label, scaledLabel]}>Labels: {defaults.labels.length ? defaults.labels.join(', ') : 'None'}</Text>
          </Pressable>
        </View>
        {showBatchLocation && <ProjectPicker projects={projects} selectedId={defaults.projectId} sections={sections} selectedSectionId={defaults.sectionId}
          onChange={projectId => applyDefault('location', {projectId, sectionId: projectId === defaultsRef.current.projectId ? defaultsRef.current.sectionId : null})}
          onSectionChange={sectionId => applyDefault('location', {projectId: defaultsRef.current.projectId, sectionId})} />}
        {showBatchPriority && <PriorityPicker value={defaults.priority} onChange={priority => applyDefault('priority', priority)} />}
        {showBatchLabels && <TextInput style={[s.input, scaledInput]} value={defaults.labels.join(', ')} placeholder="Batch labels, separated by commas" editable={!locked}
          onChangeText={value => applyDefault('labels', value.split(',').map(label => label.trim()).filter(Boolean))} />}
        {showAiSetupHint && <View style={s.notice}>
          <Text style={[s.text, scaledText]}>Set up optional AI refinement in Settings. Nothing is sent until you choose Refine with AI.</Text>
          <View style={s.actions}>
            <Pressable style={s.button} onPress={() => nav.push('ai-settings')}><Text style={[s.label, scaledLabel]}>Set up AI</Text></Pressable>
            <Pressable style={s.button} onPress={dismissAiSetupHint}><Text style={[s.label, scaledLabel]}>Dismiss</Text></Pressable>
          </View>
        </View>}
        <View style={s.details}>
          <Text style={[s.text, scaledText]}>Optional AI refinement sends selected rows{activePreview ? ' and the handwriting image when all rows are selected' : ''} to OpenAI using your configured key. Review the structured suggestions before saving.</Text>
          <View style={s.actions}><Pressable style={s.button} disabled={busy} onPress={refine}><Text style={[s.label, scaledLabel]}>Refine with AI</Text></Pressable>
            <Pressable style={s.button} disabled={busy} onPress={() => nav.push('ai-settings')}><Text style={[s.label, scaledLabel]}>AI settings</Text></Pressable>
            {undo && <Pressable style={s.button} disabled={busy} onPress={() => {setRows(undo); setUndo(null); setStatus('Restored the rows from before AI refinement.');}}><Text style={[s.label, scaledLabel]}>Undo refinement</Text></Pressable>}
            {busy && controller.current && <Pressable style={s.button} onPress={() => cancelRefinement()}><Text style={[s.label, scaledLabel]}>Stop AI</Text></Pressable>}
          </View>
        </View>
      </View>}
      <ScrollView style={s.rowsScroll} contentContainerStyle={s.rowsContent} keyboardShouldPersistTaps="handled">
        {rows.map((row, index) => <View key={row.rowId} style={s.card}>
          <View style={s.actions}><Pressable style={s.button} onPress={() => update(index, {selected: !row.selected})} disabled={locked}><Text style={[s.label, scaledLabel]}>{row.selected ? '☑' : '□'} {index + 1}</Text></Pressable>
            <TextInput style={[s.input, scaledInput]} multiline value={row.content} onChangeText={content => edit(index, 'content', content)} editable={!locked} />
          </View>
          <Text style={[s.text, scaledText]}>{projects.find((p: any) => p.id === row.projectId)?.name || 'Inbox'}{row.sectionId ? ` / ${sections.find((section: any) => section.id === row.sectionId)?.name || 'Unavailable collection'}` : ''} · P{5 - row.priority} · {row.dueString || 'No date'}{row.labels?.length ? ` · ${row.labels.join(', ')}` : ''}</Text>
          {!locked && <View style={s.actions}>
            <Pressable style={s.button} onPress={() => setExpanded(expanded === row.rowId ? null : row.rowId)}><Text style={[s.label, scaledLabel]}>Details</Text></Pressable>
            {index < rows.length - 1 && <Pressable style={s.button} onPress={() => merge(index)}><Text style={[s.label, scaledLabel]}>Merge next</Text></Pressable>}
            <Pressable style={s.button} onPress={() => split(index)}><Text style={[s.label, scaledLabel]}>Split lines</Text></Pressable>
            <Pressable style={s.button} onPress={() => setRows(prev => prev.filter(item => item.rowId !== row.rowId))}><Text style={[s.label, scaledLabel]}>Remove</Text></Pressable>
          </View>}
          {!locked && expanded === row.rowId && <View style={s.details}>
            <Text style={[s.label, scaledLabel]}>Project and collection</Text>
            <ProjectPicker projects={projects} selectedId={row.projectId} onChange={projectId => edit(index, 'location', {projectId, sectionId: projectId === row.projectId ? row.sectionId : null})}
              sections={sections} selectedSectionId={row.sectionId} onSectionChange={sectionId => edit(index, 'location', {projectId: row.projectId, sectionId})} />
            {!!(row.overrides?.location || row.instructions?.location) && <Pressable style={s.button} onPress={() => resetField(index, 'location')}><Text style={[s.label, scaledLabel]}>Use batch project and collection</Text></Pressable>}
            <Text style={[s.label, scaledLabel]}>Priority</Text><PriorityPicker value={row.priority} onChange={priority => edit(index, 'priority', priority)} />
            {!!(row.overrides?.priority || row.instructions?.priority) && <Pressable style={s.button} onPress={() => resetField(index, 'priority')}><Text style={[s.label, scaledLabel]}>Use batch priority</Text></Pressable>}
            <View style={s.actions}><Pressable style={s.button} onPress={() => setDateRow(row.rowId)}><Text style={[s.label, scaledLabel]}>Custom date</Text></Pressable>
              <Pressable style={s.button} onPress={() => edit(index, 'dueString', today())}><Text style={[s.label, scaledLabel]}>Today</Text></Pressable>
              <Pressable style={s.button} onPress={() => edit(index, 'dueString', tomorrow())}><Text style={[s.label, scaledLabel]}>Tomorrow</Text></Pressable>
              <Pressable style={s.button} onPress={() => edit(index, 'dueString', '')}><Text style={[s.label, scaledLabel]}>No date</Text></Pressable></View>
            {!!(row.overrides?.dueString || row.instructions?.dueString) && <Pressable style={s.button} onPress={() => resetField(index, 'dueString')}><Text style={[s.label, scaledLabel]}>Use batch date</Text></Pressable>}
            {dateRow === row.rowId && <DatePicker value={row.dueString} onChange={dueString => edit(index, 'dueString', dueString)} onClose={() => setDateRow(null)} />}
            <TextInput style={[s.input, scaledInput]} value={row.description} placeholder="Description" multiline onChangeText={description => edit(index, 'description', description)} />
            <TextInput style={[s.input, scaledInput]} value={(row.labels || []).join(', ')} placeholder="Labels, separated by commas" onChangeText={labels => edit(index, 'labels', labels.split(',').map((value: string) => value.trim()).filter(Boolean))} />
            {!!(row.overrides?.labels || row.instructions?.labels) && <Pressable style={s.button} onPress={() => resetField(index, 'labels')}><Text style={[s.label, scaledLabel]}>Use batch labels</Text></Pressable>}
          </View>}
        </View>)}
      </ScrollView>
    </>}
    {saved && postCreateAction !== 'auto-back' && <ScrollView style={s.rowsScroll} contentContainerStyle={s.rowsContent}>
      <Text style={[s.text, scaledText]}>Saved on this device. These tasks are pending sync.</Text>
      {createdTasks.map((task, index) => <Pressable key={task.id || index} accessibilityRole="button" accessibilityLabel={`Open task ${task.content}`} style={s.createdTask}
        onPress={() => nav.push('task-detail', {task, projects})}><Text style={[s.taskTitle, scaledTaskTitle]}>{task.content}</Text><Text style={[s.text, scaledText]}>Open task details</Text></Pressable>)}
      <View style={s.actions}><Pressable style={s.primary} onPress={goBack}><Text style={[s.primaryText, scaledPrimary]}>Done</Text></Pressable>
        <Pressable style={s.button} onPress={addAnother}><Text style={[s.label, scaledLabel]}>Add another</Text></Pressable></View>
    </ScrollView>}
    {!!status && <Text style={[s.status, scaledStatus]}>{status}</Text>}
    {!saved && <View style={s.footer}>
      {!attempted && <Pressable style={s.primary} disabled={busy || !configLoaded} onPress={save}><Text style={[s.primaryText, scaledPrimary]}>{`Save ${selected.length} task${selected.length === 1 ? '' : 's'}`}</Text></Pressable>}
      {attempted && !saved && <Pressable style={s.primary} disabled={busy || !configLoaded} onPress={save}><Text style={[s.primaryText, scaledPrimary]}>Retry same batch</Text></Pressable>}
      <Pressable style={s.button} disabled={busy} onPress={() => nav.resetTo('task-home')}><Text style={[s.label, scaledLabel]}>Tasks</Text></Pressable>
    </View>}
  </View>;
}

const s = StyleSheet.create({page: {flex: 1, backgroundColor: '#fff'}, header: {padding: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1},
  intro: {paddingHorizontal: 16, paddingTop: 12, gap: 8}, controls: {paddingHorizontal: 16, paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: '#000'},
  rowsScroll: {flex: 1}, rowsContent: {padding: 16, gap: 16}, title: {flexShrink: 1, fontWeight: '700', color: '#000'}, text: {color: '#000'},
  label: {color: '#000'}, actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center'},
  button: {padding: 12, borderWidth: 1, borderColor: '#000'}, card: {padding: 12, borderWidth: 1, borderColor: '#000', gap: 12},
  createdTask: {padding: 14, borderWidth: 1, borderColor: '#000', gap: 6}, taskTitle: {fontWeight: '700', color: '#000'},
  input: {flexGrow: 1, minWidth: 180, minHeight: 44, padding: 12, borderWidth: 1, color: '#000', textAlignVertical: 'top'},
  details: {gap: 12}, status: {paddingHorizontal: 16, paddingVertical: 8, color: '#000', fontWeight: '600'}, footer: {padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1},
  notice: {padding: 10, gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#000'},
  primary: {padding: 14, backgroundColor: '#000'}, primaryText: {color: '#fff', fontWeight: '700'}});
