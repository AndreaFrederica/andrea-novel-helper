// src/types/ahocorasick.d.ts
declare module 'ahocorasick' {
  /**
   * 简单声明 AhoCorasick 的构造函数和 search 方法。
   * 如果你需要更精确的类型，可以在这里补充。
   */
  class AhoCorasick {
    constructor(patterns: string[]);
    search(text: string): Array<[number, string]>;
  }
  export = AhoCorasick;
}
