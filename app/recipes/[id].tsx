import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { recipeService } from '../../src/services/recipeService';
import { RecipeImage, matchTone } from '../../src/components/RecipeImage';
import { cuisineLabel } from '../../src/utils/pantryRecipes';
import type { Recipe, RecipeIngredient } from '../../src/types';
import { colors, radii, spacing, shadow } from '../../src/theme';
import {
  Heart, Clock3, Timer, Users, ChefHat, ArrowLeft, Check, Plus,
  UtensilsCrossed, ShoppingCart, Package,
} from 'lucide-react-native';
import { PillButton, StatusPill, SectionHeader, colorWithOpacity } from '../../src/components/ui';
import { usePageGutter } from '../../src/hooks/useContentLayout';

/**
 * The match percentage as a pill status, so the recipe card uses the same
 * green / dark-green / amber logic as the rest of the app rather than a second
 * palette of its own.
 */
function matchStatus(percent: number | null): 'fresh' | 'active' | 'expiringSoon' {
  const tone = matchTone(percent);
  return tone === 'success' ? 'fresh' : tone === 'primary' ? 'active' : 'expiringSoon';
}

export default function RecipeDetailScreen() {
  // The hero photo stays full-bleed; the text column and the pinned bottom bar
  // take the page gutter so they centre together on a wide screen.
  const { gutter } = usePageGutter();
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const recipeId = params.id;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  /** The product this dish was generated around, when it was one of those sets. */
  const [primaryItem, setPrimaryItem] = useState<string | null>(null);
  /** Tick-offs as the user cooks. Available ingredients only — you can't check off what you don't have. */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  /** Ingredient names already on the grocery list, by name. */
  const [listed, setListed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [timerStarted, setTimerStarted] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (!recipeId || !profile) return;
    (async () => {
      try {
        const detail = await recipeService.getRecipeDetail(recipeId);
        if (detail) {
          setRecipe(detail.recipe);
          setIngredients(detail.ingredients);
          setPrimaryItem(detail.primaryItemName);
        }
        setIsFavorite(await recipeService.isFavorite(profile.id, recipeId));

        // Names already on the list, so the missing rows can say so.
        const names = await recipeService.getGroceryListNames(profile.id);
        setListed(Object.fromEntries(names.map((n) => [n, true])));
      } catch (error) {
        console.error('Error loading recipe:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [recipeId, profile]);

  useEffect(() => {
    if (profile?.account_type === 'establishment') {
      router.replace('/(tabs)');
    }
  }, [profile?.account_type]);

  const toggleFavorite = useCallback(async () => {
    if (!profile || !recipe) return;
    try {
      setIsFavorite(await recipeService.toggleFavorite(profile.id, recipe.id));
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  }, [profile, recipe]);

  const available = ingredients.filter((i) => i.available);
  const missing = ingredients.filter((i) => !i.available);
  // Optional garnishes are excluded: match_percent is computed over what the dish
  // actually needs, and the summary has to agree with the badge on the card.
  const required = ingredients.filter((i) => !i.optional);
  const matchedRequired = required.filter((i) => i.available).length;

  /**
   * Add ingredients to the grocery list and reflect the result.
   *
   * Idempotent on the server side — a name already on the list comes back in
   * `already_listed` rather than being inserted twice — so both the per-row
   * button and "add all" can call this without checking first.
   */
  const addToList = useCallback(async (items: RecipeIngredient[], announce: boolean) => {
    if (!profile || items.length === 0 || adding) return;
    setAdding(true);
    try {
      const result = await recipeService.addIngredientsToGroceryList(profile.id, items);
      setListed((current) => {
        const next = { ...current };
        for (const name of [...result.added, ...result.already_listed]) next[name] = true;
        return next;
      });

      if (!announce) return;
      Alert.alert(
        result.added.length > 0 ? 'Added to your grocery list' : 'Already on your list',
        result.added.length > 0
          ? `${result.added.length} ${result.added.length === 1 ? 'item is' : 'items are'} now on your grocery list.`
          : `All ${result.already_listed.length} were already there.`,
      );
    } catch (error) {
      console.error('Error adding ingredients to grocery list:', error);
      Alert.alert('Couldn\'t update your list', 'Something went wrong. Please try again.');
    } finally {
      setAdding(false);
    }
  }, [adding, profile]);

  const handleUseIngredients = () => {
    if (!recipe) return;
    const minutes = Math.max(1, recipe.cook_time ?? recipe.prep_time ?? 1);
    setTimerStarted(true);
    setRemainingSeconds(minutes * 60);
  };

  useEffect(() => {
    if (!timerStarted || remainingSeconds <= 0) return;
    const interval = setInterval(() => {
      setRemainingSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingSeconds, timerStarted]);

  const timerMinutes = Math.floor(remainingSeconds / 60).toString().padStart(2, '0');
  const timerSeconds = (remainingSeconds % 60).toString().padStart(2, '0');

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>Loading recipe…</Text>
      </View>
    );
  }

  // A recipe that is gone, or one RLS has hidden because it belongs to someone
  // else. Both are "not here", and the back button is the only useful action.
  if (!recipe) {
    return (
      <View style={styles.loading}>
        <Text style={styles.missingTitle}>Recipe not available</Text>
        <Text style={styles.loadingText}>It may have been replaced by a newer set of suggestions.</Text>
        <PillButton title="Go back" onPress={() => router.back()} style={{ marginTop: spacing.md }} />
      </View>
    );
  }

  const checkedCount = Object.values(checked).filter(Boolean).length;
  const allChecked = available.length > 0 && checkedCount === available.length;
  const stillToBuy = missing.filter((i) => !listed[i.ingredient_name]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.hero}>
          <RecipeImage
            uri={recipe.image_url}
            category={recipe.category}
            width="100%"
            height={230}
            radius={0}
            emojiSize={72}
          />
          <Pressable style={[styles.roundBtn, { top: insets.top + 6 }]} onPress={() => router.back()} hitSlop={8}>
            <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.4} />
          </Pressable>
          <Pressable style={[styles.roundBtn, { top: insets.top + 6, right: spacing.xl }]} onPress={toggleFavorite} hitSlop={8}>
            <Heart size={20} color={isFavorite ? colors.danger : colors.textPrimary} fill={isFavorite ? colors.danger : 'transparent'} strokeWidth={2} />
          </Pressable>
          {/* Category and cuisine together: both describe what the dish *is*, so
              they sit over the photo rather than in the row of facts below it. */}
          <View style={styles.heroBadges}>
            <StatusPill status="fresh" label={recipe.category || 'Meal'} />
            {!!recipe.cuisine && <StatusPill status="active" label={cuisineLabel(recipe.cuisine)} />}
          </View>
        </View>

        <View style={[styles.content, { paddingHorizontal: gutter }]}>
          <Text style={styles.title}>{recipe.name}</Text>
          {!!recipe.description && <Text style={styles.desc}>{recipe.description}</Text>}

          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Clock3 size={14} color={colors.primaryDark} strokeWidth={2.2} />
              <Text style={styles.metaText}>{recipe.prep_time} mins prep</Text>
            </View>
            {recipe.cook_time != null && (
              <View style={styles.metaChip}>
                <Timer size={14} color={colors.primaryDark} strokeWidth={2.2} />
                <Text style={styles.metaText}>{recipe.cook_time} mins cook</Text>
              </View>
            )}
            <View style={styles.metaChip}><ChefHat size={14} color={colors.primaryDark} strokeWidth={2.2} /><Text style={styles.metaText}>{recipe.difficulty}</Text></View>
            <View style={styles.metaChip}><Users size={14} color={colors.primaryDark} strokeWidth={2.2} /><Text style={styles.metaText}>Serves {recipe.servings}</Text></View>
            {/* Only the per-product sets have one of these, and it is the answer
                to "why did the app suggest this to me" — so it is stated, not
                left for the ingredients list to imply. */}
            {!!primaryItem && (
              <View style={styles.metaChip}>
                <Package size={14} color={colors.primaryDark} strokeWidth={2.2} />
                <Text style={styles.metaText}>For {primaryItem}</Text>
              </View>
            )}
          </View>

          {timerStarted && (
            <View style={styles.timerCard}>
              <View style={styles.timerIcon}>
                <Timer size={18} color={colors.primary} strokeWidth={2.3} />
              </View>
              <View style={styles.timerCopy}>
                <Text style={styles.timerLabel}>Cooking timer</Text>
                <Text style={styles.timerValue}>
                  {remainingSeconds > 0 ? `${timerMinutes}:${timerSeconds}` : 'Done'}
                </Text>
              </View>
              <Text style={styles.timerHint}>
                {remainingSeconds > 0 ? 'Keep cooking' : 'Ready to serve'}
              </Text>
            </View>
          )}

          {/* What this recipe costs you at the shop, in the numbers the card promised. */}
          {ingredients.length > 0 && (
            <View style={styles.matchCard}>
              <View style={styles.matchHeader}>
                <Text style={styles.matchTitle}>
                  {missing.length === 0
                    ? 'You have everything you need'
                    : `Uses ${matchedRequired} of ${required.length} ingredients`}
                </Text>
                {recipe.match_percent !== null && (
                  <StatusPill status={matchStatus(recipe.match_percent)} label={`${recipe.match_percent}% match`} />
                )}
              </View>
              <Text style={styles.matchSub}>
                {missing.length === 0
                  ? 'Nothing to buy — you can start cooking.'
                  : `${missing.length} still to buy${stillToBuy.length < missing.length ? ` · ${missing.length - stillToBuy.length} already on your list` : ''}.`}
              </Text>
              {missing.length > 0 && (
                <PillButton
                  title={adding ? 'Adding…' : `Add ${missing.length} to grocery list`}
                  icon={ShoppingCart}
                  onPress={() => addToList(missing, true)}
                  disabled={adding}
                  variant="outline"
                  style={{ marginTop: spacing.md }}
                />
              )}
            </View>
          )}

          {available.length > 0 && (
            <>
              <SectionHeader title="In your pantry" />
              <View style={styles.card}>
                {available.map((ing) => {
                  const on = !!checked[ing.id];
                  return (
                    <Pressable key={ing.id} style={styles.ingRow} onPress={() => setChecked((c) => ({ ...c, [ing.id]: !on }))}>
                      <View style={[styles.check, on && styles.checkOn]}>
                        {on && <Check size={13} color={colors.surface} strokeWidth={3} />}
                      </View>
                      <Text style={[styles.ingName, on && styles.ingNameOn]}>{ing.ingredient_name}</Text>
                      {ing.quantity != null && (
                        <Text style={styles.ingQty}>{ing.quantity} {ing.unit || ''}</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {missing.length > 0 && (
            <>
              <SectionHeader title="Still to buy" />
              <View style={styles.card}>
                {missing.map((ing) => {
                  const on = !!listed[ing.ingredient_name];
                  return (
                    <View key={ing.id} style={styles.ingRow}>
                      <Text style={styles.ingName}>
                        {ing.ingredient_name}
                        {ing.optional && <Text style={styles.optionalTag}>  optional</Text>}
                      </Text>
                      {ing.quantity != null && (
                        <Text style={styles.ingQty}>{ing.quantity} {ing.unit || ''}</Text>
                      )}
                      <Pressable
                        onPress={() => addToList([ing], false)}
                        disabled={on || adding}
                        hitSlop={8}
                        style={[styles.addBtn, on && styles.addBtnOn]}
                      >
                        {on
                          ? <Check size={14} color={colors.surface} strokeWidth={3} />
                          : <Plus size={14} color={colors.primary} strokeWidth={3} />}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          <SectionHeader title="Steps" />
          <View style={styles.steps}>
            {(recipe.instructions || []).map((step, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.bottomLeft}>
          <Text style={styles.bottomLabel}>
            {available.length > 0 ? `${checkedCount}/${available.length} ready` : 'Nothing to check off'}
          </Text>
          <Text style={styles.bottomTitle}>{allChecked ? 'All set — let\'s cook!' : 'Use in Recipe'}</Text>
        </View>
        <PillButton
          title={timerStarted && remainingSeconds > 0 ? 'Restart timer' : allChecked ? 'Cook Now' : 'Use in Recipe'}
          icon={UtensilsCrossed}
          onPress={handleUseIngredients}
          style={{ paddingHorizontal: spacing.xl }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.screenBg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screenBg, gap: spacing.sm, padding: spacing.xl },
  loadingText: { color: colors.textSecondary, textAlign: 'center' },
  missingTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  hero: { height: 230, position: 'relative' },
  heroBadges: {
    position: 'absolute',
    left: spacing.xl,
    bottom: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  roundBtn: {
    position: 'absolute', left: spacing.xl,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colorWithOpacity(colors.surface, 0.92), alignItems: 'center', justifyContent: 'center',
  },
  content: { paddingVertical: spacing.xl },
  title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.3 },
  desc: { fontSize: 14, color: colors.textSecondary, lineHeight: 21, marginTop: spacing.xs },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.mintBg, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill,
  },
  metaText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark, textTransform: 'capitalize' },
  matchCard: {
    backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg,
    marginTop: spacing.lg, ...shadow.card,
  },
  matchHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  matchTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  matchSub: { fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  timerCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.mintBg, borderRadius: radii.lg,
    padding: spacing.md, marginTop: spacing.lg,
  },
  timerIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  timerCopy: { flex: 1 },
  timerLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  timerValue: { fontSize: 24, fontWeight: '800', color: colors.primaryDark, marginTop: 1 },
  timerHint: { fontSize: 12, fontWeight: '700', color: colors.primary },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  ingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 12 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  ingName: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  ingNameOn: { textDecorationLine: 'line-through', color: colors.textSecondary },
  optionalTag: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, fontStyle: 'italic' },
  ingQty: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  addBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.mintBg, alignItems: 'center', justifyContent: 'center',
  },
  addBtnOn: { backgroundColor: colors.primary },
  steps: { gap: spacing.md },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 0,
  },
  stepNumText: { color: colors.surface, fontWeight: '800', fontSize: 14 },
  stepText: { flex: 1, fontSize: 14, color: colors.textPrimary, lineHeight: 21 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  bottomLeft: { flex: 1, paddingRight: spacing.md },
  bottomLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  bottomTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
});
