"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Keyboard = void 0;
exports.createKeyboard = createKeyboard;
const enigo_keyboard_node_1 = __importDefault(require("../enigo_keyboard.node"));
const native = enigo_keyboard_node_1.default;
class Keyboard {
    inner;
    constructor() {
        this.inner = new native.Keyboard();
    }
    typeText(text) {
        this.inner.typeText(text);
    }
    tapKey(key, modifiers) {
        this.inner.tapKey(key, modifiers);
    }
    keyDown(key) {
        this.inner.keyDown(key);
    }
    keyUp(key) {
        this.inner.keyUp(key);
    }
}
exports.Keyboard = Keyboard;
function createKeyboard() {
    return new Keyboard();
}
exports.default = Keyboard;
//# sourceMappingURL=index.js.map