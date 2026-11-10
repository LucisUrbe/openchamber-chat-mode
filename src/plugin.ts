import { Plugin } from '@opencode/plugin';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';
import { allowedTools, nativeActionAliases, supportedMajors, supportsMajorVersion, trimTools } from './policy.js';
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
        tool.input = nativeActionAliases(name, tool.input) as typeof tool.input;
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
    // Managed OpenChamber plugins can register after this Location plugin. A
    // late transform makes their Code Mode tools direct without enabling the
    // general-purpose execute tool. Re-register if a later reload changes them.
    const managedDirect = ['openchamber_web', 'openchamber_memory'];
    let directTransform: { dispose(): Promise<void> } | undefined;
    let pending = Promise.resolve();
    await ctx.session.hook('prompt', () => {
      pending = pending.catch(() => {}).then(async () => {
        const tools = await ctx.tool.list();
        if (!tools.some(tool => managedDirect.includes(tool.id) && (tool.options?.codemode !== false || nativeActionAliases(tool.id, tool.input) !== tool.input))) return;
        await directTransform?.dispose();
        directTransform = await ctx.tool.transform(editor => {
          for (const name of managedDirect) editor.update(name, tool => {
            tool.options = { namespace: tool.options?.namespace, permission: tool.options?.permission, codemode: false };
            tool.input = nativeActionAliases(name, tool.input) as typeof tool.input;
          });
        });
      });
      return pending;
    });
    await ctx.session.hook('context', event => trimTools(event.tools));
    await ctx.session.hook('generate', event => trimTools(event.tools));
    await ctx.session.hook('compaction', event => trimTools(event.tools));
  },
});
