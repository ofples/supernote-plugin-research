import React, {createContext, useContext} from 'react';
import {View, Text} from 'react-native';
import TaskRow from '../components/TaskRow';
import TaskQuickActions from '../components/TaskQuickActions';
export const WorkspaceContext = createContext<any>(null);
export default function WorkspaceTaskRow(props: any) {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) return <TaskRow {...props} />;
  const id = workspace.identity(props.task);
  const selected = workspace.selectedIds.includes(id);
  const task = workspace.project(props.task);
  if (task.deleted) return null;
  const checked = props.checked || task.completed;
  const expanded = !workspace.selectionMode && workspace.expandedId === id;
  const creating = id.startsWith('ui:');
  const protectedHistory = workspace.protectedHistory(task);
  const excludedFromSelection = workspace.selectionMode && !workspace.canSelect(task);
  return <View>
    <TaskRow {...props} task={task} checked={workspace.selectionMode ? false : checked} selected={workspace.selectionMode && selected}
      outlineSelected={expanded}
      selectionMode={workspace.selectionMode} roundCheck={!workspace.selectionMode}
      disabled={creating || protectedHistory || excludedFromSelection}
      onSyncPress={creating ? () => workspace.retryCreate(id) : props.onSyncPress}
      onCheckPress={() => workspace.selectionMode ? (!excludedFromSelection && workspace.toggle(id)) : (!protectedHistory && workspace.complete(id, !checked))}
      onLongPress={() => {if (!creating && !protectedHistory) workspace.select(id);}}
      onPress={() => creating ? workspace.retryCreate(id) : workspace.selectionMode ? (!excludedFromSelection && workspace.toggle(id)) : workspace.expand(id)}
      rightAccessory={expanded && !creating && !protectedHistory ? <TaskQuickActions onEdit={() => workspace.edit(task)}
        onDate={() => workspace.action('date', [id])} onMove={() => workspace.action('move', [id])}
        onPriority={() => workspace.action('priority', [id])} onDelete={() => workspace.action('delete', [id])}
        onDismiss={() => workspace.expand(id)}
        canMoveUp={!checked && workspace.canOrder(task, 'up')} canMoveDown={!checked && workspace.canOrder(task, 'down')}
        onMoveUp={() => workspace.order(id, 'up')} onMoveDown={() => workspace.order(id, 'down')}
        disabledActions={{date: !!checked, move: !!checked, priority: !!checked}} /> : null} />
    {protectedHistory && <Text style={{color: '#000', padding: 8}}>Change this recurring occurrence in Todoist. Its next occurrence is separate.</Text>}
  </View>;
}
