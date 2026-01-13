import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { View, StyleSheet } from 'react-native';

interface EngravedIconProps {
  size?: number;
  color: string;
}

export function EngravedIcon({ size = 23, color }: EngravedIconProps) {
  // Scale shimmer relative to main icon (matching the 23/12 ratio from modal)
  const shimmerSize = Math.round(size * 0.52);

  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name="cross-outline" size={size} color={color} />
      <MaterialCommunityIcons
        name="shimmer"
        size={shimmerSize}
        color={color}
        style={[
          styles.shimmer,
          {
            top: -size * 0.35,
            right: -size * 0.30,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  shimmer: {
    position: 'absolute',
  },
});
