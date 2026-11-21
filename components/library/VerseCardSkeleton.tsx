import { View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';

interface VerseCardSkeletonProps {
  count?: number;
}

/** Stand-in verse rows, the shape of `SwipeableVerseCard`, with its dividers. */
export function VerseCardSkeleton({ count = 3 }: VerseCardSkeletonProps) {
  const colors = Colors[useColorScheme() ?? 'light'];

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index}>
          {index > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          <View style={styles.row}>
            <Skeleton width={130} height={16} />
            <Skeleton width="70%" height={14} />
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    gap: 9,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
  },
});
