import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { CollectionArtColors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { type CollectionIconKey, resolveCollectionIcon } from '@/lib/collections/icons';

const paletteByIcon: Partial<Record<CollectionIconKey, keyof typeof CollectionArtColors.light>> = {
  dove: 'blue',
  sunrise: 'gold',
  cross: 'rose',
  globe: 'green',
  shield: 'violet',
  mountain: 'blue',
  prayer: 'violet',
  heart: 'rose',
  lamp: 'green',
  sun: 'gold',
};

export function CollectionArt({ icon, size = 'tile' }: {
  icon: CollectionIconKey;
  size?: 'tile' | 'thumbnail' | 'hero';
}) {
  const scheme = useColorScheme() ?? 'light';
  const palette = CollectionArtColors[scheme][paletteByIcon[icon] ?? 'gold'];

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.art, styles[size], { backgroundColor: palette.surface }]}
    >
      <LinearGradient colors={[palette.surface, palette.wash]} style={StyleSheet.absoluteFill} />
      <View style={[styles.outerOrbit, { borderColor: palette.ink }]} />
      <View style={[styles.innerOrbit, { borderColor: palette.ink }]} />
      <IconSymbol
        name={resolveCollectionIcon(icon).symbol}
        size={size === 'hero' ? 60 : 30}
        color={palette.ink}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  art: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: Radius.lg,
  },
  tile: { height: 72 },
  thumbnail: { width: 76, height: 76 },
  hero: { height: 136, borderRadius: Radius.xl },
  outerOrbit: {
    position: 'absolute',
    width: 224,
    height: 224,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.22,
  },
  innerOrbit: {
    position: 'absolute',
    width: 116,
    height: 116,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.34,
  },
});
