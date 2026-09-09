import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING } from '../theme';

interface AnalyticsCardProps {
  data: { label: string; value: string | number; subtitle?: string; icon?: string };
}

export const AnalyticsCard = ({ data }: AnalyticsCardProps) => {
  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <Text style={styles.label}>{data.label}</Text>
        <Text style={styles.value}>{data.value}</Text>
        {data.subtitle && <Text style={styles.subtitle}>{data.subtitle}</Text>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 14,
    color: COLORS.secondaryText,
  },
  value: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 12,
    color: COLORS.secondaryText,
    marginTop: 2,
  },
});