import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWatchdogController,
  isWithinRoot,
  normalizeWatchdogPath,
  observePluginList,
  watchdogAgentName,
} from '../dist/lib/watchdog-state.js';

const CORE = '/private/var/tmp/chat-project/.opencode/plugins/chat';

class FakeClock {
  nowMs = 0;
  nextId = 1;
  tasks = new Map();

  now = () => this.nowMs;

  setTimeout = (callback, delayMs) => this.add(callback, delayMs, 0);

  clearTimeout = timer => this.tasks.delete(timer.id);

  setInterval = (callback, delayMs) => this.add(callback, delayMs, delayMs);

  clearInterval = timer => this.tasks.delete(timer.id);

  add(callback, delayMs, repeatMs) {
    const task = { id: this.nextId++, due: this.nowMs + delayMs, callback, repeatMs };
    this.tasks.set(task.id, task);
    return task;
  }

  async flush() {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  }

  async advanceBy(durationMs) {
    const end = this.nowMs + durationMs;
    while (true) {
      const next = [...this.tasks.values()]
        .filter(task => task.due <= end)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      this.nowMs = next.due;
      if (next.repeatMs > 0) next.due += next.repeatMs;
      else this.tasks.delete(next.id);
      next.callback();
      await this.flush();
    }
    this.nowMs = end;
    await this.flush();
  }
}

function plugin(status, {
  id = status === 'failed' ? undefined : 'openchamber-chat-mode',
  path = CORE,
  sourceType = 'local',
} = {}) {
  return [{
    ...(id ? { id } : {}),
    source: { type: sourceType, path },
    state: { status, ...(status === 'failed' ? { error: 'load failed' } : {}) },
  }];
}

function harness({ listPlugins, onObservation, onHealthChange, corePluginPath = CORE }) {
  const clock = new FakeClock();
  const changes = [];
  const controller = createWatchdogController({
    corePluginPath,
    listPlugins,
    onObservation,
    clock,
    async onHealthChange(health) {
      changes.push({ health, at: clock.now() });
      await onHealthChange?.(health, changes.length);
    },
  });
  return { clock, changes, controller };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('normalizes macOS /var aliases and enforces a root path boundary', () => {
  assert.equal(normalizeWatchdogPath('/var/tmp/chat-project'), '/private/var/tmp/chat-project');
  assert.equal(normalizeWatchdogPath('/private/var/tmp/chat-project'), '/private/var/tmp/chat-project');
  assert.equal(isWithinRoot('/var/tmp/chat-project/work', '/private/var/tmp/chat-project'), true);
  assert.equal(isWithinRoot('/private/var/tmp/chat-project-elsewhere', '/private/var/tmp/chat-project'), false);
});

test('matches only the local core path and allows failed records without an id', () => {
  const failedWithoutId = plugin('failed', { path: '/var/tmp/chat-project/.opencode/plugins/chat' });
  assert.equal(observePluginList(failedWithoutId, CORE), 'failed');

  assert.equal(observePluginList(plugin('active', { path: `${CORE}-other` }), CORE), 'missing');
  assert.equal(observePluginList(plugin('active', { sourceType: 'package' }), CORE), 'missing');
  assert.equal(observePluginList(plugin('active', { id: null }), CORE), 'invalid');
  assert.equal(observePluginList([...plugin('active'), ...plugin('failed')], CORE), 'failed');
});

test('empty lists and short-lived errors retain checking until the evidence grace period expires', async () => {
  let calls = 0;
  const h = harness({
    listPlugins: async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary plugin list error');
      return [];
    },
  });
  h.controller.start();
  await h.clock.flush();
  assert.equal(h.controller.health(), 'checking');
  await h.clock.advanceBy(5_000);
  assert.equal(h.controller.health(), 'checking');
  assert.deepEqual(h.changes, []);

  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'unknown');
  assert.deepEqual(h.changes.map(change => change.health), ['unknown']);
  h.controller.dispose();
});

test('missing and invalid nonempty startup lists retain checking through the evidence grace period', async () => {
  let calls = 0;
  const h = harness({
    listPlugins: async () => {
      calls += 1;
      if (calls % 3 === 1) return plugin('active', { path: `${CORE}-other` });
      if (calls % 3 === 2) return plugin('active', { id: null });
      return plugin('active', { sourceType: 'package' });
    },
  });
  h.controller.start();
  await h.clock.flush();
  assert.equal(h.controller.health(), 'checking');
  await h.clock.advanceBy(5_000);
  assert.equal(h.controller.health(), 'checking');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'unknown');
  h.controller.dispose();
});

