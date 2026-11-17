import type { RendererApi } from './api';

declare global {
  interface Window {
    /** Injected by electron/preload.ts. Undefined when the UI runs in a plain browser. */
    api?: RendererApi;
  }
}

export {};
