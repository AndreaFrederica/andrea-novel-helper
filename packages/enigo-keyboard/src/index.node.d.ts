declare module '*.node' {
  const binding: { Keyboard: new () => any };
  export = binding;
}
