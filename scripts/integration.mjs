// Runs the installed OpenCode binary, with isolated XDG storage and a local
// OpenAI-compatible fixture. No account credentials or real LLM calls are used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chatConfig, allowedTools, versions } from '../dist/lib/policy.js';

const binary = process.env.OPENCODE_TEST_BINARY ?? '/Applications/OpenChamber.app/Contents/Resources/opencode-cli/opencode';
const root = await mkdtemp(join(tmpdir(), 'openchamber-chat-test-'));
const chat = join(root, 'chat'), coding = join(root, 'coding');
await cp(resolve('dist/location'), chat, { recursive: true });
await mkdir(coding);
const requests = [];
let replyTool;
const fixture = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body); requests.push(input);
  const tool = replyTool; replyTool = undefined;
  const message = tool ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_test', type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { role: 'assistant', content: 'fixture completed' };
  if (!input.stream) { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); return; }
  res.setHeader('content-type', 'text/event-stream');
  const chunk = delta => ({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] });
  res.write(`data: ${JSON.stringify(chunk(tool ? { role: 'assistant', tool_calls: [{ index: 0, ...message.tool_calls[0] }] } : message))}\n\n`);
  res.write(`data: ${JSON.stringify({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`); res.end();
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const model = {
  model: 'chat-test/fixture',
  providers: { 'chat-test': { name: 'Local fixture', package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'local-fixture-only' }, models: { fixture: { name: 'Fixture', limit: { context: 32000, output: 2048 }, capabilities: { tools: true, input: ['text', 'image'], output: ['text'] } } } } },
};
await writeFile(join(chat, 'opencode.jsonc'), JSON.stringify({ ...chatConfig(), ...model }));
await writeFile(join(coding, 'opencode.jsonc'), JSON.stringify(model));
const password = randomBytes(24).toString('hex');
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, XDG_DATA_HOME: join(root,'data'), XDG_CONFIG_HOME: join(root,'config'), XDG_CACHE_HOME: join(root,'cache'), XDG_STATE_HOME: join(root,'state'), OPENCODE_SERVER_PASSWORD: password };
const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: root, env, stdio: ['ignore','pipe','pipe'] });
let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
const delay = ms => new Promise(r => setTimeout(r,ms));
let base;
async function api(path, data, method = data === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'), 'Content-Type':'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}
const scoped = (path, directory) => path + '?' + new URLSearchParams({ 'location[directory]': directory });
async function prompt(id, text, files) {
  const count = requests.length;
  await api(`/api/session/${id}/prompt`, { text, ...(files ? { files } : {}) });
  await api(`/api/experimental/session/${id}/wait`, {});
  if (requests.length === count) {
    const messages = await api(`/api/session/${id}/message`);
    throw new Error('No provider request: ' + JSON.stringify(messages).slice(-5000));
  }
  return requests.slice(count);
}
try {
  for (let i=0;i<200;i++) { base = logs.match(/server listening on (http:\/\/[^\s]+)/)?.[1]; if (base) break; if (child.exitCode !== null) throw new Error('OpenCode exited'); await delay(50); }
  assert.ok(base, 'server started');
  let plugins;
  for (let i=0;i<100;i++) {
    plugins = await api(scoped('/api/plugin', chat));
    const plugin = plugins.data.find(p => p.id === 'openchamber-chat-mode');
    if (plugin?.state.status === 'active' || plugin?.state.status === 'failed') break;
    await delay(100);
  }
  await writeFile(join(root,'plugins.json'),JSON.stringify(plugins,null,2));
  assert.equal(plugins.data.find(p => p.id === 'openchamber-chat-mode')?.state.status, 'active');
  const agents = await api(scoped('/api/agent', chat));
  assert.ok(agents.data.some(a => a.id === 'chat'));
  assert.equal(agents.data.find(a => a.id === 'chat').name, 'Chat');
  const session = (await api('/api/session', { location: { directory: chat }, title: 'Chat integration' })).data;
  const config = await api(scoped('/api/config',chat));
  assert.equal(config.find(e => e.path === join(chat,'opencode.jsonc'))?.info.default_agent, 'chat');
  for (const agent of ['chat','build']) {
    await api(`/api/session/${session.id}/agent`, { agent });
    // A permissive session override must not weaken the Location policy.
    if (agent === 'build') await api(`/api/session/${session.id}`, { permissions:[{action:'*',resource:'*',effect:'allow'}] }, 'PATCH');
    for (const action of ['read','edit','write','patch','glob','grep','shell','subagent','skill','execute','browser','future_plugin_tool']) {
      const check = await api(`/api/session/${session.id}/permission`, { action, resources: ['*'] });
      assert.equal(check.data.effect, 'deny', `${agent}: ${action}`);
    }
    for (const action of allowedTools) {
      const check = await api(`/api/session/${session.id}/permission`, { action, resources: ['*'] });
      assert.equal(check.data.effect, 'allow', `${agent}: ${action}`);
    }
    const captured = await prompt(session.id, 'Say hello.');
    const primary = captured.find(r => r.tools?.length);
    assert.ok(primary, 'primary request with tools');
    assert.deepEqual(primary.tools.map(t => t.function.name).sort(), [...allowedTools].sort());
  }
  replyTool = { name: 'chat_calculate', args: { operation: 'add', a: '0.1', b: '0.2' } };
  const arithmetic = await prompt(session.id, 'Calculate 0.1 plus 0.2.');
  assert.ok(arithmetic.some(r => r.messages.some(m => m.role === 'tool' && String(m.content).includes('0.3'))), 'real calculator result returns to model');
  await api(`/api/session/${session.id}/agent`, { agent:'chat' });
  const attachment = await prompt(session.id, 'Read only my explicit attachment.', [{ uri:'data:text/plain;base64,' + Buffer.from('explicit attachment marker 42817').toString('base64'), name:'input.txt' }]);
  assert.ok(attachment.some(r=>JSON.stringify(r.messages).includes('explicit attachment marker 42817')), 'text attachment reaches model without read permission');
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';
  const visual = await prompt(session.id, 'Inspect this user-provided image.', [{ uri:'data:image/png;base64,'+image, name:'pixel.png' }]);
  assert.ok(visual.some(r=>JSON.stringify(r.messages).includes('image_url')), 'image reaches vision input');
  const sentinel = join(chat,'sentinel.txt'); await writeFile(sentinel,'unchanged');
  replyTool = { name:'shell', args:{command:`echo modified > ${sentinel}`} };
  const attack = await prompt(session.id, 'Try a tool outside the advertised schema.');
  assert.equal(await readFile(sentinel,'utf8'),'unchanged');
  assert.ok(attack.some(r=>r.messages.some(m=>m.role==='tool' && /No tool named|not (found|available)|unknown|invalid|denied/i.test(String(m.content)))), 'unadvertised call is rejected');
  const other = (await api('/api/session', { location: { directory: coding }, title: 'Coding control', agent:'build' })).data;
  for (let i=0;i<100;i++) {
    const catalog = await api(scoped('/api/agent',coding));
    if (catalog.data.some(a => a.id === 'build')) break;
    await delay(100);
  }
  const permitted = await api(`/api/session/${other.id}/permission`, { action:'read', resources:[join(coding,'example.txt')] });
  assert.equal(permitted.data.effect,'allow');
  const control = await prompt(other.id, 'Say hello.');
  assert.ok(control.some(r => r.tools?.some(t => !allowedTools.includes(t.function.name))), 'coding tools unaffected');
  const report = { passed: true, versions, checks: ['local plugin active', 'configured default Chat agent', 'Chat and Build negative permissions', 'native web permissions', 'captured model tool allowlist for Chat and Build', 'actual decimal tool execution', 'explicit text and image attachments', 'forced unadvertised shell call rejected; sentinel unchanged', 'ordinary coding location unaffected'], realLLM: false, externalSearch: false };
  await mkdir('.local/validation', { recursive:true });
  await writeFile('.local/validation/integration.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  console.error(error);
  console.error('Isolated diagnostics:', root);
  process.exitCode = 1;
} finally {
  await writeFile(join(root,'server.log'), logs.replaceAll(password,'[redacted]'));
  await writeFile(join(root,'requests.json'), JSON.stringify(requests,null,2));
  child.kill('SIGTERM'); fixture.closeAllConnections(); fixture.close();
}
