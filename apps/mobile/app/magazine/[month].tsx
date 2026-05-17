import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Dynamic monthly magazine route — `/magazine/:month`.
 *
 * Phase 2 shell scope: this is a placeholder screen for the monthly magazine
 * content surface. The `[month]` segment is captured via Expo Router's
 * file-based dynamic routing convention and surfaced to the screen through
 * `useLocalSearchParams`. No real magazine content, Python-backed data, or
 * vendor API calls are wired here — those land in later phases. The async
 * boundary contract (`ScreenState` + `DataHook<T>`) will drive this screen
 * once `usePython<T>` is implemented in Phase 3/4.
 */
export default function MagazineMonthRoute(): JSX.Element {
  const { month } = useLocalSearchParams<{ month: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Magazine</Text>
      <Text style={styles.title}>Month: {month ?? 'unknown'}</Text>
      <Text style={styles.subtitle}>App shell placeholder</Text>
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
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    opacity: 0.5,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.6,
  },
});
