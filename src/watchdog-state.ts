import { isAbsolute, relative, resolve, sep } from 'node:path';

export type WatchdogHealth = 'checking' | 'healthy' | 'failed' | 'unknown';

export const WATCHDOG_TIMING = {
  pollMs: 1_000,
  requestTimeoutMs: 6_000,
  evidenceGraceMs: 6_000,
  reloadRetryMs: 2_000,
} as const;

export interface ListedPlugin {
  readonly id?: string;
  readonly source?: {
    readonly type?: string;
    readonly path?: string;
  };
  readonly state?: {
    readonly status?: string;
  };
}

export type PluginObservation = 'active' | 'failed' | 'empty' | 'missing' | 'invalid' | 'error';

const CHAT_PLUGIN_ID = 'openchamber-chat-mode';
const FAILED_PREFIX = '⚠ Chat 插件失败 · ';
const UNKNOWN_PREFIX = '⚠ Chat 状态未知 · ';

export interface WatchdogAgentName {
  readonly id: string;
  readonly name: string;
  readonly hidden: boolean;
  readonly mode: string;
}

function stripWatchdogPrefix(name: string): string {
  let base = name;
  while (base.startsWith(FAILED_PREFIX) || base.startsWith(UNKNOWN_PREFIX)) {
    base = base.startsWith(FAILED_PREFIX)
      ? base.slice(FAILED_PREFIX.length)
      : base.slice(UNKNOWN_PREFIX.length);
  }
  return base;
}

/** Returns a replacement name only for visible primary/all agents. */
export function watchdogAgentName(agent: WatchdogAgentName, health: WatchdogHealth): string | undefined {
  if (agent.hidden || (agent.mode !== 'primary' && agent.mode !== 'all')) return undefined;
  const prefix = health === 'failed' ? FAILED_PREFIX : health === 'unknown' ? UNKNOWN_PREFIX : '';
  const base = agent.id === 'chat' ? 'Chat' : stripWatchdogPrefix(agent.name);
  return `${prefix}${base}`;
}

/**
 * Normalize an absolute path for exact location comparisons. On macOS, /var
 * is a symlink to /private/var, so treat both spellings as the same path.
 */
export function normalizeWatchdogPath(path: string): string | undefined {
  if (!path || !isAbsolute(path)) return undefined;
  let normalized = resolve(path);
  if (normalized === '/var') normalized = '/private/var';
  else if (normalized.startsWith('/var/')) normalized = `/private${normalized}`;
  return normalized;
}

export function isWithinRoot(directory: string, root: string): boolean {
  const normalizedDirectory = normalizeWatchdogPath(directory);
  const normalizedRoot = normalizeWatchdogPath(root);
  if (!normalizedDirectory || !normalizedRoot) return false;
  const pathFromRoot = relative(normalizedRoot, normalizedDirectory);
  return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

/**
 * Only local plugins loaded from the configured core plugin directory count.
 * The failed record is intentionally matched without an id: parse failures
 * can prevent OpenCode from discovering the plugin's declared id.
 */
export function observePluginList(plugins: unknown, corePluginPath: string): PluginObservation {
  if (!Array.isArray(plugins)) return 'error';
  if (plugins.length === 0) return 'empty';

  const normalizedTarget = normalizeWatchdogPath(corePluginPath);
  if (!normalizedTarget) return 'invalid';

  const matches = (plugins as ListedPlugin[]).filter(plugin => {
    if (plugin?.source?.type !== 'local' || typeof plugin.source.path !== 'string') return false;
    const normalizedSource = normalizeWatchdogPath(plugin.source.path);
    return normalizedSource === normalizedTarget;
  });
  if (matches.length === 0) return 'missing';
  if (matches.some(plugin => plugin.state?.status === 'failed')) return 'failed';
  if (matches.some(plugin => plugin.state?.status === 'active' && plugin.id === CHAT_PLUGIN_ID)) return 'active';
  return 'invalid';
}

export interface WatchdogClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

export interface WatchdogControllerOptions {
  readonly corePluginPath: string;
  readonly listPlugins: () => Promise<unknown>;
  /** Runs only for a fresh, non-expired result; returns the plugin records to observe. */
  readonly onObservation?: (result: unknown) => unknown;
  /** Called on every health transition; rejection keeps the transition pending. */
  readonly onHealthChange: (health: WatchdogHealth) => Promise<void> | void;
  readonly clock?: WatchdogClock;
}

export interface WatchdogController {
  start(): void;
  invalidate(): void;
  dispose(): void;
  health(): WatchdogHealth;
}

const systemClock: WatchdogClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: timer => clearTimeout(timer),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: timer => clearInterval(timer),
};

