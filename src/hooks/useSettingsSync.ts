import { useEffect } from 'react';
import { useAuth } from './useAuth';
import { useSettingsStore } from '../store/settingsStore';

/** Loads shop settings once the user signs in, and clears nothing on logout (settings are not secret). */
export function useSettingsSync(): void {
  const { status } = useAuth();
  const load = useSettingsStore((state) => state.load);
  const isLoaded = useSettingsStore((state) => state.isLoaded);

  useEffect(() => {
    if (status === 'authenticated' && !isLoaded) {
      void load();
    }
  }, [status, isLoaded, load]);
}
