import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerseExpandModal } from '@/components/ui/VerseExpandModal';
import { Colors, Radius, InputText } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchVerse } from '@/lib/api';
import { completeBook, hintFor, parseQuickAdd } from '@/lib/bible/quick-add';
import { formatVerseReference } from '@/lib/storage';
import { useAppStore, useVersesByCollection } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface QuickAddChip {
  key: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  status: 'ready' | 'error';
  hint?: string;
}

const MAX_SUGGESTIONS = 5;

const testIdPart = (book: string) => book.replace(/ /g, '-');

/** How many characters of `book` the typed query covers, ignoring spaces. */
function typedLength(book: string, query: string): number {
  const key = query.toLowerCase().replace(/\s+/g, '');
  if (!book.toLowerCase().replace(/\s+/g, '').startsWith(key)) return 0;
  let seen = 0;
  for (let i = 0; i < book.length; i++) {
    if (seen === key.length) return i;
    if (book[i] !== ' ') seen++;
  }
  return book.length;
}

export function QuickAddField({
  collectionId,
  onTypingChange,
}: {
  collectionId?: string;
  onTypingChange: (hasText: boolean) => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const bibleVersion = useAppStore((state) => state.bibleVersion);
  const targetId = collectionId ?? 'my-verses';
  const existing = useVersesByCollection(targetId);

  const [input, setInput] = useState('');
  const [chips, setChips] = useState<QuickAddChip[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [peek, setPeek] = useState<QuickAddChip | null>(null);
  const [peekText, setPeekText] = useState<string | null>(null);
  const peekRequest = useRef(0);

  const parse = parseQuickAdd(input);

  const statusOf = (chip: QuickAddChip) => {
    if (chip.status === 'error') return 'error';
    const held = existing.some(
      (v) => v.book === chip.book && v.chapter === chip.chapter && v.verseStart === chip.verseStart && v.verseEnd === chip.verseEnd,
    );
    return held ? 'held' : 'ready';
  };
  const readyChips = chips.filter((chip) => statusOf(chip) === 'ready');

  const updateInput = (value: string) => {
    setInput(value);
    onTypingChange(value.length > 0);
  };

  // A typed space or digit right after a book with one match completes its name.
  const handleChangeText = (next: string) => {
    const typedOne = next.length === input.length + 1 && next.startsWith(input);
    const uniqueBook = parse.kind === 'book' && parse.matches.length === 1;
    const completes = typedOne && uniqueBook && /[ \d]$/.test(next);
    updateInput(completes ? completeBook(next.trimEnd()) ?? next : next);
  };

  const addChip = (chip: Omit<QuickAddChip, 'key'>) => {
    const key = `${testIdPart(chip.book)}-${chip.chapter}-${chip.verseStart}-${chip.verseEnd}`;
    setChips((prev) => (prev.some((c) => c.key === key) ? prev : [...prev, { ...chip, key }]));
    updateInput('');
  };

  const handleSubmit = () => {
    if (parse.kind === 'book' && parse.matches.length > 0) {
      updateInput(completeBook(input, parse.matches[0]) ?? input);
    } else if (parse.kind === 'verse') {
      addChip({ ...parse, status: 'ready' });
    } else if (parse.kind === 'error' && parse.verseStart !== undefined) {
      addChip({
        book: parse.book,
        chapter: parse.chapter,
        verseStart: parse.verseStart,
        verseEnd: parse.verseEnd ?? parse.verseStart,
        status: 'error',
        hint: hintFor(parse) ?? undefined,
      });
    }
  };

  const removeChip = (key: string) => setChips((prev) => prev.filter((c) => c.key !== key));

  const handleAdd = async () => {
    if (isSaving) return;
    setIsSaving(true);
    let failed: QuickAddChip | null = null;
    for (const chip of readyChips) {
      try {
        await useAppStore.getState().addVerse(
          { book: chip.book, chapter: chip.chapter, verseStart: chip.verseStart, verseEnd: chip.verseEnd },
          targetId,
        );
        removeChip(chip.key);
      } catch (error) {
        console.error('Failed to add verse:', error);
        failed ??= chip;
      }
    }
    setIsSaving(false);
    if (failed) {
      showErrorToast(`Could not add ${formatVerseReference(failed)}. Please try again.`);
    } else if (collectionId) {
      router.navigate(`/(tabs)/(library)/${collectionId}`);
    } else {
      router.navigate('/(tabs)/(library)');
    }
  };

  const handlePeek = async (chip: QuickAddChip) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const request = ++peekRequest.current;
    setPeek(chip);
    setPeekText(null);
    try {
      const { text } = await fetchVerse(formatVerseReference(chip), bibleVersion);
      if (request === peekRequest.current) setPeekText(text);
    } catch (error) {
      console.error('Failed to fetch verse text:', error);
      if (request === peekRequest.current) setPeekText('Unable to load verse text');
    }
  };

  const suggestions = parse.kind === 'book' ? parse.matches.slice(0, MAX_SUGGESTIONS) : [];
  const hint = [hintFor(parse), ...chips.map((chip) => chip.hint)].filter(Boolean).join(' · ');

  return (
    <View style={styles.container}>
      {chips.length > 0 && (
        <View style={styles.chipRow}>
          {chips.map((chip) => {
            const status = statusOf(chip);
            const tone = status === 'ready' ? colors.success : status === 'error' ? colors.error : colors.icon;
            const reference = formatVerseReference(chip);
            return (
              <View
                key={chip.key}
                style={[
                  styles.chip,
                  { backgroundColor: colors.cardAlt, borderColor: status === 'held' ? colors.border : tone },
                ]}
              >
                <Pressable
                  testID={`quick-add-chip-${chip.key}`}
                  onLongPress={status === 'error' ? undefined : () => void handlePeek(chip)}
                >
                  <Text style={[styles.chipText, { color: tone }]}>
                    {status === 'held' ? `${reference} · already here` : reference}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${reference}`} hitSlop={8} onPress={() => removeChip(chip.key)}>
                  <IconSymbol name="xmark" size={12} color={tone} />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <View style={[styles.field, { backgroundColor: colors.input, borderColor: colors.border }]}>
        <IconSymbol name="magnifyingglass" size={16} color={colors.icon} />
        <TextInput
          testID="quick-add-field"
          style={[styles.input, { color: colors.text }]}
          value={input}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSubmit}
          placeholder="Type a reference, like Rom 8 28"
          placeholderTextColor={colors.icon}
          autoCapitalize="none"
          autoCorrect={false}
          submitBehavior="submit"
          returnKeyType="done"
        />
        {readyChips.length > 0 && (
          <Pressable
            testID="quick-add-submit"
            accessibilityRole="button"
            style={[styles.addPill, { backgroundColor: colors.primary }]}
            onPress={handleAdd}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={[styles.addPillText, { color: colors.white }]}>Add {readyChips.length}</Text>
            )}
          </Pressable>
        )}
      </View>

      {suggestions.map((book) => {
        const typed = parse.kind === 'book' ? typedLength(book, parse.query) : 0;
        return (
          <Pressable
            key={book}
            testID={`quick-add-suggestion-${testIdPart(book)}`}
            style={[styles.suggestion, { borderBottomColor: colors.border }]}
            onPress={() => updateInput(completeBook(input, book) ?? input)}
          >
            <Text style={[styles.suggestionText, { color: colors.text }]}>
              <Text style={{ color: colors.tint }}>{book.slice(0, typed)}</Text>
              {book.slice(typed)}
            </Text>
          </Pressable>
        );
      })}

      {hint.length > 0 && <Text style={[styles.hint, { color: colors.icon }]}>{hint}</Text>}

      <VerseExpandModal
        visible={peek !== null}
        verse={peek}
        verseText={peekText}
        version={bibleVersion}
        onClose={() => setPeek(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 10,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingLeft: 12,
    paddingRight: 6,
    minHeight: 44,
  },
  input: {
    ...InputText,
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  addPill: {
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
  },
  addPillText: {
    fontSize: 15,
    fontWeight: '600',
  },
  suggestion: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: {
    fontSize: 16,
  },
  hint: {
    fontSize: 13,
    marginTop: 8,
  },
});
