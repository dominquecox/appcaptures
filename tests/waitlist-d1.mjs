// Real workerd + local SQLite-backed D1, never a mocked DB or remote binding.
// Run: node tests/waitlist-d1.mjs
// If Miniflare is installed with Wrangler elsewhere, set MINIFLARE_MODULE to
// its resolved entry file. Requires a runtime supporting 2026-10-19.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { Miniflare, convertV4MiniflareOptions } = await import(process.env.MINIFLARE_MODULE || 'miniflare');
const options = {
  modules: true,
  scriptPath: fileURLToPath(new URL('../worker.js', import.meta.url)),
  compatibilityDate: '2026-10-19',
  d1Databases: ['DB'],
  d1Persist: false,
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
try {
  const db = await mf.getD1Database('DB');
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  for (const sql of schema.split(';').filter(s => s.trim())) await db.prepare(sql).run();
  // Seed same-second arrivals atomically. This reproduces the exact production
  // precision issue without relying on wall clock timing or artificial delays.
  await db.batch([
    db.prepare("INSERT INTO waitlist(email, at) VALUES (?, ?)").bind('first@example.com', '2026-01-01 00:00:00'),
    db.prepare("INSERT INTO waitlist(email, at) VALUES (?, ?)").bind('second@example.com', '2026-01-01 00:00:00'),
  ]);
  const post = async email => {
    const response = await mf.dispatchFetch('http://local/api/waitlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await post('FIRST@example.com'), { ok: true, position: 1 });
  assert.deepEqual(await post('second@example.com'), { ok: true, position: 2 });
  assert.deepEqual(await post('third@example.com'), { ok: true, position: 3 });
  assert.deepEqual(await post('first@example.com'), { ok: true, position: 1 });
  assert.equal((await db.prepare('SELECT COUNT(*) AS c FROM waitlist').first()).c, 3);
  const { results } = await db.prepare('SELECT at FROM waitlist ORDER BY rowid LIMIT 2').all();
  assert.equal(results[0].at, results[1].at, 'regression must exercise a timestamp tie');
  console.log('waitlist-d1: same-second positions 1,2; third 3; duplicate first stays 1; three rows PASS');
} finally {
  await mf.dispose();
}
