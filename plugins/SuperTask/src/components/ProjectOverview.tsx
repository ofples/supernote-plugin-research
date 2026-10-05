import React, {useState} from 'react';
import {View, Text, Pressable, FlatList, StyleSheet} from 'react-native';
import BaseTaskRow from './TaskRow';
import {useFontScale} from '../utils/useFontScale';
const {projectGroups, overviewRows, collapsingSelection} = require('../overview/model');
const {isCollectionExpanded, toggleCollectionExpanded, setProjectCollectionsExpanded} = require('../collections/collapse');

// View preferences only: no tasks, titles or credentials are retained here.
let sessionExpanded: Record<string, boolean> = {};
let sessionCompact = true;
type Props = {projects: any[]; tasks: any[]; sections?: any[]; selectedIds: string[];
  onSelect: (id: string) => void; onTask: (task: any) => void; onProject: (project: any) => void; busy?: boolean; onSyncPress?: () => void;
  footer?: React.ReactElement | null; onScrollBeginDrag?: () => void; TaskComponent?: React.ComponentType<any>; onDeselect?: (ids: string[]) => void};
export default function ProjectOverview({projects, tasks, sections = [], selectedIds, onSelect, onTask, onProject, busy, onSyncPress, TaskComponent = BaseTaskRow, onDeselect, footer, onScrollBeginDrag}: Props) {
  const scale = useFontScale();
  const [expanded, setExpanded] = useState(sessionExpanded);
  const [compact, setCompact] = useState(sessionCompact);
  const [, setCollectionRevision] = useState(0);
  const sourceGroups = projectGroups(projects, tasks, sections);
  const groups = sourceGroups.map((group: any) => ({...group, collections: group.collections.map((collection: any) => ({
    ...collection,
    isExpanded: isCollectionExpanded(group.project.id, collection.id),
  }))}));
  const allRows = overviewRows(groups, expanded);
  let hideCollectionTasks = false;
  const rows = allRows.filter((row: any) => {
    if (row.type === 'project') hideCollectionTasks = false;
    if (row.type === 'collection') {
      hideCollectionTasks = !row.isExpanded;
      return true;
    }
    return !hideCollectionTasks;
  });
  const total = groups.reduce((count: number, group: any) => count + group.tasks.length, 0);
  const changeExpanded = (value: Record<string, boolean>) => {sessionExpanded = value; setExpanded(value);};
  const toggle = (id: string) => {
    if (expanded[id]) onDeselect?.(collapsingSelection(groups, id, selectedIds));
    changeExpanded({...expanded, [id]: !expanded[id]});
  };
  const collapseAll = () => {
    onDeselect?.(collapsingSelection(groups, null, selectedIds));
    changeExpanded({});
  };
  const expandAllCollections = (value: boolean) => {
    for (const group of groups) setProjectCollectionsExpanded(group.project.id, group.collections, value);
    setCollectionRevision(revision => revision + 1);
  };
  const toggleCollection = (projectId: string, collectionId: string) => {
    toggleCollectionExpanded(projectId, collectionId);
    setCollectionRevision(revision => revision + 1);
  };
  return <View style={s.page}>
    <View style={s.controls}>
      <Text style={[s.summary, {fontSize: Math.round(14 * scale)}]}>{groups.length} projects · {total} tasks</Text>
      <View style={s.actions}>
        <Pressable style={s.control} onPress={() => {changeExpanded(Object.fromEntries(projects.map(project => [String(project.id), true]))); expandAllCollections(true);}}><Text style={s.action}>Expand all</Text></Pressable>
        <Pressable style={s.control} onPress={() => {collapseAll(); expandAllCollections(false);}}><Text style={s.action}>Collapse all</Text></Pressable>
        <Pressable style={s.control} accessibilityRole="button" accessibilityLabel={`Task density: ${compact ? 'compact' : 'comfortable'}`} onPress={() => {sessionCompact = !compact; setCompact(!compact);}}><Text style={s.action}>{compact ? 'Compact' : 'Comfortable'}</Text></Pressable>
      </View>
      <Text style={s.hint}>Tap a project to show tasks. Check a task to complete it; tap its title for actions.</Text>
    </View>
    {!projects.length ? <View><View style={s.empty}><Text style={s.emptyText}>No projects</Text></View>{footer}</View> :
      <FlatList ListFooterComponent={footer} onScrollBeginDrag={onScrollBeginDrag} data={rows} keyExtractor={(item: any) => item.key} extraData={{selectedIds, compact}}
        renderItem={({item}: any) => item.type === 'project' ?
          <View style={s.project}>
            <Pressable style={s.projectToggle} accessibilityRole="button" accessibilityLabel={`${item.expanded ? 'Collapse' : 'Expand'} ${item.project.name}`}
              accessibilityState={{expanded: item.expanded}} onPress={() => toggle(String(item.project.id))}>
              <Text style={s.chevron}>{item.expanded ? '⌄' : '›'}</Text>
              <Text style={[s.name, {fontSize: Math.round(18 * scale)}]}>{item.project.name}</Text>
              <Text style={[s.count, {fontSize: Math.round(15 * scale)}]}>{item.tasks.length}</Text>
            </Pressable>
            <Pressable style={s.open} accessibilityLabel={`Open ${item.project.name} project view`} onPress={() => onProject(item.project)}><Text style={s.action}>Open</Text></Pressable>
          </View> : item.type === 'collection' ? <Pressable style={s.collection} accessibilityRole="button"
            accessibilityLabel={`${item.isExpanded ? 'Collapse' : 'Expand'} ${item.name}`} accessibilityState={{expanded: item.isExpanded}}
            onPress={() => toggleCollection(item.projectId, item.id)}>
            <Text style={s.collectionChevron}>{item.isExpanded ? '⌄' : '›'}</Text>
            <Text style={{fontSize: Math.round(16 * scale), fontWeight: '600', color: '#000', flex: 1}}>{item.name}</Text>
            <Text style={s.collectionCount}>{item.tasks.length}</Text>
          </Pressable> :
            item.type === 'empty' ? <Text style={s.emptyProject}>No active tasks{item.collection ? ' in this collection' : ''}</Text> :
            <View style={s.task}><TaskComponent task={item.task} selected={selectedIds.includes(item.task.id)} onCheckPress={onSelect}
              onPress={onTask} compact={compact} disabled={busy} onSyncPress={onSyncPress} /></View>}
      />}
  </View>;
}
const s = StyleSheet.create({page: {flex: 1}, controls: {padding: 12, gap: 8, borderBottomWidth: 1, borderColor: '#000'},
  summary: {color: '#000'}, actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  control: {minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: '#000'},
  action: {fontSize: 14, color: '#000'}, hint: {fontSize: 13, color: '#000'},
  project: {flexDirection: 'row', borderBottomWidth: 1, borderColor: '#000', alignItems: 'center'},
  projectToggle: {flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 14, gap: 12},
  chevron: {fontSize: 24, width: 24, color: '#000'}, name: {flex: 1, fontWeight: '600', color: '#000'},
  count: {color: '#000'}, open: {paddingHorizontal: 16, minHeight: 48, justifyContent: 'center'},
  task: {marginLeft: 20},
  emptyProject: {padding: 16, marginLeft: 38, fontSize: 15, color: '#000'},
  collection: {minHeight: 48, paddingHorizontal: 14, paddingLeft: 50, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', borderBottomWidth: 1, borderColor: '#dddddd'},
  collectionChevron: {fontSize: 22, width: 20, color: '#000'}, collectionCount: {fontSize: 14, color: '#555'},
  empty: {flex: 1, justifyContent: 'center', alignItems: 'center'}, emptyText: {fontSize: 18, color: '#000'}});
