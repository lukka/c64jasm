import * as assert from 'assert';
import { evaluateMathExpression } from '../utils';

describe('evaluateMathExpression', () => {
    const mockLookupSymbol = (name: string): { addr?: number, value?: any } | null => {
        if (name === 'ZP_SRC_PTR') return { addr: 0x1234 };
        if (name === 'VAR_NUMBER') return { value: 10 };
        if (name === 'VAR_STRING') return { value: "hello" };
        if (name === 'nested.val') return { addr: 0x2000 };
        return null;
    };

    it('evaluates basic math', () => {
        assert.strictEqual(evaluateMathExpression('1 + 1', mockLookupSymbol), 2);
        assert.strictEqual(evaluateMathExpression('10 * 5', mockLookupSymbol), 50);
        assert.strictEqual(evaluateMathExpression('100 / 4', mockLookupSymbol), 25);
        assert.strictEqual(evaluateMathExpression('10 - 20', mockLookupSymbol), -10);
    });

    it('evaluates hex values', () => {
        assert.strictEqual(evaluateMathExpression('$10', mockLookupSymbol), 16);
        assert.strictEqual(evaluateMathExpression('0x10', mockLookupSymbol), 16);
        assert.strictEqual(evaluateMathExpression('$A + $B', mockLookupSymbol), 21);
    });

    it('evaluates binary values', () => {
        assert.strictEqual(evaluateMathExpression('%00000010', mockLookupSymbol), 2);
        assert.strictEqual(evaluateMathExpression('%11 + %01', mockLookupSymbol), 4);
    });

    it('substitutes known symbols with their address', () => {
        assert.strictEqual(evaluateMathExpression('ZP_SRC_PTR + 1', mockLookupSymbol), 0x1234 + 1);
        assert.strictEqual(evaluateMathExpression('nested.val - 0x100', mockLookupSymbol), 0x2000 - 0x100);
    });

    it('substitutes known variables with numeric value', () => {
        assert.strictEqual(evaluateMathExpression('VAR_NUMBER * 2', mockLookupSymbol), 20);
    });

    it('fails safely for unknown variables', () => {
        assert.strictEqual(evaluateMathExpression('UNKNOWN_VAR + 1', mockLookupSymbol), undefined);
    });

    it('fails safely for non-numeric variables', () => {
        assert.strictEqual(evaluateMathExpression('VAR_STRING + 1', mockLookupSymbol), undefined);
    });

    it('handles bitwise operators', () => {
        assert.strictEqual(evaluateMathExpression('$D000 | 1', mockLookupSymbol), 0xD001);
        assert.strictEqual(evaluateMathExpression('10 & 2', mockLookupSymbol), 2);
    });
});
