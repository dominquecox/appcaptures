// Dev environment and migration runner tests (AC-003)
// Run: node tests/dev-env.mjs
import { readFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 1. Validate wrangler.jsonc
const wranglerPath = path.join(root, 'wrangler.jsonc');
assert.ok(existsSync(wranglerPath), 'wrangler.jsonc must exist');
const wranglerRaw = readFileSync(wranglerPath, 'utf8');

// Strip single line comments and multi-line comments for JSON parsing
const cleanedJson = wranglerRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let wranglerConfig;
try {
  wranglerConfig = JSON.parse(cleanedJson);
} catch (err) {
  assert.fail(`wrangler.jsonc must be valid JSONC: ${err.message}`);
}

// Top-level assertions
assert.equal(wranglerConfig.workers_dev, false, 'Top-level workers_dev must be false (raw workers.dev disabled for prod)');
assert.ok(wranglerConfig.vars, 'Top-level vars must exist');
assert.equal(wranglerConfig.vars.ENV, 'prod', 'Top-level vars.ENV must be "prod"');

// env.dev assertions
assert.ok(wranglerConfig.env, 'env block must exist in wrangler.jsonc');
assert.ok(wranglerConfig.env.dev, 'env.dev must exist in wrangler.jsonc');
const devEnv = wranglerConfig.env.dev;

assert.equal(devEnv.name, 'appcaptures-dev', 'env.dev.name must be "appcaptures-dev"');
assert.equal(devEnv.workers_dev, true, 'env.dev.workers_dev must be true');
assert.ok(devEnv.vars, 'env.dev.vars must exist');
assert.equal(devEnv.vars.ENV, 'dev', 'env.dev.vars.ENV must be "dev"');

// D1 database assertions
assert.ok(Array.isArray(devEnv.d1_databases) && devEnv.d1_databases.length > 0, 'env.dev.d1_databases must be non-empty array');
const devDb = devEnv.d1_databases.find((db) => db.binding === 'DB');
assert.ok(devDb, 'env.dev must bind DB');
assert.equal(devDb.database_name, 'appcaptures_db_dev', 'env.dev database_name must be "appcaptures_db_dev"');

const rootDb = wranglerConfig.d1_databases?.find((db) => db.binding === 'DB');
assert.ok(rootDb, 'root configuration must bind DB');
assert.notEqual(devDb.database_name, rootDb.database_name, 'dev database_name must be separate from prod');

// Assets assertions
assert.ok(devEnv.assets, 'env.dev.assets must exist');
assert.equal(devEnv.assets.directory, './public', 'env.dev.assets.directory must match public');

// 2. Validate migrations/0000_initial.sql
const migrationPath = path.join(root, 'migrations', '0000_initial.sql');
assert.ok(existsSync(migrationPath), 'migrations/0000_initial.sql must exist');
const migrationSql = readFileSync(migrationPath, 'utf8');

assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS waitlist/i, 'migration must create waitlist table');
assert.match(migrationSql, /email TEXT PRIMARY KEY/i, 'migration must specify email PRIMARY KEY');
assert.match(migrationSql, /platform TEXT/i, 'migration must include platform column');
assert.match(migrationSql, /source TEXT/i, 'migration must include source column');
assert.match(migrationSql, /at TIMESTAMP DEFAULT CURRENT_TIMESTAMP/i, 'migration must include at timestamp column');

// Execute SQL in SQLite to prove validity
try {
  execFileSync('sqlite3', [':memory:'], { input: migrationSql, encoding: 'utf8' });
} catch (err) {
  assert.fail(`migrations/0000_initial.sql must be valid SQLite/D1 SQL: ${err.message}`);
}

// 3. Validate tools/migrate.sh
const migrateScriptPath = path.join(root, 'tools', 'migrate.sh');
assert.ok(existsSync(migrateScriptPath), 'tools/migrate.sh must exist');

const stat = statSync(migrateScriptPath);
const isExecutable = (stat.mode & 0o111) !== 0;
assert.ok(isExecutable, 'tools/migrate.sh must be executable');

const migrateContent = readFileSync(migrateScriptPath, 'utf8');
assert.match(migrateContent, /^#!\/usr\/bin\/env bash/, 'tools/migrate.sh must have bash shebang');
assert.match(migrateContent, /set -euo pipefail/, 'tools/migrate.sh must set strict shell mode');
assert.match(migrateContent, /--local/, 'tools/migrate.sh must support --local target');
assert.match(migrateContent, /--dev/, 'tools/migrate.sh must support --dev target');
assert.match(migrateContent, /--prod/, 'tools/migrate.sh must support --prod target');
assert.match(migrateContent, /wrangler d1 migrations apply/, 'tools/migrate.sh must call wrangler d1 migrations apply');

// Check bash syntax of tools/migrate.sh
try {
  execFileSync('bash', ['-n', migrateScriptPath], { encoding: 'utf8' });
} catch (err) {
  assert.fail(`tools/migrate.sh has syntax error: ${err.message}`);
}

console.log('dev-env: all assertions passed');
