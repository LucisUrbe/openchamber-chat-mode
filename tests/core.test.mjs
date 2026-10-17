import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../dist/lib/calculator.js';
import { chatConfig, trimTools, allowedTools } from '../dist/lib/policy.js';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploy } from '../scripts/deploy.mjs';
import { parseManifest } from '@openchamber/sdk/schemas';

test('decimal arithmetic, rounding and invalid inputs', () => {
  for (const [operation,a,b,result] of [['add','0.1','0.2','0.3'],['subtract','1','.9','0.1'],['multiply','123.45','100','12345'],['divide','1','8','0.125'],['divide','1','3','0.'+'3'.repeat(50)]]) {
    assert.equal(calculate({operation,a,b}).result,result);
  }
  for (const a of ['NaN','Infinity','1e999999','process.exit()','0x10','1'.repeat(257),'']) assert.throws(()=>calculate({operation:'add',a,b:'1'}));
  assert.throws(()=>calculate({operation:'divide',a:'1',b:'0'}));
  assert.throws(()=>calculate({operation:'eval',a:'1',b:'2'}));
});
test('new tools are hidden by default; policy and agent allowlists agree', () => {
  const tools=Object.fromEntries([...allowedTools,'read','execute','future_mcp_tool'].map(n=>[n,{}]));
  trimTools(tools); assert.deepEqual(Object.keys(tools),[...allowedTools]);
  const config=chatConfig();
  assert.deepEqual(config.agents.chat.permissions.slice(1).map(r=>r.action),[...allowedTools]);
  assert.deepEqual(config.policies.slice(1).map(r=>r.resource),allowedTools.map(n=>n+':*'));
});
test('extension requests sessions only and matches the installed SDK', async () => {
  const manifest=JSON.parse(await readFile('dist/extension/package.json','utf8'));
  assert.deepEqual(manifest.openchamber.contributes.capabilities,['sessions']);
  const parsed=parseManifest(manifest);
  assert.equal(parsed.ok,true,JSON.stringify(parsed));
});
test('deployment refuses existing data, preserves edits, and backs up updates', async () => {
  const base=await mkdtemp(join(tmpdir(),'chat-deploy-'));
  await assert.rejects(deploy(base),/unmanaged/);
  const target=join(base,'installed');
  await deploy(target);
  const update=await deploy(target); assert.ok(update.backup);
  assert.equal(await readFile(join(update.backup,'location/opencode.jsonc'),'utf8'),await readFile(join(target,'location/opencode.jsonc'),'utf8'));
  await writeFile(join(target,'location/opencode.jsonc'),'user edit');
  await assert.rejects(deploy(target),/Local modification preserved/);
  assert.equal(await readFile(join(target,'location/opencode.jsonc'),'utf8'),'user edit');
});
