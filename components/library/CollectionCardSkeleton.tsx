import { View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';

interface CollectionCardSkeletonProps {
  count?: number;
}

export function CollectionCardSkeleton({ count = 3 }: CollectionCardSkeletonProps) {
  const colors = Colors[useColorScheme() ?? 'light'];

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator }]}
        >
          <View style={styles.cardContent}>
            <View style={styles.cardLeft}>
              <Skeleton width={48} height={48} borderRadius={12} />
              <View style={styles.cardText}>
                <Skeleton width={120} height={17} borderRadius={4} />
                <Skeleton width={60} height={14} borderRadius={4} style={{ marginTop: 6 }} />
              </View>
            </View>
            <Skeleton width={18} height={18} borderRadius={9} />
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardText: {
    gap: 2,
  },
});
