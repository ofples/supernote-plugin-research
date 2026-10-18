import React from 'react';
import {View, Text, Pressable, StyleSheet} from 'react-native';

type IconButtonProps = {
  label: string;
  onPress: () => void;
  expanded?: boolean;
};

function IconButton({label, onPress, expanded}: IconButtonProps) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={expanded === undefined ? undefined : {expanded}}
    onPress={onPress} style={({pressed}) => [styles.button, pressed && styles.pressed]}>
    <WorkspaceIcon />
  </Pressable>;
}

function TextButton({label, accessibilityLabel, onPress, expanded}: {label: string; accessibilityLabel: string; onPress: () => void; expanded?: boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={expanded === undefined ? undefined : {expanded}}
    onPress={onPress} style={({pressed}) => [styles.textButton, pressed && styles.pressed]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}

function WorkspaceIcon() {
  return <View style={styles.sidebarIcon}>
    <View style={styles.sidebarRail} /><View style={styles.sidebarPane} />
  </View>;
}

export function HeaderActionButtons({onSettings, onClose}: {onSettings: () => void; onClose: () => void}) {
  return <View style={styles.headerActions}>
    <TextButton label="Settings" accessibilityLabel="Settings" onPress={onSettings} />
    <TextButton label="Close" accessibilityLabel="Close" onPress={onClose} />
  </View>;
}

export function WorkspaceViewControls({onViewOptions, onListMenu, viewOptionsOpen}: {
  onViewOptions: () => void;
  onListMenu: () => void;
  viewOptionsOpen: boolean;
}) {
  return <View style={styles.viewControls}>
    <TextButton label="View" accessibilityLabel="Workspace view options" expanded={viewOptionsOpen} onPress={onViewOptions} />
    <TextButton label="…" accessibilityLabel="List menu" onPress={onListMenu} />
  </View>;
}

export function WorkspaceSidebarToggle({collapsed, onPress}: {collapsed: boolean; onPress: () => void}) {
  return <IconButton label={collapsed ? 'Show sidebar' : 'Hide sidebar'} expanded={!collapsed} onPress={onPress} />;
}

const styles = StyleSheet.create({
  headerActions: {marginLeft: 'auto', flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8},
  viewControls: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6},
  textButton: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#000000', backgroundColor: '#ffffff'},
  buttonText: {fontSize: 15, color: '#000000'},
  button: {width: 44, height: 44, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff'},
  pressed: {backgroundColor: '#eeeeee'},
  sidebarIcon: {width: 21, height: 19, flexDirection: 'row', borderWidth: 1.5, borderColor: '#000000'},
  sidebarRail: {width: 6, borderRightWidth: 1.5, borderColor: '#000000', backgroundColor: '#000000'},
  sidebarPane: {flex: 1},
});
