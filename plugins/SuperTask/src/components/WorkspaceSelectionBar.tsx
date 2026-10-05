import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

export type WorkspaceSelectionAction = 'cancel' | 'move' | 'date' | 'more' | 'selectAll';
export type WorkspaceSelectionBarProps = {
  count: number;
  allSelected?: boolean;
  disabledActions?: Partial<Record<Exclude<WorkspaceSelectionAction, 'cancel' | 'selectAll'>, boolean>>;
  onCancel: () => void;
  onMove: () => void;
  onDate: () => void;
  onMore: () => void;
  onSelectAll: () => void;
};

export default function WorkspaceSelectionBar({count, allSelected = false, disabledActions = {}, onCancel, onMove, onDate, onMore, onSelectAll}: WorkspaceSelectionBarProps) {
  const scale = useFontScale();
  const actions = [
    {key: 'move', label: 'Move', callback: onMove, disabled: !!disabledActions.move},
    {key: 'date', label: 'Date', callback: onDate, disabled: !!disabledActions.date},
    {key: 'more', label: 'More', callback: onMore, disabled: !!disabledActions.more},
  ];
  return <View accessibilityLabel="Task selection actions" style={styles.bar}>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel task selection" onPress={onCancel} style={styles.button}>
      <Text style={[styles.buttonText, {fontSize: Math.round(14 * scale)}]}>Cancel</Text>
    </Pressable>
    <View style={styles.actions}>
      {actions.map(action => <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.label}
        accessibilityState={{disabled: action.disabled}} disabled={action.disabled} onPress={action.callback}
        style={[styles.button, action.disabled && styles.disabled]}>
        <Text style={[styles.buttonText, {fontSize: Math.round(14 * scale)}]}>{action.label}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel={allSelected ? 'Clear selection' : 'Select all active tasks'}
        accessibilityState={{selected: allSelected}} onPress={onSelectAll} style={styles.selectAllButton}>
        <Text style={[styles.buttonText, {fontSize: Math.round(14 * scale)}]}>{allSelected ? 'Clear all' : 'Select all'}</Text>
      </Pressable>
    </View>
    <Text accessibilityLiveRegion="polite" style={[styles.count, {fontSize: Math.round(16 * scale)}]}>{count} selected</Text>
  </View>;
}

const styles = StyleSheet.create({
  bar: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#999999', borderStyle: 'dotted', backgroundColor: '#ffffff'},
  count: {fontWeight: '700', color: '#000000', marginLeft: 'auto'},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  button: {minHeight: 44, minWidth: 52, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: '#777777'},
  selectAllButton: {minHeight: 44, minWidth: 76, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: '#000000'},
  buttonText: {fontWeight: '600', color: '#000000'},
  disabled: {opacity: 0.35},
});
