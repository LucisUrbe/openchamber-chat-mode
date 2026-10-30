import { Decimal } from 'decimal.js';

export type CalculationOperation =
  | 'add' | 'subtract' | 'multiply' | 'divide'
  | 'expression' | 'sum' | 'product' | 'mean' | 'median' | 'min' | 'max'
  | 'variance' | 'stddev' | 'sample_variance' | 'sample_stddev'
  | 'weighted_mean' | 'dot' | 'matrix_multiply' | 'sqrt' | 'bigint';

export type IntegerOperator = '+' | '-' | '*' | '/' | '%';

// Keep the original a/b inputs while allowing each operation to use only its
// documented fields. Optional fields also let the tool schema vary by operation.
export interface Calculation {
  operation: CalculationOperation;
  a?: string;
  b?: string;
  expression?: string;
  values?: string[];
  weights?: string[];
  matrix?: string[][];
  rightMatrix?: string[][];
  left?: string;
  right?: string;
  operator?: IntegerOperator;
  precision?: number;
}

const LEGACY_OPERATIONS = new Set<CalculationOperation>(['add', 'subtract', 'multiply', 'divide']);
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,3})?$/i;
const EXPRESSION_TOKEN = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+\-*/%^]|\S/gi;

function bounded(value: Decimal): Decimal {
  if (!value.isFinite()) throw new Error('Calculation produced a non-finite result.');
  if (!value.isZero() && Math.abs(value.e ?? 0) > 256) {
    throw new Error('Calculation exceeds the decimal exponent limit of ±256.');
  }
  return value;
}

function number(text: unknown, D: typeof Decimal): Decimal {
  if (typeof text !== 'string' || text.length > 256 || !DECIMAL_TEXT.test(text)) {
    throw new Error('Use decimal strings of at most 256 characters with an optional 1 to 3 digit exponent.');
  }
  return bounded(new D(text));
}

function decimalArray(values: unknown, D: typeof Decimal): Decimal[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 256) {
    throw new Error('Use an array of 1 to 256 decimal values.');
  }
  return Array.from(values, value => number(value, D));
}

function checkedSum(values: Decimal[], D: typeof Decimal): Decimal {
  return values.reduce((total, value) => bounded(total.plus(value)), new D(0));
}

function expression(source: unknown, D: typeof Decimal): Decimal {
  if (typeof source !== 'string' || !source.trim() || source.length > 2048) {
    throw new Error('Expression must contain 1 to 2048 characters.');
  }

  const tokens: string[] = [];
  for (const token of source.match(EXPRESSION_TOKEN) ?? []) {
    if (!/^\s+$/.test(token)) tokens.push(token);
  }
  if (tokens.length > 512) throw new Error('Expression may contain at most 512 tokens.');

  let at = 0;
  const parse = (minimumPrecedence = 0, depth = 0): Decimal => {
    if (depth > 32) throw new Error('Expression nesting exceeds 32.');

    const token = tokens[at++];
    let value: Decimal;
    if (token === '+' || token === '-') {
      value = parse(4, depth + 1);
      if (token === '-') value = bounded(value.neg());
    } else if (token === '(') {
      value = parse(0, depth + 1);
      if (tokens[at++] !== ')') throw new Error('Unbalanced parentheses.');
    } else if (token !== undefined) {
      value = number(token, D);
    } else {
      throw new Error('Missing expression operand.');
    }

    while (at < tokens.length) {
      const operator = tokens[at]!;
      const precedence = operator === '+' || operator === '-' ? 1
        : operator === '*' || operator === '/' || operator === '%' ? 2
        : operator === '^' ? 4
        : 0;
      if (!precedence || precedence < minimumPrecedence) break;
      at++;
      // Powers associate right; all other binary operators associate left.
      const right = parse(operator === '^' ? precedence : precedence + 1, depth + 1);

      if (operator === '/' && right.isZero()) throw new Error('Division by zero is not defined.');
      if (operator === '%' && right.isZero()) throw new Error('Remainder by zero is not defined.');
      if (operator === '^') {
        if (!right.isInteger() || right.abs().gt(100)) {
          throw new Error('Power exponent must be an integer from -100 to 100.');
        }
        if (value.isZero() && right.lt(0)) throw new Error('Zero cannot be raised to a negative power.');
      }

      const result = operator === '+' ? value.plus(right)
        : operator === '-' ? value.minus(right)
        : operator === '*' ? value.times(right)
        : operator === '/' ? value.div(right)
        : operator === '%' ? value.mod(right)
        : value.pow(right);
      value = bounded(result);
    }
    return value;
  };

  const value = parse();
  if (at !== tokens.length) throw new Error('Only numeric arithmetic and parentheses are accepted.');
  return value;
}

function integer(text: unknown): bigint {
  if (typeof text !== 'string' || !/^[+-]?\d{1,256}$/.test(text)) {
    throw new Error('Use integer strings with at most 256 digits.');
  }
  return BigInt(text);
}

function calculateBigInt(input: Calculation): { result: string; precision: 0; rounding: string } {
  const left = integer(input.left);
  const right = integer(input.right);
  let result: bigint;
  switch (input.operator) {
    case '+': result = left + right; break;
    case '-': result = left - right; break;
    case '*': result = left * right; break;
    case '/':
      if (right === 0n) throw new Error('Division by zero is not defined.');
      result = left / right;
      break;
    case '%':
      if (right === 0n) throw new Error('Remainder by zero is not defined.');
      result = left % right;
      break;
    default: throw new Error('Unknown integer operator.');
  }
  const text = result.toString();
  if (text.replace(/^-/, '').length > 513) throw new Error('Integer result exceeds bounds.');
  return { result: text, precision: 0, rounding: 'Exact integer arithmetic; division truncates toward zero.' };
}

