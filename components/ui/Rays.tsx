import { withAlpha } from '@/constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

const COUNT = 8;

/**
 * Faint sun rays behind a finished collection's icon (mastered or engraved). Drawn centred on the
 * parent: each ray is a thin bar through the middle, brightest at the centre (hidden by the icon)
 * and clearing towards its ends, so only the outer glints show around the icon.
 */
export function Rays({ size, color }: { size: number; color: string }) {
  const offset = -size / 2;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.rays, { width: size, height: size, marginLeft: offset, marginTop: offset }]}
    >
      {Array.from({ length: COUNT }, (_, i) => (
        <LinearGradient
          key={i}
          colors={[withAlpha(color, 0), withAlpha(color, 0.45), withAlpha(color, 0)]}
          style={[styles.ray, { height: size, left: size / 2 - 1, transform: [{ rotate: `${(180 / COUNT) * i + 11}deg` }] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rays: { position: 'absolute', left: '50%', top: '50%' },
  ray: { position: 'absolute', top: 0, width: 2 },
});
