import { cp, mkdir, readFile, writeFile, access, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const managedFiles = ['location/opencode.jsonc', 'location/.opencode/plugins/chat/index.js', 'location/.opencode/plugins/chat/package.json', 'extension/package.json', 'extension/panel/index.html', 'extension/panel/main.js'];
const digest = text => createHash('sha256').update(text).digest('hex');
async function exists(path) { try { await access(path); return true; } catch { return false; } }
export async function deploy(target, source = resolve('dist')) {
  target = resolve(target);
  const marker = join(target, '.chat-mode-install.json');
  const previous = await exists(marker) ? JSON.parse(await readFile(marker,'utf8')) : null;
  if (await exists(target) && !previous) throw new Error('Refusing to overwrite an unmanaged directory: ' + target);
  if (previous && previous.owner !== 'openchamber-chat-mode') throw new Error('Unrecognized installation marker');
  // Resolve all payloads before writing; never follow a deployment target symlink.
  if (await exists(target) && (await lstat(target)).isSymbolicLink()) throw new Error('Deployment target must not be a symlink');
  const payloads = new Map();
  for (const name of managedFiles) {
    payloads.set(name, await readFile(join(source,name)));
    let cursor = join(target,name);
    while (cursor !== target) {
      if (await exists(cursor) && (await lstat(cursor)).isSymbolicLink()) throw new Error(`Symlink in deployment target: ${name}`);
      cursor = dirname(cursor);
    }
    if (previous && await exists(join(target,name))) {
      if (digest(await readFile(join(target,name))) !== previous.files[name]) throw new Error(`Local modification preserved: ${name}. Back it up and reconcile before upgrading.`);
    }
  }
  let backup;
  if (previous) {
    backup = join(target, 'backups', new Date().toISOString().replaceAll(':','-'));
    for (const name of [...managedFiles,'.chat-mode-install.json']) {
      if (!await exists(join(target,name))) continue;
      await mkdir(dirname(join(backup,name)), {recursive:true}); await cp(join(target,name), join(backup,name));
    }
  }
  await mkdir(target,{recursive:true});
  for (const [name, data] of payloads) {
    await mkdir(dirname(join(target,name)),{recursive:true}); await writeFile(join(target,name),data);
  }
  await writeFile(marker, JSON.stringify({ owner:'openchamber-chat-mode', version:'0.1.0', files:Object.fromEntries([...payloads].map(([name,data])=>[name,digest(data)])) },null,2)+'\n');
  return { target, location:join(target,'location'), extension:join(target,'extension'), backup };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString','/Applications/OpenChamber.app/Contents/Info.plist'],{encoding:'utf8'}).trim();
  if (version !== '2.4.0') throw new Error('This build is validated only for OpenChamber 2.4.0.');
  const target = process.argv[2] ?? join(homedir(),'.local/share/openchamber-chat');
  console.log(JSON.stringify(await deploy(target),null,2));
}
