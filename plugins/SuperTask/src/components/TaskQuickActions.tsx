import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

export type TaskQuickAction = 'edit' | 'date' | 'move' | 'priority' | 'up' | 'down' | 'delete';
export type TaskQuickActionsProps = {
  onEdit: () => void;
  onDate: () => void;
  onMove: () => void;
  onPriority: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  disabledActions?: Partial<Record<TaskQuickAction, boolean>>;
};

const ACTIONS: Array<{key: TaskQuickAction; label: string; glyph: string; callback: keyof TaskQuickActionsProps}> = [
  {key: 'edit', label: 'Edit task', glyph: '✎', callback: 'onEdit'},
  {key: 'date', label: 'Set date', glyph: '▦', callback: 'onDate'},
  {key: 'move', label: 'Move task', glyph: '↗', callback: 'onMove'},
  {key: 'priority', label: 'Set priority', glyph: '!', callback: 'onPriority'},
  {key: 'up', label: 'Move task up', glyph: '↑', callback: 'onMoveUp'},
  {key: 'down', label: 'Move task down', glyph: '↓', callback: 'onMoveDown'},
  {key: 'delete', label: 'Delete task', glyph: '×', callback: 'onDelete'},
];

export default function TaskQuickActions(props: TaskQuickActionsProps) {
  const scale = useFontScale();
  return <View accessibilityLabel="Task actions" style={styles.container}>
    {ACTIONS.map(action => {
      const orderUnavailable = (action.key === 'up' && props.canMoveUp === false) || (action.key === 'down' && props.canMoveDown === false);
      const disabled = !!props.disabledActions?.[action.key] || orderUnavailable;
      return <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.label}
        accessibilityState={{disabled}} disabled={disabled} onPress={props[action.callback] as () => void}
        style={[styles.action, action.key === 'delete' && styles.deleteAction, disabled && styles.disabled]}>
        <Text style={[styles.glyph, {fontSize: Math.round(17 * scale)}, action.key === 'delete' && styles.deleteText]}>{action.glyph}</Text>
        <Text style={[styles.label, {fontSize: Math.round(12 * scale)}, action.key === 'delete' && styles.deleteText]}>{action.key === 'up' ? 'Up' : action.key === 'down' ? 'Down' : action.label.replace(' task', '')}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  container: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingTop: 6, paddingBottom: 2},
  action: {minWidth: 52, minHeight: 48, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#777777', backgroundColor: '#ffffff'},
  glyph: {fontWeight: '700', color: '#000000', lineHeight: 19},
  label: {fontWeight: '600', color: '#000000', textAlign: 'center'},
  deleteAction: {borderColor: '#000000'},
  deleteText: {fontWeight: '700'},
  disabled: {opacity: 0.35},
});