function matrix(input: unknown, D: typeof Decimal): Decimal[][] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 16
      || !Array.isArray(input[0]) || input[0].length < 1 || input[0].length > 16) {
    throw new Error('Use a nonempty matrix with at most 16 rows and 16 columns.');
  }
  const width = input[0].length;
  if (Array.from(input).some(row => !Array.isArray(row) || row.length !== width)) {
    throw new Error('Matrix rows must have equal width.');
  }
  return Array.from(input, row => Array.from(row as unknown[], value => number(value, D)));
}

function decimalResult(value: Decimal, precision: number): string {
  return bounded(value.toSignificantDigits(precision, Decimal.ROUND_HALF_EVEN)).toString();
}

export function calculate(input: Calculation): { result: string | string[][]; precision: number; rounding: string } {
  if (input.operation === 'bigint') return calculateBigInt(input);

  const legacy = LEGACY_OPERATIONS.has(input.operation);
  const precision = input.precision === undefined ? 50 : input.precision;
  if (!Number.isInteger(precision) || precision < 1 || precision > 256) {
    throw new Error('Precision must be an integer from 1 to 256.');
  }

  // The wide Decimal exponent window prevents silent underflow before our
  // explicit ±256 checks can reject an out-of-range intermediate value.
  const D = Decimal.clone({ precision, rounding: Decimal.ROUND_HALF_EVEN, maxE: 1_000_000, minE: -1_000_000 });
  const parseNumber = (value: unknown) => number(value, D);
  let result: string | string[][];

  if (legacy) {
    const a = parseNumber(input.a), b = parseNumber(input.b);
    let value: Decimal;
    switch (input.operation) {
      case 'add': value = a.plus(b); break;
      case 'subtract': value = a.minus(b); break;
      case 'multiply': value = a.times(b); break;
      case 'divide':
        if (b.isZero()) throw new Error('Division by zero is not defined.');
        value = a.div(b);
        break;
      default: throw new Error('Unsupported operation.');
    }
    result = decimalResult(bounded(value), precision);
    return {
      result,
      precision,
      rounding: `half-even; results exceeding ${precision} significant digits are rounded, including non-terminating division`,
    };
  }

  if (input.operation === 'expression') {
    result = decimalResult(expression(input.expression, D), precision);
  } else if (input.operation === 'sqrt') {
    const value = parseNumber(input.a);
    if (value.lt(0)) throw new Error('Square root requires a nonnegative value.');
    result = decimalResult(bounded(value.sqrt()), precision);
  } else if (input.operation === 'matrix_multiply') {
    const left = matrix(input.matrix, D), right = matrix(input.rightMatrix, D);
    if (left[0]!.length !== right.length) throw new Error('Matrix dimensions do not match.');
    result = left.map(row => right[0]!.map((_, column) => {
      const products = row.map((value, index) => bounded(value.times(right[index]![column]!)));
      return decimalResult(checkedSum(products, D), precision);
    }));
  } else {
    const values = decimalArray(input.values, D);
    let value: Decimal;
    switch (input.operation) {
      case 'sum': value = checkedSum(values, D); break;
      case 'product': value = values.reduce((total, item) => bounded(total.times(item)), new D(1)); break;
      case 'mean': value = bounded(checkedSum(values, D).div(values.length)); break;
      case 'min': value = Decimal.min(...values); break;
      case 'max': value = Decimal.max(...values); break;
      case 'median': {
        const sorted = [...values].sort((left, right) => left.cmp(right));
        const middle = Math.floor(sorted.length / 2);
        value = sorted.length % 2 === 1
          ? sorted[middle]!
          : bounded(bounded(sorted[middle - 1]!.plus(sorted[middle]!)).div(2));
        break;
      }
      case 'variance': case 'stddev': case 'sample_variance': case 'sample_stddev': {
        const sample = input.operation === 'sample_variance' || input.operation === 'sample_stddev';
        if (sample && values.length < 2) throw new Error('Sample statistics require at least 2 values.');
        // Center around an observed value before computing the mean. This keeps
        // small spreads meaningful when values share a very large magnitude.
        const anchor = values[0]!;
        const centered = values.map(item => bounded(item.minus(anchor)));
        const centerMean = bounded(checkedSum(centered, D).div(values.length));
        const squaredDifferences = centered.map(item => bounded(bounded(item.minus(centerMean)).pow(2)));
        value = bounded(checkedSum(squaredDifferences, D).div(sample ? values.length - 1 : values.length));
        if (input.operation === 'stddev' || input.operation === 'sample_stddev') value = bounded(value.sqrt());
        break;
      }
      case 'dot': case 'weighted_mean': {
        const weights = decimalArray(input.weights, D);
        if (weights.length !== values.length) throw new Error('Values and weights must have the same length.');
        const products = values.map((item, index) => bounded(item.times(weights[index]!)));
        value = checkedSum(products, D);
        if (input.operation === 'weighted_mean') {
          if (weights.some(weight => weight.lt(0))) throw new Error('Weights must be nonnegative.');
          const totalWeight = checkedSum(weights, D);
          if (totalWeight.isZero()) throw new Error('Weights must have a positive total.');
          value = bounded(value.div(totalWeight));
        }
        break;
      }
      default: throw new Error('Unsupported calculation operation.');
    }
    result = decimalResult(bounded(value), precision);
  }

  const statisticNote = input.operation === 'variance' || input.operation === 'stddev'
    || input.operation === 'sample_variance' || input.operation === 'sample_stddev'
    ? ' Population variance and standard deviation divide by N; sample variance and standard deviation divide by N−1.'
    : '';
  return {
    result,
    precision,
    rounding: `${precision} significant decimal digits, half-even.${statisticNote}`,
  };
}
