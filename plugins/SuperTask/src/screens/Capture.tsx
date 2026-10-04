/** Capture never modifies the note. Native OCR remains the fallback. */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {PluginCommAPI, PluginDocAPI, PluginManager} from 'sn-plugin-lib';
import {closePlugin} from '../utils/closePlugin';
import {loadConfig, saveConfig} from '../utils/config';
import {getProjects} from '../api/todoist';
import {offlineData} from '../offline/service';
import {recognizeLassoElements, recycleElements} from '../utils/ocr';
import {capturePreview} from '../batch/preview';
import {refineBatch, refinementError} from '../batch/refine';
const {captureChoice} = require('../batch/captureChoice');
function bounded<T>(promise: Promise<T>, ms: number, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {expired = true; reject(new Error('Capture timed out. Try a smaller selection.'));}, ms);
    promise.then(value => {clearTimeout(timer); if (expired) late?.(value); else resolve(value);}, error => {clearTimeout(timer); reject(error);});
  });
}
export default function Capture({mode, nav}: {mode: 'lasso' | 'doc'; nav: any}) {
  const [status, setStatus] = useState('Recognizing selection…');
  const [failed, setFailed] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [showAIHint, setShowAIHint] = useState(false);
  const [aiBusy, setAIBusy] = useState(false);
  const alive = useRef(true), run = useRef(0);
  const choice = useRef<any>(null), input = useRef<Promise<any> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const stopAI = () => {controller.current?.abort(); controller.current = null; setAIBusy(false); choice.current?.useOCR();};
  const start = useCallback(async () => {
    const generation = ++run.current, capturedAt = Date.now();
    controller.current?.abort(); choice.current?.close();
    setFailed(false); setAIBusy(false); setStatus('Recognizing selection…');
    const current = () => alive.current && generation === run.current;
    try {
      const config = await loadConfig();
      if (!current()) return;
      setHasKey(!!config.aiApiKey?.trim());
      setShowAIHint(!config.aiApiKey?.trim() && !config.aiSetupHintDismissed);
      const projectsPromise = bounded(getProjects(), 8000).catch(() => []);
      if (mode === 'doc') {
        const result: any = await bounded(PluginDocAPI.getLastSelectedText(), 5000);
        const projects = await projectsPromise;
        if (!current()) return;
        if (!result?.success || !result.result?.trim()) throw new Error('Select text in the document first.');
        nav.resetTo('task-add', {projects, initialContent: result.result.trim(), captureMode: mode,
          defaultProjectId: config.defaultProjectId, defaultSectionId: config.defaultSectionId});
        return;
      }
      // Preview and context do not wait for OCR. An AI request can use the image
      // while the device recognizer is still working on the native elements.
      input.current = Promise.all([projectsPromise, bounded(offlineData(), 8000).catch(() => ({sections: []})),
        bounded(capturePreview(), 8000).catch(() => undefined),
        bounded(PluginCommAPI.getCurrentFilePath(), 3000).catch(() => null),
        bounded(PluginCommAPI.getCurrentPageNum(), 3000).catch(() => null),
        bounded(PluginCommAPI.getLassoRect(), 3000).catch(() => null),
      ]).then(([projects, data, preview, path, page, rect]: any[]) => ({projects, sections: data.sections || [], preview,
        capturedAt, noteContext: path?.result ? {filePath: path.result, pageNum: page?.result ?? 0,
          bounds: rect?.success ? rect.result : null} : undefined,
        defaultProjectId: projects.some((p: any) => p.id === config.defaultProjectId) ? config.defaultProjectId : null,
        defaultSectionId: config.defaultSectionId, captureMode: mode}));
      choice.current = captureChoice({
        status: (message: string) => {if (current()) {setStatus(message); setFailed(true);}},
        review: async ({kind, value}: any) => {
          try {
            const context = await input.current;
            if (current()) nav.resetTo('task-batch', {...context,
              initialContent: kind === 'ocr' ? value.text : '', initialRows: kind === 'ai' ? value : undefined});
          } catch {if (current()) {setFailed(true); setStatus('Capture context could not be opened. Retry or enter tasks manually.');}}
        },
      });
      const selected: any = await bounded(PluginCommAPI.getLassoElements(), 10000,
        late => recycleElements((late as any)?.result || []));
      const elements = selected?.result || [];
      if (!current()) {recycleElements(elements); return;}
      if (!selected?.success || !elements.length) {recycleElements(elements); throw new Error('Lasso some handwriting first.');}
      const owner = choice.current;
      let nativeSettled: Promise<void> = Promise.resolve();
      try {
        const recognized: any = await recognizeLassoElements(elements, () => {}, (promise: Promise<void>) => {nativeSettled = promise;});
        if (!current()) return;
        if (!recognized.success || !recognized.text?.trim()) owner.ocrFailed('Could not recognize the selection. Try AI or enter tasks manually.');
        else owner.ocrReady(recognized);
      } catch (error: any) {if (current()) owner.ocrFailed(error.message);}
      finally {nativeSettled.then(() => recycleElements(elements));}
    } catch (error: any) {if (current()) {setFailed(true); setStatus(error.message);}}
  }, [mode, nav]);
  const startRef = useRef(start); startRef.current = start;
  useEffect(() => {
    startRef.current();
    const sub = PluginManager.registerPluginLifeListener({onMsg: (message: any) => {
      if (message.state >= 3) {++run.current; controller.current?.abort(); choice.current?.close();
        if (alive.current) {setAIBusy(false); setFailed(true); setStatus('Capture interrupted. Select the handwriting again and retry.');}}
    }});
    return () => {alive.current = false; ++run.current; controller.current?.abort(); choice.current?.close(); sub?.remove();};
  }, []);
  const useAI = async () => {
    if (controller.current || !input.current || !choice.current) return;
    const owner = choice.current, id = owner.requestAI();
    if (id === null) return;
    const abort = new AbortController(); controller.current = abort;
    setAIBusy(true); setFailed(false); setStatus('Recognizing with AI… Device recognition continues in the background.');
    const timer = setTimeout(() => {
      abort.abort(); owner.aiFailed(id, 'AI timed out. Using device recognition…');
      if (controller.current === abort) {controller.current = null; if (alive.current) setAIBusy(false);}
    }, 90000);
    try {
      const context = await input.current;
      if (abort.signal.aborted) throw new Error('AI cancelled.');
      if (!context.preview) throw new Error('No handwriting image available.');
      const rows = await refineBatch([], context.projects, context.capturedAt, context.preview, abort.signal, context.sections);
      if (!abort.signal.aborted) owner.aiReady(id, rows);
    } catch (error: any) {
      if (alive.current) owner.aiFailed(id, abort.signal.aborted ? 'AI stopped. Using device recognition…' : refinementError(error));
    } finally {
      clearTimeout(timer);
      if (controller.current === abort) {controller.current = null; if (alive.current) setAIBusy(false);}
    }
  };
  return <View style={s.page}><Text style={s.title}>{failed ? 'Capture needs attention' : 'Capture'}</Text>
    <Text style={s.text}>{status}</Text><Text style={s.text}>Your note is unchanged.</Text>
    {showAIHint && <View style={s.actions}>
      <Pressable style={s.button} onPress={() => {controller.current?.abort(); choice.current?.close(); ++run.current; setFailed(true); setStatus('Return here and retry capture after setting up AI.'); nav.push('ai-settings');}}><Text style={s.text}>Set up optional AI</Text></Pressable>
      <Pressable style={s.button} onPress={async () => {
        try {await saveConfig({aiSetupHintDismissed: true}); if (alive.current) setShowAIHint(false);}
        catch {if (alive.current) setStatus('Could not save the dismissed hint.');}
      }}><Text style={s.text}>Dismiss hint</Text></Pressable>
    </View>}
    <View style={s.actions}>
      {mode === 'lasso' && hasKey && !aiBusy && <Pressable style={s.button} onPress={useAI}><Text style={s.text}>Recognize with AI</Text></Pressable>}
      {aiBusy && <Pressable style={s.button} onPress={stopAI}><Text style={s.text}>Cancel AI / Use device OCR</Text></Pressable>}
      {failed && <Pressable style={s.button} onPress={start}><Text style={s.text}>Retry</Text></Pressable>}
      {failed && <Pressable style={s.button} onPress={() => {choice.current?.close(); nav.resetTo('task-batch', {projects: [], initialContent: '', captureMode: mode});}}><Text style={s.text}>Enter tasks manually</Text></Pressable>}
      <Pressable style={s.button} onPress={() => {++run.current; controller.current?.abort(); choice.current?.close(); closePlugin();}}><Text style={s.text}>Cancel</Text></Pressable>
    </View></View>;
}
const s = StyleSheet.create({page: {flex: 1, padding: 24, backgroundColor: '#fff', gap: 20},
  title: {fontSize: 24, fontWeight: '700', color: '#000'}, text: {fontSize: 18, color: '#000', lineHeight: 26},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 12}, button: {padding: 14, borderWidth: 1, borderColor: '#000'}});
