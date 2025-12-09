type NativeKeyboard = {
  new (): {
    typeText(text: string): void;
    tapKey(key: string, modifiers?: string[]): void;
    keyDown(key: string): void;
    keyUp(key: string): void;
  };
};

import nativeBinding from '../enigo_keyboard.node';
const native = nativeBinding as { Keyboard: NativeKeyboard };

export type ModifierLiteral =
  | 'shift'
  | 'ctrl'
  | 'control'
  | 'alt'
  | 'option'
  | 'meta'
  | 'cmd'
  | 'command'
  | 'win'
  | 'super';

export type KeyLiteral =
  | 'enter'
  | 'return'
  | 'tab'
  | 'space'
  | 'backspace'
  | 'bksp'
  | 'delete'
  | 'del'
  | 'escape'
  | 'esc'
  | 'up'
  | 'arrowup'
  | 'down'
  | 'arrowdown'
  | 'left'
  | 'arrowleft'
  | 'right'
  | 'arrowright'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'f4'
  | 'f5'
  | 'f6'
  | 'f7'
  | 'f8'
  | 'f9'
  | 'f10'
  | 'f11'
  | 'f12';

export type Modifier = ModifierLiteral | (string & {});
export type KeyName = KeyLiteral | (string & {});

export class Keyboard {
  private readonly inner: InstanceType<NativeKeyboard>;

  constructor() {
    this.inner = new native.Keyboard();
  }

  typeText(text: string): void {
    this.inner.typeText(text);
  }

  tapKey(key: KeyName, modifiers?: Modifier[]): void {
    this.inner.tapKey(key, modifiers);
  }

  keyDown(key: KeyName): void {
    this.inner.keyDown(key);
  }

  keyUp(key: KeyName): void {
    this.inner.keyUp(key);
  }
}

export function createKeyboard(): Keyboard {
  return new Keyboard();
}

export default Keyboard;
