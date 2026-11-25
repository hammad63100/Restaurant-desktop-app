import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../utils/api';

interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Small data-loading hook: one loading flag, one friendly error, one refresh.
 * Keeps pages free of repeated try/catch boilerplate.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> & { reload: () => Promise<void> } {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    isLoading: true,
    error: null,
  });

  // The newest loader is read at call time, so an inline arrow function does not
  // re-trigger the effect on every render.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    // `setLoading` is a separate async step so the effect below never calls
    // setState synchronously (React's "no cascading renders" rule).
    const setLoading = async (): Promise<void> => {
      setState((current) => ({ ...current, isLoading: true, error: null }));
    };
    await setLoading();
    try {
      const data = await loaderRef.current();
      if (mountedRef.current) setState({ data, isLoading: false, error: null });
    } catch (error) {
      if (mountedRef.current) {
        setState({ data: null, isLoading: false, error: errorMessage(error) });
      }
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run };
}
