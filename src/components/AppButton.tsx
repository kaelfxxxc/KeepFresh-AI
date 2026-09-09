import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export const AppButton = ({ title, onPress, loading, buttonColor, textColor }: any) => {
  return (
    <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled, buttonColor && styles[buttonColor]]}
      onPress={onPress}
    >
      {loading ? (
        <View style={styles.spinner} />
      ) : (
        <Text style={[styles.buttonText, textColor && styles[textColor]]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: 'primary',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.7 },
  spinner: { marginVertical: 6 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
});