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
  constructor();
  typeText(text: string): void;
  tapKey(key: KeyName, modifiers?: Modifier[]): void;
  keyDown(key: KeyName): void;
  keyUp(key: KeyName): void;
  tapVirtualKey(keycode: number, withShift?: boolean): void;
}

export function createKeyboard(): Keyboard;

export default Keyboard;
