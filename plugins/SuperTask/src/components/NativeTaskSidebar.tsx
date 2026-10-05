import React from 'react';
import {ScrollView, View, Text, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

export type NativeSidebarProject = {id: string | number; name?: string; is_inbox_project?: boolean; inbox_project?: boolean; isInbox?: boolean};
export type NativeTaskSidebarProps = {
  activeView: string;
  projects: NativeSidebarProject[];
  onViewChange: (view: string) => void;
  noteAvailable: boolean;
  counts?: Record<string, number>;
  visibleProjectIds?: string[];
  onCreateProject?: () => void;
  onProjectMenu?: (projectId: string) => void;
};

const NAV_ITEMS = [
  {key: 'today', label: 'Today'},
  {key: 'tomorrow', label: 'Tomorrow'},
  {key: 'upcoming', label: 'Upcoming'},
  {key: 'inbox', label: 'Inbox'},
];

function isInboxProject(project: NativeSidebarProject) {
  return project.is_inbox_project === true || project.inbox_project === true || project.isInbox === true || String(project.name || '').toLowerCase() === 'inbox';
}

function countLabel(value?: number) {
  return Number.isFinite(value) && Number(value) > 0 ? String(value) : null;
}

export default function NativeTaskSidebar({activeView, projects, onViewChange, noteAvailable, counts = {}, visibleProjectIds, onCreateProject}: NativeTaskSidebarProps) {
  const scale = useFontScale();
  const visibleSet = visibleProjectIds === undefined ? null : new Set(visibleProjectIds.map(String));
  const shownProjects = (Array.isArray(projects) ? projects : []).filter(project =>
    !!project && project.id != null && !isInboxProject(project) && (visibleSet === null || visibleSet.has(String(project.id))));

  const renderItem = (key: string, label: string, countKey = key) => {
    const selected = activeView === key;
    const count = countLabel(counts[countKey]);
    return (
      <View key={key} style={styles.itemWrap}>
        <Pressable accessibilityRole="button" accessibilityLabel={label}
          accessibilityState={{selected}} onPress={() => onViewChange(key)}
          style={[styles.item, selected ? styles.itemSelected : styles.itemIdle]}>
          <Text numberOfLines={1} style={[styles.label, {fontSize: Math.round(16 * scale)}, selected && styles.labelSelected]}>{label}</Text>
          {count ? <Text style={[styles.count, {fontSize: Math.round(13 * scale)}, selected && styles.countSelected]}>{count}</Text> : null}
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.sidebar}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {NAV_ITEMS.map(item => renderItem(item.key, item.label))}
        {noteAvailable ? renderItem('note', 'This Note') : null}
        {renderItem('device', 'On Device')}
        {renderItem('done', 'Done')}
        <View accessibilityRole="header" style={styles.projectsHeader}>
          <Text style={[styles.headerLabel, {fontSize: Math.round(14 * scale)}]}>Projects</Text>
        </View>
        {renderItem('projects', 'All projects')}
        {shownProjects.map(project => renderItem(`project:${String(project.id)}`, String(project.name || 'Untitled project'), String(project.id)))}
      </ScrollView>
      {onCreateProject ? <View style={styles.footer}>
        <Pressable accessibilityRole="button" accessibilityLabel="Create new project" style={styles.newProject} onPress={onCreateProject}>
          <Text style={[styles.newProjectText, {fontSize: Math.round(15 * scale)}]}>+ New project</Text>
        </Pressable>
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {width: 216, flexGrow: 0, flexShrink: 0, backgroundColor: '#ffffff', borderRightWidth: 1, borderRightColor: '#000000'},
  scroll: {flex: 1},
  content: {paddingHorizontal: 8, paddingTop: 10, paddingBottom: 6},
  itemWrap: {flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#999999', borderStyle: 'dotted'},
  item: {flex: 1, minHeight: 48, marginVertical: 2, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  itemIdle: {backgroundColor: '#ffffff'},
  itemSelected: {backgroundColor: '#ffffff'},
  label: {flex: 1, fontSize: 16, fontWeight: '500', color: '#000000'},
  labelSelected: {fontWeight: '700'},
  count: {marginLeft: 8, fontWeight: '700', color: '#000000'},
  countSelected: {color: '#000000'},
  projectsHeader: {minHeight: 42, justifyContent: 'flex-end', paddingHorizontal: 12, paddingBottom: 7, marginTop: 8, marginBottom: 6, borderTopWidth: 2, borderTopColor: '#000000', borderStyle: 'solid'},
  headerLabel: {fontSize: 14, fontWeight: '700', color: '#000000', letterSpacing: 0.4, textTransform: 'uppercase'},
  footer: {borderTopWidth: 1, borderTopColor: '#999999', borderStyle: 'dotted', paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#ffffff'},
  newProject: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 12},
  newProjectText: {fontSize: 15, color: '#000000', fontWeight: '700'},
});
