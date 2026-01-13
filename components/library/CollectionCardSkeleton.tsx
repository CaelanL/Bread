import { View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';

interface CollectionCardSkeletonProps {
  count?: number;
}

export function CollectionCardSkeleton({ count = 3 }: CollectionCardSkeletonProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const cardBg = colors.card;
  const borderColor = isDark ? 'rgba(201,169,98,0.3)' : 'rgba(176,141,87,0.25)'; // Bronze gold accent border

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              borderColor,
            },
          ]}
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
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
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
