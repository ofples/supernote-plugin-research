import React, {useEffect, useState} from 'react';
import {View, Text, TextInput, Pressable, ScrollView, StyleSheet} from 'react-native';
import {loadConfig, saveConfig} from '../utils/config';
export default function AISettings({nav}: {nav: any}) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState('gpt-4.1-mini');
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { let alive = true;
    loadConfig().then(config => { if (alive) {setKey(config.aiApiKey || ''); setModel(config.aiModel || 'gpt-4.1-mini'); setReady(true);} })
      .catch(() => {if (alive) setStatus('Private settings could not be opened.');});
    return () => {alive = false;};
  }, []);
  const save = async () => {
    setSaving(true);
    const ok = await saveConfig({aiApiKey: key.trim(), aiModel: model.trim() || 'gpt-4.1-mini'});
    setStatus(ok ? 'Saved privately on this device.' : 'Could not save settings.');
    setSaving(false);
  };
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Text style={s.title}>AI refinement</Text>
    <Text style={s.text}>Optional. Native handwriting recognition and offline saving work without AI.</Text>
    <Text style={s.text}>“Refine with AI” sends the reviewed task text and, when all rows are selected, the selected handwriting image to OpenAI. It uses your API account and may incur a charge. No request is made automatically.</Text>
    <Text style={s.label}>OpenAI API key</Text>
    <TextInput style={s.input} value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={ready && !saving} placeholder="sk-…" />
    <Text style={s.text}>Stored in SuperTask’s private device folder. Clearing this field disables AI. InkToClipboard has its own settings.</Text>
    <Text style={s.label}>Model</Text>
    <TextInput style={s.input} value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} editable={ready && !saving} />
    <Text style={s.text}>Use a vision model with structured output support. Default: gpt-4.1-mini.</Text>
    <View style={s.row}>
      <Pressable style={s.button} onPress={save} disabled={!ready || saving}><Text style={s.label}>{saving ? 'Saving…' : 'Save settings'}</Text></Pressable>
      <Pressable style={s.button} onPress={() => nav.canGoBack ? nav.pop() : nav.resetTo('config')} disabled={saving}><Text style={s.label}>Back</Text></Pressable>
    </View>
    {!!status && <Text style={s.text}>{status}</Text>}
  </ScrollView>;
}
const s = StyleSheet.create({page: {flex: 1, backgroundColor: '#fff'}, content: {padding: 24, gap: 16},
  title: {fontSize: 26, fontWeight: '700', color: '#000'}, text: {fontSize: 16, color: '#000', lineHeight: 24},
  label: {fontSize: 17, fontWeight: '600', color: '#000'}, input: {borderWidth: 1, borderColor: '#000', padding: 12, fontSize: 18, color: '#000'},
  row: {flexDirection: 'row', gap: 12}, button: {borderWidth: 1, borderColor: '#000', padding: 14}});
