import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

// KeepFresh AI - launch splash
//
// Choreography (all built on RN's core Animated API - no extra native deps):
//   0.0-0.25s   deep-green background holds while the session restores
//   0.25-1.05s  the logo disc rises in and fades up
//   1.05-1.40s  quick "pop" settle
//   1.40s+      holds the final frame; the parent fades the whole cover away
//
// The lockup artwork carries the mark, the wordmark and the tagline in a single
// image, so there is no separate text to animate here. That artwork is drawn on
// a paper-white field, so it sits on a matching paper disc rather than directly
// on the green.
//
// The circle is baked into the PNG (`keepfresh-splash-disc.png`), not produced
// by clipping in the view tree. Clipping a rectangular image with
// `borderRadius` + `overflow: 'hidden'` is unreliable on Android as soon as the
// same view also carries `elevation` - the corners leak and the disc reads as a
// square - so the artwork is masked to a circle at build time instead and the
// view tree never clips. The paper disc below only supplies the drop shadow.

const DEEP_GREEN = '#168A45';
const PAPER = '#FAFBF5';
const LOGO = require('../../assets/images/keepfresh-splash-disc.png');

export default function AnimatedSplash() {
  const { width } = useWindowDimensions();

  const rise = useRef(new Animated.Value(0)).current; // disc entrance 0 -> 1
  const pop = useRef(new Animated.Value(0)).current; // 0 -> 1 -> 0 settle

  useEffect(() => {
    const anim = Animated.parallel([
      // Disc rises from below with a gentle ease.
      Animated.timing(rise, {
        toValue: 1,
        duration: 800,
        delay: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Quick overshoot then settle back.
      Animated.sequence([
        Animated.timing(pop, {
          toValue: 1,
          duration: 180,
          delay: 1050,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pop, {
          toValue: 0,
          duration: 280,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
  }, [rise, pop]);

  // Fit the disc inside the viewport with a comfortable gutter, never crowding
  // the edges on a small phone. The artwork is already inset within its own
  // square canvas, so the rendered size is the disc diameter and nothing more.
  const discD = Math.min(200, width - 100);

  const riseStyle = {
    opacity: rise,
    transform: [
      { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [discD * 0.12, 0] }) },
      { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  };
  const popStyle = {
    transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
  };

  return (
    <View style={styles.root}>
      <Animated.View style={riseStyle}>
        <Animated.View style={popStyle}>
          {/* The paper disc sits exactly under the artwork's own paper circle
              and exists only so the shadow follows a round outline. */}
          <View
            style={[
              styles.disc,
              { width: discD, height: discD, borderRadius: discD / 2 },
            ]}
          >
            <Image
              source={LOGO}
              style={{ width: discD, height: discD }}
              resizeMode="contain"
            />
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DEEP_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    backgroundColor: PAPER,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
});
