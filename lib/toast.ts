/**
 * Simple toast notification system
 *
 * Usage:
 *   import { showErrorToast, subscribeToToast } from '@/lib/toast';
 *
 *   // Show a toast
 *   showErrorToast("Failed to save your progress.");
 *
 *   // Subscribe to toasts (in a component)
 *   useEffect(() => subscribeToToast(setMessage), []);
 */

type ToastListener = (message: string) => void;

const listeners: Set<ToastListener> = new Set();

/**
 * Show an error toast with a custom message
 */
export function showErrorToast(message: string): void {
  listeners.forEach((listener) => listener(message));
}

/**
 * Subscribe to toast messages
 * Returns unsubscribe function
 */
export function subscribeToToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
