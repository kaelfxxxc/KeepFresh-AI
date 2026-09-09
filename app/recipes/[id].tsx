import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { Recipe, RecipeIngredient } from '../../src/types';
import { COLORS, SPACING, RADII } from '../../src/theme';
import { Heart, Clock3, Users, ChefHat, ArrowLeft, Check, UtensilsCrossed } from 'lucide-react-native';
import { PillButton, StatusBadge } from '../../src/components/ui';

const emojiFor = (c?: string | null) =>
  c === 'desserts' ? '🍰' : c === 'meals' ? '🍝' : c === 'snacks' ? '🍿' : c === 'beverages' ? '🥤' : '🍲';
const bgFor = (c?: string | null) =>
  c === 'desserts' ? '#FCE9EF' : c === 'meals' ? COLORS.primaryLight : c === 'snacks' ? '#FFF3E0' : c === 'beverages' ? '#E8F1FD' : COLORS.mutedBg;

export default function RecipeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const recipeId = params.id;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [isFavorite, setIsFavorite] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!recipeId || !profile) return;
    (async () => {
      const { data: recipeData } = await supabase.from('recipes').select('*').eq('id', recipeId).single();
      setRecipe(recipeData);
      if (recipeData) {
        const { data: ing } = await supabase
          .from('recipe_ingredients')
          .select('*')
          .eq('recipe_id', recipeData.id)
          .order('id', { ascending: true });
        setIngredients((ing as RecipeIngredient[]) || []);
      }
      const { data: fav } = await supabase
        .from('favorite_recipes')
        .select('*')
        .eq('user_id', profile.id)
        .eq('recipe_id', recipeId)
        .single();
      setIsFavorite(!!fav);
      setLoading(false);
    })();
  }, [recipeId, profile]);

  const toggleFavorite = useCallback(async () => {
    if (!profile || !recipe) return;
    if (isFavorite) {
      await supabase.from('favorite_recipes').delete().eq('user_id', profile.id).eq('recipe_id', recipe.id);
    } else {
      await supabase.from('favorite_recipes').insert({ user_id: profile.id, recipe_id: recipe.id });
    }
    setIsFavorite(!isFavorite);
  }, [isFavorite, profile, recipe]);

  const handleUseIngredients = () => {
    Alert.alert('Use in Recipe', 'Check off ingredients as you go — when done you\'ll be back in your kitchen.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start cooking', onPress: () => router.back() },
    ]);
  };

  if (loading || !recipe) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading recipe…</Text>
      </View>
    );
  }

  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={[styles.hero, { backgroundColor: bgFor(recipe.category) }]}>
          <Pressable style={[styles.roundBtn, { top: insets.top + 6 }]} onPress={() => router.back()} hitSlop={8}>
            <ArrowLeft size={20} color={COLORS.text} strokeWidth={2.4} />
          </Pressable>
          <Pressable style={[styles.roundBtn, { top: insets.top + 6, right: SPACING.lg }]} onPress={toggleFavorite} hitSlop={8}>
            <Heart size={20} color={isFavorite ? COLORS.danger : COLORS.text} fill={isFavorite ? COLORS.danger : 'transparent'} strokeWidth={2} />
          </Pressable>
          <Text style={styles.heroEmoji}>{emojiFor(recipe.category)}</Text>
          <StatusBadge label={recipe.category || 'Meal'} tone="success" />
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>{recipe.name}</Text>
          {!!recipe.description && <Text style={styles.desc}>{recipe.description}</Text>}

          <View style={styles.metaRow}>
            <View style={styles.metaChip}><Clock3 size={14} color={COLORS.primary} strokeWidth={2.2} /><Text style={styles.metaText}>{recipe.prep_time} mins</Text></View>
            <View style={styles.metaChip}><ChefHat size={14} color={COLORS.primary} strokeWidth={2.2} /><Text style={styles.metaText}>{recipe.difficulty}</Text></View>
            <View style={styles.metaChip}><Users size={14} color={COLORS.primary} strokeWidth={2.2} /><Text style={styles.metaText}>Serves {recipe.servings}</Text></View>
          </View>

          <Text style={styles.sectionTitle}>Ingredients</Text>
          <View style={styles.card}>
            {ingredients.length === 0 ? (
              <Text style={styles.noData}>No ingredients listed for this recipe.</Text>
            ) : ingredients.map((ing) => {
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
          <Text style={styles.bottomLabel}>{checkedCount > 0 ? `${checkedCount}/${ingredients.length} ready` : 'Ingredients ready'}</Text>
          <Text style={styles.bottomTitle}>{checkedCount === ingredients.length ? 'All set — let\'s cook!' : 'Use in Recipe'}</Text>
        </View>
        <PillButton title={checkedCount === ingredients.length ? 'Cook Now' : 'Use in Recipe'} icon={UtensilsCrossed} onPress={handleUseIngredients} style={{ paddingHorizontal: SPACING.xl }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background, gap: 10 },
  loadingText: { color: COLORS.secondaryText },
  hero: { height: 230, alignItems: 'center', justifyContent: 'center' },
  roundBtn: {
    position: 'absolute', left: SPACING.lg,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center',
  },
  heroEmoji: { fontSize: 64, marginBottom: 10 },
  content: { padding: SPACING.lg },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text, letterSpacing: -0.3 },
  desc: { fontSize: 14, color: COLORS.secondaryText, lineHeight: 21, marginTop: SPACING.xs },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.md },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primaryLight, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADII.pill,
  },
  metaText: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark, textTransform: 'capitalize' },
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
  ingQty: { fontSize: 13, color: COLORS.secondaryText, fontWeight: '600' },
  noData: { color: COLORS.secondaryText, paddingVertical: SPACING.md, fontStyle: 'italic' },
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
