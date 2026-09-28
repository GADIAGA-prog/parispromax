import React, { useEffect } from 'react';
import { View } from 'react-native';
import AndroidUpdateBanner from './src/components/AndroidUpdateBanner';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './src/context/AuthContext';
import { SettingsProvider } from './src/context/SettingsContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ensureSeedCached } from './src/services/dataService';

export default function App() {
  useEffect(() => {
    // Warm the offline cache. Notification permission is requested only after
    // an explicit user action from the profile screen.
    ensureSeedCached();
  }, []);

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <View style={{ flex: 1 }}>
            <AndroidUpdateBanner />
            <RootNavigator />
          </View>
        </AuthProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
