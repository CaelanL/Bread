// lib-ok: Stable collection icon keys shared by the catalog, persistence, and picker.
import type MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { SymbolViewProps } from 'expo-symbols';
import type { ComponentProps } from 'react';

export const COLLECTION_VECTOR_GLYPHS = {
  'collection.cross': 'cross',
  'collection.sword': 'sword',
  'collection.prayer': 'hands-pray',
} as const;

type CollectionVectorSymbol = keyof typeof COLLECTION_VECTOR_GLYPHS;

type NativeCollectionIcon = {
  label: string;
  symbol: SymbolViewProps['name'];
  fallback: ComponentProps<typeof MaterialIcons>['name'];
  iosSince?: number;
};

type CollectionIcon = NativeCollectionIcon | {
  label: string;
  symbol: CollectionVectorSymbol;
};

export const COLLECTION_ICONS = {
  book: { label: 'Bible', symbol: 'book.closed', fallback: 'book' },
  'open-book': { label: 'Open book', symbol: 'book.fill', fallback: 'menu-book' },
  cross: { label: 'Cross', symbol: 'collection.cross' },
  sword: { label: 'Sword', symbol: 'collection.sword' },
  shield: { label: 'Shield', symbol: 'shield', fallback: 'shield' },
  prayer: { label: 'Praying hands', symbol: 'collection.prayer' },
  heart: { label: 'Heart', symbol: 'heart', fallback: 'favorite-border' },
  cloud: { label: 'Cloud', symbol: 'cloud', fallback: 'cloud-queue' },
  globe: { label: 'Globe', symbol: 'globe', fallback: 'public' },
  dove: { label: 'Dove', symbol: 'bird', fallback: 'flutter-dash', iosSince: 16 },
  flame: { label: 'Flame', symbol: 'flame', fallback: 'local-fire-department' },
  lifebuoy: { label: 'Lifebuoy', symbol: 'lifepreserver', fallback: 'support' },
  mountain: { label: 'Mountains', symbol: 'mountain.2', fallback: 'terrain', iosSince: 16.1 },
  leaf: { label: 'Leaf', symbol: 'leaf', fallback: 'eco' },
  tree: { label: 'Tree', symbol: 'tree', fallback: 'park', iosSince: 16.1 },
  sun: { label: 'Sun', symbol: 'sun.max', fallback: 'wb-sunny' },
  sunrise: { label: 'Sunrise', symbol: 'sunrise', fallback: 'wb-twilight' },
  moon: { label: 'Moon', symbol: 'moon', fallback: 'nightlight-round' },
  star: { label: 'Star', symbol: 'star', fallback: 'star-outline' },
  sparkles: { label: 'Sparkles', symbol: 'sparkles', fallback: 'auto-awesome' },
  water: { label: 'Water', symbol: 'drop', fallback: 'water-drop' },
  waves: { label: 'Waves', symbol: 'water.waves', fallback: 'waves', iosSince: 16 },
  flower: { label: 'Flower', symbol: 'camera.macro', fallback: 'local-florist', iosSince: 15.4 },
  crown: { label: 'Crown', symbol: 'crown', fallback: 'workspace-premium' },
  key: { label: 'Key', symbol: 'key', fallback: 'vpn-key' },
  lamp: { label: 'Lamp', symbol: 'lamp.table', fallback: 'lightbulb-outline', iosSince: 16 },
  music: { label: 'Music', symbol: 'music.note', fallback: 'music-note' },
  scroll: { label: 'Scroll', symbol: 'scroll', fallback: 'description' },
  gift: { label: 'Gift', symbol: 'gift', fallback: 'card-giftcard' },
  flag: { label: 'Flag', symbol: 'flag', fallback: 'outlined-flag' },
  compass: { label: 'Compass', symbol: 'location.north.circle', fallback: 'explore' },
  home: { label: 'Home', symbol: 'house', fallback: 'home' },
  tent: { label: 'Tent', symbol: 'tent', fallback: 'holiday-village', iosSince: 16 },
  sailboat: { label: 'Sailboat', symbol: 'sailboat', fallback: 'sailing', iosSince: 16 },
  people: { label: 'People', symbol: 'person.2', fallback: 'people-outline' },
  bell: { label: 'Bell', symbol: 'bell', fallback: 'notifications-none' },
} as const satisfies Record<string, CollectionIcon>;

export type CollectionIconKey = keyof typeof COLLECTION_ICONS;

export const DEFAULT_COLLECTION_ICON: CollectionIconKey = 'book';

export function isCollectionIconKey(key: unknown): key is CollectionIconKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(COLLECTION_ICONS, key);
}

export function resolveCollectionIcon(key: unknown): CollectionIcon {
  return COLLECTION_ICONS[isCollectionIconKey(key) ? key : DEFAULT_COLLECTION_ICON];
}

export function isCollectionVectorSymbol(name: string): name is CollectionVectorSymbol {
  return Object.prototype.hasOwnProperty.call(COLLECTION_VECTOR_GLYPHS, name);
}

export function collectionSymbolFallback(symbol: SymbolViewProps['name'], iosVersion: number) {
  return Object.values<CollectionIcon>(COLLECTION_ICONS).find(
    (icon): icon is NativeCollectionIcon => 'fallback' in icon &&
      icon.symbol === symbol && icon.iosSince !== undefined && iosVersion < icon.iosSince,
  )?.fallback;
}
