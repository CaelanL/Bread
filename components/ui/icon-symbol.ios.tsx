import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView, SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { Platform, StyleProp, View, ViewStyle } from 'react-native';

import { collectionSymbolFallback } from '@/lib/collections/icons';

const IOS_VERSION = Number.parseFloat(String(Platform.Version));

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: SymbolViewProps['name'];
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}) {
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
