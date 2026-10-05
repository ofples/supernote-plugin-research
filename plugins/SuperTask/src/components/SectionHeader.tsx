/**
 * SectionHeader - group divider with title, count chip, optional chevron (F-024).
 * White background + black rule (no gray tint -- e-ink dithers it), count in
 * the same Chip idiom as row metadata.
 */

import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

type Props = {
  title: string;
  count?: number;
  onPress?: () => void;
  action?: React.ReactNode;
};

export default function SectionHeader({title, count, onPress, action}: Props) {
  const scale = useFontScale();
  const content = (
    <View style={styles.container}>
      <Text style={[styles.title, {fontSize: Math.round(14 * scale)}]}>{title.toUpperCase()}</Text>
      <View style={styles.right}>
        {count !== undefined ? <Text style={styles.count}>{count}</Text> : null}
        {onPress ? <Text style={styles.arrow}>{'>'}</Text> : null}
        {action}
      </View>
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
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
    borderBottomColor: '#aaaaaa',
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