test('a single failed result retains prior health; a second consecutive failure marks failed', async () => {
  const responses = [plugin('active'), plugin('failed'), plugin('failed'), plugin('active')];
  const h = harness({ listPlugins: async () => responses.shift() });
  h.controller.start();
  await h.clock.flush();
  assert.equal(h.controller.health(), 'healthy');

  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'healthy');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'failed');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'healthy');
  assert.deepEqual(h.changes.map(change => change.health), ['healthy', 'failed', 'healthy']);
  h.controller.dispose();
});

test('missing targets and request errors preserve known health until the evidence grace period expires', async () => {
  let calls = 0;
  const h = harness({
    listPlugins: async () => {
      calls += 1;
      if (calls === 1) return plugin('active');
      if (calls === 2) return [];
      throw new Error('plugin list unavailable');
    },
  });
  h.controller.start();
  await h.clock.flush();
  assert.equal(h.controller.health(), 'healthy');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'healthy');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'healthy');
  assert.deepEqual(h.changes.map(change => change.health), ['healthy']);
  await h.clock.advanceBy(4_000);
  assert.equal(h.controller.health(), 'unknown');
  assert.deepEqual(h.changes.map(change => change.health), ['healthy', 'unknown']);
  h.controller.dispose();
});

test('an intervening missing result resets the failed streak', async () => {
  const responses = [plugin('failed'), [], plugin('failed'), plugin('failed')];
  const h = harness({ listPlugins: async () => responses.shift() });
  h.controller.start();
  await h.clock.flush();
  assert.equal(h.controller.health(), 'checking');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'checking');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'checking');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'failed');
  h.controller.dispose();
});

test('failed and empty observations cannot extend the last confirmed health window', async () => {
  const responses = [
    plugin('active'),
    plugin('failed'), [],
    plugin('failed'), [],
    plugin('failed'), [],
  ];
  const h = harness({ listPlugins: async () => responses.shift() ?? [] });
  h.controller.start();
  await h.clock.flush();
  assert.equal(h.controller.health(), 'healthy');
  await h.clock.advanceBy(5_000);
  assert.equal(h.controller.health(), 'healthy');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'unknown');
  assert.deepEqual(h.changes.map(change => change.health), ['healthy', 'unknown']);
  h.controller.dispose();
});

test('a stalled request becomes unknown, blocks overlap, and discards its late active result', async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness({
    listPlugins: () => {
      calls += 1;
      return calls === 1 ? pending.promise : Promise.resolve(plugin('active'));
    },
  });
  h.controller.start();
  await h.clock.flush();
  assert.equal(calls, 1);
  await h.clock.advanceBy(6_000);
  assert.equal(h.controller.health(), 'unknown');
  assert.equal(calls, 1, 'poll ticks must not overlap a request that is still pending');

  pending.resolve(plugin('active'));
  await h.clock.flush();
  assert.equal(h.controller.health(), 'unknown', 'a timed-out snapshot cannot restore health');
  assert.deepEqual(h.changes.map(change => change.health), ['unknown']);
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'healthy');
  assert.deepEqual(h.changes.map(change => change.health), ['unknown', 'healthy']);
  assert.equal(calls, 2, 'recovery comes from a new query after the timed-out request ends');
  h.controller.dispose();
});

test('catalog results from timed-out or disposed requests are never applied', async () => {
  for (const disposeBeforeResolve of [false, true]) {
    const pending = deferred();
    const knownIDs = new Set(['chat', 'build', 'plan']);
    const h = harness({
      listPlugins: () => pending.promise,
      onObservation(result) {
        for (const id of result.agentIDs ?? []) knownIDs.add(id);
        return result.plugins;
      },
    });
    h.controller.start();
    await h.clock.flush();
    if (disposeBeforeResolve) h.controller.dispose();
    else await h.clock.advanceBy(6_000);

    pending.resolve({ plugins: plugin('active'), agentIDs: ['custom-agent'] });
    await h.clock.flush();
    assert.equal(knownIDs.has('custom-agent'), false);
    assert.notEqual(h.controller.health(), 'healthy');
    h.controller.dispose();
  }
});

