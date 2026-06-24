/**
 * RecipeCatalogScreen — pure presentational screen for the content-generation
 * recipe catalog tab (Content Generation Phase, Sub-AC 2).
 *
 * Design contract (props-in / callbacks-out):
 *   This component receives all data and callbacks as plain props and contains
 *   no network I/O, no router calls, and no side-effect hooks. The route file
 *   (`app/(generate)/(tabs)/catalog.tsx`) is the only place that touches
 *   `expo-router`, the API transport, and the auth token. This split allows
 *   the screen to be unit-tested without any provider or router context, and
 *   makes the network/auth concerns independently testable in the route.
 *
 * Sorting:
 *   The screen sorts the incoming `recipes` array by `displayOrder` ascending
 *   before rendering so the UI is correct regardless of the order in which the
 *   server (or a test fixture) delivers the items. The server already sorts by
 *   `publish_date DESC, display_order ASC`, but performing the client-side sort
 *   is a defensive guarantee that satisfies the Sub-AC contract without adding
 *   any network round-trip.
 *
 * Layout (portrait, vertical list):
 *
 *   ┌──────────────────────────────────┐
 *   │ 트렌드 레시피                     │  ← screen header (static label)
 *   ├──────────────────────────────────┤
 *   │ ┌──────────────────────────────┐ │
 *   │ │ recipe-id-1                  │ │  ← RecipeCard (Pressable) for each
 *   │ └──────────────────────────────┘ │    recipe sorted by displayOrder
 *   │ ┌──────────────────────────────┐ │
 *   │ │ recipe-id-2                  │ │
 *   │ └──────────────────────────────┘ │
 *   └──────────────────────────────────┘
 *
 * Empty-state:
 *   When `recipes` is empty and neither `loading` nor `error`, the screen
 *   renders a Korean empty-state message so the user is not left with a blank
 *   white screen.
 *
 * Accessibility:
 *   Each recipe card has `accessibilityRole="button"` and an
 *   `accessibilityLabel` equal to the recipe ID so VoiceOver/TalkBack can
 *   announce the item and activate it.
 *
 * TestIDs (public contract, pinned by tests):
 *   - `recipe-catalog-screen`          — root container
 *   - `recipe-catalog-loading`         — loading skeleton placeholder
 *   - `recipe-catalog-error`           — error fallback container
 *   - `recipe-catalog-empty`           — empty-state container
 *   - `recipe-catalog-item-{recipeId}` — Pressable wrapper per recipe
 *   - `recipe-catalog-label-{recipeId}` — Text label inside each card
 *     (uses `recipe-catalog-label-` NOT `recipe-catalog-item-label-` so that
 *     prefix queries on `recipe-catalog-item-` match only the Pressable wrappers)
 */
import * as React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CatalogRecipe } from '../../fetch-recipe-catalog';
import { COLORS, SPACING } from '../../theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RecipeCatalogScreenProps {
  /**
   * Sorted-or-unsorted recipe list from the server. The screen re-sorts by
   * `displayOrder` ascending before rendering so it is correct regardless of
   * delivery order.
   */
  readonly recipes: readonly CatalogRecipe[];
  /**
   * `true` while the route is awaiting the API response. The screen renders
   * a neutral skeleton placeholder.
   */
  readonly loading: boolean;
  /**
   * `true` when the API call failed. The screen renders a Korean error
   * fallback message.
   */
  readonly error: boolean;
  /**
   * Invoked when the user taps a recipe card. The route translates this into
   * a router push to the generation screen, passing `recipeId` as a
   * query parameter.
   */
  readonly onSelectRecipe: (recipeId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return a new array sorted by `displayOrder` ascending. Pure — no mutation.
 * The server already sorts, but this client-side sort is a defensive guarantee
 * that the Sub-AC contract requires ("sorts by display order").
 */
function sortByDisplayOrder(
  recipes: readonly CatalogRecipe[],
): readonly CatalogRecipe[] {
  return [...recipes].sort((a, b) => a.displayOrder - b.displayOrder);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecipeCatalogScreen(
  props: RecipeCatalogScreenProps,
): React.ReactElement {
  const { recipes, loading, error, onSelectRecipe } = props;

  if (loading) {
    return <View testID="recipe-catalog-loading" style={styles.loadingContainer} />;
  }

  if (error) {
    return (
      <View testID="recipe-catalog-error" style={styles.errorContainer}>
        <Text style={styles.errorText}>레시피를 불러오지 못했어요.</Text>
      </View>
    );
  }

  const sorted = sortByDisplayOrder(recipes);

  if (sorted.length === 0) {
    return (
      <View testID="recipe-catalog-empty" style={styles.emptyContainer}>
        <Text style={styles.emptyText}>아직 레시피가 없어요.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView
      testID="recipe-catalog-screen"
      edges={['top']}
      style={styles.container}
    >
      <Text style={styles.heading}>트렌드 레시피</Text>
      <ScrollView contentContainerStyle={styles.list} testID="recipe-catalog-list">
        {sorted.map((recipe) => (
          <Pressable
            key={recipe.recipeId}
            testID={`recipe-catalog-item-${recipe.recipeId}`}
            onPress={() => onSelectRecipe(recipe.recipeId)}
            accessibilityRole="button"
            accessibilityLabel={
              recipe.title.length > 0 ? recipe.title : recipe.recipeId
            }
            style={styles.card}
          >
            {recipe.thumbnailUrl !== null ? (
              <Image
                testID={`recipe-catalog-thumbnail-${recipe.recipeId}`}
                source={{ uri: recipe.thumbnailUrl }}
                style={styles.cardThumbnail}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View
                testID={`recipe-catalog-thumbnail-placeholder-${recipe.recipeId}`}
                style={styles.cardThumbnailPlaceholder}
              />
            )}
            <View style={styles.cardBody}>
              <Text
                testID={`recipe-catalog-label-${recipe.recipeId}`}
                style={styles.cardLabel}
              >
                {recipe.title}
              </Text>
              {recipe.description !== null && (
                <Text
                  testID={`recipe-catalog-description-${recipe.recipeId}`}
                  style={styles.cardDescription}
                  numberOfLines={2}
                >
                  {recipe.description}
                </Text>
              )}
              {recipe.tags.length > 0 && (
                <View style={styles.tagRow}>
                  {recipe.tags.map((tag, i) => (
                    <View
                      key={`${tag}-${i}`}
                      testID={`recipe-catalog-tag-${recipe.recipeId}-${i}`}
                      style={styles.tagChip}
                    >
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
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
    gap: SPACING.sm,
  },
  card: {
    padding: SPACING.md,
    borderRadius: 12,
    backgroundColor: COLORS.base.pink,
    borderWidth: 1,
    borderColor: COLORS.grayscale.border,
  },
  cardThumbnail: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    marginBottom: SPACING.sm,
  },
  cardThumbnailPlaceholder: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.grayscale.border,
  },
  cardBody: {
    gap: SPACING.xs,
  },
  cardLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.grayscale.text,
  },
  cardDescription: {
    fontSize: 13,
    color: COLORS.grayscale.disabled,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  tagChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 99,
    backgroundColor: COLORS.grayscale.border,
  },
  tagText: {
    fontSize: 11,
    color: COLORS.grayscale.text,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#f2f2f2',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.grayscale.disabled,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.grayscale.disabled,
  },
});
