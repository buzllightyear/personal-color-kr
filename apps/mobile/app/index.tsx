import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Root index route for the personal-color-kr Expo app shell.
 *
 * This is a placeholder landing screen. Per the Phase 2 shell scope, no
 * production UI is implemented here — the file exists so that Expo Router
 * has a valid `/` route while the conditional redirect scaffold lives in
 * `app/_layout.tsx` (paywall/referral gates land in Phase 3/4).
 */
export default function Index(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>personal-color-kr</Text>
      <Text style={styles.subtitle}>App shell placeholder</Text>
      <Link href="/step-1" style={styles.link}>
        Enter funnel
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.6,
    marginBottom: 24,
  },
  link: {
    fontSize: 16,
    color: '#2563eb',
  },
});
