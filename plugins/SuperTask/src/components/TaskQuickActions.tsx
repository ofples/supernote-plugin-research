import React from 'react';
import {Text, Pressable, ScrollView, StyleSheet} from 'react-native';
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
  onDismiss?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  disabledActions?: Partial<Record<TaskQuickAction, boolean>>;
  maxWidth?: number;
};

const ACTIONS: Array<{key: TaskQuickAction; label: string; glyph: string; callback: keyof TaskQuickActionsProps}> = [
  {key: 'edit', label: 'Edit task', glyph: '✎', callback: 'onEdit'},
  {key: 'date', label: 'Set date', glyph: '▦', callback: 'onDate'},
  {key: 'move', label: 'Move task', glyph: '↗', callback: 'onMove'},
  {key: 'priority', label: 'Set priority', glyph: '!', callback: 'onPriority'},
  {key: 'up', label: 'Move task up', glyph: '↑', callback: 'onMoveUp'},
  {key: 'down', label: 'Move task down', glyph: '↓', callback: 'onMoveDown'},
  {key: 'delete', label: 'Delete task', glyph: '🗑', callback: 'onDelete'},
];

export default function TaskQuickActions(props: TaskQuickActionsProps) {
  const scale = useFontScale();
  const actions = ACTIONS;
  return <ScrollView horizontal accessibilityLabel="Task actions" showsHorizontalScrollIndicator={false}
    style={[styles.container, props.maxWidth !== undefined && {width: Math.min(Math.max(0, props.maxWidth), 7 * 44 + 40 - 7)}]} contentContainerStyle={styles.actions}>
    {actions.map((action, index) => {
      const orderUnavailable = (action.key === 'up' && props.canMoveUp === false) || (action.key === 'down' && props.canMoveDown === false);
      const disabled = !!props.disabledActions?.[action.key] || orderUnavailable;
      return <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.label}
        accessibilityState={{disabled}} disabled={disabled} onPress={props[action.callback] as () => void}
        style={[styles.action, index === 0 && {marginLeft: 0}, action.key === 'delete' && styles.deleteAction, disabled && styles.disabled]}>
        <Text style={[styles.glyph, {fontSize: Math.round(19 * scale), lineHeight: Math.round(23 * scale)}, action.key === 'delete' && styles.deleteText]}>{action.glyph}</Text>
      </Pressable>;
    })}
    <Pressable accessibilityRole="button" accessibilityLabel="Close task actions" onPress={props.onDismiss}
      style={[styles.action, styles.dismissAction]}>
      <Text style={[styles.glyph, {fontSize: Math.round(19 * scale), lineHeight: Math.round(23 * scale)}]}>×</Text>
    </Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: {backgroundColor: '#ffffff', flexGrow: 0, flexShrink: 1, alignSelf: 'flex-end'},
  actions: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff'},
  action: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#000000', marginLeft: -1},
  dismissAction: {width: 40},
  glyph: {fontWeight: '700', color: '#000000', lineHeight: 19},
  deleteAction: {},
  deleteText: {fontWeight: '700'},
  disabled: {opacity: 0.35},
});
