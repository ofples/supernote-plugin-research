import React, {useEffect, useState, useRef} from 'react';
import {AppState, Pressable, StyleSheet, Text, View} from 'react-native';
import {loadConfig, saveConfig, getCachedConfig} from '../utils/config';
import {CheckRow, Section, Segmented, SettingRow} from '../components/settings';
import {
  launcherStatus,
  reloadLauncher,
  requestLauncherPermission,
  confirmLauncherPreference,
} from './service';

export default function LauncherSettings() {
  const [enabled, setEnabled] = useState(false);
  const [edge, setEdge] = useState('right');
  const [permission, setPermission] = useState(false);
  const [available, setAvailable] = useState(false);
  const [foregroundDetection, setForegroundDetection] = useState(true);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const refresh = async () => {
    try {
      const status = await launcherStatus();
      setPermission(status.permission);
      setAvailable(status.available);
      setForegroundDetection(status.foregroundDetection === true);
      await reloadLauncher();
      const config = await loadConfig();
      if (!savingRef.current) {
        setEnabled(config.launcherEnabled === true);
        setEdge(config.launcherEdge === 'left' ? 'left' : 'right');
      }
      if (status.hidePending) {
        setMessage('Hidden. Saved on device.');
      }
    } catch (error: any) {
      setMessage(error.message || 'Launcher status could not be checked.');
    }
  };
  useEffect(() => {
    let mounted = true;
    loadConfig()
      .then(config => {
        if (mounted && !savingRef.current) {
          setEnabled(config.launcherEnabled === true);
          setEdge(config.launcherEdge === 'left' ? 'left' : 'right');
        }
      })
      .catch(() => {});
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
    // Status is deliberately checked on returning from the permission screen.
  }, []);
  const change = async (next: {
    launcherEnabled?: boolean;
    launcherEdge?: string;
    launcherPosition?: number;
  }) => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    const previous = {enabled, edge};
    setSaving(true);
    setMessage('Saving locally…');
    if (next.launcherEnabled !== undefined) {
      setEnabled(next.launcherEnabled);
    }
    if (next.launcherEdge) {
      setEdge(next.launcherEdge);
    }
    let committed = false;
    try {
      if (!(await saveConfig(next))) {
        throw new Error('Settings could not be saved.');
      }
      committed = true;
      if (next.launcherEnabled !== undefined) {
        await confirmLauncherPreference();
        setEnabled(next.launcherEnabled);
      }
      if (next.launcherEdge) {
        setEdge(next.launcherEdge);
      }
      await reloadLauncher();
      setMessage('Saved on device');
    } catch (error: any) {
      if (!committed) {
        const durable = getCachedConfig();
        setEnabled(
          durable ? durable.launcherEnabled === true : previous.enabled,
        );
        setEdge(
          durable
            ? durable.launcherEdge === 'left'
              ? 'left'
              : 'right'
            : previous.edge,
        );
      }
      setMessage(error.message || 'Launcher settings failed.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <Section title="EDGE LAUNCHER">
      <Text style={styles.note}>
        Finger only. Tap to open tasks; drag to reposition. Hold for Hide and
        Settings. The button stays at the chosen edge when rotated. It hides
        while SuperTask is open.
      </Text>
      <Text style={styles.note}>
        Pen protection is unavailable: touching the button with the pen can
        leave ink in the note underneath. Use a finger and keep the button away
        from handwriting.
      </Text>
      {!available && (
        <Text style={styles.note}>
          Install the full plugin package to make the native launcher available.
        </Text>
      )}
      {available && !foregroundDetection && (
        <Text style={styles.note}>
          This host does not allow foreground detection. The launcher stays
          hidden to avoid covering other apps.
        </Text>
      )}
      <CheckRow
        checked={enabled}
        onToggle={() => {
          if (available && !saving) {
            change({launcherEnabled: !enabled});
          }
        }}
        label="Floating edge button"
        hint={
          permission
            ? 'Optional, finger only'
            : 'Requires Android overlay permission for PluginHost'
        }
      />
      {available && !permission && (
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={async () => {
            try {
              await requestLauncherPermission();
              setMessage(
                'Allow display over other apps for PluginHost, then return here.',
              );
            } catch (error: any) {
              setMessage(error.message);
            }
          }}>
          <Text>Allow display over other apps</Text>
        </Pressable>
      )}
      <SettingRow label="Edge">
        <Segmented
          options={[
            {label: 'Left', key: 'left'},
            {label: 'Right', key: 'right'},
          ]}
          value={edge}
          onChange={value => change({launcherEdge: value})}
        />
      </SettingRow>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => change({launcherEnabled: false})}>
          <Text>Hide / disable</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() =>
            change({launcherEdge: 'right', launcherPosition: 0.45})
          }>
          <Text>Reset position</Text>
        </Pressable>
      </View>
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {message}
        </Text>
      )}
    </Section>
  );
}
const styles = StyleSheet.create({
  note: {fontSize: 16, color: '#333', marginVertical: 8},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#555',
    marginVertical: 6,
  },
});
