// Clean-checkout release gate. No upload: every Wrangler invocation is --dry-run.
// WRANGLER_CLI may point at a pinned Wrangler CLI entry (see tests/README.md).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, lstatSync, readFileSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const temp = mkdtempSync(path.join(tmpdir(), 'appcaptures-assets-'));
const checkout = path.join(temp, 'checkout');
const allowlist = new Set([
  '/index.html', '/news/index.html', '/changelog/index.html',
  '/terms/index.html', '/privacy/index.html', '/support/index.html',
  '/data/news.json', '/data/changelog.json',
  '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png',
  '/manifest.json', '/robots.txt', '/sitemap.xml', '/sw.js',
  '/app/index.html',
  '/app/js/main.js', '/app/js/models.js', '/app/js/presets.js',
  '/app/js/render.js', '/app/js/store.js', '/app/js/ui.js',
  '/app/presets/vidiloop/capture/screen.png',
  '/app/presets/vidiloop/discover/screen.png',
  '/app/presets/vidiloop/for_you_feed/screen.png',
  '/app/presets/vidiloop/notifications/screen.png',
  '/app/presets/vidiloop/onboarding/screen.png',
  '/app/presets/vidiloop/plus_paywall/screen.png',
  '/app/presets/vidiloop/profile_top8/screen.png',
  '/app/presets/vidiloop/trim_editor/screen.png',
]);
const cli = process.env.WRANGLER_CLI ? [process.execPath, [path.resolve(process.env.WRANGLER_CLI)]] : ['wrangler', []];
function inspect(label) {
  const result = spawnSync(cli[0], [...cli[1], 'deploy', '--dry-run', '--config', 'wrangler.jsonc', '--outdir', path.join(temp, 'bundle')], {
    cwd: checkout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, WRANGLER_LOG: 'debug', WRANGLER_LOG_PATH: path.join(temp, 'wrangler.log'), WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
  });
  const output = (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(result.status, 0, `${label}: Wrangler dry-run failed: ${output}`);
  assert.match(output, /--dry-run: exiting now/);
  // Pinned Wrangler prints its exact recursive input list, followed by its
  // own .assetsignore decisions. Fail closed if this output contract changes.
  const header = /Read (\d+) files? from the assets directory (.+)/.exec(output);
  assert.ok(header, 'Wrangler must enumerate its asset inputs');
  const directory = realpathSync(header[2].trim());
  const canonicalCheckout = realpathSync(checkout);
  assert.ok(directory === canonicalCheckout || directory.startsWith(canonicalCheckout + path.sep), 'asset directory must stay inside clean checkout');
  const entries = output.slice(header.index + header[0].length).split('\n').filter(s => s.startsWith('/')).slice(0, Number(header[1]));
  assert.equal(entries.length, Number(header[1]), 'incomplete Wrangler asset enumeration');
  const ignored = new Set([...output.matchAll(/^Ignoring asset: (.+)$/gm)].map(m => '/' + m[1].trim()));
  const files = entries.filter(entry => {
    if (ignored.has(entry)) return false;
    let stat;
    try { stat = lstatSync(path.join(directory, entry.slice(1))); }
    catch (error) {
      // Wrangler may remove temporary bundle paths after enumerating them.
      // Never silently drop such a candidate from a broad-root manifest.
      if (error.code === 'ENOENT' && !allowlist.has(entry)) return true;
      throw error;
    }
    assert.ok(!stat.isSymbolicLink(), `symlink asset forbidden: ${entry}`);
    return stat.isFile();
  }).sort();
  const unexpected = files.filter(file => !allowlist.has(file));
  return { label, directory: path.relative(canonicalCheckout, directory), files, unexpected };
}
try {
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', root, checkout]);
  execFileSync('git', ['-C', checkout, 'checkout', '--quiet', '--detach', revision]);
  assert.equal(execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'fixture must start as a clean checkout');
  const clean = inspect('clean checkout');
  assert.deepEqual(clean.unexpected, [], `non-public upload paths: ${clean.unexpected.join(', ')}`);
  assert.deepEqual(clean.files, [...allowlist].sort(), 'all intended public assets must be included');
  // Root-level development debris must never become public assets.
  mkdirSync(path.join(checkout, '.wrangler'), { recursive: true });
  writeFileSync(path.join(checkout, '.wrangler', 'sentinel.map'), 'test-only');
  writeFileSync(path.join(checkout, '.dev.vars.test'), 'DUMMY=test-only');
  writeFileSync(path.join(checkout, 'worker.js.map'), 'test-only');
  const dirty = inspect('root debris');
  assert.deepEqual(dirty.files, clean.files, 'root artifacts must not affect upload manifest');
  // Mutation test: an unlisted public file must be detected, even when the
  // bundler succeeds. Never upload this fixture or change the source tree.
  const leak = path.join(checkout, 'public', 'accidental-internal.txt');
  writeFileSync(leak, 'test-only');
  const negative = inspect('public allowlist mutation');
  assert.deepEqual(negative.unexpected, ['/accidental-internal.txt'], 'allowlist guard must reject an unexpected public asset');
  rmSync(leak);
  // Recreate the original broad-root failure and prove the guard catches it.
  const configPath = path.join(checkout, 'wrangler.jsonc');
  writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('"directory": "./public"', '"directory": "."'));
  const broad = inspect('broad-root mutation');
  assert.ok(broad.unexpected.includes('/worker.js'), 'guard must detect broad-root Worker exposure');
  assert.ok(broad.unexpected.some(s => s.startsWith('/.git/')), 'guard must detect Git metadata exposure');
  if (process.env.ASSET_MANIFEST_REPORT) writeFileSync(process.env.ASSET_MANIFEST_REPORT, JSON.stringify({ revision, clean, dirty, negative, broad }, null, 2) + '\n');
  console.log(`asset-manifest: ${revision}; ${clean.files.length} allowlisted public assets; clean checkout + root debris PASS; leaked public file + broad root correctly rejected`);
  console.log(clean.files.join('\n'));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
