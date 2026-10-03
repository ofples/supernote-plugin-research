/** Capture is read-only; native elements are recycled before review. */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {PluginCommAPI, PluginDocAPI, PluginManager} from 'sn-plugin-lib';
import {closePlugin} from '../utils/closePlugin';
import {loadConfig} from '../utils/config';
import {getProjects} from '../api/todoist';
import {recognizeLassoElements, recycleElements} from '../utils/ocr';
import {capturePreview} from '../batch/preview';
function withTimeout<T>(promise: Promise<T>, ms: number, onLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {timedOut = true; reject(new Error('Recognition timed out. Select a smaller passage and try again.'));}, ms);
    promise.then(value => {clearTimeout(timer); if (timedOut) onLate?.(value); else resolve(value);}, error => {clearTimeout(timer); reject(error);});
  });
}
export default function Capture({mode, nav}: {mode: 'lasso' | 'doc'; nav: any}) {
  const [status, setStatus] = useState('Recognizing selection…');
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  const run = useRef(0);
  const start = useCallback(async () => {
    const generation = ++run.current;
    const capturedAt = Date.now();
    setFailed(false); setStatus('Recognizing selection…');
    let elements: any[] = [];
    const current = () => alive.current && generation === run.current;
    try {
      const config = await loadConfig();
      if (!current()) return;
      const projectsPromise = getProjects().catch(() => []);
      let content = '';
      let noteContext: any;
      let preview: string | undefined;
      if (mode === 'lasso') {
        const result: any = await withTimeout(PluginCommAPI.getLassoElements(), 10000,
          (late: any) => recycleElements(late?.result || []));
        elements = result?.result || [];
        if (!current()) return;
        if (!result?.success || !elements.length) throw new Error('Lasso some handwriting first.');
        // OCR has its own bounded SDK calls. Keep elements alive until all of
        // its native access has finished, including after the view closes.
        const recognized: any = await recognizeLassoElements(elements, () => {});
        if (!current()) return;
        if (!recognized.success || !recognized.text?.trim()) throw new Error('Could not recognize the selection. Try clearer text.');
        content = recognized.text;
        const rect: any = await withTimeout(PluginCommAPI.getLassoRect(), 3000).catch(() => null);
        if (!current()) return;
        noteContext = {filePath: recognized.pageContext.filePath, pageNum: recognized.pageContext.pageNum,
          bounds: rect?.success ? rect.result : null};
        preview = await withTimeout(capturePreview(), 8000).catch(() => undefined);
      } else {
        const result: any = await withTimeout(PluginDocAPI.getLastSelectedText(), 5000);
        if (!result?.success || !result.result?.trim()) throw new Error('Select text in the document first.');
        content = result.result.trim();
      }
      const projects = await projectsPromise;
      if (!alive.current || generation !== run.current) return;
      nav.resetTo(mode === 'lasso' ? 'task-batch' : 'task-add', {projects,
        defaultProjectId: projects.some((project: any) => project.id === config.defaultProjectId) ? config.defaultProjectId : null,
        initialContent: content,
        noteContext, capturedAt, preview, captureMode: mode});
    } catch (error: any) {
      if (alive.current && generation === run.current) {setFailed(true); setStatus(error.message);}
    } finally {recycleElements(elements);}
  }, [mode, nav]);
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    startRef.current();
    const invalidate = () => {++run.current;};
    const sub = PluginManager.registerPluginLifeListener({onMsg: (message: any) => {
      if (message.state >= 3) {invalidate(); if (alive.current) {setFailed(true); setStatus('Capture was interrupted. Select your handwriting again and retry.');}}
    }});
    return () => {alive.current = false; invalidate(); sub?.remove();};
  }, []);
  return <View style={s.page}><Text style={s.title}>{failed ? 'Capture needs attention' : 'Capture'}</Text>
    <Text style={s.text}>{status}</Text><Text style={s.text}>Your note is unchanged.</Text>
    <View style={s.actions}>{failed && <Pressable style={s.button} onPress={start}><Text style={s.text}>Retry</Text></Pressable>}
      {failed && <Pressable style={s.button} onPress={() => nav.resetTo('task-batch', {projects: [], initialContent: ''})}><Text style={s.text}>Enter tasks manually</Text></Pressable>}
      <Pressable style={s.button} onPress={() => {++run.current; closePlugin();}}><Text style={s.text}>Cancel</Text></Pressable></View>
  </View>;
}
const s = StyleSheet.create({page: {flex: 1, padding: 24, backgroundColor: '#fff', gap: 20},
  title: {fontSize: 24, fontWeight: '700', color: '#000'}, text: {fontSize: 18, color: '#000', lineHeight: 26},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 12}, button: {padding: 14, borderWidth: 1, borderColor: '#000'}});
