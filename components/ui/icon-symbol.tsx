// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { COLLECTION_ICONS, COLLECTION_VECTOR_GLYPHS, isCollectionVectorSymbol } from '@/lib/collections/icons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<SymbolViewProps['name'], ComponentProps<typeof MaterialIcons>['name']>;
type IconSymbolName = keyof typeof MAPPING | keyof typeof COLLECTION_VECTOR_GLYPHS;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  ...Object.fromEntries(Object.values(COLLECTION_ICONS).flatMap((icon) =>
    'fallback' in icon ? [[icon.symbol, icon.fallback]] : []
  )),
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.left': 'arrow-back-ios',
  'chevron.right': 'chevron-right',
  'chevron.down': 'keyboard-arrow-down',
  'plus': 'add',
  'book.fill': 'menu-book',
  'book.closed': 'book',
  'mic.fill': 'mic',
  'play.fill': 'play-arrow',
  'pause.fill': 'pause',
  'arrow.up.right': 'north-east',
  'arrow.up.left': 'north-west',
  'xmark': 'close',
  'magnifyingglass': 'search',
  'checkmark': 'check',
  'arrow.counterclockwise': 'refresh',
  'arrow.right': 'arrow-forward',
  'eye': 'visibility',
  'eye.slash': 'visibility-off',
  'line.3.horizontal': 'drag-handle',
  'pencil': 'edit',
  'trash': 'delete-outline',
  'heart.fill': 'favorite',
  'folder.fill': 'folder',
  'person.crop.circle.fill': 'account-circle',
  'person.2.fill': 'group',
  'doc.on.doc': 'content-copy',
  'number': 'tag',
  'square.on.square': 'filter-none',
  'square.and.arrow.up': 'ios-share',
  'ellipsis': 'more-horiz',
  'arrow.triangle.2.circlepath': 'autorenew',
  'rectangle.portrait.and.arrow.right': 'logout',
} as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  if (isCollectionVectorSymbol(name)) {
    return <MaterialCommunityIcons color={color} size={size} name={COLLECTION_VECTOR_GLYPHS[name]} style={style} />;
  }
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
