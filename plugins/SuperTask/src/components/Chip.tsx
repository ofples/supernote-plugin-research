/** Metadata label: quiet collection borders, inverted styling for urgency. */

import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

export default function Chip({label, inverted, quiet}: {label: string; inverted?: boolean; quiet?: boolean}) {
  const scale = useFontScale();
  return (
    <View style={[st.chip, quiet && st.chipQuiet, inverted && st.chipInverted]}>
      <Text style={[st.text, quiet && st.textQuiet, {fontSize: Math.round(12 * scale)}, inverted && st.textInverted]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: '#ffffff',
    alignSelf: 'flex-start',
  },
  chipQuiet: {borderColor: '#bbbbbb', borderRadius: 0},
  textQuiet: {fontWeight: '400' as const},
  chipInverted: {
    backgroundColor: '#000000',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: '#000000',
  },
  textInverted: {
    color: '#ffffff',
  },
});
