// lib-ok: Holds an invite code across the sign-in gate, the way replayColdStartTap holds a notification tap.
let pending: string | null = null;

export function stashPendingJoin(code: string) {
  pending = code;
}

export function takePendingJoin(): string | null {
  const code = pending;
  pending = null;
  return code;
}
