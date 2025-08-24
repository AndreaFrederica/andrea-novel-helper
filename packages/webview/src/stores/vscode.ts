import { defineStore } from 'pinia';

declare const acquireVsCodeApi: () => {
  postMessage: (data: unknown) => unknown;
};

export const useVsCodeApiStore = defineStore('vsCodeApi', () => {
  const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : undefined;

  return { vscode };
})
