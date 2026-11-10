// Stand-ins for managed tools that are not installed in the test environment.
// Web and memory use the same Code Mode registration as OpenChamber 2.7.
export default {
  id: 'chat-test-openchamber-managed',
  async setup(ctx) {
    const names = JSON.parse(process.env.CHAT_TEST_FIXTURE_NATIVE_TOOLS ?? '[]');
    await ctx.tool.transform(editor => {
      for (const name of names) {
        const codemode = name !== 'openchamber_render';
        const actions = name === 'openchamber_web'
          ? ['browser.open', 'browser.snapshot', 'browser.close']
          : name === 'openchamber_memory'
            ? ['memory.read', 'memory.list', 'memory.save', 'memory.delete']
            : undefined;
        if (codemode) editor.namespace({ name, description: `Fixture ${name}` });
        editor.add({
          name,
          description: `Fixture ${name}`,
          options: { codemode },
          input: {
            type: 'object',
            properties: {
              action: { type: 'string', ...(actions ? { oneOf: actions.map(value => ({ const:value })) } : {}) },
              parameters: { type: 'object', additionalProperties: true },
            },
            required: ['action'],
            additionalProperties: true,
          },
          async execute(input, context) {
            const { action, parameters, ...rest } = input;
            const response = await fetch(process.env.OPENCHAMBER_AGENT_TOOL_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENCHAMBER_AGENT_TOOL_TOKEN}` },
              body: JSON.stringify({ tool: name, sessionID: context.sessionID, input: { ...rest, ...parameters, action } }),
              signal: context.signal,
            });
            return { content: await response.text() };
          },
        });
      }
    });
  },
};
