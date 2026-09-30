import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radii } from '../theme';
import { colorWithOpacity } from '../utils/color';

type RecipeCategory = 'desserts' | 'meals' | 'snacks' | 'beverages';

const CATEGORY_PRESENTATION: Record<RecipeCategory, { emoji: string; tint: string }> = {
  desserts: { emoji: '🍰', tint: '#FCE9EF' },
  meals: { emoji: '🍝', tint: colors.mintBg },
  snacks: { emoji: '🍿', tint: '#FFF3E0' },
  beverages: { emoji: '🥤', tint: '#E8F1FD' },
};

const DEFAULT_PRESENTATION = {
  emoji: '🍲',
  tint: colorWithOpacity(colors.textSecondary, 0.12),
};

const SPINNER_DELAY_MS = 220;

function presentationFor(category?: string | null) {
  return category && Object.prototype.hasOwnProperty.call(CATEGORY_PRESENTATION, category)
    ? CATEGORY_PRESENTATION[category as RecipeCategory]
    : DEFAULT_PRESENTATION;
}

export function recipeEmoji(category?: string | null): string {
  return presentationFor(category).emoji;
}

export function recipeTint(category?: string | null): string {
  return presentationFor(category).tint;
}

export function matchTone(percent: number | null): 'success' | 'primary' | 'warning' {
  if (percent === null) return 'primary';
  if (percent >= 80) return 'success';
  if (percent >= 50) return 'primary';
  return 'warning';
}

export function prefetchRecipeImages(uris: (string | null | undefined)[]): void {
  uris.forEach((uri) => {
    if (uri) Image.prefetch(uri).catch(() => undefined);
  });
}

export interface RecipeImageProps {
  uri?: string | null;
  category?: string | null;
  width: number | `${number}%`;
  height: number;
  radius?: number;
  emojiSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function RecipeImage(props: RecipeImageProps) {
  // A changed URL gets fresh loading state immediately, with no stale image frame.
  return <RecipeImageAttempt key={props.uri ?? 'no-image'} {...props} />;
}

function RecipeImageAttempt({
  uri,
  category,
  width,
  height,
  radius = radii.md,
  emojiSize,
  style,
}: RecipeImageProps) {
  const [failed, setFailed] = useState(!uri);
  const [loaded, setLoaded] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!uri || failed || loaded) return undefined;
    const timer = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [failed, loaded, uri]);

  return (
    <View
      style={[
        styles.frame,
        { width, height, borderRadius: radius, backgroundColor: recipeTint(category) },
        style,
      ]}
    >
      <Text style={{ fontSize: emojiSize ?? Math.round(height * 0.5) }}>
        {recipeEmoji(category)}
      </Text>

      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}

      {uri && !failed && !loaded && showSpinner ? (
        <View style={[StyleSheet.absoluteFill, styles.spinner]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  spinner: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
});
