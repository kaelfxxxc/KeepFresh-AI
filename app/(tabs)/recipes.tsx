import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { COLORS, SPACING } from '../../theme';
import { Recipe } from '../../types';

const RECIPE_CATEGORIES = ['All', 'Desserts', 'Meals', 'Snacks', 'Beverages'];

export default function RecipesScreen() {
  const { profile } = useAuth();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [category, setCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRecipes = async () => {
    try {
      setLoading(true);
      let query = supabase.from('recipes').select('*');
      if (category !== 'All') {
        query = query.eq('category', category.toLowerCase());
      }
      const { data } = await query;
      if (data) setRecipes(data);
    } catch (error) {
      console.error('Error fetching recipes:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
  }, [category]);

  const renderRecipe = ({ item }: { item: Recipe }) => (
    <TouchableOpacity style={styles.recipeCard} onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: item.id } })}>
      <View style={styles.recipeImage}>
        <Text style={styles.recipeEmoji}>
          {item.category === 'desserts' ? '🍰' : item.category === 'meals' ? '🍝' : item.category === 'snacks' ? '🍿' : '🥤'}
        </Text>
      </View>
      <View style={styles.recipeInfo}>
        <Text style={styles.recipeName}>{item.name}</Text>
        <View style={styles.recipeMeta}>
          <Text style={styles.recipeMetaText}>{item.prep_time} mins</Text>
          <Text style={styles.recipeMetaDot}>•</Text>
          <Text style={styles.recipeMetaText}>{item.difficulty}</Text>
        </View>
        <View style={styles.rating}>
          <Text style={styles.ratingStar}>★</Text>
          <Text style={styles.ratingText}>4.5</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recipe Suggestions</Text>
      </View>
      <View style={styles.categories}>
        {RECIPE_CATEGORIES.map(cat => (
          <TouchableOpacity key={cat} style={[styles.categoryTab, category === cat && styles.categoryTabActive]} onPress={() => setCategory(cat)}>
            <Text style={[styles.categoryText, category === cat && styles.categoryTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={recipes}
        keyExtractor={item => item.id}
        renderItem={renderRecipe}
        numColumns={2}
        columnWrapperStyle={styles.row}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRecipes(); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No recipes found</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.lg, paddingBottom: SPACING.sm },
  title: { fontSize: 24, fontWeight: 'bold', color: COLORS.text },
  categories: { flexDirection: 'row', paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md },
  categoryTab: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 20, backgroundColor: COLORS.white },
  categoryTabActive: { backgroundColor: COLORS.primary },
  categoryText: { fontSize: 13, color: COLORS.secondaryText },
  categoryTextActive: { color: COLORS.white, fontWeight: '600' },
  list: { paddingHorizontal: SPACING.md },
  row: { justifyContent: 'space-between' },
  recipeCard: { width: '48%', backgroundColor: COLORS.white, borderRadius: 12, marginBottom: SPACING.md, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  recipeImage: { height: 120, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center' },
  recipeEmoji: { fontSize: 48 },
  recipeInfo: { padding: SPACING.md },
  recipeName: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  recipeMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  recipeMetaText: { fontSize: 12, color: COLORS.secondaryText },
  recipeMetaDot: { marginHorizontal: 4, color: COLORS.secondaryText },
  rating: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  ratingStar: { color: COLORS.warning, fontSize: 14 },
  ratingText: { fontSize: 12, color: COLORS.secondaryText, marginLeft: 2 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 50 },
  emptyText: { color: COLORS.secondaryText },
});