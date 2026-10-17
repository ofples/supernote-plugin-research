import React, {useState} from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {KeyboardAwareTextInput} from './KeyboardAvoidance';
const {DEFAULT_AI_MODELS, addAIModel, normalizeAIModels, removeAIModel} = require('../utils/aiModels');

export type AISettingsFieldsProps = {
  apiKey: string;
  model: string;
  models: string[];
  status?: string;
  saving?: boolean;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => boolean | void | Promise<boolean | void>;
  onModelsChange: (value: string[], selectedModel?: string) => boolean | void | Promise<boolean | void>;
  onSave: () => void | Promise<void>;
};

/** Shared AI credential/model controls. Storage and request ownership stay with the parent screen. */
export default function AISettingsFields({apiKey, model, models, status = '', saving = false, onApiKeyChange, onModelChange, onModelsChange, onSave}: AISettingsFieldsProps) {
  const [expanded, setExpanded] = useState(false);
  const [newModel, setNewModel] = useState('');
  const options = normalizeAIModels(models, model);
  const addModel = async () => {
    const value = newModel.trim();
    if (!value) return;
    const saved = await onModelsChange(addAIModel(options, value), value);
    if (saved !== false) {setNewModel(''); setExpanded(false);}
  };
  const removeModel = async (value: string) => {
    let next = removeAIModel(options, value);
    let selected: string | undefined;
    if (model === value) {
      if (!next.length) next = [DEFAULT_AI_MODELS[0]];
      selected = next[0];
    }
    await onModelsChange(next, selected);
  };
  const selectModel = async (value: string) => {
    try {await onModelChange(value);}
    finally {setExpanded(false);}
  };
  return <View style={s.fields}>
    <Text style={s.heading}>AI refinement</Text>
    <Text style={s.body}>Optional. Native handwriting recognition and offline saving work without AI.</Text>
    <Text style={s.body}>AI refinement sends the selected handwriting image and task details to OpenAI using your API account. Automatic requests happen only when AI by default is enabled for lasso capture.</Text>
    <Text style={s.label}>OpenAI API key</Text>
    <KeyboardAwareTextInput accessibilityLabel="OpenAI API key" style={s.input} value={apiKey} onChangeText={onApiKeyChange} secureTextEntry
      autoCapitalize="none" autoCorrect={false} editable={!saving} placeholder="sk-…" />
    <Text style={s.body}>Stored in SuperTask’s private device folder. Clearing this field disables AI. InkToClipboard has its own settings.</Text>
    <Text style={s.label}>Model</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Selected AI model ${model}. ${expanded ? 'Hide' : 'Show'} model list`} disabled={saving}
      style={s.input} onPress={() => setExpanded(value => !value)}>
      <Text style={s.modelText}>{model}  {expanded ? '▲' : '▼'}</Text>
    </Pressable>
    {expanded && <View style={s.modelList}>
      {options.map((value: string) => <View key={value} style={s.modelRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Select model ${value}`} disabled={saving} style={s.modelSelect} onPress={() => selectModel(value)}>
          <Text style={[s.modelText, value === model && s.selected]}>{value}{value === model ? '  ✓' : ''}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove model ${value}`} disabled={saving} style={s.removeButton} onPress={() => removeModel(value)}>
          <Text style={s.label}>Remove</Text>
        </Pressable>
      </View>)}
      <Text style={s.label}>Add model ID</Text>
      <KeyboardAwareTextInput accessibilityLabel="New AI model ID" style={s.input} value={newModel} onChangeText={setNewModel}
        autoCapitalize="none" autoCorrect={false} editable={!saving} placeholder="Model ID" />
      <Pressable accessibilityRole="button" accessibilityLabel="Add AI model" style={s.button} disabled={saving || !newModel.trim()} onPress={addModel}>
        <Text style={s.label}>Add model</Text>
      </Pressable>
    </View>}
    <Text style={s.body}>Examples: gpt-4.1-mini, gpt-4.1, gpt-4o-mini. You can add any model ID supported by your API account.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Save AI settings" accessibilityState={{disabled: saving}}
      style={[s.button, saving && s.disabled]} disabled={saving} onPress={onSave}>
      <Text style={s.label}>{saving ? 'Saving…' : 'Save settings'}</Text>
    </Pressable>
    {!!status && <Text accessibilityLiveRegion="polite" style={s.body}>{status}</Text>}
  </View>;
}

const s = StyleSheet.create({
  fields: {gap: 16},
  heading: {fontSize: 26, fontWeight: '700', color: '#000000'},
  body: {fontSize: 16, color: '#000000', lineHeight: 24},
  label: {fontSize: 17, fontWeight: '600', color: '#000000'},
  input: {minHeight: 44, borderWidth: 1, borderColor: '#000000', padding: 12, fontSize: 18, color: '#000000'},
  modelText: {fontSize: 17, color: '#000000'},
  modelList: {gap: 8},
  modelRow: {minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#000000'},
  modelSelect: {flex: 1, padding: 10},
  selected: {fontWeight: '700'},
  removeButton: {padding: 10, borderLeftWidth: 1, borderColor: '#000000'},
  button: {alignSelf: 'flex-start', borderWidth: 1, borderColor: '#000000', padding: 14},
  disabled: {opacity: 0.5},
});
