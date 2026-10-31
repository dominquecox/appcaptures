// Unit tests for AppCaptures D1 SaaS Schema (SPEC Section 3.3, AC-004)
// Run: node tests/schema-saas.mjs

import { DatabaseSync } from "node:sqlite";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);

// 1. Verify schema-saas.sql and migrations/0001_saas_schema.sql match
const schemaSaasPath = path.join(rootDir, "schema-saas.sql");
const migration0001Path = path.join(rootDir, "migrations", "0001_saas_schema.sql");

assert.ok(existsSync(schemaSaasPath), "schema-saas.sql must exist");
assert.ok(existsSync(migration0001Path), "migrations/0001_saas_schema.sql must exist");

const schemaSaasContent = readFileSync(schemaSaasPath, "utf8");
const migration0001Content = readFileSync(migration0001Path, "utf8");

assert.equal(
  schemaSaasContent.trim(),
  migration0001Content.trim(),
  "schema-saas.sql and migrations/0001_saas_schema.sql must match exactly"
);

// 2. Instantiate in-memory SQLite database
const db = new DatabaseSync(":memory:");

// 3. Enable foreign key support
db.exec("PRAGMA foreign_keys = ON;");
const fkPragma = db.prepare("PRAGMA foreign_keys;").get();
assert.equal(fkPragma.foreign_keys, 1, "foreign_keys pragma must be active (1)");

// 4. Execute initial waitlist migration (or schema.sql if migration file not yet merged)
const initialSqlPath = existsSync(path.join(rootDir, "migrations", "0000_initial.sql"))
  ? path.join(rootDir, "migrations", "0000_initial.sql")
  : path.join(rootDir, "schema.sql");

const initialSql = readFileSync(initialSqlPath, "utf8");
db.exec(initialSql);

// 5. Execute migrations/0001_saas_schema.sql
db.exec(migration0001Content);

// 6. Verify table creation in database
const expectedTables = [
  "waitlist",
  "users",
  "sessions",
  "magic_links",
  "projects",
  "screens",
  "renders",
  "exports",
  "listings",
  "credit_ledger",
  "purchases",
  "stripe_events",
  "invites",
  "feature_flags",
  "audit_log",
  "support_threads",
  "support_messages",
  "news_posts",
  "changelog_entries",
];

const createdTables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
  .all()
  .map((row) => row.name);

for (const tableName of expectedTables) {
  assert.ok(
    createdTables.includes(tableName),
    `Expected table '${tableName}' was not found in sqlite_master`
  );
}

// 7. Test inserting records into all required SaaS tables
// users
db.prepare(`
  INSERT INTO users (id, email, name, status, plan, stripe_customer_id)
  VALUES (?, ?, ?, ?, ?, ?)
`).run("u_test1", "user1@example.com", "Test User", "active", "free", "cus_test1");

// sessions
db.prepare(`
  INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, ua)
  VALUES (?, ?, ?, ?, ?, ?)
`).run("sess_1", "u_test1", "hash_token_1", "2026-12-31T23:59:59Z", "127.0.0.1", "TestAgent/1.0");

// magic_links
db.prepare(`
  INSERT INTO magic_links (token_hash, email, expires_at)
  VALUES (?, ?, ?)
`).run("ml_token_1", "user1@example.com", "2026-11-01T00:00:00Z");

// projects
db.prepare(`
  INSERT INTO projects (id, user_id, name, platforms_json, brand_json)
  VALUES (?, ?, ?, ?, ?)
`).run(
  "proj_1",
  "u_test1",
  "Sample App",
  JSON.stringify(["ios", "android"]),
  JSON.stringify({ primary: "#7c5cff", bg: "#0b0914" })
);

// screens
db.prepare(`
  INSERT INTO screens (id, project_id, ord, capture_r2_key, headline, subhead, locale)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run("scr_1", "proj_1", 0, "captures/scr1.png", "Headline 1", "Subhead 1", "en-US");

// renders
db.prepare(`
  INSERT INTO renders (id, project_id, target_size, html_r2_key, png_r2_key, passes, review_json, status, cost_neurons)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  "rnd_1",
  "proj_1",
  "1320x2868",
  "renders/rnd1.html",
  "renders/rnd1.png",
  1,
  JSON.stringify({ review: "ok" }),
  "completed",
  25
);

