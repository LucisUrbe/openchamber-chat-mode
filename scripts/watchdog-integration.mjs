// Exercise the independent watchdog against the real installed OpenCode binary.
// All locations, credentials and configuration are isolated in a temp directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chatConfig } from '../dist/lib/policy.js';

const binary = process.env.OPENCODE_TEST_BINARY ?? '/Applications/OpenChamber.app/Contents/Resources/opencode-cli/opencode';
const root = await mkdtemp(join(tmpdir(), 'chat-watchdog-test-'));
const locations = Object.fromEntries(['healthy', 'setup-failed', 'syntax-failed', 'missing'].map(name => [name, join(root,name)]));
const baseConfig = process.env.OPENCODE_TEST_CHAT_CONFIG
  ? JSON.parse(await readFile(process.env.OPENCODE_TEST_CHAT_CONFIG, 'utf8'))
  : chatConfig();
const config = {
  ...baseConfig,
  agents: {
    ...baseConfig.agents,
    'guard-fixture': { mode:'primary', description:'Watchdog test primary agent' },
    'guard-shared': { mode:'all', description:'Watchdog test all-mode agent' },
  },
};
for (const location of Object.values(locations)) {
  await cp(resolve('dist/location'), location, { recursive:true });
  await writeFile(join(location,'opencode.jsonc'), JSON.stringify(config));
}
const mainFile = location => join(location,'.opencode/plugins/chat/index.js');
const healthyPlugin = await readFile(mainFile(locations.healthy));
await writeFile(mainFile(locations['setup-failed']), `export default {
  id: 'openchamber-chat-mode',
  async setup(ctx) {
    await ctx.agent.transform(editor => editor.update('chat', agent => { agent.name = 'fixture-before-error'; }));
    throw new Error('intentional setup failure');
  }
};`);
await writeFile(mainFile(locations['syntax-failed']), 'export default {');
await rm(join(locations.missing,'.opencode/plugins/chat'), { recursive:true });

const password = randomBytes(24).toString('hex');
const env = { PATH:process.env.PATH, HOME:process.env.HOME, TMPDIR:process.env.TMPDIR, XDG_DATA_HOME:join(root,'data'), XDG_CONFIG_HOME:join(root,'config'), XDG_CACHE_HOME:join(root,'cache'), XDG_STATE_HOME:join(root,'state'), OPENCODE_SERVER_PASSWORD:password };
const child = spawn(binary, ['serve','--hostname','127.0.0.1','--port','0'], { cwd:root, env, stdio:['ignore','pipe','pipe'] });
let logs = '';
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
let base;
async function api(path, data) {
  const response = await fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization:'Basic ' + Buffer.from('opencode:' + password).toString('base64'), 'Content-Type':'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data), signal:AbortSignal.timeout(5000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body}`);
  return body ? JSON.parse(body) : undefined;
}
const scoped = (path, directory) => path + '?' + new URLSearchParams({ 'location[directory]':directory });
async function waitForNames(directory, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let names;
  while (Date.now() < deadline) {
    names = (await api(scoped('/api/agent',directory))).data;
    if (predicate(names)) return names;
    await delay(200);
  }
  throw new Error(`Agent names did not reach expected state: ${JSON.stringify(names?.map(a => ({ id:a.id, name:a.name })))}`);
}
const hasWarning = (names, message) => ['chat','build','plan','guard-fixture','guard-shared'].every(id => names.some(agent => agent.id === id && agent.name.startsWith(message)));
const isHealthy = names => names.find(a => a.id === 'chat')?.name === 'Chat'
  && names.find(a => a.id === 'build')?.name === 'Build'
  && names.find(a => a.id === 'plan')?.name === 'Plan'
  && ['guard-fixture','guard-shared','guard-added'].every(id => {
    const agent = names.find(a => a.id === id);
    return !agent || !agent.name.startsWith('⚠ Chat ');
  });
