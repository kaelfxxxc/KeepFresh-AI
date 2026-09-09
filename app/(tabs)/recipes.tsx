import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING, RADII, SHADOW } from '../../src/theme';
import { Recipe } from '../../src/types';
import { ChefHat, Clock3, Users } from 'lucide-react-native';
import { Chip, EmptyState } from '../../src/components/ui';

const RECIPE_CATEGORIES = ['All', 'Meals', 'Desserts', 'Snacks', 'Beverages'] as const;

const emojiFor = (c?: string | null) =>
  c === 'desserts' ? '🍰' : c === 'meals' ? '🍝' : c === 'snacks' ? '🍿' : c === 'beverages' ? '🥤' : '🍲';
const bgFor = (c?: string | null) =>
  c === 'desserts' ? '#FCE9EF' : c === 'meals' ? COLORS.primaryLight : c === 'snacks' ? '#FFF3E0' : c === 'beverages' ? '#E8F1FD' : COLORS.mutedBg;

type RecipeWithIngredients = Recipe & { ingredient_names: string[] };

export default function RecipesScreen() {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [recipes, setRecipes] = useState<RecipeWithIngredients[]>([]);
  const [category, setCategory] = useState<string>('All');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRecipes = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase.from('recipes').select('*').order('prep_time', { ascending: true });
      if (category !== 'All') query = query.eq('category', category.toLowerCase());
      const { data } = await query;
      if (data) {
        const ids = (data as Recipe[]).map((r) => r.id);
        let ingredients: { recipe_id: string; ingredient_name: string }[] = [];
        if (ids.length) {
          const { data: ing } = await supabase
            .from('recipe_ingredients')
            .select('recipe_id, ingredient_name')
            .in('recipe_id', ids);
          ingredients = (ing as any) ?? [];
        }
        const byRecipe: Record<string, string[]> = {};
        ingredients.forEach((i) => {
          (byRecipe[i.recipe_id] = byRecipe[i.recipe_id] || []).push(i.ingredient_name);
        });
        setRecipes((data as Recipe[]).map((r) => ({ ...r, ingredient_names: byRecipe[r.id] || [] })));
      }
    } catch (error) {
      console.error('Error fetching recipes:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [category]);

  useEffect(() => { fetchRecipes(); }, [fetchRecipes]);

  const renderRecipe = ({ item }: { item: RecipeWithIngredients }) => {
    const uses = item.ingredient_names.slice(0, 3).join(', ');
    return (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
        onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: item.id } })}
      >
        <View style={[styles.thumb, { backgroundColor: bgFor(item.category) }]}>
          <Text style={{ fontSize: 34 }}>{emojiFor(item.category)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Clock3 size={13} color={COLORS.secondaryText} strokeWidth={2} />
              <Text style={styles.metaText}>{item.prep_time} min</Text>
            </View>
            <View style={styles.metaItem}>
              <Users size={13} color={COLORS.secondaryText} strokeWidth={2} />
              <Text style={styles.metaText}>{item.servings} servings</Text>
            </View>
            <Text style={styles.difficulty}>{item.difficulty}</Text>
          </View>
          {uses ? (
            <View style={styles.useRow}>
              <Text style={styles.useLabel}>Use: </Text>
              <Text style={styles.useText} numberOfLines={1}>{uses}{item.ingredient_names.length > 3 ? ` +${item.ingredient_names.length - 3}` : ''}</Text>
            </View>
          ) : (
            <Text style={styles.desc} numberOfLines={1}>{item.description}</Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Recipe Suggestions</Text>
        <Text style={styles.subtitle}>Turn expiring ingredients into meals</Text>
      </View>

      <View style={styles.chipRow}>
        {RECIPE_CATEGORIES.map((cat) => (
          <Chip key={cat} label={cat} active={category === cat} onPress={() => setCategory(cat)} />
        ))}
      </View>

      <FlatList
        data={recipes}
        keyExtractor={(item) => item.id}
        renderItem={renderRecipe}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl, gap: SPACING.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRecipes(); }} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon={ChefHat}
              title="No recipes here yet"
              hint={category === 'All' ? 'Check back soon for more suggestions.' : `Try the All filter — no ${category.toLowerCase()} recipes yet.`}
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.secondaryText, marginTop: 2 },
  chipRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: COLORS.white, borderRadius: RADII.card,
    padding: SPACING.md, ...SHADOW.card,
  },
  thumb: {
    width: 74, height: 74, borderRadius: RADII.image,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: COLORS.secondaryText, fontWeight: '500' },
  difficulty: {
    fontSize: 11, fontWeight: '700', color: COLORS.primary, textTransform: 'capitalize',
  },
  useRow: { flexDirection: 'row', marginTop: 7 },
  useLabel: { fontSize: 12, color: COLORS.secondaryText },
  useText: { flex: 1, fontSize: 12, color: COLORS.text, fontWeight: '500' },
  desc: { fontSize: 12, color: COLORS.secondaryText, marginTop: 7 },
});
