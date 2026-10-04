// Minimal declarations for the Node built-ins used by the persistence tests.
// (The app doesn't depend on @types/node, which would clash with React Native's globals.)

declare module 'node:sqlite' {
  type Value = string | number | bigint | null | Uint8Array;
  export class StatementSync {
    run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...params: Value[]): Record<string, unknown>[];
    get(...params: Value[]): Record<string, unknown> | undefined;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function readdirSync(path: string): string[];
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}
