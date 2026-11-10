// lib-ok: Stable collection icon keys shared by the catalog, persistence, and picker.
import type MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { SymbolViewProps } from 'expo-symbols';
import type { ComponentProps } from 'react';

type CollectionIcon = {
  label: string;
  symbol: SymbolViewProps['name'];
  fallback: ComponentProps<typeof MaterialIcons>['name'];
};

export const COLLECTION_ICONS = {
  book: { label: 'Bible', symbol: 'book.closed', fallback: 'book' },
  'open-book': { label: 'Open book', symbol: 'book.fill', fallback: 'menu-book' },
  cross: { label: 'Cross', symbol: 'cross', fallback: 'add' },
  sword: { label: 'Sword', symbol: 'figure.fencing', fallback: 'sports-martial-arts' },
  shield: { label: 'Shield', symbol: 'shield', fallback: 'shield' },
  prayer: { label: 'Prayer', symbol: 'hands.sparkles', fallback: 'volunteer-activism' },
  heart: { label: 'Heart', symbol: 'heart', fallback: 'favorite-border' },
  cloud: { label: 'Cloud', symbol: 'cloud', fallback: 'cloud-queue' },
  globe: { label: 'Globe', symbol: 'globe', fallback: 'public' },
  dove: { label: 'Dove', symbol: 'bird', fallback: 'flutter-dash' },
  flame: { label: 'Flame', symbol: 'flame', fallback: 'local-fire-department' },
  lifebuoy: { label: 'Lifebuoy', symbol: 'lifepreserver', fallback: 'support' },
  mountain: { label: 'Mountains', symbol: 'mountain.2', fallback: 'terrain' },
  leaf: { label: 'Leaf', symbol: 'leaf', fallback: 'eco' },
  tree: { label: 'Tree', symbol: 'tree', fallback: 'park' },
  sun: { label: 'Sun', symbol: 'sun.max', fallback: 'wb-sunny' },
  sunrise: { label: 'Sunrise', symbol: 'sunrise', fallback: 'wb-twilight' },
  moon: { label: 'Moon', symbol: 'moon', fallback: 'nightlight-round' },
  star: { label: 'Star', symbol: 'star', fallback: 'star-outline' },
  sparkles: { label: 'Sparkles', symbol: 'sparkles', fallback: 'auto-awesome' },
  water: { label: 'Water', symbol: 'drop', fallback: 'water-drop' },
  waves: { label: 'Waves', symbol: 'water.waves', fallback: 'waves' },
  flower: { label: 'Flower', symbol: 'camera.macro', fallback: 'local-florist' },
  crown: { label: 'Crown', symbol: 'crown', fallback: 'workspace-premium' },
  key: { label: 'Key', symbol: 'key', fallback: 'vpn-key' },
  lamp: { label: 'Lamp', symbol: 'lamp.table', fallback: 'lightbulb-outline' },
  music: { label: 'Music', symbol: 'music.note', fallback: 'music-note' },
  scroll: { label: 'Scroll', symbol: 'scroll', fallback: 'description' },
  gift: { label: 'Gift', symbol: 'gift', fallback: 'card-giftcard' },
  flag: { label: 'Flag', symbol: 'flag', fallback: 'outlined-flag' },
  compass: { label: 'Compass', symbol: 'location.north.circle', fallback: 'explore' },
  home: { label: 'Home', symbol: 'house', fallback: 'home' },
  tent: { label: 'Tent', symbol: 'tent', fallback: 'holiday-village' },
  sailboat: { label: 'Sailboat', symbol: 'sailboat', fallback: 'sailing' },
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
