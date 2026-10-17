import React, {useEffect, useRef, useState} from 'react';
import {View, Text, FlatList, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';
const {paginateGroups} = require('../workspace/boardPagination');

type Group = {key: string; title: string; tasks: any[]; header?: React.ReactElement | null; footer?: React.ReactElement | null; emptyMessage?: string | null};
type Props = {groups: Group[]; renderTask: (task: any, group: Group) => any; taskKey: (task: any) => string; extraData?: any; contextKey: string};

/** Two vertical task lanes at a time, with explicit e-ink pagination between pairs. */
export default function WorkspaceBoard({groups, renderTask, taskKey, extraData, contextKey}: Props) {
  const scale = useFontScale();
  const [page, setPage] = useState(0);
  const lastContextKey = useRef(contextKey);
  const requestedPage = lastContextKey.current === contextKey ? page : 0;
  const pagination = paginateGroups(groups, requestedPage);

  useEffect(() => {
    if (lastContextKey.current !== contextKey) {
      lastContextKey.current = contextKey;
      setPage(0);
    } else if (pagination.page !== page) {
      setPage(pagination.page);
    }
  }, [contextKey, groups.length, page, pagination.page]);

  const renderColumn = (item: Group) => <View key={item.key} style={styles.column}>
    {item.header || <View style={styles.heading}><Text numberOfLines={1} style={[styles.title, {fontSize: Math.round(15 * scale)}]}>{item.title}</Text>
      <Text style={styles.count}>{item.tasks.length}</Text></View>}
    <FlatList data={item.tasks} keyExtractor={task => taskKey(task)} renderItem={({item: task}) => renderTask(task, item)}
      extraData={extraData} ListEmptyComponent={item.emptyMessage === null ? null : <Text style={styles.empty}>{item.emptyMessage || 'No tasks'}</Text>} ListFooterComponent={item.footer} />
  </View>;

  return <View style={styles.board}>
    <View style={styles.pagination}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous board columns"
        accessibilityState={{disabled: pagination.page === 0}} disabled={pagination.page === 0}
        onPress={() => setPage(value => Math.max(0, value - 1))} style={[styles.pageButton, pagination.page === 0 && styles.disabled]}>
        <Text style={styles.pageButtonText}>Previous</Text>
      </Pressable>
      <Text accessibilityLabel={`Board page ${pagination.page + 1} of ${pagination.pageCount}`} style={styles.pageLabel}>
        Page {pagination.page + 1} of {pagination.pageCount}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next board columns"
        accessibilityState={{disabled: pagination.page >= pagination.pageCount - 1}} disabled={pagination.page >= pagination.pageCount - 1}
        onPress={() => setPage(value => Math.min(pagination.pageCount - 1, value + 1))}
        style={[styles.pageButton, pagination.page >= pagination.pageCount - 1 && styles.disabled]}>
        <Text style={styles.pageButtonText}>Next</Text>
      </Pressable>
    </View>
    {groups.length === 0 ? <Text style={styles.emptyBoard}>No tasks in this view</Text> :
      <View style={styles.columns}>
        {pagination.groups.map(renderColumn)}
        {pagination.groups.length === 1 && <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.column} />}
      </View>}
  </View>;
}

const styles = StyleSheet.create({
  board: {flex: 1},
  pagination: {minHeight: 52, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#000'},
  pageButton: {minWidth: 84, minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, borderWidth: 1, borderColor: '#000', backgroundColor: '#fff'},
  pageButtonText: {fontSize: 14, fontWeight: '700', color: '#000'},
  pageLabel: {fontSize: 14, fontWeight: '700', color: '#000'},
  disabled: {opacity: 0.35},
  columns: {flex: 1, flexDirection: 'row', padding: 8, gap: 8, alignItems: 'stretch'},
  column: {flex: 1, minWidth: 0, height: '100%', borderWidth: 1, borderColor: '#777', backgroundColor: '#fff'},
  heading: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: '#000'},
  title: {flex: 1, color: '#000', fontWeight: '700'}, count: {color: '#000', fontSize: 13}, empty: {padding: 12, color: '#555'},
  emptyBoard: {flex: 1, textAlign: 'center', textAlignVertical: 'center', padding: 12, color: '#555'},
});
