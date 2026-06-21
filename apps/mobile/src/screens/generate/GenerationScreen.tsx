/**
 * GenerationScreen — pure presentational screen for the AC2 generation flow.
 *
 * Design contract (props-in / callbacks-out):
 *   Receives all state + callbacks as plain props; no network I/O, no router,
 *   no side-effect hooks. The route file owns the selfie pick, the
 *   `request-generation` transport call, the 30 s loading window, and the
 *   `status` state machine. This split lets the screen be unit-tested without
 *   any provider/router context.
 *
 * State machine (driven by the `status` prop):
 *   - `idle`     → a "generate" CTA (the user has a recipe selected).
 *   - `loading`  → a loading indicator (the route holds this ≤ 30 s).
 *   - `success`  → renders the server-side watermarked result image.
 *   - `error`    → a Korean error message + a "try again" CTA. Maps the
 *                  recoverable vs unrecoverable error kinds to copy.
 *
 * TestIDs (public contract, pinned by tests):
 *   - `generation-screen`          — root container
 *   - `generation-generate-button` — idle-state CTA
 *   - `generation-loading`         — loading indicator container
 *   - `generation-result`          — result <Image>
 *   - `generation-error`           — error container
 *   - `generation-retry-button`    — error-state retry CTA
 */
import * as React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { GenerationErrorKind } from '../../request-generation';
import { COLORS, SPACING } from '../../theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type GenerationStatus = 'idle' | 'loading' | 'success' | 'error';

export interface GenerationScreenProps {
  /** Current step in the generation state machine. */
  readonly status: GenerationStatus;
  /** Watermarked result data URI (`data:image/png;base64,...`); success only. */
  readonly imageDataUri?: string | null;
  /** Discriminated failure kind; error state only. */
  readonly errorKind?: GenerationErrorKind | null;
  /** Invoked when the user taps the idle-state "generate" CTA. */
  readonly onGenerate: () => void;
  /** Invoked when the user taps the error-state "try again" CTA. */
  readonly onRetry: () => void;
}

// ---------------------------------------------------------------------------
// Korean copy
// ---------------------------------------------------------------------------

const _COPY = {
  title: '이미지 생성',
  generate: '생성하기',
  loading: '생성 중이에요…',
  retry: '다시 시도',
  // Error copy keyed by recoverability. Unrecoverable kinds get a distinct line.
  errorRecoverable: '지금 생성이 어려워요. 다시 시도해 주세요.',
  errorUnauthorized: '로그인이 필요해요.',
  errorRecipeMissing: '이 레시피는 더 이상 사용할 수 없어요.',
} as const;

function _errorMessage(kind: GenerationErrorKind | null | undefined): string {
  if (kind === 'unauthorized') return _COPY.errorUnauthorized;
  if (kind === 'recipe_not_found') return _COPY.errorRecipeMissing;
  return _COPY.errorRecoverable;
}

/** A retry CTA is pointless for terminal, non-recoverable failures. */
function _isRetryable(kind: GenerationErrorKind | null | undefined): boolean {
  return kind !== 'unauthorized' && kind !== 'recipe_not_found';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GenerationScreen(props: GenerationScreenProps): React.ReactElement {
  const { status, imageDataUri, errorKind, onGenerate, onRetry } = props;

  return (
    <View testID="generation-screen" style={styles.container}>
      <Text style={styles.title}>{_COPY.title}</Text>

      {status === 'idle' && (
        <Pressable
          testID="generation-generate-button"
          accessibilityRole="button"
          accessibilityLabel={_COPY.generate}
          onPress={onGenerate}
          style={styles.cta}
        >
          <Text style={styles.ctaLabel}>{_COPY.generate}</Text>
        </Pressable>
      )}

      {status === 'loading' && (
        <View testID="generation-loading" style={styles.center}>
          <Text style={styles.muted}>{_COPY.loading}</Text>
        </View>
      )}

      {status === 'success' && imageDataUri != null && (
        <Image
          testID="generation-result"
          accessibilityRole="image"
          source={{ uri: imageDataUri }}
          style={styles.result}
          resizeMode="contain"
        />
      )}

      {status === 'error' && (
        <View testID="generation-error" style={styles.center}>
          <Text style={styles.muted}>{_errorMessage(errorKind)}</Text>
          {_isRetryable(errorKind) && (
            <Pressable
              testID="generation-retry-button"
              accessibilityRole="button"
              accessibilityLabel={_COPY.retry}
              onPress={onRetry}
              style={styles.cta}
            >
              <Text style={styles.ctaLabel}>{_COPY.retry}</Text>
            </Pressable>
          )}
        </View>
      )}
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
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
  },
  title: {
    fontSize: 20,
    color: COLORS.grayscale.text,
    paddingBottom: SPACING.lg,
  },
  cta: {
    padding: SPACING.md,
    borderRadius: 12,
    backgroundColor: COLORS.base.pink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.grayscale.border,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  ctaLabel: {
    fontSize: 16,
    color: COLORS.grayscale.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
  },
  muted: {
    fontSize: 15,
    color: COLORS.grayscale.disabled,
  },
  result: {
    flex: 1,
    width: '100%',
    marginVertical: SPACING.md,
  },
});
