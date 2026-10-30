import { Agent, Plugin } from '@opencode/plugin';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWatchdogController,
  isWithinRoot,
  normalizeWatchdogPath,
  watchdogAgentName,
  type ListedPlugin,
  type WatchdogController,
  type WatchdogHealth,
} from './watchdog-state.js';

const INITIAL_AGENT_IDS = ['chat', 'build', 'plan'] as const;

function normalizedRealPath(path: string): string | undefined {
  try {
    return normalizeWatchdogPath(realpathSync(path));
  } catch {
    // Preserve exact matching for a missing core path reported by OpenCode.
    return normalizeWatchdogPath(path);
  }
}

export default Plugin.define({
  id: 'openchamber-chat-watchdog',
  async setup(ctx) {
    let root: string;
    let directory: string;
    let corePluginPath: string;
    try {
      // The deployed guard is root/.opencode/plugins/chat-watch.js.
      root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
      directory = realpathSync(ctx.location.directory);
      if (!isWithinRoot(directory, root)) return;
      corePluginPath = normalizedRealPath(resolve(root, '.opencode', 'plugins', 'chat')) ?? '';
    } catch {
      return;
    }
    if (!corePluginPath) return;

    let health: WatchdogHealth = 'checking';
    const knownAgentIDs = new Set<string>(INITIAL_AGENT_IDS);
    const registration = await ctx.agent.transform(editor => {
      const transformIDs = new Set([
        ...knownAgentIDs,
        ...editor.list().map(agent => String(agent.id)),
      ]);
      for (const id of transformIDs) {
        editor.update(id, agent => {
          const nextName = watchdogAgentName({
            id: String(agent.id),
            name: String(agent.name),
            hidden: agent.hidden,
            mode: agent.mode,
          }, health);
          if (nextName !== undefined && nextName !== String(agent.name)) {
            agent.name = Agent.Name.make(nextName);
          }
        });
      }
    });

    let controller: WatchdogController;
    controller = createWatchdogController({
      corePluginPath,
      async listPlugins() {
        const location = { location: { directory: ctx.location.directory } };
        const [pluginResult, agentResult] = await Promise.allSettled([
          ctx.plugin.list(location),
          ctx.agent.list(location),
        ]);
        const plugins = pluginResult.status === 'fulfilled'
          ? pluginResult.value.data.map(plugin => {
            if (plugin.source.type !== 'local') return plugin;
            return {
              ...plugin,
              source: {
                ...plugin.source,
                path: normalizedRealPath(plugin.source.path) ?? '',
              },
            } satisfies ListedPlugin;
          })
          : undefined;
        const agentIDs = agentResult.status === 'fulfilled'
          ? agentResult.value.data.map(agent => String(agent.id))
          : undefined;
        return { plugins, agentIDs };
      },
      onObservation(result) {
        if (!result || typeof result !== 'object') return undefined;
        const observation = result as { readonly plugins?: unknown; readonly agentIDs?: unknown };
        let changed = false;
        if (Array.isArray(observation.agentIDs)) {
          for (const id of observation.agentIDs) {
            if (typeof id !== 'string' || !id || knownAgentIDs.has(id)) continue;
            knownAgentIDs.add(id);
            changed = true;
          }
        }
        if (changed) controller.invalidate();
        return observation.plugins;
      },
      async onHealthChange(nextHealth) {
        health = nextHealth;
        await ctx.agent.reload();
      },
    });

    const startTimer = setTimeout(() => controller.start(), 0);
    return async () => {
      clearTimeout(startTimer);
      controller.dispose();
      await registration.dispose();
    };
  },
});
