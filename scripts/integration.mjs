// Runs the installed OpenCode binary, with isolated XDG storage and a local
// OpenAI-compatible fixture. No account credentials or real LLM calls are used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, cp, writeFile, readFile, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { chatConfig, allowedTools, versions, supportedMajors, supportsMajorVersion } from '../dist/lib/policy.js';

const binary = process.env.OPENCODE_TEST_BINARY ?? '/Applications/OpenChamber.app/Contents/Resources/opencode-cli/opencode';
const root = await mkdtemp(join(tmpdir(), 'openchamber-chat-test-'));
const chat = join(root, 'chat'), coding = join(root, 'coding');
await cp(resolve('dist/location'), chat, { recursive: true });
await mkdir(coding);
const managedPlugin = process.env.OPENCODE_TEST_MANAGED_PLUGIN;
const managedDirectory = managedPlugin && ((await stat(managedPlugin)).isDirectory() ? managedPlugin : dirname(managedPlugin));
const managedSource = managedDirectory ? await readFile(join(managedDirectory, 'index.js'), 'utf8') : '';
const managedNames = ['openchamber_web', 'openchamber_memory', 'openchamber_render', 'openchamber_schedule', 'openchamber_knowledge', 'openchamber_image'];
const fixtureNames = managedNames.filter(name => !managedSource.includes(`name: "${name}"`));
const requests = [], nativeCalls = [], memories = new Map();
let replyTool;
const fixture = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body);
  if (req.url === '/agent-tool') {
    if (req.headers.authorization !== 'Bearer local-native-fixture') { res.writeHead(403).end(); return; }
    nativeCalls.push(input);
    const requested = input.input.action;
    const prefix = input.tool === 'openchamber_web' ? 'browser.' : input.tool === 'openchamber_memory' ? 'memory.' : '';
    const action = prefix && typeof requested === 'string' && !requested.includes('.') ? prefix + requested : requested;
    let data = { fixture: input.tool };
    if (action === 'memory.save') memories.set(input.input.title, input.input.body);
    if (action === 'memory.read') data = { body: memories.get(input.input.title) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ schemaVersion: 1, ok: true, action, data }));
    return;
  }
  requests.push(input);
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
// Optionally test a real installation's JSON configuration without writing to it.
const testChatConfig = process.env.OPENCODE_TEST_CHAT_CONFIG
  ? JSON.parse(await readFile(process.env.OPENCODE_TEST_CHAT_CONFIG, 'utf8'))
  : chatConfig();
