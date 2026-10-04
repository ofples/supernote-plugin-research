import React from 'react';
import {View, Text, TextInput, Pressable, StyleSheet} from 'react-native';

export type AISettingsFieldsProps = {
  apiKey: string;
  model: string;
  status?: string;
  saving?: boolean;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSave: () => void | Promise<void>;
};

/** Shared AI credential/model controls. Storage and request ownership stay with the parent screen. */
export default function AISettingsFields({apiKey, model, status = '', saving = false, onApiKeyChange, onModelChange, onSave}: AISettingsFieldsProps) {
  return <View style={s.fields}>
    <Text style={s.heading}>AI refinement</Text>
    <Text style={s.body}>Optional. Native handwriting recognition and offline saving work without AI.</Text>
    <Text style={s.body}>“Refine with AI” sends the reviewed task text and, when all rows are selected, the selected handwriting image to OpenAI. It uses your API account and may incur a charge. No request is made automatically.</Text>
    <Text style={s.label}>OpenAI API key</Text>
    <TextInput accessibilityLabel="OpenAI API key" style={s.input} value={apiKey} onChangeText={onApiKeyChange} secureTextEntry
      autoCapitalize="none" autoCorrect={false} editable={!saving} placeholder="sk-…" />
    <Text style={s.body}>Stored in SuperTask’s private device folder. Clearing this field disables AI. InkToClipboard has its own settings.</Text>
    <Text style={s.label}>Model</Text>
    <TextInput accessibilityLabel="AI model" style={s.input} value={model} onChangeText={onModelChange}
      autoCapitalize="none" autoCorrect={false} editable={!saving} />
    <Text style={s.body}>Use a vision model with structured output support. Default: gpt-4.1-mini.</Text>
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
  button: {alignSelf: 'flex-start', borderWidth: 1, borderColor: '#000000', padding: 14},
  disabled: {opacity: 0.5},
});
