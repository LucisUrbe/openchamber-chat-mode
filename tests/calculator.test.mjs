import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../dist/lib/calculator.js';

test('legacy decimal operations preserve their inputs and 50 digit output', () => {
  for (const [operation, a, b, expected] of [
    ['add', '0.1', '0.2', '0.3'],
    ['subtract', '1', '.9', '0.1'],
    ['multiply', '123.45', '100', '12345'],
    ['divide', '1', '8', '0.125'],
    ['divide', '1', '3', `0.${'3'.repeat(50)}`],
  ]) {
    const actual = calculate({ operation, a, b });
    assert.equal(actual.result, expected);
    assert.equal(actual.precision, 50);
  }
  assert.match(calculate({ operation: 'divide', a: '1', b: '3' }).rounding, /half-even/);
  for (const a of ['NaN', 'Infinity', '1e999999', 'process.exit()', '0x10', '1'.repeat(257), '']) {
    assert.throws(() => calculate({ operation: 'add', a, b: '1' }));
  }
  assert.equal(calculate({ operation: 'add', a: '1e2', b: '1' }).result, '101');
  assert.equal(calculate({ operation: 'divide', a: '1', b: '3', precision: 5 }).result, '0.33333');
  assert.throws(() => calculate({ operation: 'add', a: '1', b: '1', precision: 257 }), /Precision/);
  assert.throws(() => calculate({ operation: 'divide', a: '1', b: '0' }), /zero/);
  assert.throws(() => calculate({ operation: 'eval', a: '1', b: '2' }));
});

test('expression parser follows arithmetic precedence and rejects code', () => {
  const evaluate = expression => calculate({ operation: 'expression', expression }).result;
  assert.equal(evaluate('1 + 2 * 3'), '7');
  assert.equal(evaluate('(1 + 2) * 3'), '9');
  assert.equal(evaluate('-2^2'), '-4');
  assert.equal(evaluate('2^3^2'), '512');
  assert.equal(evaluate('2^-2'), '0.25');
  assert.equal(evaluate('10 % 4 + 1'), '3');
  assert.equal(evaluate('20 - 5 - 3'), '12');
  assert.equal(evaluate('(-7) % 3'), '-1');
  for (const expression of [
    'process.exit()', 'Math.max(1, 2)', '2 ** 3', '1 / 0', '1 % 0', '2^1.5', '2^101', '1 +',
  ]) assert.throws(() => evaluate(expression), undefined, expression);
  assert.throws(() => evaluate('('.repeat(33) + '1' + ')'.repeat(33)), /nesting/);
  assert.throws(() => evaluate(Array.from({ length: 260 }, () => '1').join('+')), /tokens/);
  assert.throws(() => evaluate('1'.repeat(2049)), /2048/);
});

test('new decimal operations cover reductions, order statistics, and roots', () => {
  const calculateValues = (operation, values, extra = {}) => calculate({ operation, values, ...extra });
  assert.equal(calculateValues('sum', ['1', '2', '3']).result, '6');
  assert.equal(calculateValues('product', ['2', '3', '4']).result, '24');
  assert.equal(calculateValues('mean', ['1', '2', '3']).result, '2');
  assert.equal(calculateValues('median', ['1', '3', '5']).result, '3');
  assert.equal(calculateValues('median', ['1', '2', '5', '8']).result, '3.5');
  assert.equal(calculateValues('min', ['5', '-2', '3']).result, '-2');
  assert.equal(calculateValues('max', ['5', '-2', '3']).result, '5');
  assert.equal(calculate({ operation: 'sqrt', a: '4' }).result, '2');
  assert.equal(calculate({ operation: 'sqrt', a: '-0' }).result, '0');
  assert.match(calculate({ operation: 'sqrt', a: '2' }).result, /^1\.4142135623730950488016887242096980785696718753769$/);
  assert.throws(() => calculate({ operation: 'sqrt', a: '-1' }), /nonnegative/);
  assert.throws(() => calculateValues('sum', []), /1 to 256/);
  assert.throws(() => calculateValues('product', Array(257).fill('1')), /1 to 256/);
});

