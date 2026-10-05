/** Group title and plain count above a single faint divider. */

import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

type Props = {
  title: string;
  count?: number;
  onPress?: () => void;
  expanded?: boolean;
  onToggle?: () => void;
  action?: React.ReactNode;
};

export default function SectionHeader({title, count, onPress, expanded, onToggle, action}: Props) {
  const scale = useFontScale();
  const collapsible = onToggle !== undefined;
  const content = (
    <View style={styles.container}>
      <Text style={[styles.title, {fontSize: Math.round(14 * scale)}]}>{title.toUpperCase()}</Text>
      <View style={styles.right}>
        {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
        {collapsible ? <Text style={styles.arrow}>{expanded ? '⌄' : '›'}</Text> : onPress ? <Text style={styles.arrow}>{'>'}</Text> : null}
        {action}
      </View>
    </View>
  );

  if (collapsible || onPress) {
    return <Pressable accessibilityRole="button" accessibilityState={collapsible ? {expanded} : undefined}
      accessibilityLabel={collapsible ? `${expanded ? 'Collapse' : 'Expand'} ${title}` : undefined}
      onPress={collapsible ? onToggle : onPress}>{content}</Pressable>;
  }
  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    backgroundColor: '#ffffff',
  },
  count: {color: '#666', fontSize: 14},
  title: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: 0.5,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  arrow: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
});