try {
  for (let i=0; i<200; i++) {
    base = logs.match(/server listening on (http:\/\/[^\s]+)/)?.[1];
    if (base) break;
    if (child.exitCode !== null) throw new Error('OpenCode exited before listening');
    await delay(50);
  }
  assert.ok(base, 'server started');
  // Trigger each location before polling so their startup windows overlap.
  await Promise.all(Object.values(locations).map(directory => api(scoped('/api/plugin',directory))));
  const [, failedNames] = await Promise.all([
    waitForNames(locations.healthy, isHealthy),
    waitForNames(locations['setup-failed'], names => hasWarning(names, '⚠ Chat 插件失败')),
    waitForNames(locations['syntax-failed'], names => hasWarning(names, '⚠ Chat 插件失败')),
    waitForNames(locations.missing, names => hasWarning(names, '⚠ Chat 状态未知')),
  ]);
  assert.equal(failedNames.find(a => a.id === 'general')?.name, 'General', 'subagent name is unchanged');
  assert.equal(failedNames.find(a => a.id === 'compaction')?.name, 'Compaction', 'hidden primary name is unchanged');
  const healthyPlugins = (await api(scoped('/api/plugin',locations.healthy))).data;
  assert.equal(healthyPlugins.find(p => p.id === 'openchamber-chat-mode')?.state.status, 'active');
  assert.equal(healthyPlugins.find(p => p.id === 'openchamber-chat-watchdog')?.state.status, 'active');
  const syntaxPlugins = (await api(scoped('/api/plugin',locations['syntax-failed']))).data;
  assert.ok(syntaxPlugins.some(p => p.source?.type === 'local' && p.source.path.endsWith('/.opencode/plugins/chat') && p.state.status === 'failed'), 'a syntax failure is visible by its local source path');
  const session = (await api('/api/session', { location:{ directory:locations['setup-failed'] }, title:'Watchdog permission check' })).data;
  for (const agent of ['chat','build','plan']) {
    await api(`/api/session/${session.id}/agent`, { agent });
    for (const action of ['read','shell','browser','future_plugin_tool']) {
      assert.equal((await api(`/api/session/${session.id}/permission`, { action, resources:['*'] })).data.effect, 'deny', `${agent}: ${action}`);
    }
  }
  const changedConfig = { ...config, agents:{ ...config.agents, 'guard-added':{ mode:'primary', description:'Dynamically added watchdog test agent' } } };
  await writeFile(join(locations['setup-failed'],'opencode.jsonc'), JSON.stringify(changedConfig));
  // OpenCode's isolated server does not necessarily notice filesystem edits on
  // its own. Reload locations to apply the changed fixture configuration.
  await api('/api/location/reload', {});
  await waitForNames(locations['setup-failed'], names => hasWarning(names, '⚠ Chat 插件失败')
    && names.some(agent => agent.id === 'guard-added' && agent.name.startsWith('⚠ Chat 插件失败')), 30000);
  await writeFile(mainFile(locations['setup-failed']), healthyPlugin);
  await api('/api/location/reload', {});
  await waitForNames(locations['setup-failed'], isHealthy, 30000);
  const recovered = (await api(scoped('/api/plugin',locations['setup-failed']))).data.find(p => p.id === 'openchamber-chat-mode');
  assert.equal(recovered?.state.status, 'active');
  console.log(JSON.stringify({ passed:true, checks:['healthy agent names', 'setup failure after partial registration', 'syntax failure without a plugin id', 'missing core becomes unknown', 'custom and newly added primary/all warnings with unchanged hidden/subagent names', 'Chat/Build/Plan permissions remain denied on failure', 'recovery after a location reload restores names'], realLLM:false },null,2));
} catch (error) {
  console.error(error);
  console.error('Isolated diagnostics:', root);
  process.exitCode = 1;
} finally {
  await writeFile(join(root,'server.log'),logs.replaceAll(password,'[redacted]'));
  child.kill('SIGTERM');
}
