/* eslint-disable @typescript-eslint/no-var-requires */
type NativeKeyboard = {
  new (): {
    type_text(text: string): void;
    tap_key(key: string, modifiers?: string[]): void;
    key_down(key: string): void;
    key_up(key: string): void;
    tapVirtualKey(keycode: number, with_shift?: boolean): void;
  };
};

// 支持 dist/enigo_keyboard.node（打包后放在 dist 内）与根目录 enigo_keyboard.node 的双路径加载
let nativeBinding: any;
for (const candidate of ['./enigo_keyboard.node', '../enigo_keyboard.node']) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeBinding = require(candidate);
    break;
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND') {
      continue;
    }
    throw err;
  }
}

if (!nativeBinding) {
  throw new Error('Failed to load enigo_keyboard.node from expected locations.');
}

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
    this.inner.type_text(text);
  }

  tapKey(key: KeyName, modifiers?: Modifier[]): void {
    this.inner.tap_key(key, modifiers);
  }

  keyDown(key: KeyName): void {
    this.inner.key_down(key);
  }

  keyUp(key: KeyName): void {
    this.inner.key_up(key);
  }

  tapVirtualKey(keycode: number, withShift = false): void {
    this.inner.tapVirtualKey(keycode, withShift);
  }
}

export function createKeyboard(): Keyboard {
  return new Keyboard();
}

export default Keyboard;
