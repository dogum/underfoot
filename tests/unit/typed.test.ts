/* Every module in src/ is type-checked: none may opt out with @ts-nocheck. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../../src');

describe('typed', () => {
  it('no module in src/ turns type checking off', () => {
    const off = (fs.readdirSync(SRC, { recursive: true }) as string[])
      .filter(f => /\.ts$/.test(f))
      .filter(f => /^\s*\/\/\s*@ts-nocheck/m.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
    expect(off).toEqual([]);
  });
});
