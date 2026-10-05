import React, {createContext, useContext} from 'react';
import {View} from 'react-native';
import TaskRow from '../components/TaskRow';
import TaskQuickActions from '../components/TaskQuickActions';
export const WorkspaceContext = createContext<any>(null);
export default function WorkspaceTaskRow(props: any) {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) return <TaskRow {...props} />;
  const id = String(props.task.id);
  const selected = workspace.selectedIds.includes(id);
  const task = workspace.project(props.task);
  if (task.deleted) return null;
  const checked = props.checked || task.completed;
  const expanded = !workspace.selectionMode && workspace.expandedId === id;
  const creating = id.startsWith('ui:');
  return <View style={expanded ? {borderWidth: 1, borderColor: '#000'} : undefined}>
    <TaskRow {...props} task={task} checked={workspace.selectionMode ? false : checked} selected={workspace.selectionMode && selected}
      selectionMode={workspace.selectionMode} roundCheck={!workspace.selectionMode}
      disabled={creating}
      onSyncPress={creating ? () => workspace.retryCreate(id) : props.onSyncPress}
      onCheckPress={() => workspace.selectionMode ? workspace.toggle(id) : workspace.complete(id, !checked)}
      onLongPress={() => {if (!creating) workspace.select(id);}}
      onPress={() => creating ? workspace.retryCreate(id) : workspace.selectionMode ? workspace.toggle(id) : workspace.expand(id)} />
    {expanded && !creating && <TaskQuickActions onEdit={() => workspace.edit(task)}
      onDate={() => workspace.action('date', [id])} onMove={() => workspace.action('move', [id])}
      onPriority={() => workspace.action('priority', [id])} onDelete={() => workspace.action('delete', [id])}
      canMoveUp={!checked && workspace.canOrder(task, 'up')} canMoveDown={!checked && workspace.canOrder(task, 'down')}
      onMoveUp={() => workspace.order(id, 'up')} onMoveDown={() => workspace.order(id, 'down')}
      disabledActions={{date: !!checked, move: !!checked, priority: !!checked}} />}
  </View>;
}