export function createWatchdogController(options: WatchdogControllerOptions): WatchdogController {
  const clock = options.clock ?? systemClock;
  let status: WatchdogHealth = 'checking';
  let failedStreak = 0;
  let started = false;
  let disposed = false;
  let activeRequest: { timedOut: boolean; startedAt: number } | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let evidenceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestDeadline: ReturnType<typeof setTimeout> | undefined;
  let reloadRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let reloadPending = false;
  let reloadInFlight = false;
  let lastReloadFailed = false;
  let reloadRevision = 0;
  let applyingObservation = false;
  let lastEvidenceAt = 0;

  const expireEvidence = (): void => {
    evidenceTimer = undefined;
    if (disposed) return;
    const remaining = lastEvidenceAt + WATCHDOG_TIMING.evidenceGraceMs - clock.now();
    if (remaining > 0) {
      evidenceTimer = clock.setTimeout(expireEvidence, remaining);
      return;
    }
    setHealth('unknown');
  };

  const recordEvidence = (): void => {
    lastEvidenceAt = clock.now();
    if (evidenceTimer) clock.clearTimeout(evidenceTimer);
    evidenceTimer = clock.setTimeout(expireEvidence, WATCHDOG_TIMING.evidenceGraceMs);
  };

  const setHealth = (next: WatchdogHealth): void => {
    if (disposed || status === next) return;
    status = next;
    invalidate();
  };

  const invalidate = (): void => {
    if (disposed) return;
    reloadRevision += 1;
    reloadPending = true;
    if (!applyingObservation) scheduleReload(false);
  };

  const observe = (observation: PluginObservation): void => {
    if (observation === 'active') {
      failedStreak = 0;
      recordEvidence();
      setHealth('healthy');
      return;
    }
    if (observation === 'failed') {
      failedStreak += 1;
      if (failedStreak >= 2) {
        recordEvidence();
        setHealth('failed');
      }
      return;
    }

    failedStreak = 0;
    if (clock.now() - lastEvidenceAt >= WATCHDOG_TIMING.evidenceGraceMs) setHealth('unknown');
  };

  const scheduleReload = (retry: boolean): void => {
    if (disposed || !reloadPending || reloadInFlight || reloadRetryTimer) return;
    if (!retry) {
      void reload();
      return;
    }
    reloadRetryTimer = clock.setTimeout(() => {
      if (disposed) return;
      reloadRetryTimer = undefined;
      void reload();
    }, WATCHDOG_TIMING.reloadRetryMs);
  };

  const reload = async (): Promise<void> => {
    if (disposed || !reloadPending || reloadInFlight) return;
    reloadInFlight = true;
    const requestedRevision = reloadRevision;
    const requestedHealth = status;
    try {
      await options.onHealthChange(requestedHealth);
      if (disposed) return;
      lastReloadFailed = false;
      if (reloadRevision === requestedRevision) reloadPending = false;
    } catch {
      if (disposed) return;
      lastReloadFailed = true;
      reloadPending = true;
    } finally {
      reloadInFlight = false;
      if (!disposed && reloadPending) scheduleReload(lastReloadFailed);
    }
  };

  const applyResult = (result: unknown): void => {
    if (disposed) return;
    applyingObservation = true;
    try {
      const plugins = options.onObservation ? options.onObservation(result) : result;
      observe(observePluginList(plugins, options.corePluginPath));
    } catch {
      observe('error');
    } finally {
      applyingObservation = false;
      if (!disposed && reloadPending) scheduleReload(false);
    }
  };

  const poll = async (): Promise<void> => {
    if (disposed || activeRequest) return;
    const request = { timedOut: false, startedAt: clock.now() };
    activeRequest = request;
    requestDeadline = clock.setTimeout(() => {
      if (disposed || activeRequest !== request) return;
      request.timedOut = true;
      setHealth('unknown');
    }, WATCHDOG_TIMING.requestTimeoutMs);

    let result: unknown;
    try {
      result = await options.listPlugins();
    } catch {
      if (disposed || activeRequest !== request) return;
      if (requestDeadline) clock.clearTimeout(requestDeadline);
      requestDeadline = undefined;
      activeRequest = undefined;
      if (request.timedOut || clock.now() - request.startedAt >= WATCHDOG_TIMING.requestTimeoutMs) {
        setHealth('unknown');
        return;
      }
      observe('error');
      return;
    }

    if (disposed || activeRequest !== request) return;
    if (requestDeadline) clock.clearTimeout(requestDeadline);
    requestDeadline = undefined;
    activeRequest = undefined;
    if (request.timedOut || clock.now() - request.startedAt >= WATCHDOG_TIMING.requestTimeoutMs) {
      setHealth('unknown');
      return;
    }
    applyResult(result);
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      lastEvidenceAt = clock.now();
      evidenceTimer = clock.setTimeout(expireEvidence, WATCHDOG_TIMING.evidenceGraceMs);
      pollTimer = clock.setInterval(() => { void poll(); }, WATCHDOG_TIMING.pollMs);
      void poll();
    },
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      activeRequest = undefined;
      if (pollTimer) clock.clearInterval(pollTimer);
      if (evidenceTimer) clock.clearTimeout(evidenceTimer);
      if (requestDeadline) clock.clearTimeout(requestDeadline);
      if (reloadRetryTimer) clock.clearTimeout(reloadRetryTimer);
      pollTimer = undefined;
      evidenceTimer = undefined;
      requestDeadline = undefined;
      reloadRetryTimer = undefined;
      reloadPending = false;
    },
    health: () => status,
  };
}
