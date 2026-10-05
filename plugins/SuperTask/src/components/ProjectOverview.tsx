import React, {useState} from 'react';
import {View, Text, Pressable, FlatList, StyleSheet} from 'react-native';
import BaseTaskRow from './TaskRow';
import {useFontScale} from '../utils/useFontScale';
const {projectGroups, overviewRows, collapsingSelection} = require('../overview/model');

// View preferences only: no tasks, titles or credentials are retained here.
let sessionExpanded: Record<string, boolean> = {};
let sessionCompact = true;
type Props = {projects: any[]; tasks: any[]; sections?: any[]; selectedIds: string[];
  onSelect: (id: string) => void; onTask: (task: any) => void; onProject: (project: any) => void; busy?: boolean; onSyncPress?: () => void;
  TaskComponent?: React.ComponentType<any>};
export default function ProjectOverview({projects, tasks, sections = [], selectedIds, onSelect, onTask, onProject, busy, onSyncPress, TaskComponent = BaseTaskRow}: Props) {
  const scale = useFontScale();
  const [expanded, setExpanded] = useState(sessionExpanded);
  const [compact, setCompact] = useState(sessionCompact);
  const groups = projectGroups(projects, tasks, sections);
  const rows = overviewRows(groups, expanded);
  const total = groups.reduce((count: number, group: any) => count + group.tasks.length, 0);
  const changeExpanded = (value: Record<string, boolean>) => {sessionExpanded = value; setExpanded(value);};
  const toggle = (id: string) => {
    if (expanded[id]) collapsingSelection(groups, id, selectedIds).forEach(onSelect);
    changeExpanded({...expanded, [id]: !expanded[id]});
  };
  const collapseAll = () => {
    collapsingSelection(groups, null, selectedIds).forEach(onSelect);
    changeExpanded({});
  };
  return <View style={s.page}>
    <View style={s.controls}>
      <Text style={[s.summary, {fontSize: Math.round(14 * scale)}]}>{groups.length} projects · {total} tasks</Text>
      <View style={s.actions}>
        <Pressable style={s.control} onPress={() => changeExpanded(Object.fromEntries(projects.map(project => [String(project.id), true])))}><Text style={s.action}>Expand all</Text></Pressable>
        <Pressable style={s.control} onPress={collapseAll}><Text style={s.action}>Collapse all</Text></Pressable>
        <Pressable style={s.control} accessibilityRole="button" accessibilityLabel={`Task density: ${compact ? 'compact' : 'comfortable'}`} onPress={() => {sessionCompact = !compact; setCompact(!compact);}}><Text style={s.action}>{compact ? 'Compact' : 'Comfortable'}</Text></Pressable>
      </View>
      <Text style={s.hint}>Tap a project to show tasks. Check a task to complete it; tap its title for actions.</Text>
    </View>
    {!projects.length ? <View style={s.empty}><Text style={s.emptyText}>No projects</Text></View> :
      <FlatList data={rows} keyExtractor={(item: any) => item.key} extraData={{selectedIds, compact}}
        renderItem={({item}: any) => item.type === 'project' ?
          <View style={s.project}>
            <Pressable style={s.projectToggle} accessibilityRole="button" accessibilityLabel={`${item.expanded ? 'Collapse' : 'Expand'} ${item.project.name}`}
              accessibilityState={{expanded: item.expanded}} onPress={() => toggle(String(item.project.id))}>
              <Text style={s.chevron}>{item.expanded ? '⌄' : '›'}</Text>
              <Text style={[s.name, {fontSize: Math.round(18 * scale)}]}>{item.project.name}</Text>
              <Text style={[s.count, {fontSize: Math.round(15 * scale)}]}>{item.tasks.length}</Text>
            </Pressable>
            <Pressable style={s.open} accessibilityLabel={`Open ${item.project.name} project view`} onPress={() => onProject(item.project)}><Text style={s.action}>Open</Text></Pressable>
          </View> : item.type === 'collection' ? <View style={s.collection}><Text style={{fontSize: Math.round(16 * scale), fontWeight: '600', color: '#000'}}>{item.name} · {item.tasks.length}</Text></View> :
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
  task: {marginLeft: 20, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: '#777'},
  emptyProject: {padding: 16, marginLeft: 38, fontSize: 15, color: '#000'},
  collection: {padding: 12, paddingLeft: 50, alignSelf: 'stretch', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000'},
  empty: {flex: 1, justifyContent: 'center', alignItems: 'center'}, emptyText: {fontSize: 18, color: '#000'}});
