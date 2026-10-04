/**
 * ProjectPicker - Project list with inline collection choices
 *
 * Collection buttons wrap without a horizontal ScrollView to keep e-ink taps reliable.
 */

import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';
const {projectSections} = require('../collections/model');

type Project = {
  id: string;
  name: string;
};

type Props = {
  projects: Project[];
  selectedId: string | null;
  onChange: (projectId: string | null) => void;
  sections?: any[];
  selectedSectionId?: string | null;
  onSectionChange?: (sectionId: string | null) => void;
};

export default function ProjectPicker({projects, selectedId, onChange, sections = [], selectedSectionId = null, onSectionChange}: Props) {
  const scale = useFontScale();
  if (!projects.length) return null;
  const inbox = projects.find((p: any) => p.inbox_project || p.is_inbox_project);
  const effectiveId = selectedId || inbox?.id;

  return (
    <View style={styles.list}>
      {selectedId && !projects.some(p => p.id === selectedId) && <Text style={styles.text}>Selected project is unavailable. Choose a project below.</Text>}
      {projects.map(p => <View key={p.id}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={`Choose project ${p.name}`} accessibilityState={{selected: effectiveId === p.id, expanded: effectiveId === p.id}}
          style={[styles.button, effectiveId === p.id && styles.selected]}
          onPress={() => onChange(p.id)}>
          <Text style={[styles.text, {fontSize: Math.round(14 * scale)}, effectiveId === p.id && styles.textSelected]}>
            {effectiveId === p.id ? '⌄ ' : '› '}{p.name}
          </Text>
        </Pressable>
        {effectiveId === p.id && onSectionChange && <View style={styles.collections}>
          <Text style={[styles.text, {fontSize: Math.round(14 * scale)}]}>Collections</Text>
          {!!selectedSectionId && !projectSections(sections, p.id).some((s: any) => s.id === selectedSectionId) && <Text style={styles.text}>Selected collection is unavailable. Choose a collection or No collection.</Text>}
          <View style={styles.row}>{[{id: null, name: 'No collection'}, ...projectSections(sections, p.id)].map((s: any) =>
            <Pressable key={s.id || 'none'} accessibilityRole="button" accessibilityLabel={`Choose collection ${s.name}`}
              accessibilityState={{selected: selectedSectionId === s.id}} style={[styles.button, selectedSectionId === s.id && styles.selected]}
              onPress={() => {onChange(p.id); onSectionChange(s.id);}}>
              <Text style={[styles.text, {fontSize: Math.round(14 * scale)}, selectedSectionId === s.id && styles.textSelected]}>{s.name}</Text>
            </Pressable>)}</View>
          {!projectSections(sections, p.id).length && <Text style={styles.text}>No collections cached for this project. Refresh Tasks while online to fetch changes.</Text>}
        </View>}
      </View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {gap: 8}, collections: {marginLeft: 24, paddingVertical: 12, gap: 8},
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
  },
  selected: {
    backgroundColor: '#000000',
  },
  text: {
    fontSize: 14,
    color: '#000000',
  },
  textSelected: {
    color: '#ffffff',
  },
});
