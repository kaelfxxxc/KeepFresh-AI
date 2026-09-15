// RecipeImage — a recipe's photograph, over the app's own fallback art.
//
// A generated recipe's `image_url` is either a real photo of that dish or NULL:
// the server refuses to attach a photo whose alt text does not describe the dish
// (see the relevance vote in supabase/functions/recipe-suggestions). So this
// component is built around "the photo may simply not exist". The tinted category
// emoji is the base layer and always renders; the photo is painted over it once
// it has actually decoded. There is never a blank rectangle, a URL that 404s
// lands on the same art as a recipe that never had an image at all, and nothing
// here can throw.
//
// The emoji and tint tables live here rather than in each screen because both the
// tab and the detail view draw the same fallback, and they had drifted apart into
// two copies of the same three hex values.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADII } from '../theme';

/**
 * The dish emoji standing in for a category. Deliberately the same vocabulary as
 * the category chips on the Recipes tab.
 */
export function recipeEmoji(category?: string | null): string {
  switch (category) {
    case 'desserts':
      return '🍰';
    case 'meals':
      return '🍝';
    case 'snacks':
      return '🍿';
    case 'beverages':
      return '🥤';
    default:
      return '🍲';
  }
}

/** The tint behind that emoji. */
export function recipeTint(category?: string | null): string {
  switch (category) {
    case 'desserts':
      return '#FCE9EF';
    case 'meals':
      return COLORS.primaryLight;
    case 'snacks':
      return '#FFF3E0';
    case 'beverages':
      return '#E8F1FD';
    default:
      return COLORS.mutedBg;
  }
}

/**
 * The tone for a match badge: green when a recipe uses most of the pantry, amber
 * when it doesn't.
 *
 * Lives here with the other recipe presentation vocabulary so the card and the
 * detail screen colour the same number the same way.
 */
export function matchTone(percent: number | null): 'success' | 'primary' | 'warning' {
  if (percent === null) return 'primary';
  if (percent >= 80) return 'success';
  if (percent >= 50) return 'primary';
  return 'warning';
}

/**
 * Warm the native image cache for photos that are not on screen yet.
 *
 * Called once after the list loads so that scrolling does not wait on several
 * simultaneous downloads. Failures are the component's business, not this
 * function's — a prefetch that fails just means the card shows the fallback.
 */
export function prefetchRecipeImages(uris: (string | null | undefined)[]): void {
  for (const uri of uris) {
    if (!uri) continue;
    Image.prefetch(uri).catch(() => {});
  }
}

/**
 * How long a load may take before it is worth admitting to.
 *
 * Long enough that a cached photo never flashes a spinner, short enough that a
 * slow one does not look like a hang.
 */
const SPINNER_DELAY_MS = 220;

export function RecipeImage({
  uri,
  category,
  width,
  height,
  radius = RADII.image,
  emojiSize,
  style,
}: {
  uri?: string | null;
  /** Decides the fallback emoji and tint. */
  category?: string | null;
  width: number | `${number}%`;
  height: number;
  radius?: number;
  /** Defaults to half the height, which suits both the 74px thumb and the hero. */
  emojiSize?: number;
  style?: any;
}) {
  const [failed, setFailed] = useState(!uri);
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);

  // A new URL is a new attempt: clear the failure and restart the spinner clock.
  //
  // The failure is deliberately per-mount rather than remembered for the life of
  // the process. Remembering would save one request per dead URL, but it would
  // also mean a Pexels hiccup mid-load left that dish on its fallback art until
  // the app restarted — a worse and less recoverable outcome than a retry.
  useEffect(() => {
    setFailed(!uri);
    setVisible(false);
    setSlow(false);
  }, [uri]);

  useEffect(() => {
    if (failed || visible) return;
    const timer = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [failed, visible, uri]);

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

      {!failed && !!uri && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onLoad={() => setVisible(true)}
          onError={() => {
            setFailed(true);
            setVisible(false);
          }}
        />
      )}

      {!failed && !visible && slow && (
        <View style={[StyleSheet.absoluteFill, styles.spinner]}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // `hidden` keeps the photo inside the rounded corners, so the image itself does
  // not need a radius that would have to be kept in step with the frame's.
  frame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  spinner: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.55)' },
});
