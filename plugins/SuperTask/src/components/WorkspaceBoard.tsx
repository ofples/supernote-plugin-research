import React from 'react';
import {View, Text, FlatList, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

type Group = {key: string; title: string; tasks: any[]; header?: React.ReactElement | null; footer?: React.ReactElement | null; emptyMessage?: string | null};
type Props = {groups: Group[]; renderTask: (task: any, group: Group) => any; taskKey: (task: any) => string; extraData?: any};

/** Horizontal, virtualized columns. Each column virtualizes its own task rows. */
export default function WorkspaceBoard({groups, renderTask, taskKey, extraData}: Props) {
  const scale = useFontScale();
  return <FlatList horizontal style={styles.board} data={groups} keyExtractor={item => item.key} extraData={extraData}
    showsHorizontalScrollIndicator={false} contentContainerStyle={styles.columns}
    ListEmptyComponent={<Text style={styles.empty}>No tasks in this view</Text>}
    renderItem={({item}) => <View style={styles.column}>
      {item.header || <View style={styles.heading}><Text numberOfLines={1} style={[styles.title, {fontSize: Math.round(15 * scale)}]}>{item.title}</Text>
        <Text style={styles.count}>{item.tasks.length}</Text></View>}
      <FlatList data={item.tasks} keyExtractor={task => taskKey(task)} renderItem={({item: task}) => renderTask(task, item)}
        extraData={extraData} ListEmptyComponent={item.emptyMessage === null ? null : <Text style={styles.empty}>{item.emptyMessage || 'No tasks'}</Text>} ListFooterComponent={item.footer} />
    </View>} />;
}

const styles = StyleSheet.create({
  board: {flex: 1}, columns: {padding: 8, gap: 8, alignItems: 'stretch'},
  column: {width: 248, height: '100%', borderWidth: 1, borderColor: '#777', backgroundColor: '#fff'},
  heading: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: '#000'},
  title: {flex: 1, color: '#000', fontWeight: '700'}, count: {color: '#000', fontSize: 13}, empty: {padding: 12, color: '#555'},
});
