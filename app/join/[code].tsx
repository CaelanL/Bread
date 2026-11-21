import { JoinInvite } from '@/components/shared/JoinInvite';
import { useLocalSearchParams } from 'expo-router';

/** The join modal for com.biblemem://join/<code>. */
export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <JoinInvite code={code ?? ''} />;
}
