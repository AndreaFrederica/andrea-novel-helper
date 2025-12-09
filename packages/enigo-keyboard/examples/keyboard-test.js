// Simple manual test. Focus a text field before running this script.
import { Keyboard } from '../dist/index.js';

const kb = new Keyboard();

console.log('Focus a text field now; typing will start in 2 seconds...');

setTimeout(() => {
  kb.typeText('Hello from enigo keyboard test');
  kb.tapKey('enter');
  kb.tapKey('v', ['ctrl']); // Example shortcut: Ctrl+V / Cmd+V
  console.log('Done.');
}, 2000);
