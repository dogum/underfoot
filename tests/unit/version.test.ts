import { describe, it, expect } from 'vitest';
import { VERSION } from '../../src/core/classes';
import pkg from '../../package.json';

describe('version', () => {
  it('the app reports the package version', () => expect(VERSION).toBe(pkg.version));
});
