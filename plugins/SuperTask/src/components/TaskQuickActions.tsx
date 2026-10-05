import React from 'react';
import {View, Pressable, ScrollView, StyleSheet} from 'react-native';

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

const ACTIONS: Array<{key: TaskQuickAction; label: string; callback: keyof TaskQuickActionsProps}> = [
  {key: 'edit', label: 'Edit task', callback: 'onEdit'},
  {key: 'date', label: 'Set date', callback: 'onDate'},
  {key: 'move', label: 'Move task', callback: 'onMove'},
  {key: 'priority', label: 'Set priority', callback: 'onPriority'},
  {key: 'up', label: 'Move task up', callback: 'onMoveUp'},
  {key: 'down', label: 'Move task down', callback: 'onMoveDown'},
  {key: 'delete', label: 'Delete task', callback: 'onDelete'},
];

export default function TaskQuickActions(props: TaskQuickActionsProps) {
  const actions = ACTIONS;
  return <ScrollView horizontal accessibilityLabel="Task actions" showsHorizontalScrollIndicator={false}
    style={[styles.container, props.maxWidth !== undefined && {width: Math.min(Math.max(0, props.maxWidth), 8 * 44 + 2)}]} contentContainerStyle={styles.actions}>
    {actions.map((action, index) => {
      const orderUnavailable = (action.key === 'up' && props.canMoveUp === false) || (action.key === 'down' && props.canMoveDown === false);
      const disabled = !!props.disabledActions?.[action.key] || orderUnavailable;
      return <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.label}
        accessibilityState={{disabled}} disabled={disabled} onPress={props[action.callback] as () => void}
        style={[styles.action, index === 0 && styles.firstAction, disabled && styles.disabled]}>
        <ActionIcon name={action.key} />
      </Pressable>;
    })}
    <Pressable accessibilityRole="button" accessibilityLabel="Close task actions" onPress={props.onDismiss}
      style={[styles.action, styles.dismissAction]}>
      <ActionIcon name="close" />
    </Pressable>
  </ScrollView>;
}

function ActionIcon({name}: {name: TaskQuickAction | 'close'}) {
  if (name === 'date') {
    return <View style={styles.calendar}>
      <View style={styles.calendarTop} /><View style={styles.calendarRule} />
      <View style={styles.calendarGrid}><View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} /></View>
    </View>;
  }
  if (name === 'edit') {
    return <View style={styles.iconBox}>
      <View style={styles.pencil} /><View style={styles.pencilTip} /><View style={styles.editRule} />
    </View>;
  }
  if (name === 'move') {
    return <View style={styles.iconBox}>
      <View style={styles.diagonal} /><View style={styles.moveArrowTop} /><View style={styles.moveArrowRight} />
    </View>;
  }
  if (name === 'priority') {
    return <View style={styles.iconBox}>
      <View style={styles.priorityStem} /><View style={styles.priorityDot} />
    </View>;
  }
  if (name === 'up' || name === 'down') {
    return <View style={styles.iconBox}>
      <View style={[styles.arrowStem, name === 'down' && styles.arrowStemDown]} />
      <View style={[styles.arrowLeft, name === 'down' && styles.arrowLeftDown]} />
      <View style={[styles.arrowRight, name === 'down' && styles.arrowRightDown]} />
    </View>;
  }
  if (name === 'delete') {
    return <View style={styles.iconBox}>
      <View style={styles.binLid} /><View style={styles.bin} /><View style={styles.binLineOne} /><View style={styles.binLineTwo} />
    </View>;
  }
  return <View style={styles.iconBox}>
    <View style={[styles.closeLine, styles.closeLineOne]} /><View style={[styles.closeLine, styles.closeLineTwo]} />
  </View>;
}

const styles = StyleSheet.create({
  container: {backgroundColor: '#ffffff', flexGrow: 0, flexShrink: 1, alignSelf: 'flex-end', borderWidth: 1, borderColor: '#000000'},
  actions: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff'},
  action: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', borderLeftWidth: 1, borderColor: '#000000'},
  firstAction: {borderLeftWidth: 0},
  dismissAction: {width: 44},
  iconBox: {width: 22, height: 22, alignItems: 'center', justifyContent: 'center'},
  calendar: {width: 18, height: 17, borderWidth: 1.5, borderColor: '#000000', marginTop: 3},
  calendarTop: {position: 'absolute', top: -4, left: 3, right: 3, height: 5, borderLeftWidth: 1.5, borderRightWidth: 1.5, borderColor: '#000000'},
  calendarRule: {position: 'absolute', top: 3, left: 0, right: 0, borderTopWidth: 1, borderColor: '#000000'},
  calendarGrid: {position: 'absolute', top: 7, left: 3, right: 3, flexDirection: 'row', justifyContent: 'space-between'},
  dot: {width: 2, height: 2, backgroundColor: '#000000'},
  pencil: {position: 'absolute', width: 16, height: 4, backgroundColor: '#000000', transform: [{rotate: '-45deg'}]},
  pencilTip: {position: 'absolute', width: 0, height: 0, right: 2, top: 2, borderTopWidth: 3, borderBottomWidth: 3, borderLeftWidth: 4, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#000000'},
  editRule: {position: 'absolute', width: 7, height: 1.5, backgroundColor: '#000000', left: 2, bottom: 2},
  diagonal: {position: 'absolute', width: 15, height: 1.5, backgroundColor: '#000000', transform: [{rotate: '-45deg'}]},
  moveArrowTop: {position: 'absolute', width: 7, height: 1.5, backgroundColor: '#000000', right: 1, top: 4, transform: [{rotate: '-45deg'}]},
  moveArrowRight: {position: 'absolute', width: 7, height: 1.5, backgroundColor: '#000000', right: 1, top: 4, transform: [{rotate: '45deg'}]},
  priorityStem: {width: 2, height: 12, backgroundColor: '#000000', marginBottom: 3},
  priorityDot: {position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#000000', bottom: 1},
  arrowStem: {width: 1.5, height: 14, backgroundColor: '#000000', marginTop: 6},
  arrowStemDown: {marginTop: 0, marginBottom: 6},
  arrowLeft: {position: 'absolute', width: 8, height: 1.5, backgroundColor: '#000000', top: 4, left: 4, transform: [{rotate: '-45deg'}]},
  arrowRight: {position: 'absolute', width: 8, height: 1.5, backgroundColor: '#000000', top: 4, right: 4, transform: [{rotate: '45deg'}]},
  arrowLeftDown: {top: 17, transform: [{rotate: '45deg'}]},
  arrowRightDown: {top: 17, transform: [{rotate: '-45deg'}]},
  binLid: {position: 'absolute', top: 3, width: 13, height: 1.5, backgroundColor: '#000000'},
  bin: {position: 'absolute', top: 6, width: 11, height: 12, borderWidth: 1.5, borderTopWidth: 0, borderColor: '#000000'},
  binLineOne: {position: 'absolute', top: 8, width: 1, height: 7, backgroundColor: '#000000', marginLeft: -3},
  binLineTwo: {position: 'absolute', top: 8, width: 1, height: 7, backgroundColor: '#000000', marginLeft: 3},
  closeLine: {position: 'absolute', width: 17, height: 1.5, backgroundColor: '#000000'},
  closeLineOne: {transform: [{rotate: '45deg'}]},
  closeLineTwo: {transform: [{rotate: '-45deg'}]},
  disabled: {opacity: 0.35},
});