test('population and sample statistics use their respective denominators', () => {
  const values = ['1', '2', '3'];
  assert.equal(calculate({ operation: 'variance', values }).result, `0.${'6'.repeat(49)}7`);
  assert.equal(calculate({ operation: 'stddev', values }).result, '0.81649658092772603273242802490196379732198249355223');
  assert.equal(calculate({ operation: 'sample_variance', values }).result, '1');
  assert.equal(calculate({ operation: 'sample_stddev', values }).result, '1');
  const large = `1${'0'.repeat(100)}`;
  const adjacent = `1${'0'.repeat(99)}1`;
  assert.equal(calculate({ operation: 'variance', values: [large, adjacent] }).result, '0.25');
  assert.equal(calculate({ operation: 'sample_variance', values: [large, adjacent] }).result, '0.5');
  assert.match(calculate({ operation: 'variance', values }).rounding, /divide by N; sample variance and standard deviation divide by N−1/);
  assert.match(calculate({ operation: 'sample_variance', values }).rounding, /divide by N; sample variance and standard deviation divide by N−1/);
  assert.throws(() => calculate({ operation: 'sample_variance', values: ['1'] }), /at least 2/);
  assert.throws(() => calculate({ operation: 'sample_stddev', values: [] }), /1 to 256/);
});

test('dot products, weighted means, and matrix multiplication validate dimensions', () => {
  assert.equal(calculate({ operation: 'dot', values: ['1', '2', '3'], weights: ['4', '5', '6'] }).result, '32');
  assert.equal(calculate({ operation: 'weighted_mean', values: ['10', '20'], weights: ['1', '3'] }).result, '17.5');
  assert.equal(calculate({ operation: 'weighted_mean', values: ['10', '20'], weights: ['-0', '3'] }).result, '20');
  assert.throws(() => calculate({ operation: 'weighted_mean', values: ['1', '2'], weights: ['-1', '2'] }), /nonnegative/);
  assert.throws(() => calculate({ operation: 'weighted_mean', values: ['1', '2'], weights: ['0', '0'] }), /positive total/);
  assert.throws(() => calculate({ operation: 'dot', values: ['1'], weights: ['1', '2'] }), /same length/);
  assert.deepEqual(calculate({
    operation: 'matrix_multiply',
    matrix: [['1', '2', '3'], ['4', '5', '6']],
    rightMatrix: [['7', '8'], ['9', '10'], ['11', '12']],
  }).result, [['58', '64'], ['139', '154']]);
  assert.throws(() => calculate({ operation: 'matrix_multiply', matrix: [['1', '2'], ['3']], rightMatrix: [['1'], ['2']] }), /equal width/);
  assert.throws(() => calculate({ operation: 'matrix_multiply', matrix: [['1', '2']], rightMatrix: [['1', '2']] }), /dimensions/);
  assert.throws(() => calculate({ operation: 'matrix_multiply', matrix: Array.from({ length: 17 }, () => ['1']), rightMatrix: [['1']] }), /16 rows/);
});

test('precision, decimal exponent bounds, and large exact integers are enforced', () => {
  assert.deepEqual(calculate({ operation: 'expression', expression: '1/3', precision: 5 }), {
    result: `0.${'3'.repeat(5)}`,
    precision: 5,
    rounding: '5 significant decimal digits, half-even.',
  });
  assert.equal(calculate({ operation: 'min', values: ['1.23456789'], precision: 4 }).result, '1.235');
  assert.equal(calculate({ operation: 'expression', expression: '0.125', precision: 2 }).result, '0.12');
  assert.equal(calculate({ operation: 'expression', expression: '0.135', precision: 2 }).result, '0.14');
  for (const precision of [0, 257, 1.5, '5']) {
    assert.throws(() => calculate({ operation: 'sum', values: ['1'], precision }));
  }
  assert.equal(calculate({ operation: 'sum', values: ['1e-256'] }).result, '1e-256');
  assert.throws(() => calculate({ operation: 'sum', values: ['1e+999'] }), /exponent limit/);
  assert.throws(() => calculate({ operation: 'sum', values: ['1e9999'] }), /1 to 3 digit exponent/);
  assert.throws(() => calculate({ operation: 'expression', expression: '1e-256/10' }), /exponent limit/);
  assert.throws(() => calculate({ operation: 'sum', values: ['9e256', '9e256'] }), /exponent limit/);

  const huge = '9'.repeat(256);
  assert.equal(calculate({ operation: 'bigint', left: huge, right: huge, operator: '*' }).result,
    (BigInt(huge) * BigInt(huge)).toString());
  assert.equal(calculate({ operation: 'bigint', left: '-7', right: '3', operator: '/' }).result, '-2');
  assert.equal(calculate({ operation: 'bigint', left: '-7', right: '3', operator: '%' }).result, '-1');
  assert.equal(calculate({ operation: 'bigint', left: '12', right: '30', operator: '+' }).precision, 0);
  assert.throws(() => calculate({ operation: 'bigint', left: '1', right: '0', operator: '/' }), /zero/);
  assert.throws(() => calculate({ operation: 'bigint', left: '1'.repeat(257), right: '1', operator: '+' }), /256 digits/);
});
