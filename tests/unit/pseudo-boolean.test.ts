/**
 * Unit tests for PseudoBoolean — a flexible string-to-boolean converter.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PseudoBoolean } from '../../build/lib/pseudo-boolean.js';

// ---------------------------------------------------------------------------
// Falsy inputs
// ---------------------------------------------------------------------------

describe('PseudoBoolean.from: null and undefined', () => {
    it('returns false for null', () => {
        assert.equal(PseudoBoolean.from(null), false);
    });

    it('returns false for undefined', () => {
        assert.equal(PseudoBoolean.from(undefined), false);
    });
});

describe('PseudoBoolean.from: boolean passthrough', () => {
    it('returns true for boolean true', () => {
        assert.equal(PseudoBoolean.from(true), true);
    });

    it('returns false for boolean false', () => {
        assert.equal(PseudoBoolean.from(false), false);
    });
});

describe('PseudoBoolean.from: falsy string values', () => {
    it('returns false for empty string', () => {
        assert.equal(PseudoBoolean.from(''), false);
    });

    it('returns false for "false"', () => {
        assert.equal(PseudoBoolean.from('false'), false);
    });

    it('returns false for "FALSE" (case-insensitive)', () => {
        assert.equal(PseudoBoolean.from('FALSE'), false);
    });

    it('returns false for "none"', () => {
        assert.equal(PseudoBoolean.from('none'), false);
    });

    it('returns false for "null"', () => {
        assert.equal(PseudoBoolean.from('null'), false);
    });

    it('returns false for "nan"', () => {
        assert.equal(PseudoBoolean.from('nan'), false);
    });

    it('returns false for "nil"', () => {
        assert.equal(PseudoBoolean.from('nil'), false);
    });

    it('returns false for "0"', () => {
        assert.equal(PseudoBoolean.from('0'), false);
    });

    it('returns false for "no"', () => {
        assert.equal(PseudoBoolean.from('no'), false);
    });

    it('returns false for "undefined"', () => {
        assert.equal(PseudoBoolean.from('undefined'), false);
    });

    it('returns false for "  false  " (with surrounding spaces)', () => {
        assert.equal(PseudoBoolean.from('  false  '), false);
    });
});

describe('PseudoBoolean.from: truthy string values', () => {
    it('returns true for "true"', () => {
        assert.equal(PseudoBoolean.from('true'), true);
    });

    it('returns true for "TRUE" (case-insensitive)', () => {
        assert.equal(PseudoBoolean.from('TRUE'), true);
    });

    it('returns true for "yes"', () => {
        assert.equal(PseudoBoolean.from('yes'), true);
    });

    it('returns true for "1"', () => {
        assert.equal(PseudoBoolean.from('1'), true);
    });

    it('returns true for "ok"', () => {
        assert.equal(PseudoBoolean.from('ok'), true);
    });

    it('returns true for any other non-empty string (e.g. "hello")', () => {
        assert.equal(PseudoBoolean.from('hello'), true);
    });

    it('returns true for a numeric-looking string like "42"', () => {
        assert.equal(PseudoBoolean.from('42'), true);
    });
});

describe('PseudoBoolean.from: non-string non-boolean values', () => {
    it('throws TypeError for a number input', () => {
        assert.throws(() => PseudoBoolean.from(42), TypeError);
    });

    it('throws TypeError for an object input', () => {
        assert.throws(() => PseudoBoolean.from({}), TypeError);
    });

    it('throws TypeError for an array input', () => {
        assert.throws(() => PseudoBoolean.from([]), TypeError);
    });
});
