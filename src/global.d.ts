/// <reference types="vite/client" />
import type { PlannerApi } from '../electron/preload';

declare global {
  interface Window {
    api?: PlannerApi;
  }
}

export {};
