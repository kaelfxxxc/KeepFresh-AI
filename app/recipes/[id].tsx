import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { recipeService } from '../../src/services/recipeService';
import { RecipeImage, matchTone } from '../../src/components/RecipeImage';
import type { Recipe, RecipeIngredient } from '../../src/types';
import { COLORS, SPACING, RADII } from '../../src/theme';
import {
  Heart, Clock3, Timer, Users, ChefHat, ArrowLeft, Check, Plus,
  UtensilsCrossed, ShoppingCart,
} from 'lucide-react-native';
import { PillButton, StatusBadge } from '../../src/components/ui';

export default function RecipeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const recipeId = params.id;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  /** Tick-offs as the user cooks. Available ingredients only — you can't check off what you don't have. */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  /** Ingredient names already on the grocery list, by name. */
  const [listed, setListed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!recipeId || !profile) return;
    (async () => {
      try {
        const detail = await recipeService.getRecipeDetail(recipeId);
        if (detail) {
          setRecipe(detail.recipe);
          setIngredients(detail.ingredients);
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
    Alert.alert('Use in Recipe', 'Check off ingredients as you go — when done you\'ll be back in your kitchen.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start cooking', onPress: () => router.back() },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primary} />
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
        <PillButton title="Go back" onPress={() => router.back()} style={{ marginTop: SPACING.md }} />
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
            <ArrowLeft size={20} color={COLORS.text} strokeWidth={2.4} />
          </Pressable>
          <Pressable style={[styles.roundBtn, { top: insets.top + 6, right: SPACING.lg }]} onPress={toggleFavorite} hitSlop={8}>
            <Heart size={20} color={isFavorite ? COLORS.danger : COLORS.text} fill={isFavorite ? COLORS.danger : 'transparent'} strokeWidth={2} />
          </Pressable>
          <StatusBadge label={recipe.category || 'Meal'} tone="success" style={styles.heroBadge} />
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>{recipe.name}</Text>
          {!!recipe.description && <Text style={styles.desc}>{recipe.description}</Text>}

          <View style={styles.metaRow}>
            <View style={styles.metaChip}>
              <Clock3 size={14} color={COLORS.primary} strokeWidth={2.2} />
              <Text style={styles.metaText}>{recipe.prep_time} mins prep</Text>
            </View>
            {recipe.cook_time != null && (
              <View style={styles.metaChip}>
                <Timer size={14} color={COLORS.primary} strokeWidth={2.2} />
                <Text style={styles.metaText}>{recipe.cook_time} mins cook</Text>
              </View>
            )}
            <View style={styles.metaChip}><ChefHat size={14} color={COLORS.primary} strokeWidth={2.2} /><Text style={styles.metaText}>{recipe.difficulty}</Text></View>
            <View style={styles.metaChip}><Users size={14} color={COLORS.primary} strokeWidth={2.2} /><Text style={styles.metaText}>Serves {recipe.servings}</Text></View>
          </View>

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
                  <StatusBadge label={`${recipe.match_percent}% match`} tone={matchTone(recipe.match_percent)} />
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
                  style={{ marginTop: SPACING.md }}
                />
              )}
            </View>
          )}

          {available.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>In your pantry</Text>
              <View style={styles.card}>
                {available.map((ing) => {
                  const on = !!checked[ing.id];
                  return (
                    <Pressable key={ing.id} style={styles.ingRow} onPress={() => setChecked((c) => ({ ...c, [ing.id]: !on }))}>
                      <View style={[styles.check, on && styles.checkOn]}>
                        {on && <Check size={13} color={COLORS.white} strokeWidth={3} />}
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
              <Text style={styles.sectionTitle}>Still to buy</Text>
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
                          ? <Check size={14} color={COLORS.white} strokeWidth={3} />
                          : <Plus size={14} color={COLORS.primary} strokeWidth={3} />}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>Steps</Text>
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

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SPACING.md }]}>
        <View style={styles.bottomLeft}>
          <Text style={styles.bottomLabel}>
            {available.length > 0 ? `${checkedCount}/${available.length} ready` : 'Nothing to check off'}
          </Text>
          <Text style={styles.bottomTitle}>{allChecked ? 'All set — let\'s cook!' : 'Use in Recipe'}</Text>
        </View>
        <PillButton title={allChecked ? 'Cook Now' : 'Use in Recipe'} icon={UtensilsCrossed} onPress={handleUseIngredients} style={{ paddingHorizontal: SPACING.xl }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, gap: 10, padding: SPACING.xl },
  loadingText: { color: COLORS.secondaryText, textAlign: 'center' },
  missingTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  hero: { height: 230, position: 'relative' },
  heroBadge: { position: 'absolute', left: SPACING.lg, bottom: SPACING.md },
  roundBtn: {
    position: 'absolute', left: SPACING.lg,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center',
  },
  content: { padding: SPACING.lg },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text, letterSpacing: -0.3 },
  desc: { fontSize: 14, color: COLORS.secondaryText, lineHeight: 21, marginTop: SPACING.xs },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.md },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primaryLight, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADII.pill,
  },
  metaText: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark, textTransform: 'capitalize' },
  matchCard: {
    backgroundColor: COLORS.white, borderRadius: RADII.card, padding: SPACING.md,
    marginTop: SPACING.md, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  matchHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  matchTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.text },
  matchSub: { fontSize: 13, color: COLORS.secondaryText, marginTop: 4, lineHeight: 18 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  card: {
    backgroundColor: COLORS.white, borderRadius: RADII.card, paddingHorizontal: SPACING.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.divider,
  },
  ingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.divider, gap: 12 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: COLORS.divider, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: COLORS.secondary, borderColor: COLORS.secondary },
  ingName: { flex: 1, fontSize: 14, fontWeight: '500', color: COLORS.text },
  ingNameOn: { textDecorationLine: 'line-through', color: COLORS.secondaryText },
  optionalTag: { fontSize: 12, fontWeight: '500', color: COLORS.secondaryText, fontStyle: 'italic' },
  ingQty: { fontSize: 13, color: COLORS.secondaryText, fontWeight: '600' },
  addBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  addBtnOn: { backgroundColor: COLORS.secondary },
  steps: { gap: SPACING.md },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 0,
  },
  stepNumText: { color: COLORS.white, fontWeight: '800', fontSize: 14 },
  stepText: { flex: 1, fontSize: 14, color: COLORS.text, lineHeight: 21 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.white, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.divider,
  },
  bottomLeft: { flex: 1, paddingRight: SPACING.md },
  bottomLabel: { fontSize: 11, color: COLORS.secondaryText, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  bottomTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
});
