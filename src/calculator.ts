import { Decimal } from 'decimal.js';

const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_EVEN });
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
export interface Calculation { operation: 'add' | 'subtract' | 'multiply' | 'divide'; a: string; b: string }
export function calculate(input: Calculation) {
  for (const value of [input.a, input.b]) {
    if (typeof value !== 'string' || value.length > 256 || !decimal.test(value)) {
      throw new Error('Operands must be finite decimal strings of at most 256 characters (no code or exponent syntax).');
    }
  }
  const a = new D(input.a), b = new D(input.b);
  let result: Decimal;
  switch (input.operation) {
    case 'add': result = a.plus(b); break;
    case 'subtract': result = a.minus(b); break;
    case 'multiply': result = a.times(b); break;
    case 'divide':
      if (b.isZero()) throw new Error('Division by zero is not defined.');
      result = a.div(b); break;
    default: throw new Error('Unsupported operation.');
  }
  if (!result.isFinite()) throw new Error('Non-finite result.');
  return { result: result.toString(), precision: 50, rounding: 'half-even; results exceeding 50 significant digits are rounded, including non-terminating division' };
}
