// @ts-strict-ignore
/* eslint-disable */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
  }
  function acquireVsCodeApi(): VsCodeApi;
  interface Window {
    vscodeApi?: VsCodeApi;
  }
}

