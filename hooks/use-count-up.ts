import { useEffect, useRef, useState } from 'react';

/**
 * Animates a count-up from 0 to target value.
 * - Target ≤ 10: Each step is 100ms (so 10 = 1 second, 5 = 500ms)
 * - Target > 10: 1 second total, using requestAnimationFrame for smooth animation
 */
export function useCountUp(target: number): number {
  const [displayValue, setDisplayValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing animation
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (target <= 0) {
      setDisplayValue(0);
      return;
    }

    const FIXED_DELAY = 100; // 100ms per step for small numbers
    const TOTAL_DURATION = 1000; // 1 second for large numbers

    if (target <= 10) {
      // Small numbers: count each one, 100ms per step
      let current = 0;
      const step = () => {
        current++;
        setDisplayValue(current);

        if (current >= target) return;
        timeoutRef.current = setTimeout(step, FIXED_DELAY);
      };

      timeoutRef.current = setTimeout(step, FIXED_DELAY);
    } else {
      // Large numbers: time-based animation for exactly 1 second
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / TOTAL_DURATION, 1);
        const value = Math.round(progress * target);
        setDisplayValue(value);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [target]);

  return displayValue;
}
