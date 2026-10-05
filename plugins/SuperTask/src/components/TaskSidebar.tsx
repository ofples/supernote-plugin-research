import React from 'react';
import {ScrollView, View, Text, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

type Props = {
  activeView: string;
  projects: any[];
  onViewChange: (view: string) => void;
  noteAvailable: boolean;
  counts?: Record<string, number>;
  visibleProjectIds?: string[];
};

const NAV_ITEMS = [
  {key: 'today', label: 'Today'},
  {key: 'tomorrow', label: 'Tomorrow'},
  {key: 'upcoming', label: 'Upcoming'},
  {key: 'inbox', label: 'Inbox'},
];
const LOWER_ITEMS = [
  {key: 'device', label: 'On Device'},
  {key: 'done', label: 'Done'},
];

function countLabel(value?: number) {
  return Number.isFinite(value) && Number(value) > 0 ? String(value) : null;
}

function isInboxProject(project: any) {
  return !!project && (project.is_inbox_project === true || project.inbox_project === true || project.isInbox === true || String(project.name || '').toLowerCase() === 'inbox');
}

export default function TaskSidebar({activeView, projects, onViewChange, noteAvailable, counts = {}, visibleProjectIds}: Props) {
  const scale = useFontScale();
  const visibleSet = visibleProjectIds === undefined ? null : new Set(visibleProjectIds.map(String));
  const shownProjects = (Array.isArray(projects) ? projects : []).filter(project => {
    if (!project || project.id == null || isInboxProject(project)) return false;
    return visibleSet === null || visibleSet.has(String(project.id));
  });

  const renderItem = (key: string, label: string, countKey = key) => {
    const selected = activeView === key;
    const count = countLabel(counts[countKey]);
    return (
      <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{selected}} onPress={() => onViewChange(key)}
        style={[styles.item, selected ? styles.itemSelected : styles.itemIdle]}>
        <Text numberOfLines={1} style={[styles.label, {fontSize: Math.round(16 * scale)}, selected && styles.labelSelected]}>
          {label}
        </Text>
        {count ? <Text style={[styles.count, {fontSize: Math.round(13 * scale)}, selected && styles.countSelected]}>{count}</Text> : null}
      </Pressable>
    );
  };

  return (
    <ScrollView style={styles.sidebar} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {NAV_ITEMS.map(item => renderItem(item.key, item.label))}
      {noteAvailable ? renderItem('note', 'This Note') : null}
      {LOWER_ITEMS.map(item => renderItem(item.key, item.label))}
      <View accessibilityRole="header" style={styles.projectsHeader}>
        <Text style={[styles.headerLabel, {fontSize: Math.round(14 * scale)}]}>Projects</Text>
      </View>
      {renderItem('projects', 'All projects')}
      {shownProjects.map(project => renderItem(`project:${String(project.id)}`, String(project.name || 'Untitled project'), String(project.id)))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sidebar: {width: 216, flexGrow: 0, flexShrink: 0, backgroundColor: '#ffffff', borderRightWidth: 1, borderRightColor: '#000000'},
  content: {paddingHorizontal: 8, paddingVertical: 10},
  item: {minHeight: 48, marginVertical: 3, paddingHorizontal: 12, borderRadius: 0, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  itemIdle: {backgroundColor: '#ffffff', borderColor: '#ffffff'},
  itemSelected: {backgroundColor: '#000000', borderColor: '#000000'},
  label: {flex: 1, fontSize: 16, fontWeight: '600', color: '#000000'},
  labelSelected: {color: '#ffffff', fontWeight: '700'},
  count: {marginLeft: 8, fontWeight: '700', color: '#000000'},
  countSelected: {color: '#ffffff'},
  projectsHeader: {minHeight: 42, justifyContent: 'flex-end', paddingHorizontal: 12, paddingBottom: 7, marginTop: 8, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: '#000000'},
  headerLabel: {fontSize: 14, fontWeight: '700', color: '#000000', letterSpacing: 0.4, textTransform: 'uppercase'},
});
