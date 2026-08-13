// src/types/node-sqlite.d.ts
// 为 @types/node@20 补充 node:sqlite (Node >= 22.5) 的最小类型声明。
// 仅声明本项目实际使用到的 API。
declare module 'node:sqlite' {
  type SQLInputValue = string | number | bigint | null | Uint8Array;

  class StatementSync {
    run(...anonymousParameters: SQLInputValue[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    get(...anonymousParameters: SQLInputValue[]): unknown;
    all(...anonymousParameters: SQLInputValue[]): unknown[];
  }

  class DatabaseSync {
    constructor(
      location: string,
      options?: {
        open?: boolean;
        readOnly?: boolean;
        enableForeignKeyConstraints?: boolean;
        enableDoubleQuotedStringLiterals?: boolean;
        allowExtension?: boolean;
      }
    );
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export { DatabaseSync, StatementSync, SQLInputValue };
}
