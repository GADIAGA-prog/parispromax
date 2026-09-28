import React, { useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text } from 'react-native';
import * as Application from 'expo-application';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { androidUpdateAvailable } from '../../shared/androidUpdate';

export default function AndroidUpdateBanner() {
  const insets = useSafeAreaInsets();
  const [release, setRelease] = useState(null);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    let active = true;
    const check = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('https://www.parispromax.com/android-release.json', { signal: controller.signal });
        if (!response.ok) return;
        const value = await response.json();
        if (active) setRelease(androidUpdateAvailable(value, Application.nativeBuildVersion) ? value : null);
      } catch { /* Keep the app usable offline. */ }
      finally { clearTimeout(timeout); }
    };
    void check();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => { active = false; subscription.remove(); };
  }, []);
  if (!release) return null;
  return <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://www.parispromax.com/#android-update').catch(() => {})} style={[styles.banner, { paddingTop: insets.top + 12 }]}>
    <Text style={styles.title}>ParisPromax {release.version} est disponible</Text>
    <Text style={styles.text}>Téléchargez la mise à jour sur le site pour remplacer votre ancienne version.</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  banner: { backgroundColor: '#9f2424', padding: 14 },
  title: { color: '#fff', fontSize: 13, fontWeight: '800' },
  text: { color: '#fff', fontSize: 11, marginTop: 3 },
});
