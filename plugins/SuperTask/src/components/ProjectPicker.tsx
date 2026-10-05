/** Compact project and selected-project collection controls for task forms. */

import React, {useEffect, useRef, useState} from 'react';
import {View, Text, TextInput, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';
const {projectSections} = require('../collections/model');

type Project = {id: string; name: string};
type Section = {id: string; name: string; project_id: string; localId?: string};
type Props = {
  projects: Project[];
  selectedId: string | null;
  onChange: (projectId: string | null) => void;
  sections?: Section[];
  selectedSectionId?: string | null;
  onSectionChange?: (sectionId: string | null) => void;
  onCreateCollection?: (projectId: string, name: string) => Promise<any>;
  requireExplicit?: boolean;
};

export default function ProjectPicker({projects, selectedId, onChange, sections = [], selectedSectionId = null, onSectionChange, onCreateCollection, requireExplicit = false}: Props) {
  const scale = useFontScale();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const savingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  if (!projects.length) return null;
  const inbox = projects.find((p: any) => p.inbox_project || p.is_inbox_project);
  const effectiveId = selectedId || (requireExplicit ? null : inbox?.id);
  const selectedProject = projects.find(p => p.id === effectiveId);
  const collections: Section[] = selectedProject ? projectSections(sections, selectedProject.id) : [];

  const beginCreate = () => { setCreating(true); setName(''); setError(''); };
  const cancelCreate = () => { if (savingRef.current) return; setCreating(false); setName(''); setError(''); };
  const saveCollection = async () => {
    const cleanName = name.trim();
    if (!selectedProject || !cleanName || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      let create = onCreateCollection;
      if (!create) {
        const service = await import('../offline/service') as unknown as {
          createOfflineCollection: (projectId: string, collectionName: string) => Promise<Section>;
        };
        create = service.createOfflineCollection;
      }
      const section = await create(selectedProject.id, cleanName);
      if (!section || !section.id || section.project_id !== selectedProject.id) {
        throw new Error('Collection could not be confirmed.');
      }
      if (mounted.current) {
        onChange(selectedProject.id);
        onSectionChange?.(section.id);
        setCreating(false);
        setName('');
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save collection.');
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      {selectedId && !projects.some(p => p.id === selectedId) && <Text style={[styles.text, {fontSize: Math.round(14 * scale)}]}>Selected project is unavailable. Choose a project below.</Text>}
      <View style={styles.row} accessibilityLabel="Projects">
        {projects.map(p => {
          const selected = effectiveId === p.id;
          return <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`Choose project ${p.name}`}
            accessibilityState={{selected}}
            style={[styles.choice, selected && styles.choiceSelected]}
            disabled={saving} onPress={() => onChange(p.id)}>
            <Text style={[styles.text, {fontSize: Math.round(14 * scale)}, selected && styles.textSelected]}>{p.name}</Text>
          </Pressable>;
        })}
      </View>

      {!!selectedProject && !!onSectionChange && <View style={styles.collections}>
        {collections.length > 0 && <View style={styles.row} accessibilityLabel="Collections">
          {[{id: null, name: 'No collection'}, ...collections].map((section: any) => {
            const selected = selectedSectionId === section.id || (!!selectedSectionId && selectedSectionId === section.localId);
            return <Pressable key={section.id || 'none'} accessibilityRole="button"
              accessibilityLabel={`Choose collection ${section.name}`} accessibilityState={{selected}}
              style={[styles.choice, selected && styles.choiceSelected]}
              onPress={() => {onChange(selectedProject.id); onSectionChange(section.id);}}>
              <Text style={[styles.text, {fontSize: Math.round(14 * scale)}, selected && styles.textSelected]}>{section.name}</Text>
            </Pressable>;
          })}
        </View>}
        {!!selectedSectionId && !collections.some(section => section.id === selectedSectionId || section.localId === selectedSectionId) && <View>
          <Text style={[styles.text, {fontSize: Math.round(14 * scale)}]}>Selected collection is unavailable.</Text>
          <Pressable style={styles.action} onPress={() => onSectionChange(null)} accessibilityLabel="Clear unavailable collection"><Text style={styles.text}>No collection</Text></Pressable>
        </View>}
        {!creating ? <Pressable accessibilityRole="button" accessibilityLabel={`New collection in ${selectedProject.name}`} style={styles.action} onPress={beginCreate}>
          <Text style={[styles.text, {fontSize: Math.round(14 * scale)}]}>New collection</Text>
        </Pressable> : <View style={styles.createForm}>
          <View style={styles.inputRow}><TextInput accessibilityLabel="New collection name" style={[styles.input, {fontSize: Math.round(15 * scale)}]} value={name}
            onChangeText={value => {setName(value); setError('');}} editable={!saving} autoCorrect={false} returnKeyType="done"
            onSubmitEditing={saveCollection} />
          <View style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityLabel="Save new collection" accessibilityState={{disabled: saving || !name.trim()}}
              style={[styles.action, (saving || !name.trim()) && styles.disabled]} disabled={saving || !name.trim()} onPress={saveCollection}>
              <Text style={[styles.text, {fontSize: Math.round(14 * scale)}]}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel new collection" style={styles.action} disabled={saving} onPress={cancelCreate}>
              <Text style={[styles.text, {fontSize: Math.round(14 * scale)}]}>Cancel</Text>
            </Pressable>
          </View>
          </View>
          {!!error && <Text accessibilityRole="alert" style={[styles.text, styles.error]}>{error}</Text>}
        </View>}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {gap: 10},
  collections: {paddingTop: 2, gap: 8},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  choice: {paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#000000', borderRadius: 0},
  choiceSelected: {backgroundColor: '#000000'},
  action: {alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: '#000000', borderRadius: 0},
  disabled: {opacity: 0.5},
  createForm: {gap: 8},
  inputRow: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  input: {flex: 1, minWidth: 80, minHeight: 44, borderWidth: 1, borderColor: '#000000', borderRadius: 0, paddingHorizontal: 10, paddingVertical: 8, color: '#000000'},
  text: {fontSize: 14, color: '#000000'},
  textSelected: {color: '#ffffff', fontWeight: '700'},
  error: {fontWeight: '600'},
});
