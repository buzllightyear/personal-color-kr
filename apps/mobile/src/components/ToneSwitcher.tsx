/**
 * ToneSwitcher — Phase 3.3 Tone Switcher UI component (Sub-AC 5+6).
 *
 * Mounted on every tab. Lets the user pick any of the 4 seasons; the
 * pick propagates globally via {@link useToneState} (a tone change in
 * any tab re-renders all 4 tabs to the new tone within the same render
 * frame).
 *
 * Emits `tone_switched { from, to }` to PostHog when the user picks a
 * tone different from the current one. No event fires when the user
 * taps the currently-active chip (idempotent UI).
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePostHog } from 'posthog-react-native';

import type { Season } from '../contracts/post-payment-views';
import { trackToneSwitched } from '../analytics/track-tone-switched';
import { useToneState } from '../providers/ToneStateProvider';

const ALL_SEASONS: readonly Season[] = [
  'spring-warm',
  'summer-cool',
  'autumn-warm',
  'winter-cool',
];

const KOREAN_LABEL: Readonly<Record<Season, string>> = {
  'spring-warm': '봄웜',
  'summer-cool': '여름쿨',
  'autumn-warm': '가을웜',
  'winter-cool': '겨울쿨',
};

export function ToneSwitcher(): React.ReactElement {
  const { current, setTone } = useToneState();
  const posthog = usePostHog();

  return (
    <View style={styles.row} testID="tone-switcher">
      {ALL_SEASONS.map((season) => {
        const isActive = season === current;
        return (
          <Pressable
            key={season}
            onPress={() => {
              if (isActive) {
                return;
              }
              const previous = current;
              setTone(season);
              trackToneSwitched(posthog, { from: previous, to: season });
            }}
            style={[styles.chip, isActive && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            testID={`tone-switcher-chip-${season}`}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {KOREAN_LABEL[season]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d0d0d0',
  },
  chipActive: {
    borderColor: '#222',
    backgroundColor: '#222',
  },
  label: {
    fontSize: 13,
    color: '#444',
  },
  labelActive: {
    color: '#fff',
    fontWeight: '600',
  },
});
