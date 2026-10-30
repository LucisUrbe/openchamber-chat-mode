import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deploy, legacyManagedFiles, managedFiles, parseDeployArgs } from '../scripts/deploy.mjs';

const config = 'location/opencode.jsonc';
const watchdog = 'location/.opencode/plugins/chat-watch.js';
const marker = '.chat-mode-install.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const exists = path => lstat(path).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
async function snapshot(target) {
  return Object.fromEntries(await Promise.all([...managedFiles, marker].map(async name => [name, await readFile(join(target, name))])));
}
async function legacySnapshot(target) {
  return Object.fromEntries(await Promise.all([...legacyManagedFiles, marker].map(async name => [name, await readFile(join(target, name))])));
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'chat-preserve-test-'));
  const target = join(root, 'installed');
  const source = join(root, 'next');
  await cp(resolve('dist'), source, { recursive: true });
  for (const name of managedFiles.filter(name => name !== config)) {
    await writeFile(join(source, name), Buffer.concat([await readFile(join(source, name)), Buffer.from('\nupdated fixture\n')]));
  }
  await deploy(target);
  return { root, target, source };
}
async function makeLegacy(target) {
  await unlink(join(target, watchdog));
  const oldMarker = JSON.parse(await readFile(join(target, marker)));
  delete oldMarker.files[watchdog];
  await writeFile(join(target, marker), JSON.stringify(oldMarker, null, 2) + '\n');
}

test('explicitly preserving a modified config backs up and upgrades the other files', async () => {
  const { target, source } = await fixture();
  await writeFile(join(target, config), '{"user":"custom configuration"}\n');
  const before = await snapshot(target);
  const mtime = (await lstat(join(target, config))).mtimeMs;
  const previousMarker = JSON.parse(before[marker]);

  await assert.rejects(deploy(target, source), /Local modification preserved/);
  assert.deepEqual(await snapshot(target), before);
  assert.equal(await exists(join(target, 'backups')), false);

  const result = await deploy(target, source, { preserveModifiedConfig: true });
  assert.deepEqual(result.preserved, [config]);
  assert.deepEqual(await readFile(join(target, config)), before[config]);
  assert.equal((await lstat(join(target, config))).mtimeMs, mtime);
  assert.deepEqual(await snapshot(result.backup), before);
  const newMarker = JSON.parse(await readFile(join(target, marker)));
  assert.equal(newMarker.files[config], previousMarker.files[config]);
  for (const name of managedFiles.filter(name => name !== config)) {
    const payload = await readFile(join(source, name));
    assert.deepEqual(await readFile(join(target, name)), payload);
    assert.equal(newMarker.files[name], hash(payload));
  }
  await assert.rejects(deploy(target, source), /Local modification preserved/);
  const again = await deploy(target, source, { preserveModifiedConfig: true });
  assert.deepEqual(again.preserved, [config]);
  assert.equal(JSON.parse(await readFile(join(target, marker))).files[config], previousMarker.files[config]);
  assert.deepEqual(await readFile(join(target, config)), before[config]);
});

test('preservation never permits edits to any other managed file or a missing file', async () => {
  for (const name of managedFiles.filter(name => name !== config)) {
    const { target, source } = await fixture();
    await writeFile(join(target, config), 'custom config');
    await writeFile(join(target, name), 'custom other file');
    const before = await snapshot(target);
    await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /Local modification preserved/);
    assert.deepEqual(await snapshot(target), before);
    assert.equal(await exists(join(target, 'backups')), false);
  }
  const { target, source } = await fixture();
  await unlink(join(target, config));
  await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /Managed file is missing/);
  assert.equal(await exists(join(target, 'backups')), false);
});

