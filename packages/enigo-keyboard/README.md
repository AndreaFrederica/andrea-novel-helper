# @anh/enigo-keyboard

Minimal keyboard simulation module built with Rust + [`enigo`](https://crates.io/crates/enigo) + `napi-rs`. It only covers common keys and text input so the footprint stays small for Node/Electron desktop runtimes.

## Build

1. Install the Rust toolchain and Node 18+.
2. In this folder run:

   ```bash
   npm install
   npm run build        # builds native index.node and TypeScript -> dist/
   ```

   Use `npm run build:debug` when you need debug symbols.

## Usage

```ts
import { Keyboard, createKeyboard } from '@anh/enigo-keyboard'

const kb = new Keyboard() // or createKeyboard()

kb.typeText('Hello, world!')
kb.tapKey('v', ['ctrl'])          // Ctrl+V
kb.tapKey('escape')               // single key press
kb.keyDown('shift')               // hold a modifier
kb.keyUp('shift')                 // release a modifier
```

Supported key strings: `enter/return/tab/space/backspace/delete/escape`, arrow keys, `home/end/pageup/pagedown`, `F1`–`F12`, single characters, and modifiers `ctrl/alt/shift/meta(win/cmd/super)`. Single-character input is sent using the current keyboard layout.

## Design focus

- Keyboard only; no mouse or imaging dependencies.
- Release profile tunes for size: `panic = "abort"`, `lto = "thin"`, `opt-level = "s"`.
- No prebuilt binaries; generate multi-platform artifacts with `napi build --platform --release` if you want to publish.

## Notes

- Desktop runtimes only (Node/Electron/Tauri). Browsers cannot load the native module.
- macOS needs accessibility/input-monitoring permission; some Wayland environments may need extra permissions.
