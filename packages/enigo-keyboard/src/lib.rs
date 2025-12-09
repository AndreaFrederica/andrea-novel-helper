use enigo::Direction::{Click, Press, Release};
use enigo::{Enigo, InputError, Key, Keyboard as _, NewConError, Settings};
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub struct Keyboard {
    inner: Enigo,
}

#[napi]
impl Keyboard {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let settings = Settings::default();
        let inner = Enigo::new(&settings).map_err(map_new_error)?;
        Ok(Self { inner })
    }

    #[napi]
    pub fn type_text(&mut self, text: String) -> Result<()> {
        if text.is_empty() {
            return Ok(());
        }

        self.inner.text(&text).map_err(map_input_error)
    }

    #[napi]
    pub fn tap_key(&mut self, key: String, modifiers: Option<Vec<String>>) -> Result<()> {
        let key = parse_key(&key)?;
        let modifiers = parse_modifiers(modifiers.as_deref())?;

        press_modifiers(&mut self.inner, &modifiers)?;
        let key_result = self.inner.key(key, Click);
        let release_result = release_modifiers(&mut self.inner, &modifiers);

        if let Err(err) = key_result {
            // Best-effort release before bubbling the error up.
            let _ = release_result;
            return Err(map_input_error(err));
        }

        release_result?;
        Ok(())
    }

    #[napi]
    pub fn key_down(&mut self, key: String) -> Result<()> {
        let key = parse_key(&key)?;
        self.inner.key(key, Press).map_err(map_input_error)
    }

    #[napi]
    pub fn key_up(&mut self, key: String) -> Result<()> {
        let key = parse_key(&key)?;
        self.inner.key(key, Release).map_err(map_input_error)
    }

    #[napi(js_name = "tapVirtualKey")]
    pub fn tap_virtual_key(&mut self, keycode: u16, with_shift: Option<bool>) -> Result<()> {
        let mut pressed_shift = false;
        if with_shift.unwrap_or(false) {
            self.inner
                .key(Key::Shift, Press)
                .map_err(map_input_error)?;
            pressed_shift = true;
        }

        let key = Key::Other(u32::from(keycode));
        let res = self.inner.key(key, Click).map_err(map_input_error);

        if pressed_shift {
            // Best-effort release shift even on failure.
            let _ = self.inner.key(Key::Shift, Release);
        }

        res
    }
}

fn parse_key(input: &str) -> Result<Key> {
    let key = input.trim();
    if key.chars().count() == 1 {
        if let Some(ch) = key.chars().next() {
            return Ok(Key::Unicode(ch));
        }
    }

    match key.to_ascii_lowercase().as_str() {
        "enter" | "return" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "space" => Ok(Key::Space),
        "backspace" | "bksp" => Ok(Key::Backspace),
        "delete" | "del" => Ok(Key::Delete),
        "escape" | "esc" => Ok(Key::Escape),
        "up" | "arrowup" => Ok(Key::UpArrow),
        "down" | "arrowdown" => Ok(Key::DownArrow),
        "left" | "arrowleft" => Ok(Key::LeftArrow),
        "right" | "arrowright" => Ok(Key::RightArrow),
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        "pageup" => Ok(Key::PageUp),
        "pagedown" => Ok(Key::PageDown),
        "f1" => Ok(Key::F1),
        "f2" => Ok(Key::F2),
        "f3" => Ok(Key::F3),
        "f4" => Ok(Key::F4),
        "f5" => Ok(Key::F5),
        "f6" => Ok(Key::F6),
        "f7" => Ok(Key::F7),
        "f8" => Ok(Key::F8),
        "f9" => Ok(Key::F9),
        "f10" => Ok(Key::F10),
        "f11" => Ok(Key::F11),
        "f12" => Ok(Key::F12),
        other => Err(Error::new(
            Status::InvalidArg,
            format!("Unsupported key: {other}"),
        )),
    }
}

fn parse_modifiers(modifiers: Option<&[String]>) -> Result<Vec<Key>> {
    let mut parsed = Vec::new();
    if let Some(values) = modifiers {
        for modifier in values {
            let key = match modifier.trim().to_ascii_lowercase().as_str() {
                "shift" => Key::Shift,
                "ctrl" | "control" => Key::Control,
                "alt" | "option" => Key::Alt,
                "meta" | "cmd" | "command" | "win" | "super" => Key::Meta,
                other => {
                    return Err(Error::new(
                        Status::InvalidArg,
                        format!("Unsupported modifier: {other}"),
                    ))
                }
            };
            parsed.push(key);
        }
    }
    Ok(parsed)
}

fn press_modifiers(enigo: &mut Enigo, modifiers: &[Key]) -> Result<()> {
    for modifier in modifiers {
        enigo.key(*modifier, Press).map_err(map_input_error)?;
    }
    Ok(())
}

fn release_modifiers(enigo: &mut Enigo, modifiers: &[Key]) -> Result<()> {
    for modifier in modifiers.iter().rev() {
        enigo.key(*modifier, Release).map_err(map_input_error)?;
    }
    Ok(())
}

fn map_input_error(err: InputError) -> Error {
    Error::new(Status::GenericFailure, err.to_string())
}

fn map_new_error(err: NewConError) -> Error {
    Error::new(Status::GenericFailure, err.to_string())
}