// exports
db.prepare(`
  INSERT INTO exports (id, user_id, project_id, kind, r2_key, watermarked, status, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run("exp_1", "u_test1", "proj_1", "zip", "exports/exp1.zip", 0, "queued", "2026-12-01T00:00:00Z");

// listings
db.prepare(`
  INSERT INTO listings (id, project_id, store, locale, fields_json)
  VALUES (?, ?, ?, ?, ?)
`).run("list_1", "proj_1", "ios", "en-US", JSON.stringify({ title: "Sample App" }));

// credit_ledger
db.prepare(`
  INSERT INTO credit_ledger (id, user_id, delta, reason, ref)
  VALUES (?, ?, ?, ?, ?)
`).run("cred_1", "u_test1", 50, "welcome_bonus", null);

// purchases
db.prepare(`
  INSERT INTO purchases (id, user_id, stripe_session_id, product, amount_cents, status)
  VALUES (?, ?, ?, ?, ?, ?)
`).run("pur_1", "u_test1", "cs_live_session_1", "pro_lifetime", 1900, "completed");

// stripe_events
db.prepare(`
  INSERT INTO stripe_events (id, type)
  VALUES (?, ?)
`).run("evt_1", "checkout.session.completed");

// invites
db.prepare(`
  INSERT INTO invites (token_hash, email, expires_at)
  VALUES (?, ?, ?)
`).run("inv_token_1", "invitee@example.com", "2026-11-15T00:00:00Z");

// feature_flags
db.prepare(`
  INSERT INTO feature_flags (key, enabled, rollout_pct, allowlist_json, updated_by)
  VALUES (?, ?, ?, ?, ?)
`).run("browser_render_pipeline", 1, 100, JSON.stringify(["u_test1"]), "admin");

// audit_log
db.prepare(`
  INSERT INTO audit_log (id, actor, action, target_type, target_id, meta_json, ip)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run("aud_1", "admin", "create_project", "project", "proj_1", "{}", "127.0.0.1");

// support_threads
db.prepare(`
  INSERT INTO support_threads (id, user_id, email, subject, status)
  VALUES (?, ?, ?, ?, ?)
`).run("thread_1", "u_test1", "user1@example.com", "Help with export", "open");

// support_messages
db.prepare(`
  INSERT INTO support_messages (id, thread_id, sender, body)
  VALUES (?, ?, ?, ?)
`).run("msg_1", "thread_1", "user1@example.com", "My export is processing.");

// news_posts
db.prepare(`
  INSERT INTO news_posts (id, slug, title, body, status)
  VALUES (?, ?, ?, ?, ?)
`).run("np_1", "welcome-v2", "Welcome v2", "Body text", "published");

// changelog_entries
db.prepare(`
  INSERT INTO changelog_entries (id, version, title, body, status)
  VALUES (?, ?, ?, ?, ?)
`).run("cl_1", "1.1.0", "Version 1.1.0", "Release notes", "published");

// Verify row counts before cascade delete
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM users WHERE id = 'u_test1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = 'u_test1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM projects WHERE user_id = 'u_test1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM screens WHERE project_id = 'proj_1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM renders WHERE project_id = 'proj_1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM exports WHERE user_id = 'u_test1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM credit_ledger WHERE user_id = 'u_test1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM purchases WHERE user_id = 'u_test1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM listings WHERE project_id = 'proj_1'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM support_threads WHERE id = 'thread_1'").get().c, 1);

// 8. Test that cascading delete works: deleting a users row cascades to sessions, projects, screens, renders, exports
db.prepare("DELETE FROM users WHERE id = 'u_test1'").run();

assert.equal(db.prepare("SELECT COUNT(*) AS c FROM users WHERE id = 'u_test1'").get().c, 0);
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = 'u_test1'").get().c, 0, "sessions must cascade delete");
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM projects WHERE user_id = 'u_test1'").get().c, 0, "projects must cascade delete");
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM screens WHERE project_id = 'proj_1'").get().c, 0, "screens must cascade delete");
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM renders WHERE project_id = 'proj_1'").get().c, 0, "renders must cascade delete");
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM exports WHERE user_id = 'u_test1'").get().c, 0, "exports must cascade delete");
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM credit_ledger WHERE user_id = 'u_test1'").get().c, 0, "credit_ledger must cascade delete");
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM purchases WHERE user_id = 'u_test1'").get().c, 0, "purchases must cascade delete");
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM listings WHERE project_id = 'proj_1'").get().c, 0, "listings must cascade delete");

// support_threads has ON DELETE SET NULL on user_id
const threadAfterUserDelete = db.prepare("SELECT user_id FROM support_threads WHERE id = 'thread_1'").get();
assert.equal(threadAfterUserDelete.user_id, null, "support_threads user_id must be SET NULL on user deletion");

// 9. Test that duplicate email in users throws UNIQUE constraint error
db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("u_dup1", "unique_test@example.com");
assert.throws(
  () => {
    db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("u_dup2", "unique_test@example.com");
  },
  /UNIQUE constraint failed: users\.email/i,
  "Inserting duplicate email into users must throw UNIQUE constraint error"
);

// 10. Test that duplicate stripe_session_id in purchases throws UNIQUE constraint error
db.prepare("INSERT INTO purchases (id, user_id, stripe_session_id, product, amount_cents) VALUES (?, ?, ?, ?, ?)").run(
  "pur_dup1",
  "u_dup1",
  "sess_unique_test",
  "pro_lifetime",
  1900
);
assert.throws(
  () => {
    db.prepare("INSERT INTO purchases (id, user_id, stripe_session_id, product, amount_cents) VALUES (?, ?, ?, ?, ?)").run(
      "pur_dup2",
      "u_dup1",
      "sess_unique_test",
      "pro_lifetime",
      1900
    );
  },
  /UNIQUE constraint failed: purchases\.stripe_session_id/i,
  "Inserting duplicate stripe_session_id into purchases must throw UNIQUE constraint error"
);

// 11. Test that stripe_events idempotency works on primary key
// First insert must succeed
db.prepare("INSERT INTO stripe_events (id, type) VALUES (?, ?)").run("evt_idemp_1", "checkout.session.completed");

// Duplicate insert with INSERT must throw UNIQUE constraint error
assert.throws(
  () => {
    db.prepare("INSERT INTO stripe_events (id, type) VALUES (?, ?)").run("evt_idemp_1", "checkout.session.completed");
  },
  /UNIQUE constraint failed: stripe_events\.id/i,
  "Inserting duplicate stripe_events id must fail PK constraint"
);

// INSERT OR IGNORE must succeed without error and keep count at 1
const ignoreResult = db.prepare("INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)").run("evt_idemp_1", "checkout.session.completed");
assert.equal(ignoreResult.changes, 0, "Duplicate INSERT OR IGNORE must affect 0 rows");
assert.equal(
  db.prepare("SELECT COUNT(*) AS c FROM stripe_events WHERE id = 'evt_idemp_1'").get().c,
  1,
  "stripe_events idempotency ensures exactly 1 row exists"
);

console.log("schema-saas: all assertions passed");
