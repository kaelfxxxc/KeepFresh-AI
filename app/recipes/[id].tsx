import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, RefreshControl } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/context/AuthContext';
import { COLORS, SPACING } from '../../src/theme';
import { Recipe } from '../../src/types';

export default function RecipeDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const recipeId = params.id;
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (!recipeId || !profile) return;

    const fetch = async () => {
      setLoading(true);
      
      const { data: recipeData } = await supabase
        .from('recipes')
        .select('*')
        .eq('id', recipeId)
        .single();
      setRecipe(recipeData);
      
      const { data: fav } = await supabase
        .from('favorite_recipes')
        .select('*')
        .eq('user_id', profile.id)
        .eq('recipe_id', recipeId)
        .single();
      setIsFavorite(!!fav);
      
      setLoading(false);
    };

    fetch();
  }, [recipeId, profile]);

  const toggleFavorite = async () => {
    if (!profile || !recipe) return;
    
    if (isFavorite) {
      await supabase.from('favorite_recipes')
        .delete()
        .eq('user_id', profile.id)
        .eq('recipe_id', recipe.id);
    } else {
      await supabase.from('favorite_recipes')
        .insert({ user_id: profile.id, recipe_id: recipe.id });
    }
    setIsFavorite(!isFavorite);
  };

  const handleUseIngredients = async () => {
    Alert.alert(
      'Use Ingredients',
      'Mark ingredients as consumed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Use',
          onPress: async () => {
            Alert.alert('Success', 'Ingredients marked as used!');
          },
        },
      ]
    );
  };

  if (loading || !recipe) {
    return (
      <View style={styles.loading}>
        <Text>Loading recipe...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.imageSection}>
        <Text style={styles.imagePlaceholder}>
          {recipe.category === 'desserts' ? '🍰' : recipe.category === 'meals' ? '🍝' : recipe.category === 'snacks' ? '🍿' : '🥗'}
        </Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{recipe.name}</Text>
        
        <View style={styles.meta}>
          <Text style={styles.metaText}>⏱️ {recipe.prep_time} mins</Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.metaText}>{recipe.difficulty}</Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.metaText}>👥 {recipe.servings} servings</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionButton} onPress={handleUseIngredients}>
            <Text style={styles.actionText}>Use in Recipe</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={toggleFavorite}>
            <Text style={[styles.actionText, isFavorite && styles.favorited]}>
              {isFavorite ? '★ Saved' : '☆ Save'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton}>
            <Text style={styles.actionText}>Share</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ingredients</Text>
          <View style={styles.ingredientsList}>
            {recipe.instructions ? recipe.instructions.map((_, i) => (
              <Text key={i} style={styles.ingredientItem}>• Ingredient {i + 1}</Text>
            )) : <Text style={styles.noData}>No ingredients listed</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Steps</Text>
          <View style={styles.stepsList}>
            {recipe.instructions ? recipe.instructions.map((step, i) => (
              <View key={i} style={styles.step}>
                <Text style={styles.stepNumber}>{i + 1}</Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            )) : <Text style={styles.noData}>No steps available</Text>}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  imageSection: { height: 200, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center' },
  imagePlaceholder: { fontSize: 64 },
  content: { padding: SPACING.lg },
  title: { fontSize: 28, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.lg },
  metaText: { fontSize: 14, color: COLORS.secondaryText },
  metaDot: { color: COLORS.divider },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl },
  actionButton: { flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: COLORS.white, alignItems: 'center', borderWidth: 1, borderColor: COLORS.divider },
  actionText: { color: COLORS.primary, fontWeight: '600' },
  favorited: { color: COLORS.danger },
  section: { marginBottom: SPACING.xl },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: SPACING.md },
  ingredientsList: { gap: SPACING.sm },
  ingredientItem: { fontSize: 14, color: COLORS.text, marginBottom: SPACING.xs },
  stepsList: { gap: SPACING.md },
  step: { flexDirection: 'row', gap: SPACING.sm },
  stepNumber: { fontSize: 20, color: COLORS.primary, fontWeight: 'bold' },
  stepText: { fontSize: 14, color: COLORS.text, flex: 1 },
  noData: { color: COLORS.secondaryText, fontStyle: 'italic' },
});