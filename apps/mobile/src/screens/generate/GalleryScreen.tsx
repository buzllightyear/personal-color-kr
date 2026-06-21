/**
 * GalleryScreen — pure presentational screen for the user's generated-image
 * gallery tab (Content Generation AC4).
 *
 * Design contract (props-in / callbacks-out):
 *   All data + callbacks arrive as props; no network I/O, no router, no expo
 *   modules. The route (`app/(generate)/(tabs)/gallery.tsx`) owns the transport,
 *   the auth token, the authenticated image sources, and the camera-roll save —
 *   so this screen unit-tests without any provider/router context.
 *
 * States: loading skeleton → error fallback → empty-state → image list. Each
 * item renders the (authenticated) image plus a "save to camera roll" CTA.
 *
 * TestIDs (public contract, pinned by tests):
 *   - `gallery-screen`             root container (populated state)
 *   - `gallery-loading`            loading skeleton
 *   - `gallery-error`              error fallback
 *   - `gallery-empty`              empty-state
 *   - `gallery-item-{id}`          per-item container
 *   - `gallery-image-{id}`         the Image for each item
 *   - `gallery-save-{id}`          per-item save CTA (Pressable)
 */
import * as React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { COLORS, SPACING } from '../../theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Image source for a gallery item — a URI plus optional auth headers. */
export interface GalleryImageSource {
  readonly uri: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A single gallery entry the screen renders. */
export interface GalleryScreenItem {
  readonly generationId: string;
  readonly recipeId: string;
  readonly imageSource: GalleryImageSource;
}

export interface GalleryScreenProps {
  /** Gallery items in display order (server delivers newest first). */
  readonly items: readonly GalleryScreenItem[];
  /** `true` while the route awaits the gallery response. */
  readonly loading: boolean;
  /** `true` when the gallery fetch failed. */
  readonly error: boolean;
  /** Invoked when the user taps a row's "save to camera roll" CTA. */
  readonly onSave: (generationId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GalleryScreen(props: GalleryScreenProps): React.ReactElement {
  const { items, loading, error, onSave } = props;

  if (loading) {
    return <View testID="gallery-loading" style={styles.loadingContainer} />;
  }

  if (error) {
    return (
      <View testID="gallery-error" style={styles.centerContainer}>
        <Text style={styles.mutedText}>갤러리를 불러오지 못했어요.</Text>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View testID="gallery-empty" style={styles.centerContainer}>
        <Text style={styles.mutedText}>아직 만든 이미지가 없어요.</Text>
      </View>
    );
  }

  return (
    <View testID="gallery-screen" style={styles.container}>
      <Text style={styles.heading}>내 갤러리</Text>
      <ScrollView contentContainerStyle={styles.list} testID="gallery-list">
        {items.map((item) => (
          <View
            key={item.generationId}
            testID={`gallery-item-${item.generationId}`}
            style={styles.card}
          >
            <Image
              testID={`gallery-image-${item.generationId}`}
              source={item.imageSource}
              style={styles.image}
              resizeMode="cover"
              accessibilityLabel={item.recipeId}
            />
            <Pressable
              testID={`gallery-save-${item.generationId}`}
              onPress={() => onSave(item.generationId)}
              accessibilityRole="button"
              accessibilityLabel="카메라 롤에 저장"
              style={styles.saveButton}
            >
              <Text style={styles.saveLabel}>카메라 롤에 저장</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.grayscale.background,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.grayscale.text,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  list: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.grayscale.border,
    overflow: 'hidden',
    backgroundColor: COLORS.grayscale.background,
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: COLORS.base.pink,
  },
  saveButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  saveLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.grayscale.text,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#f2f2f2',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  mutedText: {
    fontSize: 14,
    color: COLORS.grayscale.disabled,
  },
});
