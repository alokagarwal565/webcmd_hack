import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// Singleton pool — Neon's connection string already carries ?sslmode=require;
// pg respects it automatically via the connectionString.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
});
