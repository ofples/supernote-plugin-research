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
const {fromText, mergeNext, splitRow, MAX_TASKS} = require('../batch/model');
const {localDate} = require('../offline/model');
type Props = {nav: any; initialContent?: string; initialDescription?: string; projects: any[];
  defaultProjectId?: string; defaultSectionId?: string; noteContext?: any; capturedAt?: number; preview?: string};
export default function BatchAdd({nav, initialContent = '', initialDescription = '', projects: initialProjects,
  defaultProjectId, defaultSectionId, noteContext, capturedAt = Date.now(), preview}: Props) {
  const {projects, sections} = useLocations(initialProjects);
  const nextId = useRef(0);
  const decorate = (values: any[]) => values.map(row => ({...row, rowId: ++nextId.current}));
  const [rows, setRows] = useState<any[]>(() => decorate(fromText(initialContent, {projectId: defaultProjectId || null, sectionId: defaultSectionId || null, description: initialDescription})));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dateRow, setDateRow] = useState<number | null>(null);
  const [undo, setUndo] = useState<any[] | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const request = useRef({});
  const captureTime = useRef(capturedAt).current;
  const selected = rows.filter(row => row.selected);
  const locked = busy || attempted || saved;
  useEffect(() => {
    const sub = PluginManager.registerPluginLifeListener({onMsg: (message: any) => {
      if (message.state >= 3) controller.current?.abort();
    }});
    return () => {alive.current = false; controller.current?.abort(); sub?.remove();};
  }, []);
  const update = (index: number, values: any) => setRows(prev => prev.map((row, i) => i === index ? {...row, ...values} : row));
  const safely = (action: () => any[]) => {
    try {setRows(action()); setStatus('');} catch (error: any) {setStatus(error.message);}
  };
  const refine = async () => {
    if (working.current || attempted || saved) return;
    if (!selected.length) {setStatus('Select at least one row to refine.'); return;}
    const previous = rows;
    const abort = new AbortController();
    controller.current = abort; working.current = true; setBusy(true);
    setStatus('Refining with OpenAI… Original rows are kept until a valid result arrives.');
    const timer = setTimeout(() => abort.abort(), 90000);
    try {
      // Sending the complete crop could reintroduce deselected writing. Text-only
      // refinement is used when any row is excluded.
      const proposals = await refineBatch(selected, projects, captureTime,
        selected.length === rows.length ? preview : undefined, abort.signal, sections);
      if (!alive.current || abort.signal.aborted) return;
      setUndo(previous);
      setRows(decorate([...proposals, ...previous.filter(row => !row.selected)]));
      setStatus('AI suggestions ready. Check titles, dates and projects before saving.');
    } catch (error: any) {
      if (alive.current) setStatus(abort.signal.aborted ? 'AI refinement stopped. Original rows were kept.' : refinementError(error));
    } finally {
      clearTimeout(timer); controller.current = null; working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const save = async () => {
    if (working.current || saved) return;
    if (!selected.length || selected.some(row => !row.content.trim())) {setStatus('Select at least one task; every selected title must be filled in.'); return;}
    working.current = true; setBusy(true); setAttempted(true); setStatus('Saving the batch on this device…');
    try {
      const result = await saveOfflineBatch(selected, noteContext, captureTime, request.current);
      if (alive.current) {setSaved(true); setStatus(`Saved ${result.length} task${result.length === 1 ? '' : 's'} on this device. Sync starts while SuperTask is open and resumes next time you open it.`);}
    } catch (error: any) {
      if (alive.current) setStatus(`${error.message} Retry keeps the same task identities. Open Tasks to inspect any saved work.`);
    } finally {working.current = false; if (alive.current) setBusy(false);}
  };
  return <View style={s.page}>
    <View style={s.header}><Text style={s.title}>Review tasks</Text>
      <Pressable style={s.button} onPress={() => {controller.current?.abort(); closePlugin();}} disabled={busy && !controller.current}><Text style={s.label}>{saved ? 'Close' : 'Cancel'}</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.text}>One task per row. Edit recognition, merge wrapped lines, or insert line breaks and split. Handwriting remains unchanged.</Text>
      <Text style={s.text}>Captured {localDate(new Date(captureTime))}. {selected.length} of {rows.length} selected.</Text>
      {!locked && <View style={s.actions}>
        <Pressable style={s.button} onPress={() => setRows(prev => prev.map(row => ({...row, selected: true})))}><Text style={s.label}>Select all</Text></Pressable>
        <Pressable style={s.button} onPress={() => setRows(prev => prev.map(row => ({...row, selected: false})))}><Text style={s.label}>Select none</Text></Pressable>
        <Pressable style={s.button} onPress={() => {if (rows.length < MAX_TASKS) setRows(prev => [...prev, ...decorate(fromText('New task', {projectId: defaultProjectId || null, sectionId: defaultSectionId || null}))]);}}><Text style={s.label}>Add row</Text></Pressable>
      </View>}
      {rows.map((row, index) => <View key={row.rowId} style={s.card}>
        <View style={s.actions}><Pressable style={s.button} disabled={locked} onPress={() => update(index, {selected: !row.selected})}><Text style={s.label}>{row.selected ? '☑' : '□'} {index + 1}</Text></Pressable>
          <TextInput style={s.input} multiline value={row.content} onChangeText={content => update(index, {content})} editable={!locked} />
        </View>
        <Text style={s.text}>{projects.find((p: any) => p.id === row.projectId)?.name || 'Inbox'}{row.sectionId ? ` / ${sections.find((section: any) => section.id === row.sectionId)?.name || 'Unavailable collection'}` : ''} · P{5 - row.priority} · {row.dueString || 'No date'}{row.labels?.length ? ` · ${row.labels.join(', ')}` : ''}</Text>
        {!locked && <View style={s.actions}>
          <Pressable style={s.button} onPress={() => setExpanded(expanded === row.rowId ? null : row.rowId)}><Text style={s.label}>Details</Text></Pressable>
          {index < rows.length - 1 && <Pressable style={s.button} onPress={() => safely(() => mergeNext(rows, index))}><Text style={s.label}>Merge next</Text></Pressable>}
          <Pressable style={s.button} onPress={() => safely(() => decorate(splitRow(rows, index)))}><Text style={s.label}>Split lines</Text></Pressable>
          <Pressable style={s.button} onPress={() => setRows(prev => prev.filter(item => item.rowId !== row.rowId))}><Text style={s.label}>Remove</Text></Pressable>
        </View>}
        {!locked && expanded === row.rowId && <View style={s.details}>
          <Text style={s.label}>Project and collection</Text>
          <ProjectPicker projects={projects} selectedId={row.projectId} onChange={projectId => update(index, {projectId, sectionId: projectId === row.projectId ? row.sectionId : null})}
            sections={sections} selectedSectionId={row.sectionId} onSectionChange={sectionId => update(index, {sectionId})} />
          <PriorityPicker value={row.priority} onChange={priority => update(index, {priority})} />
          <View style={s.actions}><Pressable style={s.button} onPress={() => setDateRow(row.rowId)}><Text style={s.label}>Date</Text></Pressable>
            <Pressable style={s.button} onPress={() => update(index, {dueString: localDate(new Date(captureTime))})}><Text style={s.label}>Captured today</Text></Pressable>
            <Pressable style={s.button} onPress={() => update(index, {dueString: ''})}><Text style={s.label}>No date</Text></Pressable></View>
          {dateRow === row.rowId && <DatePicker value={row.dueString} onChange={dueString => update(index, {dueString})} onClose={() => setDateRow(null)} />}
          <TextInput style={s.input} value={row.description} placeholder="Description" multiline onChangeText={description => update(index, {description})} />
          <TextInput style={s.input} value={(row.labels || []).join(', ')} placeholder="Labels, separated by commas" onChangeText={labels => update(index, {labels: labels.split(',').map(value => value.trim()).filter(Boolean)})} />
        </View>}
      </View>)}
      {!saved && !attempted && <View style={s.details}>
        <Text style={s.text}>Optional AI refinement sends selected rows{preview ? ' and the handwriting image when all rows are selected' : ''} to OpenAI using your configured key. Review the structured suggestions before saving.</Text>
        <View style={s.actions}><Pressable style={s.button} disabled={busy} onPress={refine}><Text style={s.label}>Refine with AI</Text></Pressable>
          <Pressable style={s.button} disabled={busy} onPress={() => nav.push('ai-settings')}><Text style={s.label}>AI settings</Text></Pressable>
          {undo && <Pressable style={s.button} disabled={busy} onPress={() => {setRows(undo); setUndo(null); setStatus('Restored the rows from before AI refinement.');}}><Text style={s.label}>Undo refinement</Text></Pressable>}
          {busy && controller.current && <Pressable style={s.button} onPress={() => controller.current?.abort()}><Text style={s.label}>Stop AI</Text></Pressable>}
        </View>
      </View>}
      {!!status && <Text style={s.status}>{status}</Text>}
      <View style={s.actions}>{!saved && <Pressable style={s.primary} disabled={busy} onPress={save}><Text style={s.primaryText}>{attempted ? 'Retry same batch' : `Save ${selected.length} task${selected.length === 1 ? '' : 's'}`}</Text></Pressable>}
        <Pressable style={s.button} disabled={busy} onPress={() => nav.resetTo('task-home')}><Text style={s.label}>Tasks</Text></Pressable>
      </View>
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({page: {flex: 1, backgroundColor: '#fff'}, header: {padding: 16, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1},
  content: {padding: 16, gap: 16}, title: {fontSize: 24, fontWeight: '700', color: '#000'}, text: {fontSize: 15, color: '#000', lineHeight: 22},
  label: {fontSize: 16, color: '#000'}, actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center'},
  button: {padding: 12, borderWidth: 1, borderColor: '#000'}, card: {padding: 12, borderWidth: 1, borderColor: '#000', gap: 12},
  input: {flexGrow: 1, minWidth: 180, padding: 12, borderWidth: 1, fontSize: 18, color: '#000', textAlignVertical: 'top'},
  details: {gap: 12}, status: {fontSize: 17, color: '#000', fontWeight: '600'}, primary: {padding: 14, backgroundColor: '#000'},
  primaryText: {fontSize: 17, color: '#fff', fontWeight: '700'}});
