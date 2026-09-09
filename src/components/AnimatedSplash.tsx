import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

// KeepFresh AI - launch splash
//
// Choreography (all built on RN's core Animated API - no extra native deps):
//   0.0-0.35s   deep-green background + soft glow expands behind the logo
//   0.3-1.0s    the logo mark rises in from below (basket drawing itself up)
//   1.0-1.4s    quick "pop" settle (vegetables dropping into place)
//   1.4-2.2s    "KeepFresh AI" name fades/scales in, then the tagline fades in
//   2.2s+       holds the final frame; the parent fades the whole cover away
//
// Everything is sized from the window dimensions so it stays responsive on
// small phones and large tablets alike.

const DEEP_GREEN = '#168A45';
const LOGO = require('../../assets/images/keepfresh-logo.png');
const TAGLINE = 'Smarter Food Management.\nLess Waste, More Savings.';

export default function AnimatedSplash() {
  const { width, height } = useWindowDimensions();

  const glow = useRef(new Animated.Value(0)).current; // soft halo expansion
  const rise = useRef(new Animated.Value(0)).current; // mark entrance 0 -> 1
  const pop = useRef(new Animated.Value(0)).current; // 0 -> 1 -> 0 veg settle
  const nameV = useRef(new Animated.Value(0)).current; // 0 -> 1
  const tagV = useRef(new Animated.Value(0)).current; // 0 -> 1

  useEffect(() => {
    const anim = Animated.parallel([
      // Soft glow appears and expands behind the logo.
      Animated.timing(glow, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Basket/mark slides up from the bottom with a gentle ease.
      Animated.timing(rise, {
        toValue: 1,
        duration: 700,
        delay: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Vegetables "pop": quick overshoot then settle back.
      Animated.sequence([
        Animated.timing(pop, {
          toValue: 1,
          duration: 180,
          delay: 1020,
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
      // Name fades & scales in (95% -> 100%).
      Animated.timing(nameV, {
        toValue: 1,
        duration: 420,
        delay: 1500,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Tagline fades in underneath.
      Animated.timing(tagV, {
        toValue: 1,
        duration: 450,
        delay: 1850,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [glow, rise, pop, nameV, tagV]);

  // Responsive sizing - hero image scales with the smaller screen dimension.
  const hero = Math.max(120, Math.min(width * 0.56, height * 0.34, 300));
  const heroBox = hero * 2.4;
  const glowSize = hero * 1.8;
  const glowOffset = (heroBox - glowSize) / 2; // centers halo behind the image
  const nameFont = Math.max(28, Math.min(46, width * 0.1));
  const tagFont = Math.max(13, Math.min(18, width * 0.042));

  const riseStyle = {
    opacity: rise,
    transform: [
      { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [hero * 0.55, 0] }) },
      { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) },
    ],
  };
  const popStyle = {
    transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
  };
  const glowStyle = {
    opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }),
    transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
  };
  const nameStyle = {
    opacity: nameV,
    transform: [{ scale: nameV.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
  };

  return (
    <View style={styles.root}>
      <View style={[styles.heroBox, { width: heroBox, height: heroBox }]}>
        {/* Soft glow expands behind the mark */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              width: glowSize,
              height: glowSize,
              borderRadius: glowSize / 2,
              top: glowOffset,
              left: glowOffset,
            },
            glowStyle,
          ]}
        />
        <Animated.View style={riseStyle}>
          <Animated.View style={popStyle}>
            <Image
              source={LOGO}
              style={{
                width: hero,
                height: hero,
                borderRadius: hero / 2,
                borderWidth: Math.max(2, hero * 0.012),
                borderColor: 'rgba(255,255,255,0.45)',
              }}
              resizeMode="cover"
            />
          </Animated.View>
        </Animated.View>
      </View>

      <Animated.View style={[styles.nameWrap, nameStyle]}>
        <Text style={[styles.name, { fontSize: nameFont }]}>KeepFresh AI</Text>
      </Animated.View>

      <Animated.View style={[styles.tagWrap, { opacity: tagV }]}>
        <Text style={[styles.tag, { fontSize: tagFont }]}>{TAGLINE}</Text>
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
  halo: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  heroBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameWrap: {
    marginTop: 4,
  },
  name: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  tagWrap: {
    marginTop: 12,
    paddingHorizontal: 28,
  },
  tag: {
    color: 'rgba(255,255,255,0.82)',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
  },
});
