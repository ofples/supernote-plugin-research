import React, {useRef} from 'react';
import {View, Text, TextInput, Pressable, StyleSheet} from 'react-native';
import {useFontScale} from '../utils/useFontScale';

export type InlineTaskComposerProps = {
  value: string;
  onChangeText: (value: string) => void;
  dueDate: string;
  destinationLabel: string;
  onChooseDate: () => void;
  onChooseDestination: () => void;
  onSubmit: () => void;
  saving?: boolean;
};

export default function InlineTaskComposer({value, onChangeText, dueDate, destinationLabel, onChooseDate, onChooseDestination, onSubmit, saving = false}: InlineTaskComposerProps) {
  const scale = useFontScale();
  const input = useRef<TextInput>(null);
  const disabled = saving || !value.trim();
  const submit = () => {if (disabled) return; onSubmit(); input.current?.focus();};
  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput ref={input} accessibilityLabel="New task" placeholder="Enter task — description" placeholderTextColor="#666666"
          style={[styles.input, {fontSize: Math.round(16 * scale), lineHeight: Math.round(22 * scale)}]}
          value={value} onChangeText={onChangeText} onSubmitEditing={submit} returnKeyType="done"
          blurOnSubmit={false} editable={!saving} accessibilityState={{disabled: saving}} />
        <Pressable accessibilityRole="button" accessibilityLabel={dueDate ? `Choose due date, ${dueDate}` : 'Choose due date'}
          style={styles.dateButton} onPress={onChooseDate}>
          <View style={styles.calendarIcon}><View style={styles.calendarRule} /><View style={styles.calendarDots}><View style={styles.calendarDot} /><View style={styles.calendarDot} /><View style={styles.calendarDot} /></View></View>
          {dueDate ? <Text numberOfLines={1} style={[styles.dateText, {fontSize: Math.round(12 * scale)}]}>{dueDate}</Text> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Add task" accessibilityState={{disabled}}
          style={[styles.addButton, disabled && styles.disabled]} disabled={disabled} onPress={submit}>
          <Text style={[styles.addText, {fontSize: Math.round(15 * scale)}]}>{saving ? 'Saving…' : 'Add'}</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Task destination: ${destinationLabel}. Change destination`}
        style={styles.destination} onPress={onChooseDestination}>
        <Text style={[styles.destinationText, {fontSize: Math.round(13 * scale)}]} numberOfLines={1}>
          <Text style={styles.destinationPrefix}>To: </Text>{destinationLabel || 'Choose a destination'}
        </Text>
        <Text style={styles.destinationArrow}>⌄</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#999999', borderStyle: 'dotted', backgroundColor: '#ffffff'},
  inputRow: {flexDirection: 'row', alignItems: 'stretch', gap: 6},
  input: {flex: 1, minHeight: 48, borderWidth: 1, borderColor: '#777777', paddingHorizontal: 10, paddingVertical: 8, color: '#000000', backgroundColor: '#ffffff'},
  dateButton: {minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#777777', paddingHorizontal: 5},
  calendarIcon: {width: 22, height: 20, borderWidth: 1.5, borderColor: '#000', justifyContent: 'center'},
  calendarRule: {height: 1.5, backgroundColor: '#000', position: 'absolute', top: 4, left: 0, right: 0},
  calendarDots: {flexDirection: 'row', justifyContent: 'space-evenly', marginTop: 5},
  calendarDot: {width: 3, height: 3, backgroundColor: '#000'},
  dateText: {color: '#000000'},
  addButton: {minWidth: 64, minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, backgroundColor: '#000000'},
  addText: {fontWeight: '700', color: '#ffffff'},
  disabled: {opacity: 0.45},
  destination: {minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4},
  destinationText: {flex: 1, color: '#000000'},
  destinationPrefix: {fontWeight: '700'},
  destinationArrow: {fontSize: 20, color: '#000000', paddingHorizontal: 8},
});
