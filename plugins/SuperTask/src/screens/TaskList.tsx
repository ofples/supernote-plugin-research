/**
 * TaskList screen - browse and manage Todoist tasks
 */

import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {closePlugin} from '../utils/closePlugin';
import {loadConfig} from '../utils/config';
import {setConfigLoader, getTasks, completeTask} from '../api/todoist';
import {log, logError} from '../utils/debug';

// Todoist priority is inverted: 4=urgent(P1), 1=normal(P4)
const PRIORITY_LABELS: Record<number, string> = {
  4: 'P1',
  3: 'P2',
  2: 'P3',
  1: '',
};

type Props = {
  onNavigate: (screen: string) => void;
};

export default function TaskList({onNavigate}: Props) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError('');

    log('TaskList', 'Starting fetchTasks');
    setConfigLoader(loadConfig);

    try {
      log('TaskList', 'Loading config...');
      const config = await loadConfig();
      log('TaskList', `Config loaded. Token: ${config.apiToken ? 'present' : 'MISSING'}`);

      if (!config.apiToken) {
        setError('No API token. Tap the gear icon to configure.');
        setLoading(false);
        return;
      }

      log('TaskList', 'Calling getTasks...');
      const result = await getTasks();
      log('TaskList', `Got ${result?.length ?? 'null'} tasks`);

      if (!Array.isArray(result)) {
        log('TaskList', `Unexpected result type: ${typeof result}`);
        setTasks([]);
        setLoading(false);
        return;
      }

      // Sort: due today first, then by due date, then no date last
      result.sort((a: any, b: any) => {
        const aDate = a.due?.date || '9999';
        const bDate = b.due?.date || '9999';
        return aDate.localeCompare(bDate);
      });
      setTasks(result);
    } catch (err: any) {
      logError('TaskList', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleComplete = async (taskId: string) => {
    try {
      await completeTask(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err: any) {
      setError(`Complete failed: ${err.message}`);
    }
  };

  const handleClose = () => {
    closePlugin();
  };

  const renderTask = ({item}: {item: any}) => {
    const priorityLabel = PRIORITY_LABELS[item.priority] || '';
    const dueText = item.due?.string || item.due?.date || '';

    return (
      <View style={styles.taskRow}>
        <Pressable
          style={styles.checkbox}
          onPress={() => handleComplete(item.id)}>
          <Text style={styles.checkboxText}>○</Text>
        </Pressable>
        <View style={styles.taskContent}>
          <Text style={styles.taskTitle}>{item.content}</Text>
          <View style={styles.taskMeta}>
            {priorityLabel ? (
              <Text style={styles.priority}>{priorityLabel}</Text>
            ) : null}
            {dueText ? <Text style={styles.dueDate}>{dueText}</Text> : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Tasks</Text>
        <View style={styles.headerButtons}>
          <Pressable style={styles.headerButton} onPress={() => onNavigate('debug')}>
            <Text style={styles.headerButtonText}>Log</Text>
          </Pressable>
          <Pressable style={styles.headerButton} onPress={fetchTasks}>
            <Text style={styles.headerButtonText}>Refresh</Text>
          </Pressable>
          <Pressable style={styles.headerButton} onPress={handleClose}>
            <Text style={styles.headerButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#000000" />
          <Text style={styles.loadingText}>Loading tasks...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : tasks.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No active tasks</Text>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={item => item.id}
          renderItem={renderTask}
          style={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {tasks.length} active task{tasks.length !== 1 ? 's' : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 0,
  },
  headerButtonText: {
    fontSize: 14,
    color: '#000000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666666',
  },
  errorText: {
    fontSize: 16,
    color: '#000000',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 18,
    color: '#666666',
  },
  list: {
    flex: 1,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  checkbox: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkboxText: {
    fontSize: 22,
    color: '#000000',
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    color: '#000000',
    lineHeight: 22,
  },
  taskMeta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  priority: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
  },
  dueDate: {
    fontSize: 13,
    color: '#666666',
  },
  separator: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginLeft: 60,
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#000000',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    color: '#666666',
  },
});
