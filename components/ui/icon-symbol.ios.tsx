import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView, SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { Platform, StyleProp, View, ViewStyle } from 'react-native';

import { COLLECTION_VECTOR_GLYPHS, collectionSymbolFallback, isCollectionVectorSymbol } from '@/lib/collections/icons';

const IOS_VERSION = Number.parseFloat(String(Platform.Version));

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: SymbolViewProps['name'] | keyof typeof COLLECTION_VECTOR_GLYPHS;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}) {
  if (isCollectionVectorSymbol(name)) {
    return (
      <View style={style}>
        <MaterialCommunityIcons name={COLLECTION_VECTOR_GLYPHS[name]} size={size} color={color} />
      </View>
    );
  }

  const fallback = collectionSymbolFallback(name, IOS_VERSION);
  if (fallback) {
    return (
      <View style={style}>
        <MaterialIcons name={fallback} size={size} color={color} />
      </View>
    );
  }

  return (
    <SymbolView
      weight={weight}
      tintColor={color}
      resizeMode="scaleAspectFit"
      name={name}
      style={[
        {
          width: size,
          height: size,
        },
        style,
      ]}
    />
  );
}
