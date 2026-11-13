import { cp, mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { labelLocale, localizeManifest } from './tool-labels.mjs';

export const legacyManagedFiles = ['location/opencode.jsonc', 'location/.opencode/plugins/chat/index.js', 'location/.opencode/plugins/chat/package.json', 'extension/package.json', 'extension/panel/index.html', 'extension/panel/main.js'];
export const managedFiles = [...legacyManagedFiles, 'location/.opencode/plugins/chat-watch.js'];
const digest = text => createHash('sha256').update(text).digest('hex');
async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function deploy(target, source = resolve('dist'), { preserveModifiedConfig = false, locale } = {}) {
  target = resolve(target);
  const marker = join(target, '.chat-mode-install.json');
  if (await exists(target) && (await lstat(target)).isSymbolicLink()) throw new Error('Deployment target must not be a symlink');
  if (await exists(marker) && (await lstat(marker)).isSymbolicLink()) throw new Error('Installation marker must not be a symlink');
  const previous = await exists(marker) ? JSON.parse(await readFile(marker,'utf8')) : null;
  if (await exists(target) && !previous) throw new Error('Refusing to overwrite an unmanaged directory: ' + target);
  if (previous && previous.owner !== 'openchamber-chat-mode') throw new Error('Unrecognized installation marker');
  let previousFiles = [];
  if (previous) {
    if (!previous.files || typeof previous.files !== 'object' || Array.isArray(previous.files)) throw new Error('Invalid installation marker file hashes');
    const names = Object.keys(previous.files).sort();
    const matches = expected => JSON.stringify(names) === JSON.stringify([...expected].sort());
    if (matches(managedFiles)) previousFiles = managedFiles;
    else if (matches(legacyManagedFiles)) previousFiles = legacyManagedFiles;
    else throw new Error('Invalid installation marker managed file set');
    if (previousFiles.some(name => typeof previous.files[name] !== 'string' || !/^[a-f0-9]{64}$/.test(previous.files[name]))) throw new Error('Invalid installation marker file hashes');
  }
  const backups = join(target, 'backups');
  if (previous && await exists(backups) && (await lstat(backups)).isSymbolicLink()) throw new Error('Backup directory must not be a symlink');
  // Resolve all payloads before writing; never follow a deployment target symlink.
  const payloads = new Map();
  const preserved = new Set();
  for (const name of managedFiles) {
    let payload = await readFile(join(source,name));
    if (name === 'extension/package.json' && locale !== undefined) {
      payload = Buffer.from(JSON.stringify(localizeManifest(JSON.parse(payload.toString('utf8')), locale), null, 2) + '\n');
    }
    payloads.set(name, payload);
    let cursor = join(target,name);
    while (cursor !== target) {
      if (await exists(cursor) && (await lstat(cursor)).isSymbolicLink()) throw new Error(`Symlink in deployment target: ${name}`);
      cursor = dirname(cursor);
    }
    if (previous && previousFiles.includes(name)) {
      if (!await exists(join(target,name))) throw new Error(`Managed file is missing: ${name}. Reconcile before upgrading.`);
      if (digest(await readFile(join(target,name))) !== previous.files[name]) {
        if (name === 'location/opencode.jsonc' && preserveModifiedConfig) preserved.add(name);
        else throw new Error(`Local modification preserved: ${name}. Back it up and reconcile before upgrading.`);
      }
    } else if (previous && await exists(join(target,name))) {
      throw new Error(`Refusing to overwrite a previously unmanaged file: ${name}`);
    }
  }
  let backup;
  if (previous) {
    await mkdir(backups, {recursive:true});
    backup = await mkdtemp(join(backups, new Date().toISOString().replaceAll(':','-') + '-'));
    for (const name of [...previousFiles,'.chat-mode-install.json']) {
      await mkdir(dirname(join(backup,name)), {recursive:true}); await cp(join(target,name), join(backup,name));
    }
  }
  await mkdir(target,{recursive:true});
  for (const [name, data] of payloads) {
    if (preserved.has(name)) continue;
    await mkdir(dirname(join(target,name)),{recursive:true}); await writeFile(join(target,name),data);
  }
  await writeFile(marker, JSON.stringify({ owner:'openchamber-chat-mode', version:'0.1.0', files:Object.fromEntries([...payloads].map(([name,data])=>[name,preserved.has(name) ? previous.files[name] : digest(data)])) },null,2)+'\n');
  return { target, location:join(target,'location'), extension:join(target,'extension'), backup, preserved:[...preserved], ...(locale === undefined ? {} : { toolLabels:labelLocale(locale) }) };
}
/** The OpenChamber UI language from its settings, or undefined when unset or unreadable. */
export function openChamberLocale(home = homedir()) {
  try {
    const { locale } = JSON.parse(readFileSync(join(home,'.config/openchamber/settings.json'),'utf8'));
    return typeof locale === 'string' && locale.trim() ? locale.trim() : undefined;
  } catch { return undefined; }
}
export function parseDeployArgs(args, home = homedir()) {
  let target, preserveModifiedConfig = false, locale;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--preserve-modified-config') preserveModifiedConfig = true;
    else if (arg === '--locale' || arg.startsWith('--locale=')) {
      if (locale !== undefined) throw new Error('Specify at most one locale.');
      locale = arg === '--locale' ? args[++i] : arg.slice('--locale='.length);
      if (!locale || locale.startsWith('-')) throw new Error('--locale needs a language tag, such as zh-CN or en.');
    }
    else if (arg.startsWith('-')) throw new Error(`Unknown deployment option: ${arg}`);
    else if (target) throw new Error('Specify at most one deployment target.');
    else target = arg;
  }
  return { target:target ?? join(home,'.local/share/openchamber-chat'), preserveModifiedConfig, locale:locale ?? openChamberLocale(home) ?? 'en' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { supportedMajors, supportsMajorVersion } = await import(resolve('dist/lib/policy.js'));
  const version = execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString','/Applications/OpenChamber.app/Contents/Info.plist'],{encoding:'utf8'}).trim();
  if (!supportsMajorVersion(version, supportedMajors.openchamber)) throw new Error(`This build requires OpenChamber ${supportedMajors.openchamber}.x.y; received ${version}.`);
  const { target, preserveModifiedConfig, locale } = parseDeployArgs(process.argv.slice(2));
  const result = await deploy(target, resolve('dist'), { preserveModifiedConfig, locale });
  if (result.preserved.length) console.warn('The modified location configuration was preserved as-is; its prompts, permissions and policies were not updated.');
  console.log(JSON.stringify(result,null,2));
}
