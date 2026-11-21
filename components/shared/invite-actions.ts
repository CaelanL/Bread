import { inviteMessage } from '@/lib/shared/invite-code';
import { copyText } from '@/lib/shared/invites';
import { showErrorToast } from '@/lib/toast';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';

const COPIED_MS = 1500;

/** Copies an invite code; `copied` stays true for a moment after, for the check. */
export function useCopyCode() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = (code: string) => {
    try {
      copyText(code);
      if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      showErrorToast("Couldn't copy the code. Use Share instead.");
    }
  };

  return { copied, copy, reset: () => setCopied(false) };
}

/** The system share sheet with the invite text and link. */
export function shareInvite(name: string, code: string) {
  Share.share({ message: inviteMessage(name, code) }).catch(() => {
    showErrorToast("Couldn't open sharing. Copy the code instead.");
  });
}
