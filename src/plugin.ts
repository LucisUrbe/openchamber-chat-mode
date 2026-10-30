import { Plugin } from '@opencode/plugin';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';
import { allowedTools, supportedMajors, supportsMajorVersion, trimTools } from './policy.js';
import { calculate, type Calculation } from './calculator.js';

export default Plugin.define({
  id: 'openchamber-chat-mode',
  async setup(ctx) {
    // The bundle is deployed only at location/.opencode/plugins/chat/index.js.
    const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
    const directory = realpathSync(ctx.location.directory);
    if (directory !== root && !directory.startsWith(root + sep)) return;
    if (!supportsMajorVersion(ctx.app.version, supportedMajors.opencode)) throw new Error(`Chat mode requires OpenCode ${supportedMajors.opencode}.x.y; received ${ctx.app.version}.`);
    await ctx.tool.transform(editor => {
      // Native tools must remain directly callable when Code Mode is unavailable.
      for (const name of allowedTools) editor.update(name, tool => {
        tool.options = { namespace: tool.options?.namespace, permission: tool.options?.permission, codemode: false };
      });
      editor.add({
        name: 'chat_calculate',
        description: 'Calculate using decimal strings. Use expression for arithmetic (+, -, *, /, %, ^ and parentheses); add/subtract/multiply/divide use a and b; sqrt uses a. Use values for sum, product, mean, median, min, max, variance, stddev, sample_variance and sample_stddev; weighted_mean and dot also use weights. matrix_multiply uses matrix and rightMatrix. bigint uses left, right and operator for exact integer arithmetic. Decimal calculations default to 50 significant digits, with optional precision up to 256; rounding is half-even. Variance and stddev are population statistics unless named sample_. No code or function calls.',
        options: { codemode: false, permission: 'chat_calculate' },
        input: {
          type: 'object', additionalProperties: false,
          properties: {
            operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide', 'sqrt', 'expression', 'sum', 'product', 'mean', 'median', 'min', 'max', 'variance', 'stddev', 'sample_variance', 'sample_stddev', 'weighted_mean', 'dot', 'matrix_multiply', 'bigint'] },
            a: { type: 'string', maxLength: 256, description: 'First decimal operand, or input to sqrt.' },
            b: { type: 'string', maxLength: 256, description: 'Second decimal operand.' },
            expression: { type: 'string', maxLength: 2048, description: 'Numeric arithmetic expression; identifiers and functions are not allowed.' },
            values: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'string', maxLength: 256 }, description: 'Decimal values for statistics or the first vector.' },
            weights: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'string', maxLength: 256 }, description: 'Weights for weighted_mean, or the second vector for dot.' },
            matrix: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', maxLength: 256 } }, description: 'Left matrix.' },
            rightMatrix: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', maxLength: 256 } }, description: 'Right matrix.' },
            left: { type: 'string', maxLength: 257, description: 'First integer for bigint.' },
            right: { type: 'string', maxLength: 257, description: 'Second integer for bigint.' },
            operator: { type: 'string', enum: ['+', '-', '*', '/', '%'], description: 'Operator for bigint; division truncates toward zero.' },
            precision: { type: 'integer', minimum: 1, maximum: 256, description: 'Significant decimal digits, default 50; bigint is exact.' },
          }, required: ['operation'],
        },
        async execute(input, context) {
          context.signal.throwIfAborted();
          await ctx.permission.assert({
            sessionID: context.sessionID, agent: context.agent,
            action: 'chat_calculate', resources: ['*'],
            source: { type: 'tool', messageID: context.messageID, id: context.id },
          });
          return { content: JSON.stringify(calculate(input as Calculation)) };
        },
      });
    });
    await ctx.session.hook('context', event => trimTools(event.tools));
    await ctx.session.hook('generate', event => trimTools(event.tools));
    await ctx.session.hook('compaction', event => trimTools(event.tools));
  },
});
