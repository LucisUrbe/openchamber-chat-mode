import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/location/.opencode/plugins/chat', { recursive: true });
await mkdir('dist/extension/panel', { recursive: true });
await mkdir('dist/lib', { recursive: true });
await build({ entryPoints: ['src/policy.ts', 'src/calculator.ts'], outdir: 'dist/lib', bundle: true, platform: 'node', format: 'esm' });
const { chatConfig } = await import(resolve('dist/lib/policy.js'));
await writeFile('dist/location/opencode.jsonc', JSON.stringify(chatConfig(), null, 2) + '\n');
await build({ entryPoints: ['src/plugin.ts'], outfile: 'dist/location/.opencode/plugins/chat/index.js', bundle: true, platform: 'node', format: 'esm', target: 'es2022' });
await writeFile('dist/location/.opencode/plugins/chat/package.json', JSON.stringify({ name: 'openchamber-chat-core', version: '0.1.0', type: 'module', main: './index.js' }, null, 2) + '\n');
await build({ entryPoints: ['src/panel.ts'], outfile: 'dist/extension/panel/main.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022' });
await copyFile('extension/package.json', 'dist/extension/package.json');
await copyFile('extension/panel/index.html', 'dist/extension/panel/index.html');
console.log('Built Chat Location and OpenChamber extension in dist/.');
