import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ApiCallEvent } from "../airwallex/client.ts";

// Durable memory for money movement:
// - operations: one row per logical operation key, holding its request_id and result. A retry of the
//   same operation reuses the request_id, so Airwallex deduplicates it; a new operation gets a new one.
// - audit: every API call, for the payday report and the demo's audit log.
export class Store {
  private readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        key TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        result TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        account TEXT,
        request_id TEXT,
        status INTEGER NOT NULL,
        error_code TEXT,
        ms INTEGER NOT NULL
      );
    `);
  }

  requestIdFor(key: string): string {
    const row = this.db.prepare("SELECT request_id FROM operations WHERE key = ?").get(key) as { request_id: string } | undefined;
    if (row) return row.request_id;
    const requestId = randomUUID();
    this.db.prepare("INSERT INTO operations (key, request_id, updated_at) VALUES (?, ?, ?)").run(key, requestId, new Date().toISOString());
    return requestId;
  }

  result<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT result FROM operations WHERE key = ?").get(key) as { result: string | null } | undefined;
    return row?.result ? (JSON.parse(row.result) as T) : undefined;
  }

  saveResult(key: string, result: unknown): void {
    this.requestIdFor(key);
    this.db.prepare("UPDATE operations SET result = ?, updated_at = ? WHERE key = ?").run(JSON.stringify(result), new Date().toISOString(), key);
  }

  audit(event: ApiCallEvent): void {
    this.db
      .prepare("INSERT INTO audit (at, method, path, account, request_id, status, error_code, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.at.toISOString(), event.method, event.path, event.account ?? null, event.requestId ?? null, event.status, event.errorCode ?? null, event.ms);
  }

  auditLog(): { at: string; method: string; path: string; account: string | null; request_id: string | null; status: number; error_code: string | null }[] {
    return this.db.prepare("SELECT at, method, path, account, request_id, status, error_code FROM audit ORDER BY id").all() as never;
  }

  close(): void {
    this.db.close();
  }
}