const fixturePlugin = join(root, 'native-fixture');
await mkdir(fixturePlugin);
await cp(resolve('tests/fixtures/openchamber-managed.mjs'), join(fixturePlugin, 'index.js'));
await writeFile(join(fixturePlugin, 'package.json'), JSON.stringify({ name:'chat-test-openchamber-managed', version:'0.0.0', type:'module', main:'./index.js' }));
const managedCopy = join(root, 'installed-managed');
if (managedDirectory) await cp(managedDirectory, managedCopy, { recursive:true });
const plugins = [...(managedDirectory ? [managedCopy] : []), fixturePlugin];
await mkdir(join(root, 'config', 'opencode'), { recursive:true });
await writeFile(join(root, 'config', 'opencode', 'opencode.json'), JSON.stringify({ plugins }));
await writeFile(join(chat, 'opencode.jsonc'), JSON.stringify({ ...testChatConfig, ...model }));
await writeFile(join(coding, 'opencode.jsonc'), JSON.stringify(model));
const password = randomBytes(24).toString('hex');
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, XDG_DATA_HOME: join(root,'data'), XDG_CONFIG_HOME: join(root,'config'), XDG_CACHE_HOME: join(root,'cache'), XDG_STATE_HOME: join(root,'state'), OPENCODE_SERVER_PASSWORD: password, OPENCHAMBER_AGENT_TOOL_URL: `http://127.0.0.1:${fixture.address().port}/agent-tool`, OPENCHAMBER_AGENT_TOOL_TOKEN: 'local-native-fixture', CHAT_TEST_FIXTURE_NATIVE_TOOLS: JSON.stringify(fixtureNames) };
const binaryVersionOutput = execFileSync(binary, ['--version'], { cwd: root, env, encoding: 'utf8' }).trim();
const binaryVersion = binaryVersionOutput.match(/^opencode v(\S+)$/)?.[1];
assert.ok(supportsMajorVersion(binaryVersion, supportedMajors.opencode), `Unsupported or unrecognized OpenCode version: ${binaryVersionOutput}`);
let appVersion;
try { appVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c','Print :CFBundleShortVersionString','/Applications/OpenChamber.app/Contents/Info.plist'], { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim(); }
catch { appVersion = undefined; }
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
function lastToolResponse(captured) {
  const messages = captured.flatMap(request => request.messages.filter(message => message.role === 'tool'));
  assert.ok(messages.length, 'tool response reaches the model');
  return JSON.parse(messages.at(-1).content);
}
try {
  for (let i=0;i<200;i++) { base = logs.match(/server listening on (http:\/\/[^\s]+)/)?.[1]; if (base) break; if (child.exitCode !== null) throw new Error('OpenCode exited'); await delay(50); }
  assert.ok(base, 'server started');
  let plugins, agents;
  for (let i=0;i<100;i++) {
    plugins = await api(scoped('/api/plugin', chat));
    const plugin = plugins.data.find(p => p.id === 'openchamber-chat-mode');
    const watchdog = plugins.data.find(p => p.id === 'openchamber-chat-watchdog');
    if (plugin?.state.status === 'failed' || watchdog?.state.status === 'failed') break;
    if (plugin?.state.status === 'active' && watchdog?.state.status === 'active') {
      agents = await api(scoped('/api/agent', chat));
      if (agents.data.find(a => a.id === 'chat')?.name === 'Chat') break;
    }
    await delay(100);
  }
  await writeFile(join(root,'plugins.json'),JSON.stringify(plugins,null,2));
  assert.equal(plugins.data.find(p => p.id === 'openchamber-chat-mode')?.state.status, 'active');
  assert.equal(plugins.data.find(p => p.id === 'openchamber-chat-watchdog')?.state.status, 'active');
  agents ??= await api(scoped('/api/agent', chat));
  assert.ok(agents.data.some(a => a.id === 'chat'));
  assert.equal(agents.data.find(a => a.id === 'chat').name, 'Chat');
  const session = (await api('/api/session', { location: { directory: chat }, title: 'Chat integration' })).data;
  const config = await api(scoped('/api/config',chat));
  assert.equal(config.find(e => e.path === join(chat,'opencode.jsonc'))?.info.default_agent, 'chat');
  for (const agent of ['chat','build']) {
    await api(`/api/session/${session.id}/agent`, { agent });
    // A permissive session override must not weaken the Location policy.
    if (agent === 'build') await api(`/api/session/${session.id}`, { permissions:[{action:'*',resource:'*',effect:'allow'}] }, 'PATCH');
    for (const action of ['read','edit','write','patch','glob','grep','shell','subagent','skill','execute','browser','openchamber','openchamber_schedule','openchamber_knowledge','openchamber_image','future_plugin_tool']) {
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
    const schema = primary.tools.find(t => t.function.name === 'chat_calculate').function.parameters;
    assert.ok(schema.properties.operation.enum.includes('expression'));
    assert.ok(schema.properties.operation.enum.includes('sample_variance'));
    assert.ok(schema.properties.operation.enum.includes('matrix_multiply'));
    assert.ok(schema.properties.operation.enum.includes('bigint'));
  }
  replyTool = { name: 'chat_calculate', args: { operation: 'add', a: '0.1', b: '0.2' } };
  const arithmetic = await prompt(session.id, 'Calculate 0.1 plus 0.2.');
  assert.equal(lastToolResponse(arithmetic).result, '0.3', 'real calculator result returns to model');
  await api(`/api/session/${session.id}/agent`, { agent:'chat' });
  for (const [args, expected] of [
    [{ operation:'expression', expression:'1250*(12.5/100)+2^3' }, '164.25'],
    [{ operation:'weighted_mean', values:['80','90'], weights:['0.25','0.75'] }, '87.5'],
    [{ operation:'sample_variance', values:['1','3'] }, '2'],
    [{ operation:'matrix_multiply', matrix:[['1','2']], rightMatrix:[['3'],['4']] }, [['11']]],
    [{ operation:'bigint', left:'9007199254740993', right:'2', operator:'+' }, '9007199254740995'],
  ]) {
    replyTool = { name:'chat_calculate', args };
    const captured = await prompt(session.id, `Exercise calculator operation ${args.operation}.`);
    assert.deepEqual(lastToolResponse(captured).result, expected, `${args.operation} result returns to model`);
  }
  replyTool = { name:'openchamber_web', args:{ action:'browser.snapshot', parameters:{} } };
  const web = await prompt(session.id, 'Inspect the browser page.');
  assert.equal(lastToolResponse(web).action, 'browser.snapshot');
  assert.equal(nativeCalls.at(-1).tool, 'openchamber_web');
  replyTool = { name:'openchamber_web', args:{ action:'open', parameters:{ url:'https://example.com' } } };
  const webAlias = await prompt(session.id, 'Open a test page with the short action name.');
  assert.equal(lastToolResponse(webAlias).action, 'browser.open');
  assert.equal(nativeCalls.at(-1).input.action, 'open', 'short action reaches the managed tool');
  replyTool = { name:'openchamber_render', args:{ action:'render.page', parameters:{ title:'Fixture', html:'<p>Fixture</p>' } } };
  const rendered = await prompt(session.id, 'Show an interactive illustration.');
  assert.equal(lastToolResponse(rendered).action, 'render.page');
  assert.equal(nativeCalls.at(-1).tool, 'openchamber_render');
  replyTool = { name:'openchamber_memory', args:{ action:'memory.save', parameters:{ title:'Fixture preference', body:'fixture value', scope:'project' } } };
  const saved = await prompt(session.id, 'Remember the fixture preference.');
  assert.equal(lastToolResponse(saved).action, 'memory.save');
  const followup = (await api('/api/session', { location:{ directory:chat }, title:'Memory follow-up', agent:'chat' })).data;
  replyTool = { name:'openchamber_memory', args:{ action:'read', parameters:{ title:'Fixture preference', scope:'project' } } };
  const recalled = await prompt(followup.id, 'Read the fixture preference.');
  assert.equal(lastToolResponse(recalled).data.body, 'fixture value');
  assert.notEqual(nativeCalls.at(-1).sessionID, nativeCalls.at(-2).sessionID, 'memory requests come from different sessions');
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
  const codingTools = control.find(r => r.tools?.length).tools.map(t => t.function.name);
  assert.ok(codingTools.includes('execute'), 'coding location retains Code Mode');
  assert.ok(!codingTools.includes('openchamber_web') && !codingTools.includes('openchamber_memory'), 'Chat direct-tool transform stays in its location');
  const report = {
    passed: true,
    versions: {
      opencode: { actual:binaryVersion, baseline:versions.opencode, matchesBaseline:binaryVersion === versions.opencode },
      openchamber: { installed:appVersion ?? null, baseline:versions.openchamber, matchesBaseline:appVersion === versions.openchamber },
    },
    checks: ['local plugin active', 'configured default Chat agent and display name', 'Chat and Build negative permissions', 'captured model tool allowlist and calculator schema for Chat and Build', 'native browser, render and cross-session memory calls through a local callback fixture', 'actual arithmetic, expression, statistics, matrix and bigint tool execution', 'explicit text and image attachments', 'forced unadvertised shell call rejected; sentinel unchanged', 'ordinary coding location unaffected'], managedPlugin: managedPlugin ? 'installed native plugin plus stand-ins for missing tools' : 'stand-ins', fixtureNames, realLLM: false, externalSearch: false,
  };
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
