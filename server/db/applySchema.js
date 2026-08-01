import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function applySchema() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] Schema applied.');
  await pool.end();
}

applySchema().catch((err) => {
  console.error('[db] Failed to apply schema:', err.message);
  process.exit(1);
});
