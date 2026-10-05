/** Shared task row: checkbox completes, body opens details, sync symbol opens status. */

import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {log} from '../utils/debug';
import Chip from './Chip';
import {Check} from './settings';
import {useFontScale} from '../utils/useFontScale';
const {localDate} = require('../offline/model');

const PRIORITY_LABELS: Record<number, string> = {
  4: 'P1',
  3: 'P2',
  2: 'P3',
  1: '',
};

type Props = {
  task: any;
  onCheckPress: (taskId: string) => void; // complete active task or reopen checked task
  onPress: (task: any) => void;
  showProject?: string;
  showCollection?: string;
  pageNum?: number;
  checked?: boolean;      // Done-tab mode: box filled, tap = reopen
  selected?: boolean;     // selection mode: box filled while selected
  completedAt?: string;   // ISO completion timestamp -> "Done Jul 24" chip
  onOpenNote?: () => void; // renders a right-aligned "Note >" jump button
  compact?: boolean;
  roundCheck?: boolean;
  onSyncPress?: () => void;
  disabled?: boolean;
  selectionMode?: boolean;
  onLongPress?: (task: any) => void;
};

export default function TaskRow({task, onCheckPress, onPress, showProject, showCollection, pageNum, checked, selected, completedAt, onOpenNote, compact = false, roundCheck = false, onSyncPress, disabled = false, selectionMode = false, onLongPress}: Props) {
  const scale = useFontScale();

  const handleCheckPress = (event?: any) => {
    event?.stopPropagation?.();
    log('TaskRow', `CHECK pressed id=${task.id} checked=${!!checked} selected=${!!selected}`);
    onCheckPress(task.id);
  };

  const priorityLabel = PRIORITY_LABELS[task.priority] || '';
  const dueDate = (task.due?.date || '').slice(0, 10);
  const today = localDate(new Date());
  const isOverdue = !checked && dueDate && dueDate < today;
  const isToday = dueDate === today;

  const chips: Array<{label: string; inverted?: boolean}> = [];
  if (completedAt) chips.push({label: `Done ${formatDate(completedAt.slice(0, 10))}`});
  if (isOverdue) chips.push({label: `Overdue ${formatDate(dueDate)}`, inverted: true});
  else if (isToday) chips.push({label: 'Today'});
  else if (dueDate) chips.push({label: formatDate(dueDate)});
  if (priorityLabel) chips.push({label: priorityLabel});
  if (showProject) chips.push({label: showProject});
  if (showCollection) chips.push({label: showCollection});
  if (pageNum !== undefined) chips.push({label: `p.${pageNum}`});
  const syncPending = task.syncState === 'pending' || task._registryOnly || task.awaitingRecurrence || task.occurrencePending;
  const syncAttention = task.syncState === 'attention';

  // Keep the title aligned with its checkbox as metadata wraps.
  const hasMeta = chips.length > 0;

  return (
    <Pressable
      style={[styles.row, compact && styles.compactRow, !hasMeta && styles.rowCentered]}
      onLongPress={() => onLongPress?.(task)}
      onPress={() => { log('TaskRow', `ROW pressed id=${task.id}`); onPress(task); }}>
      <Pressable
        style={[styles.checkTarget, !hasMeta && styles.checkTargetCentered]}
        onPress={handleCheckPress}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityLabel={`${selectionMode ? 'Select' : checked ? 'Reopen' : 'Complete'} ${task.content}`}
        accessibilityState={{checked: !!checked || !!selected, disabled}}
        hitSlop={6}>
        <Check checked={!!checked || !!selected} round={selectionMode ? false : roundCheck} />
      </Pressable>
      <View style={styles.content}>
        <Text style={[styles.title, {fontSize: Math.round(16 * scale), lineHeight: Math.round(22 * scale)}]}>{task.content}</Text>
        {chips.length > 0 && (
          <View style={styles.meta}>
            {chips.map((c, i) => (
              <Chip key={i} label={c.label} inverted={c.inverted} />
            ))}
          </View>
        )}
      </View>
      {syncPending || syncAttention ? <Pressable style={styles.syncTarget} accessibilityRole="button"
        accessibilityLabel={syncAttention ? 'Sync needs attention' : task.awaitingRecurrence ? 'Waiting for next recurring occurrence' : 'Waiting to sync'}
        onPress={event => {event.stopPropagation(); onSyncPress ? onSyncPress() : onPress(task);}}>
        <Text style={styles.syncSymbol}>{syncAttention ? '!' : '↥'}</Text>
      </Pressable> : null}
      {onOpenNote ? (
        <Pressable
          style={styles.noteBtn}
          onPress={event => { event.stopPropagation(); log('TaskRow', `OPEN NOTE pressed id=${task.id}`); onOpenNote(); }}
          hitSlop={6}>
          <Text style={[styles.noteBtnText, {fontSize: Math.round(13 * scale)}]}>{'Note >'}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

const styles = StyleSheet.create({
  syncTarget: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4},
  syncSymbol: {fontSize: 23, fontWeight: '700', color: '#000'},
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowCentered: {
    alignItems: 'center',
  },
  compactRow: {paddingVertical: 6, paddingHorizontal: 12, minHeight: 56},
  checkTarget: {
    width: 44,
    minHeight: 44,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 0,
    marginRight: 6,
  },
  checkTargetCentered: {
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    color: '#000000',
    lineHeight: 22,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  noteBtn: {
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginLeft: 8,
    alignSelf: 'flex-start',
  },
  noteBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },
});
