import React from 'react';
import {View, Pressable, StyleSheet} from 'react-native';

type WorkspaceIcon = 'settings' | 'close' | 'view' | 'menu' | 'sidebar';

type IconButtonProps = {
  icon: WorkspaceIcon;
  label: string;
  onPress: () => void;
  expanded?: boolean;
};

function IconButton({icon, label, onPress, expanded}: IconButtonProps) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={expanded === undefined ? undefined : {expanded}}
    onPress={onPress} style={({pressed}) => [styles.button, pressed && styles.pressed]}>
    <WorkspaceIcon name={icon} />
  </Pressable>;
}

function WorkspaceIcon({name}: {name: WorkspaceIcon}) {
  if (name === 'settings') {
    return <View style={styles.gear}>
      <View style={styles.gearToothTop} /><View style={styles.gearToothRight} />
      <View style={styles.gearToothBottom} /><View style={styles.gearToothLeft} />
      <View style={styles.gearCore}><View style={styles.gearHole} /></View>
    </View>;
  }
  if (name === 'close') {
    return <View style={styles.iconBox}>
      <View style={[styles.closeLine, styles.closeLineOne]} />
      <View style={[styles.closeLine, styles.closeLineTwo]} />
    </View>;
  }
  if (name === 'view') {
    return <View style={styles.viewGrid}>
      <View style={styles.viewCell} /><View style={styles.viewCell} />
      <View style={styles.viewCell} /><View style={styles.viewCell} />
    </View>;
  }
  if (name === 'sidebar') {
    return <View style={styles.sidebarIcon}>
      <View style={styles.sidebarRail} /><View style={styles.sidebarPane} />
    </View>;
  }
  return <View style={styles.menuDots}>
    <View style={styles.menuDot} /><View style={styles.menuDot} /><View style={styles.menuDot} />
  </View>;
}

export function HeaderActionButtons({onSettings, onClose}: {onSettings: () => void; onClose: () => void}) {
  return <View style={styles.headerActions}>
    <IconButton icon="settings" label="Settings" onPress={onSettings} />
    <IconButton icon="close" label="Close" onPress={onClose} />
  </View>;
}

export function WorkspaceViewControls({onViewOptions, onListMenu, viewOptionsOpen}: {
  onViewOptions: () => void;
  onListMenu: () => void;
  viewOptionsOpen: boolean;
}) {
  return <View style={styles.viewControls}>
    <IconButton icon="view" label="Workspace view options" expanded={viewOptionsOpen} onPress={onViewOptions} />
    <IconButton icon="menu" label="List menu" onPress={onListMenu} />
  </View>;
}

export function WorkspaceSidebarToggle({collapsed, onPress}: {collapsed: boolean; onPress: () => void}) {
  return <IconButton icon="sidebar" label={collapsed ? 'Show sidebar' : 'Hide sidebar'} expanded={!collapsed} onPress={onPress} />;
}

const styles = StyleSheet.create({
  headerActions: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4},
  viewControls: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2},
  button: {width: 44, height: 44, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff'},
  pressed: {backgroundColor: '#eeeeee'},
  iconBox: {width: 22, height: 22, alignItems: 'center', justifyContent: 'center'},
  closeLine: {position: 'absolute', width: 18, height: 2, backgroundColor: '#000000'},
  closeLineOne: {transform: [{rotate: '45deg'}]},
  closeLineTwo: {transform: [{rotate: '-45deg'}]},
  gear: {width: 22, height: 22, alignItems: 'center', justifyContent: 'center'},
  gearToothTop: {position: 'absolute', top: 0, width: 5, height: 5, backgroundColor: '#000000'},
  gearToothRight: {position: 'absolute', right: 0, width: 5, height: 5, backgroundColor: '#000000'},
  gearToothBottom: {position: 'absolute', bottom: 0, width: 5, height: 5, backgroundColor: '#000000'},
  gearToothLeft: {position: 'absolute', left: 0, width: 5, height: 5, backgroundColor: '#000000'},
  gearCore: {width: 16, height: 16, borderRadius: 8, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center'},
  gearHole: {width: 6, height: 6, borderRadius: 3, backgroundColor: '#ffffff'},
  viewGrid: {width: 19, height: 19, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignContent: 'space-between'},
  viewCell: {width: 8, height: 8, borderWidth: 1.5, borderColor: '#000000'},
  menuDots: {width: 22, height: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2},
  menuDot: {width: 4, height: 4, borderRadius: 2, backgroundColor: '#000000'},
  sidebarIcon: {width: 21, height: 19, flexDirection: 'row', borderWidth: 1.5, borderColor: '#000000'},
  sidebarRail: {width: 6, borderRightWidth: 1.5, borderColor: '#000000', backgroundColor: '#000000'},
  sidebarPane: {flex: 1},
});
