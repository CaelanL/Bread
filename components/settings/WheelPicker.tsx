/**
 * iOS-style vertical wheel picker for an integer value in [min, max].
 * Uses the native `Picker` from `@react-native-picker/picker`, which
 * renders as the system spinner on iOS (UIPickerView) and a dropdown
 * on Android. The dependency is already in `package.json`.
 *
 * Used by ReviewIntervalModal — the user spins to pick a day count
 * from 30..365. Snapping, momentum, and accessibility come for free
 * from the native wheel.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Picker } from '@react-native-picker/picker';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

interface Props {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

export function WheelPicker({ value, min, max, onChange }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // 336 items for 30..365 — Picker handles this fine (native wheels
  // are designed for thousands of items).
  const items = useMemo(() => {
    const arr: number[] = [];
    for (let i = min; i <= max; i++) arr.push(i);
    return arr;
  }, [min, max]);

  return (
    <View style={styles.container}>
      <Picker
        selectedValue={value}
        onValueChange={(v) => onChange(Number(v))}
        // itemStyle is iOS-only; Android dropdown ignores it.
        itemStyle={[styles.item, { color: colors.text }]}
        style={styles.picker}
        mode="dialog"
      >
        {items.map((n) => (
          <Picker.Item
            key={n}
            label={`${n} ${n === 1 ? 'day' : 'days'}`}
            value={n}
            color={colors.text}
          />
        ))}
      </Picker>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 200,
    justifyContent: 'center',
  },
  picker: {
    width: '100%',
    height: 200,
  },
  item: {
    fontSize: 22,
    fontWeight: '500',
  },
});