test('preservation requires a valid managed marker and rejects symlinked paths', async () => {
  const { root, target, source } = await fixture();
  const unmanaged = join(root, 'unmanaged');
  await mkdir(unmanaged);
  await assert.rejects(deploy(unmanaged, source, { preserveModifiedConfig: true }), /unmanaged/);
  const originalMarker = await readFile(join(target, marker));
  const brokenMarker = JSON.parse(originalMarker);
  delete brokenMarker.files[config];
  await writeFile(join(target, marker), JSON.stringify(brokenMarker));
  await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /Invalid installation marker/);
  assert.equal(await exists(join(target, 'backups')), false);
  brokenMarker.files[config] = [JSON.parse(originalMarker).files[config]];
  await writeFile(join(target, marker), JSON.stringify(brokenMarker));
  const invalidMarker = await readFile(join(target, marker));
  await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /Invalid installation marker/);
  assert.deepEqual(await readFile(join(target, marker)), invalidMarker);
  assert.equal(await exists(join(target, 'backups')), false);
  await writeFile(join(target, marker), originalMarker);

  const targetLink = join(root, 'target-link');
  await symlink(target, targetLink);
  await assert.rejects(deploy(targetLink, source, { preserveModifiedConfig: true }), /target must not be a symlink/);

  const markerPath = join(target, marker);
  await unlink(markerPath);
  await symlink(join(root, 'nonexistent'), markerPath);
  await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /marker must not be a symlink/);
  await unlink(markerPath);
  await writeFile(markerPath, originalMarker);

  const backupLink = join(target, 'backups');
  await symlink(join(root, 'nonexistent'), backupLink);
  await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /Backup directory must not be a symlink/);
  await unlink(backupLink);

  const configPath = join(target, config);
  await unlink(configPath);
  await symlink(join(root, 'nonexistent'), configPath);
  await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /Symlink in deployment target/);
});

test('deployment arguments select only the explicit config-preservation option', () => {
  assert.deepEqual(parseDeployArgs([], '/test-home'), { target: '/test-home/.local/share/openchamber-chat', preserveModifiedConfig: false });
  assert.deepEqual(parseDeployArgs(['--preserve-modified-config', '/test-target'], '/test-home'), { target: '/test-target', preserveModifiedConfig: true });
  assert.throws(() => parseDeployArgs(['--unknown']), /Unknown deployment option/);
  assert.throws(() => parseDeployArgs(['/first', '/second']), /at most one/);
});

test('legacy installation upgrades safely and retains its edited config and original backup', async () => {
  const { target, source } = await fixture();
  await makeLegacy(target);
  await writeFile(join(target, config), 'custom legacy configuration\n');
  const before = await legacySnapshot(target);
  const originalMtime = (await lstat(join(target, config))).mtimeMs;
  const oldMarker = JSON.parse(before[marker]);
  const upgraded = await deploy(target, source, { preserveModifiedConfig: true });
  assert.deepEqual(upgraded.preserved, [config]);
  assert.deepEqual(await legacySnapshot(upgraded.backup), before);
  assert.equal(await exists(join(upgraded.backup, watchdog)), false);
  assert.deepEqual(await readFile(join(target, config)), before[config]);
  assert.equal((await lstat(join(target, config))).mtimeMs, originalMtime);
  const currentMarker = JSON.parse(await readFile(join(target, marker)));
  assert.equal(currentMarker.files[config], oldMarker.files[config]);
  assert.equal(currentMarker.files[watchdog], hash(await readFile(join(source, watchdog))));
  await deploy(target, source, { preserveModifiedConfig: true });
  assert.equal(JSON.parse(await readFile(join(target, marker))).files[config], oldMarker.files[config]);

  // Restoring an old marker without removing the newly added file must not
  // silently adopt or overwrite the now-unmanaged watchdog on the next run.
  for (const name of [...legacyManagedFiles, marker]) await cp(join(upgraded.backup, name), join(target, name));
  const restored = await legacySnapshot(target);
  await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /previously unmanaged file/);
  assert.deepEqual(await legacySnapshot(target), restored);
  assert.equal(await exists(join(target, watchdog)), true);
  assert.equal(hash(await readFile(join(target, watchdog))), currentMarker.files[watchdog]);
  await unlink(join(target, watchdog));
  const reinstalled = await deploy(target, source, { preserveModifiedConfig: true });
  assert.deepEqual(reinstalled.preserved, [config]);
  assert.equal(hash(await readFile(join(target, watchdog))), currentMarker.files[watchdog]);
});

test('legacy migration refuses an already present watchdog without writing or backing up', async () => {
  const { target, source } = await fixture();
  await makeLegacy(target);
  await writeFile(join(target, watchdog), 'independent user file');
  const before = await legacySnapshot(target);
  await assert.rejects(deploy(target, source, { preserveModifiedConfig: true }), /previously unmanaged file/);
  assert.deepEqual(await legacySnapshot(target), before);
  assert.equal(await readFile(join(target, watchdog), 'utf8'), 'independent user file');
  assert.equal(await exists(join(target, 'backups')), false);
});
