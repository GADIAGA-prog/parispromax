import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// expo-notifications (push) was removed from Expo Go in SDK 53+. We only use
// LOCAL notifications, but loading/initializing the module in Expo Go still
// logs a noisy warning. Detect Expo Go so we can skip setup there; everything
// runs normally in a development build / standalone app.
const IS_EXPO_GO = Constants.appOwnership === 'expo';

// ---------------------------------------------------------------------------
// PARISPROMAX — Local push notifications (simulated alerts)
//
//  - "Morning Alert"  : every day at 08:00 -> pronostics du jour ready.
//  - "Urgency Alert"  : 15 min before a given race start time.
//
// Uses expo-notifications local scheduling (no remote server required), which
// keeps it working offline.
// ---------------------------------------------------------------------------

// Foreground display behavior. Skipped in Expo Go: any native expo-notifications
// call there emits the "push removed from Expo Go" warning.
if (!IS_EXPO_GO) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function registerForNotifications() {
  if (IS_EXPO_GO) return false; // skip in Expo Go (avoids push-removed warning)
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('pronostics', {
        name: 'Pronostics PMU',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#10b981',
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    return status === 'granted';
  } catch (e) {
    console.warn('Notification registration failed', e);
    return false;
  }
}

// Daily 08:00 "Morning Alert".
export async function scheduleMorningAlert() {
  if (IS_EXPO_GO) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '☀️ Pronostics du jour disponibles',
        body: "Les pronostics IA et le Quinté+ du jour sont prêts. Bonne chance !",
        data: { type: 'morning' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 8,
        minute: 0,
      },
    });
  } catch (e) {
    console.warn('scheduleMorningAlert failed', e);
    return null;
  }
}

// "Urgency Alert" 15 minutes before a race (pass a JS Date of the race start).
export async function scheduleRaceUrgencyAlert(raceName, startDate) {
  if (IS_EXPO_GO) return null;
  try {
    const fireAt = new Date(startDate.getTime() - 15 * 60 * 1000);
    if (fireAt.getTime() <= Date.now()) return null; // too late, skip
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '⏱️ Départ imminent !',
        body: `${raceName} dans 15 min — vérifiez vos TOP PRONOS IA maintenant.`,
        data: { type: 'urgency', race: raceName },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
  } catch (e) {
    console.warn('scheduleRaceUrgencyAlert failed', e);
    return null;
  }
}

// Fire an immediate demo notification (used by the Dev Panel / Profile).
// Returns false in Expo Go so the caller can show an in-app message instead.
export async function sendTestNotification() {
  if (IS_EXPO_GO) return false;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔔 Alerte test ParisPromax',
        body: '🔥 TOP PRONO: Eclair de Lune (n°1) — Value Bet détecté à Vincennes.',
        data: { type: 'test' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
    });
  } catch (e) {
    console.warn('sendTestNotification failed', e);
    return null;
  }
}

export async function cancelAll() {
  if (IS_EXPO_GO) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    // ignore
  }
}

// Convenience used at app startup.
export async function initNotifications() {
  const granted = await registerForNotifications();
  if (granted) {
    await scheduleMorningAlert();
  }
  return granted;
}

export default {
  registerForNotifications,
  scheduleMorningAlert,
  scheduleRaceUrgencyAlert,
  sendTestNotification,
  cancelAll,
  initNotifications,
};