test('catalog errors retain known ids while a successful failed-plugin result is observed', async () => {
  const knownIDs = new Set(['chat', 'build', 'plan', 'previous-custom']);
  const failed = plugin('failed');
  const h = harness({
    listPlugins: async () => ({ plugins: failed, agentIDs: undefined }),
    onObservation(result) {
      for (const id of result.agentIDs ?? []) knownIDs.add(id);
      return result.plugins;
    },
  });
  h.controller.start();
  await h.clock.flush();
  assert.deepEqual([...knownIDs], ['chat', 'build', 'plan', 'previous-custom']);
  assert.equal(h.controller.health(), 'checking', 'one explicit failure is not sufficient');
  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'failed');
  h.controller.dispose();
});

test('late request results after disposal are ignored and timers are cleared', async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness({ listPlugins: () => { calls += 1; return pending.promise; } });
  h.controller.start();
  await h.clock.flush();
  h.controller.dispose();
  pending.resolve(plugin('active'));
  await h.clock.flush();
  await h.clock.advanceBy(10_000);
  assert.equal(h.controller.health(), 'checking');
  assert.equal(calls, 1);
  assert.deepEqual(h.changes, []);
});

test('failed reloads retain the latest health and retry at a bounded interval', async () => {
  let listCalls = 0;
  let reloadCalls = 0;
  const h = harness({
    listPlugins: async () => {
      listCalls += 1;
      return listCalls >= 8 ? plugin('active') : [];
    },
    onHealthChange: async () => {
      reloadCalls += 1;
      if (reloadCalls === 1) throw new Error('agent reload failed');
    },
  });
  h.controller.start();
  await h.clock.flush();
  await h.clock.advanceBy(6_000);
  assert.equal(h.controller.health(), 'unknown');
  assert.equal(reloadCalls, 1);

  await h.clock.advanceBy(1_000);
  assert.equal(h.controller.health(), 'healthy');
  assert.equal(reloadCalls, 1, 'a pending failed reload is retried no faster than the configured interval');
  await h.clock.advanceBy(1_000);
  assert.equal(reloadCalls, 2);
  assert.deepEqual(h.changes.map(change => change.health), ['unknown', 'healthy']);
  assert.equal(h.changes[1].at - h.changes[0].at, 2_000);
  h.controller.dispose();
});

test('invalidation during a reload causes a second reload after the first succeeds', async () => {
  const firstReload = deferred();
  let attempts = 0;
  const h = harness({
    listPlugins: async () => plugin('active'),
    onHealthChange: async () => {
      attempts += 1;
      if (attempts === 1) await firstReload.promise;
    },
  });
  h.controller.start();
  await h.clock.flush();
  assert.equal(h.controller.health(), 'healthy');
  assert.equal(attempts, 1);

  h.controller.invalidate();
  assert.equal(attempts, 1, 'single-flight reload remains in progress');
  firstReload.resolve();
  await h.clock.flush();
  assert.equal(attempts, 2, 'the new revision is applied after the older reload settles');
  assert.deepEqual(h.changes.map(change => change.health), ['healthy', 'healthy']);
  h.controller.dispose();
});

test('warning prefixes are idempotent and only visible primary/all agents are changed', () => {
  const failedPrefix = '⚠ Chat 插件失败 · ';
  const unknownPrefix = '⚠ Chat 状态未知 · ';
  assert.equal(watchdogAgentName({ id: 'build', name: `${failedPrefix}Build`, hidden: false, mode: 'primary' }, 'failed'), `${failedPrefix}Build`);
  assert.equal(watchdogAgentName({ id: 'build', name: `${failedPrefix}Build`, hidden: false, mode: 'primary' }, 'unknown'), `${unknownPrefix}Build`);
  assert.equal(watchdogAgentName({ id: 'build', name: `${unknownPrefix}Build`, hidden: false, mode: 'primary' }, 'healthy'), 'Build');
  assert.equal(watchdogAgentName({ id: 'chat', name: `${failedPrefix}Old`, hidden: false, mode: 'all' }, 'unknown'), `${unknownPrefix}Chat`);
  assert.equal(watchdogAgentName({ id: 'hidden', name: `${failedPrefix}Secret`, hidden: true, mode: 'primary' }, 'healthy'), undefined);
  assert.equal(watchdogAgentName({ id: 'subagent', name: `${failedPrefix}Sub`, hidden: false, mode: 'subagent' }, 'healthy'), undefined);
});
