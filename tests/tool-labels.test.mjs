import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseManifest } from '@openchamber/sdk/schemas';
import { labelLocale, localizeManifest, toolLabels } from '../scripts/tool-labels.mjs';

const source = JSON.parse(await readFile('extension/package.json', 'utf8'));
const names = manifest => Object.fromEntries(manifest.openchamber.contributes.tools.map(t => [t.match, t.name]));

test('locale tags map to Simplified, Traditional or English labels', () => {
  for (const tag of ['zh-CN', 'zh', 'zh-SG', 'zh-Hans', 'zh_CN', 'ZH-cn']) assert.equal(labelLocale(tag), 'zh-Hans', tag);
  for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-CN']) assert.equal(labelLocale(tag), 'zh-Hant', tag);
  for (const tag of ['en', 'en-US', 'fr', 'ja', '', '  ', 'not a tag!', undefined, null, 42]) assert.equal(labelLocale(tag), 'en', String(tag));
});

test('the source manifest declares English names for every translated tool', () => {
  const english = names(source);
  assert.deepEqual(english, { websearch: 'Web Search', webfetch: 'Fetch URL', chat_calculate: 'Chat Calculate' });
  for (const labels of Object.values(toolLabels)) assert.deepEqual(Object.keys(labels).sort(), Object.keys(english).sort());
});

test('localized manifests stay valid and leave the source untouched', () => {
  const before = JSON.stringify(source);
  const hans = localizeManifest(source, 'zh-CN');
  assert.deepEqual(names(hans), { websearch: '联网搜索', webfetch: '获取网页', chat_calculate: '数值计算' });
  assert.deepEqual(names(localizeManifest(source, 'zh-TW')), { websearch: '聯網搜尋', webfetch: '擷取網頁', chat_calculate: '數值計算' });
  assert.deepEqual(localizeManifest(source, 'de'), source);
  assert.equal(JSON.stringify(source), before);
  for (const tag of ['en', 'zh-CN', 'zh-TW']) {
    const parsed = parseManifest(localizeManifest(source, tag));
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
  }
});
