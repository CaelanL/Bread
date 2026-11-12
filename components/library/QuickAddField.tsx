import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, InputText, Motion, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { completeBook, MAX_ROWS, parseQuickAdd, quickAddRows, type QuickAddReference, type QuickAddRow } from '@/lib/bible/quick-add';
import { sharedErrorMessage } from '@/lib/shared/invite-code';
import { formatVerseReference, type SavedVerse } from '@/lib/storage';
import { useAppStore, useVersesByCollection } from '@/lib/store';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

const TOAST_MS = 4000;

const referenceKey = (ref: QuickAddReference) => `${ref.book}-${ref.chapter}-${ref.verseStart}-${ref.verseEnd}`;
const rowLabel = (row: QuickAddRow) => (row.kind === 'fill' ? row.text.trim() : formatVerseReference(row));

interface Toast {
  message: string;
  error?: boolean;
  added?: SavedVerse;
}

/**
 * The add screen's search field. Focusing it enters search mode (the parent hides the book
 * list); Cancel leaves it. Rows narrow the field or add a reference at once.
 */
export function QuickAddField({
  collectionId,
  searching,
  onSearchChange,
}: {
  collectionId?: string;
  searching: boolean;
  onSearchChange: (searching: boolean) => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const tabBarHeight = useBottomTabBarHeight();
  const targetId = collectionId ?? 'my-verses';
  const existing = useVersesByCollection(targetId);
  const verses = useAppStore((state) => state.verses);
  const inputRef = useRef<TextInput>(null);
  const pending = useRef(new Set<string>());

  const [input, setInput] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const held = (ref: QuickAddReference) => existing.some((v) => referenceKey(v) === referenceKey(ref));

  // An empty field lists the latest references added elsewhere, newest first.
  const recent = useMemo(() => {
    const here = new Set(existing.map(referenceKey));
    const seen = new Set<string>();
    return [...verses]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((v) => {
        const key = referenceKey(v);
        if (here.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_ROWS)
      .map((v): QuickAddRow => ({ kind: 'add', book: v.book, chapter: v.chapter, verseStart: v.verseStart, verseEnd: v.verseEnd }));
  }, [verses, existing]);

  const rows = input.trim() ? quickAddRows(input) : recent;
  const undoable = toast?.added;

  // A typed space or digit right after a book with one match completes its name.
  const handleChangeText = (next: string) => {
    const parse = parseQuickAdd(input);
    const typedOne = next.length === input.length + 1 && next.startsWith(input);
    const uniqueBook = parse.kind === 'book' && parse.matches.length === 1;
    const completes = typedOne && uniqueBook && /[ \d]$/.test(next);
    setInput(completes ? completeBook(next.trimEnd()) ?? next : next);
  };

  const add = async (ref: QuickAddReference) => {
    const key = referenceKey(ref);
    if (held(ref) || pending.current.has(key)) return;
    pending.current.add(key);
    setInput('');
    const reference = formatVerseReference(ref);
    try {
      const added = await useAppStore.getState().addVerse(
        { book: ref.book, chapter: ref.chapter, verseStart: ref.verseStart, verseEnd: ref.verseEnd },
        targetId,
      );
      if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
      setToast({ message: `Added ${reference}`, added });
    } catch (error) {
      console.error('Failed to add verse:', error);
      setToast({ message: sharedErrorMessage(error, `Could not add ${reference}. Please try again.`), error: true });
    } finally {
      pending.current.delete(key);
    }
  };

  const undo = async (verse: SavedVerse) => {
    setToast(null);
    try {
      await useAppStore.getState().deleteVerse(verse.id, targetId);
    } catch (error) {
      console.error('Failed to undo add:', error);
      setToast({ message: `Could not remove ${formatVerseReference(verse)}. Please try again.`, error: true });
    }
  };

  const pick = (row: QuickAddRow) => {
    if (row.kind === 'fill') setInput(row.text);
    else void add(row);
  };

  // Return takes the top row. Recent rows wait for a tap.
  const handleSubmit = () => {
    if (input.trim() && rows[0]) pick(rows[0]);
  };

  const cancel = () => {
    setInput('');
    setToast(null);
    inputRef.current?.blur();
    onSearchChange(false);
  };

  return (
    <View style={searching ? styles.searching : undefined}>
      <View style={styles.fieldRow}>
        <View style={[styles.field, { backgroundColor: colors.input, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.icon} />
          <TextInput
            ref={inputRef}
            testID="quick-add-field"
            style={[styles.input, { color: colors.text }]}
            value={input}
            onChangeText={handleChangeText}
            onSubmitEditing={handleSubmit}
            onFocus={() => onSearchChange(true)}
            placeholder="Search"
            placeholderTextColor={colors.icon}
            autoCapitalize="none"
            autoCorrect={false}
            submitBehavior="submit"
            returnKeyType="done"
          />
        </View>
        {searching && (
          <Pressable testID="quick-add-cancel" accessibilityRole="button" hitSlop={8} onPress={cancel}>
            <Text style={[styles.cancel, { color: colors.tint }]}>Cancel</Text>
          </Pressable>
        )}
      </View>

      {searching && (
        <View style={styles.body}>
          {!input.trim() && rows.length > 0 && (
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>Recent</Text>
          )}
          {rows.map((row, index) => {
            const label = rowLabel(row);
            const isHeld = row.kind === 'add' && held(row);
            const isTop = index === 0 && input.trim().length > 0;
            return (
              <Pressable
                key={label}
                testID={`quick-add-row-${label.replace(/ /g, '-')}`}
                accessibilityRole="button"
                accessibilityLabel={row.kind === 'fill' ? label : isHeld ? `${label}, already in this collection` : `Add ${label}`}
                style={[styles.row, isTop && { backgroundColor: colors.primaryLight }]}
                onPress={() => pick(row)}
              >
                <Text style={[styles.rowText, { color: colors.text }]}>{label}</Text>
                {row.kind === 'fill' ? (
                  <IconSymbol name="arrow.up.left" size={16} color={colors.icon} />
                ) : isHeld ? (
                  <Text style={[styles.heldText, { color: colors.icon }]}>Already in this collection</Text>
                ) : (
                  <IconSymbol name="plus" size={18} color={colors.tint} />
                )}
              </Pressable>
            );
          })}

          {toast && (
            <KeyboardStickyView style={styles.toastDock} offset={{ opened: tabBarHeight }}>
              <Animated.View
                entering={FadeIn.duration(Motion.expandMs)}
                exiting={FadeOut.duration(Motion.exitMs)}
                testID="quick-add-toast"
                style={[styles.toast, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.toastText, { color: toast.error ? colors.error : colors.text }]}>{toast.message}</Text>
                {undoable && (
                  <Pressable testID="quick-add-undo" accessibilityRole="button" hitSlop={8} onPress={() => void undo(undoable)}>
                    <Text style={[styles.undo, { color: colors.tint }]}>Undo</Text>
                  </Pressable>
                )}
              </Animated.View>
            </KeyboardStickyView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searching: {
    flex: 1,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  input: {
    ...InputText,
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  cancel: {
    fontSize: 17,
  },
  body: {
    flex: 1,
    paddingHorizontal: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
  },
  rowText: {
    flex: 1,
    fontSize: 17,
  },
  heldText: {
    fontSize: 14,
  },
  toastDock: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 16,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    boxShadow: Shadows.floating,
  },
  toastText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  undo: {
    fontSize: 15,
    fontWeight: '600',
  },
});
