import { withAlpha } from '@/constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

const ANGLES = [-30, -15, 0, 15, 30];

/**
 * A faint fan of rays rising from behind the top of a finished collection's icon (mastered or
 * engraved). Each ray starts at the icon's centre, hidden by the icon, and fades out upwards, so
 * only short glints show above its top edge. Place it first inside a wrapper around the icon.
 */
export function Rays({ length, color }: { length: number; color: string }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.rays}
    >
      {ANGLES.map((angle) => (
        <LinearGradient
          key={angle}
          colors={[withAlpha(color, 0), withAlpha(color, 0.3)]}
          style={[
            styles.ray,
            { height: length, top: -length, transformOrigin: 'bottom', transform: [{ rotate: `${angle}deg` }] },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rays: { position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 },
  ray: { position: 'absolute', left: -1, width: 2 },
});
