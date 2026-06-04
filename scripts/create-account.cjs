'use strict';
/*
 * Provision a pokkit project account.
 *
 *   node scripts/create-account.cjs "CourseBloom"
 *
 * Prints { id, name, key } as JSON. The key is shown ONCE — only its hash is
 * stored. Give the key to the project (POKKIT_KEY). Writes directly to the live
 * SQLite DB (WAL-safe alongside the running server).
 */
const path = require('node:path');
const PokkitStore = require('../core/index.js');

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('usage: node scripts/create-account.cjs "Project Name"');
  process.exit(1);
}

const dataDir = process.env.POKKIT_DATA_DIR || path.join(__dirname, '..', 'data');
const store = new PokkitStore({ dataDir });
try {
  const { account, key } = store.createAccount(name);
  console.log(JSON.stringify({ id: account.id, name: account.name, key }, null, 2));
} finally {
  store.close();
}
