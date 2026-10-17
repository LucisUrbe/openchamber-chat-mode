import { Agent, Plugin } from '@opencode/plugin';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sep } from 'node:path';
import { allowedTools, trimTools, versions } from './policy.js';
import { calculate, type Calculation } from './calculator.js';

export default Plugin.define({
  id: 'openchamber-chat-mode',
  async setup(ctx) {
    // The bundle is deployed only at location/.opencode/plugins/chat/index.js.
    const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
    const directory = realpathSync(ctx.location.directory);
    if (directory !== root && !directory.startsWith(root + sep)) return;
    if (ctx.app.version !== versions.opencode) throw new Error(`Chat mode requires OpenCode ${versions.opencode}; revalidate before upgrading.`);
    await ctx.agent.transform(editor => {
      editor.update('chat', agent => { agent.name = Agent.Name.make('Chat'); });
    });
    await ctx.tool.transform(editor => {
      // Native tools must remain directly callable when Code Mode is unavailable.
      for (const name of allowedTools) editor.update(name, tool => {
        tool.options = { namespace: tool.options?.namespace, permission: tool.options?.permission, codemode: false };
      });
      editor.add({
        name: 'chat_calculate',
        description: 'Add, subtract, multiply or divide decimal strings with 50 significant digits and half-even rounding. No code execution.',
        options: { codemode: false, permission: 'chat_calculate' },
        input: {
          type: 'object', additionalProperties: false,
          properties: {
            operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
            a: { type: 'string', maxLength: 256 }, b: { type: 'string', maxLength: 256 },
          }, required: ['operation', 'a', 'b'],
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
