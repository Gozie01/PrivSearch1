// ─────────────────────────────────────────────────────────────
// DB middleware — expose the connected Mongo Db instance
// ─────────────────────────────────────────────────────────────
import { Db } from 'mongodb';

let _db: Db | null = null;

export function setDb(db: Db): void {
  _db = db;
}

export function getDb(): Db {
  if (!_db) throw new Error('[DB middleware] Db not connected yet');
  return _db;
}
