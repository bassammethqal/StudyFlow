import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure .env is loaded before evaluating process.env.DATABASE_URL
function loadEnv() {
  const possiblePaths = [
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "server/.env"),
    path.resolve(process.cwd(), "studyflow_v4/server/.env")
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
    }
  }
  dotenv.config();
}

loadEnv();

const { Pool } = pg;

let pgPool = null;
let sqliteDb = null;
let _isPostgres = false;
let initialized = false;
let initPromise = null;

function getDbUrl() {
  loadEnv();
  return (process.env.DATABASE_URL || "").trim();
}

async function initConnection() {
  if (initialized) return;

  const rawDbUrl = getDbUrl();
  _isPostgres = Boolean(rawDbUrl);

  if (_isPostgres) {
    const isLocal = rawDbUrl.includes("localhost") || rawDbUrl.includes("127.0.0.1");
    pgPool = new Pool({
      connectionString: rawDbUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    });

    console.log(`[DB] Neon PostgreSQL mode enabled (SSL: ${isLocal ? "disabled (local)" : "enabled"}).`);
  } else {
    // In production, require PostgreSQL and forbid native SQLite
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "FATAL: DATABASE_URL must be configured in production environment! " +
        "Native SQLite fallback is disabled in production to prevent crashes and ephemeral data loss."
      );
    }

    console.log("[DB] DATABASE_URL not set. Running with local SQLite (studyflow.db).");
    try {
      // Lazy dynamic import of better-sqlite3 strictly for local offline dev
      const { default: Database } = await import("better-sqlite3");
      const dbPath = path.resolve(__dirname, "../studyflow.db");
      sqliteDb = new Database(dbPath);
      sqliteDb.pragma("foreign_keys = ON");
      sqliteDb.pragma("journal_mode = WAL");
      sqliteDb.pragma("synchronous = NORMAL");
    } catch (err) {
      console.error("[DB ERROR] Failed to load local SQLite module 'better-sqlite3':", err.message);
      throw err;
    }
  }

  initialized = true;
}

