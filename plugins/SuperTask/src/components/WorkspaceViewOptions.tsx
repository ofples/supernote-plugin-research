import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';

type Props = {value: any; onChange: (patch: any) => void; onClose: () => void};
const choices = (label: string, key: string, options: Array<[string, string]>, value: string, onChange: (patch: any) => void) => <View style={styles.group}>
  <Text style={styles.label}>{label}</Text><View style={styles.options}>{options.map(([id, title]) => <Pressable key={id} accessibilityRole="button" accessibilityState={{selected: value === id}}
    onPress={() => onChange({[key]: id})} style={[styles.choice, value === id && styles.selected]}>
    <Text style={[styles.choiceText, value === id && styles.selectedText]}>{title}</Text></Pressable>)}</View>
</View>;

export default function WorkspaceViewOptions({value, onChange, onClose}: Props) {
  return <View accessibilityLabel="Workspace view options" style={styles.panel}>
    <View style={styles.top}><Text style={styles.title}>View options</Text><Pressable accessibilityRole="button" accessibilityLabel="Close view options" onPress={onClose} style={styles.close}><Text style={styles.choiceText}>Close</Text></Pressable></View>
    {choices('Layout', 'view', [['list', 'List'], ['board', 'Board']], value.view, onChange)}
    {choices('Group by', 'groupBy', [['collection', 'Collection'], ['project', 'Project'], ['date', 'Date'], ['none', 'None']], value.groupBy, onChange)}
    {choices('Sort', 'sortBy', [['manual', 'Manual'], ['priority', 'Priority'], ['due', 'Due date'], ['title', 'Title']], value.sortBy, onChange)}
  </View>;
}

const styles = StyleSheet.create({
  panel: {position: 'absolute', zIndex: 20, top: 48, right: 8, width: 310, padding: 10, gap: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: '#000'},
  top: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, title: {fontSize: 15, color: '#000', fontWeight: '700'},
  close: {minHeight: 38, justifyContent: 'center', paddingHorizontal: 9, borderWidth: 1, borderColor: '#777'},
  group: {gap: 4}, label: {fontSize: 12, color: '#555', fontWeight: '700'}, options: {flexDirection: 'row', flexWrap: 'wrap', gap: 4},
  choice: {minHeight: 36, justifyContent: 'center', paddingHorizontal: 8, borderWidth: 1, borderColor: '#777'}, selected: {backgroundColor: '#000', borderColor: '#000'},
  choiceText: {fontSize: 12, color: '#000'}, selectedText: {color: '#fff', fontWeight: '700'},
});
