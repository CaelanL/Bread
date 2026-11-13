import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { composeDisplayName, MAX_NAME_PART_LENGTH } from '@/lib/shared/display-name';
import { useRef } from 'react';
import { type StyleProp, StyleSheet, Text, TextInput, type TextStyle } from 'react-native';

interface Props {
  first: string;
  last: string;
  onChangeFirst: (value: string) => void;
  onChangeLast: (value: string) => void;
  onSubmit: () => void;
  inputStyle: StyleProp<TextStyle>;
  editable?: boolean;
  testIDPrefix: string;
}

/** First name, optional last name, and what members will see ("Shown as Caelan L."). */
export function NameFields({ first, last, onChangeFirst, onChangeLast, onSubmit, inputStyle, editable = true, testIDPrefix }: Props) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const lastRef = useRef<TextInput>(null);
  const shown = first.trim() ? composeDisplayName(first, last) : null;
  const common = {
    style: inputStyle,
    placeholderTextColor: colors.icon,
    maxLength: MAX_NAME_PART_LENGTH,
    autoCapitalize: 'words' as const,
    autoCorrect: false,
    editable,
  };

  return (
    <>
      <TextInput
        {...common}
        testID={`${testIDPrefix}-first`}
        value={first}
        onChangeText={onChangeFirst}
        placeholder="First name"
        textContentType="givenName"
        autoComplete="name-given"
        autoFocus
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => lastRef.current?.focus()}
      />
      <TextInput
        {...common}
        ref={lastRef}
        testID={`${testIDPrefix}-last`}
        value={last}
        onChangeText={onChangeLast}
        placeholder="Last name (optional)"
        textContentType="familyName"
        autoComplete="name-family"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
      />
      <Text style={[styles.shown, { color: colors.icon }]} numberOfLines={1}>
        {shown ? `Shown as ${shown}` : ' '}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  shown: { fontSize: 13, lineHeight: 18 },
});