async function ensureInitialized() {
  if (initialized) return;
  if (!initPromise) {
    initPromise = initConnection().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  await initPromise;
}

/**
 * Convert parameterized query with '?' placeholders to PostgreSQL '$1, $2, ...' placeholders.
 */
function toPgSql(sql) {
  let paramIdx = 0;
  return sql.replace(/\?/g, () => `$${++paramIdx}`);
}

export const db = {
  get isPostgres() {
    return Boolean(getDbUrl());
  },

  async init() {
    // Re-check in case DATABASE_URL was set after module load
    const currentUrl = getDbUrl();
    const wantsPostgres = Boolean(currentUrl);

    if (wantsPostgres !== _isPostgres || !initialized) {
      initialized = false;
      initPromise = null;
      if (sqliteDb) {
        try { sqliteDb.close(); } catch {}
        sqliteDb = null;
      }
      if (pgPool) {
        try { await pgPool.end(); } catch {}
        pgPool = null;
      }
      await ensureInitialized();
    }

    if (_isPostgres) {
      const client = await pgPool.connect();
      try {
        console.log("[DB] Connected successfully to Neon PostgreSQL database.");
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS subjects (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            code VARCHAR(100),
            progress INTEGER DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            tag VARCHAR(100) NOT NULL DEFAULT 'General',
            done INTEGER DEFAULT 0,
            priority VARCHAR(20) NOT NULL DEFAULT 'medium',
            due_date VARCHAR(20),
            estimated_minutes INTEGER DEFAULT 30,
            subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS schedules (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            subject VARCHAR(255) NOT NULL,
            day VARCHAR(50) NOT NULL,
            start_time VARCHAR(20) NOT NULL,
            end_time VARCHAR(20) NOT NULL,
            room VARCHAR(255)
          );

          CREATE TABLE IF NOT EXISTS password_resets (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            token VARCHAR(255) NOT NULL,
            code VARCHAR(20) NOT NULL,
            expires_at BIGINT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS focus_sessions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            duration_minutes INTEGER NOT NULL,
            subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
            task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS meta (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, done);
          CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(user_id, due_date);
          CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id);
          CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id);
          CREATE INDEX IF NOT EXISTS idx_schedules_day ON schedules(user_id, day, start_time);
          CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
          CREATE INDEX IF NOT EXISTS idx_focus_user ON focus_sessions(user_id);
          CREATE INDEX IF NOT EXISTS idx_focus_created ON focus_sessions(user_id, created_at);
        `);

        // Check legacy subjects purge in meta
        const metaRes = await client.query("SELECT value FROM meta WHERE key = 'legacy_subjects_purged'");
        if (!metaRes.rows || metaRes.rows.length === 0) {
          await client.query("DELETE FROM subjects WHERE code IN ('DB201','CS202','WEB203','IS204')");
          await client.query(
            "INSERT INTO meta(key, value) VALUES('legacy_subjects_purged', '1') ON CONFLICT (key) DO NOTHING"
          );
        }
      } finally {
        client.release();
      }
    } else {
      sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,tag TEXT NOT NULL DEFAULT 'General',done INTEGER DEFAULT 0,priority TEXT NOT NULL DEFAULT 'medium',due_date TEXT,estimated_minutes INTEGER DEFAULT 30,subject_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL);
        CREATE TABLE IF NOT EXISTS subjects(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,name TEXT NOT NULL,code TEXT,progress INTEGER DEFAULT 0,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS schedules(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,subject TEXT NOT NULL,day TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,room TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS password_resets(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL,token TEXT NOT NULL,code TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS focus_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,duration_minutes INTEGER NOT NULL,subject_id INTEGER,task_id INTEGER,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL,FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL);
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
        CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, done);
        CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(user_id, due_date);
        CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id);
        CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id);
        CREATE INDEX IF NOT EXISTS idx_schedules_day ON schedules(user_id, day, start_time);
        CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
        CREATE INDEX IF NOT EXISTS idx_focus_user ON focus_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_focus_created ON focus_sessions(user_id, created_at);
      `);

      try {
        const done = sqliteDb.prepare("SELECT value FROM meta WHERE key='legacy_subjects_purged'").get();
        if (!done) {
          sqliteDb.prepare("DELETE FROM subjects WHERE code IN ('DB201','CS202','WEB203','IS204')").run();
          sqliteDb.prepare("INSERT INTO meta(key,value) VALUES('legacy_subjects_purged','1') ON CONFLICT (key) DO NOTHING").run();
        }
      } catch {}

      for (const sql of [
        "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'",
        "ALTER TABLE tasks ADD COLUMN due_date TEXT",
        "ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER DEFAULT 30",
        "ALTER TABLE tasks ADD COLUMN subject_id INTEGER"
      ]) {
        try { sqliteDb.exec(sql); } catch {}
      }
    }
  },

  async get(sql, params = []) {
    await ensureInitialized();
    if (_isPostgres) {
      const pgSql = toPgSql(sql);
      const res = await pgPool.query(pgSql, params);
      return res.rows[0] || null;
    } else {
      const row = sqliteDb.prepare(sql).get(...params);
      return row || null;
    }
  },

  async all(sql, params = []) {
    await ensureInitialized();
    if (_isPostgres) {
      const pgSql = toPgSql(sql);
      const res = await pgPool.query(pgSql, params);
      return res.rows;
    } else {
      return sqliteDb.prepare(sql).all(...params);
    }
  },

  async run(sql, params = []) {
    await ensureInitialized();
    if (_isPostgres) {
      let pgSql = toPgSql(sql);
      const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
      if (isInsert && !/RETURNING/i.test(pgSql)) {
        pgSql += " RETURNING id";
      }
      const res = await pgPool.query(pgSql, params);
      const lastInsertRowid = res.rows && res.rows[0] ? res.rows[0].id : null;
      return {
        changes: res.rowCount,
        lastInsertRowid,
        rows: res.rows
      };
    } else {
      const info = sqliteDb.prepare(sql).run(...params);
      return {
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid
      };
    }
  },

  async checkpoint() {
    if (!_isPostgres && sqliteDb) {
      try {
        sqliteDb.pragma("wal_checkpoint(PASSIVE)");
      } catch {}
    }
  },

  async close() {
    if (_isPostgres && pgPool) {
      try { await pgPool.end(); } catch {}
      pgPool = null;
      initialized = false;
      initPromise = null;
    } else if (sqliteDb) {
      try {
        sqliteDb.pragma("wal_checkpoint(FULL)");
        sqliteDb.close();
      } catch {}
      sqliteDb = null;
      initialized = false;
      initPromise = null;
    }
  }
};
