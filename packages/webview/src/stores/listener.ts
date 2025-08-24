import { defineStore } from 'pinia';
import { ref } from 'vue';
export const useListenerStore = defineStore('listener', () => {
  const receive = ref<string>('');

  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
      case 'extension.message':
        receive.value = message.data;
        break;
      default:
        receive.value = `其他类型的消息：\n${JSON.stringify(message)}`;
    }
  });

  return {
    receive
  };
})
