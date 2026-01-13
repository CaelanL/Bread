import { View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';

interface VerseCardSkeletonProps {
  count?: number;
}

export function VerseCardSkeleton({ count = 3 }: VerseCardSkeletonProps) {
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
            <Skeleton width={40} height={40} borderRadius={10} />
            <View style={styles.cardText}>
              <Skeleton width={140} height={15} borderRadius={4} />
              <Skeleton width="100%" height={15} borderRadius={4} style={{ marginTop: 8 }} />
              <Skeleton width="80%" height={15} borderRadius={4} style={{ marginTop: 4 }} />
            </View>
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
    padding: 14,
    marginBottom: 12,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardText: {
    flex: 1,
    gap: 4,
  },
});
