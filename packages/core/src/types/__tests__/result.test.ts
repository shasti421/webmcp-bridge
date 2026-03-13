import { describe, it, expect } from 'vitest';

import { ok, err, isOk, isErr, unwrap, mapResult, type Result } from '../result.js';
import type { BridgeError } from '../errors.js';

describe('Result monad', () => {
  describe('ok()', () => {
    it('creates a success result', () => {
      const result = ok(42);
      expect(result).toEqual({ ok: true, value: 42 });
    });

    it('works with string values', () => {
      const result = ok('hello');
      expect(result).toEqual({ ok: true, value: 'hello' });
    });

    it('works with object values', () => {
      const obj = { name: 'test', count: 5 };
      const result = ok(obj);
      expect(result).toEqual({ ok: true, value: obj });
    });

    it('works with null and undefined', () => {
      expect(ok(null)).toEqual({ ok: true, value: null });
      expect(ok(undefined)).toEqual({ ok: true, value: undefined });
    });
  });

  describe('err()', () => {
    it('creates an error result', () => {
      const error: BridgeError = {
        code: 'SELECTOR_NOT_FOUND',
        message: 'Element not found',
        source: 'selector',
        timestamp: new Date(),
      };
      const result = err(error);
      expect(result).toEqual({ ok: false, error });
    });

    it('works with string errors', () => {
      const result = err('something went wrong');
      expect(result).toEqual({ ok: false, error: 'something went wrong' });
    });
  });

  describe('isOk()', () => {
    it('returns true for ok results', () => {
      expect(isOk(ok(42))).toBe(true);
    });

    it('returns false for err results', () => {
      expect(isOk(err('fail'))).toBe(false);
    });

    it('narrows type correctly', () => {
      const result: Result<number, string> = ok(42);
      if (isOk(result)) {
        // TypeScript should allow accessing .value here
        expect(result.value).toBe(42);
      }
    });
  });

  describe('isErr()', () => {
    it('returns true for err results', () => {
      expect(isErr(err('fail'))).toBe(true);
    });

    it('returns false for ok results', () => {
      expect(isErr(ok(42))).toBe(false);
    });

    it('narrows type correctly', () => {
      const result: Result<number, string> = err('fail');
      if (isErr(result)) {
        // TypeScript should allow accessing .error here
        expect(result.error).toBe('fail');
      }
    });
  });

  describe('unwrap()', () => {
    it('returns value for ok results', () => {
      expect(unwrap(ok(42))).toBe(42);
    });

    it('throws for err results', () => {
      const error: BridgeError = {
        code: 'TOOL_NOT_FOUND',
        message: 'Tool missing',
        source: 'engine',
        timestamp: new Date(),
      };
      expect(() => unwrap(err(error))).toThrow('Unwrap called on Err');
    });

    it('includes error details in thrown message', () => {
      expect(() => unwrap(err('my error'))).toThrow('my error');
    });
  });

  describe('mapResult()', () => {
    it('transforms value of ok result', () => {
      const result = mapResult(ok(5), (n) => n * 2);
      expect(result).toEqual({ ok: true, value: 10 });
    });

    it('passes through err result unchanged', () => {
      const original = err('fail');
      const result = mapResult(original, (n: number) => n * 2);
      expect(result).toEqual({ ok: false, error: 'fail' });
    });

    it('supports type-changing transforms', () => {
      const result = mapResult(ok(42), (n) => String(n));
      expect(result).toEqual({ ok: true, value: '42' });
    });

    it('supports chaining', () => {
      const result = mapResult(
        mapResult(ok(5), (n) => n + 1),
        (n) => n * 10,
      );
      expect(result).toEqual({ ok: true, value: 60 });
    });
  });
});
