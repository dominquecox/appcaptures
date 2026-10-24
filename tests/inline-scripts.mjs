// Parse every executable inline script with the actual Node syntax checker.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
let checked = 0;
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  const [, attrs, source] = match;
  if (/\bsrc\s*=/i.test(attrs) || !source.trim()) continue;
  const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
  if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
  const result = spawnSync(process.execPath, ['--check', '--input-type=' + (type === 'module' ? 'module' : 'commonjs')], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, `Inline script ${++checked}: ${result.stderr}`);
}
assert.ok(checked > 0, 'must extract executable inline scripts');
console.log(`inline-scripts: ${checked} scripts pass node --check`);
