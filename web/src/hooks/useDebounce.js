import { useEffect, useState } from 'react';

/**
 * Debounce a rapidly changing value (search boxes, range inputs) so the API
 * is not queried on every keystroke.
 */
export function useDebounce(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

