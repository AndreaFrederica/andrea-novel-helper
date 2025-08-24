import { defineStore } from 'pinia';
import { useVsCodeApiStore } from './vscode';

export const useSenderStore = defineStore('sender', () => {
  const vscode = useVsCodeApiStore().vscode;

  function initReady() {
    vscode?.postMessage({ command: 'init.ready' });
  }

  function sendMessage(message: string) {
    vscode?.postMessage({
      command: 'message.send',
      message: message
    });
  }

  return {
    initReady,
    sendMessage
  }
});
