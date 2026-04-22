import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
// Use Vite's ?url import so the WASM is emitted as a properly hashed asset
// and served from a URL that works regardless of host/origin. This avoids
// relying on a bare "/sql-wasm.wasm" path resolving correctly in the
// Capacitor WebView.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { DatabaseError, ValidationError } from './errors';

const DB_NAME = 'classtrack_attendance';
const DB_STORE = 'database';
const DB_KEY = 'main';

let db: SqlJsDatabase | null = null;

// IndexedDB helpers for persisting the SQLite database
function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  const idb = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.get(DB_KEY);
    request.onsuccess = () => {
      idb.close();
      resolve(request.result ? new Uint8Array(request.result) : null);
    };
    request.onerror = () => {
      idb.close();
      reject(request.error);
    };
  });
}

async function saveToIndexedDB(): Promise<void> {
  if (!db) return;
  const data = db.export();
  const idb = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    // Store the Uint8Array directly. Passing `data.buffer` (a raw ArrayBuffer
    // backed by WASM memory) is unreliable on Android WebView IndexedDB.
    const request = store.put(data, DB_KEY);
    request.onsuccess = () => {
      idb.close();
      resolve();
    };
    request.onerror = () => {
      const err = request.error;
      idb.close();
      console.error('IndexedDB write failed:', err);
      reject(err);
    };
  });
}

async function deleteFromIndexedDB(): Promise<void> {
  const idb = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const request = store.delete(DB_KEY);
    request.onsuccess = () => { idb.close(); resolve(); };
    request.onerror = () => { idb.close(); reject(request.error); };
  });
}

export async function initDatabase(): Promise<void> {
  // sql.js's built-in WASM fetcher fails inside the Android WebView with
  // "both async and sync fetching of the wasm failed" because Capacitor
  // serves .wasm with a MIME type that breaks both `instantiateStreaming`
  // and its XHR fallback. Fetch the bytes ourselves and hand them to
  // initSqlJs via `wasmBinary`, which skips sql.js's fetcher entirely.
  let wasmBinary: ArrayBuffer;
  try {
    const resp = await fetch(sqlWasmUrl);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${sqlWasmUrl}`);
    }
    wasmBinary = await resp.arrayBuffer();
  } catch (err: any) {
    throw new Error(
      `Could not load SQLite WASM (${sqlWasmUrl}): ${err?.message || String(err)}`
    );
  }

  const SQL = await initSqlJs({ wasmBinary });

  let savedData: Uint8Array | null = null;
  try {
    savedData = await loadFromIndexedDB();
  } catch (err) {
    console.error('IndexedDB load failed, starting fresh:', err);
  }

  if (savedData && savedData.byteLength > 0) {
    try {
      db = new SQL.Database(savedData);
    } catch (err) {
      // Corrupt bytes stored by a prior buggy version — discard and start fresh.
      console.error('Saved database is corrupt, resetting:', err);
      try { await deleteFromIndexedDB(); } catch {}
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      session_name TEXT NOT NULL DEFAULT 'Session 1',
      notes TEXT,
      FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
      UNIQUE(student_id, date, session_name)
    )
  `);

  // Migration: Check if session_name column exists (for older versions)
  try {
    const tableInfo = db.exec("PRAGMA table_info(attendance)");
    const hasSessionName = tableInfo[0].values.some(row => row[1] === 'session_name');
    
    if (!hasSessionName) {
      console.log('Migrating attendance table to include session_name...');
      // SQLite doesn't support DROP CONSTRAINT, so we recreate the table
      db.run("ALTER TABLE attendance RENAME TO attendance_old");
      db.run(`
        CREATE TABLE attendance (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL,
          date TEXT NOT NULL,
          status TEXT NOT NULL,
          session_name TEXT NOT NULL DEFAULT 'Session 1',
          notes TEXT,
          FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
          UNIQUE(student_id, date, session_name)
        )
      `);
      db.run(`
        INSERT INTO attendance (student_id, date, status, notes)
        SELECT student_id, date, status, notes FROM attendance_old
      `);
      db.run("DROP TABLE attendance_old");
      console.log('Migration complete.');
    }
  } catch (err) {
    console.error('Migration failed:', err);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      session_name TEXT NOT NULL,
      UNIQUE(class_id, date, session_name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await persist();
}

/** Persist the database to IndexedDB after write operations */
/** Wipe the persisted database entirely (used by the Reset button on errors). */
export async function resetDatabase(): Promise<void> {
  try { await deleteFromIndexedDB(); } catch {}
  // Best-effort: also drop the whole IndexedDB database so nothing lingers.
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  } catch {}
}

export async function persist(): Promise<void> {
  await saveToIndexedDB();
}

/** ONLY FOR TESTING: Reset the internal db reference */
export function resetDbForTesting(): void {
  db = null;
}

/** Get the raw database instance (for advanced queries) */
export function getDb(): SqlJsDatabase {
  if (!db) throw new DatabaseError('Database not initialized. Call initDatabase() first.');
  return db;
}

// Belt-and-suspenders helper: build INSERTs without sql.js string parameter
// binding. sql.js's string-binding path (`on`/`$t`/`Yt`/`nl` helpers) can be
// clobbered by esbuild minification name-collisions between React and the
// emscripten runtime. Integer binding is fine, but string binding has been
// observed to silently bind NULL ("NOT NULL constraint failed: classes.name"
// on the first INSERT with a string value). Quoting the value inline avoids
// the binding path entirely. All callers here pass trusted, user-supplied
// strings that we escape the SQLite way (double single-quotes).
function sqlStr(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function sqlInt(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`sqlInt: not a finite number (${value})`);
  return String(Math.trunc(n));
}

// ─── Classes ────────────────────────────────────────────────────────────────

export interface ClassRow {
  id: number;
  name: string;
}

export function getAllClasses(): ClassRow[] {
  const stmt = getDb().prepare('SELECT * FROM classes');
  const results: ClassRow[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as ClassRow;    results.push(row);
  }
  stmt.free();
  return results;
}

export function addClass(name: string): ClassRow {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new ValidationError('Class name cannot be empty');
  const database = getDb();
  try {
    database.exec(`INSERT INTO classes (name) VALUES (${sqlStr(trimmed)})`);
    const id = database.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    return { id, name: trimmed };
  } catch (err) {
    throw new DatabaseError('Failed to add class', err);
  }
}

export function deleteClass(id: number): void {
  try {
    // Manual cascade since sql.js PRAGMA foreign_keys may not be reliable
    const students = getDb().exec('SELECT id FROM students WHERE class_id = ?', [id]);
    if (students.length > 0 && students[0].values.length > 0) {
      const studentIds = students[0].values.map(row => row[0] as number);
      for (const sid of studentIds) {
        getDb().run('DELETE FROM attendance WHERE student_id = ?', [sid]);
      }
    }
    getDb().run('DELETE FROM students WHERE class_id = ?', [id]);
    getDb().run('DELETE FROM sessions WHERE class_id = ?', [id]);
    getDb().run('DELETE FROM classes WHERE id = ?', [id]);
  } catch (err) {
    throw new DatabaseError('Failed to delete class', err);
  }
}

// ─── Students ───────────────────────────────────────────────────────────────

export interface StudentRow {
  id: number;
  class_id: number;
  name: string;
}

export function getStudentsByClass(classId: number): StudentRow[] {
  try {
    const stmt = getDb().prepare('SELECT * FROM students WHERE class_id = ?');
    stmt.bind([classId]);
    const results: StudentRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as StudentRow;
      results.push(row);
    }
    stmt.free();
    return results;
  } catch (err) {
    throw new DatabaseError('Failed to get students', err);
  }
}

export function addStudent(classId: number, name: string): StudentRow {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new ValidationError('Student name cannot be empty');
  const database = getDb();
  try {
    database.exec(
      `INSERT INTO students (class_id, name) VALUES (${sqlInt(classId)}, ${sqlStr(trimmed)})`
    );
    const id = database.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
    return { id, class_id: classId, name: trimmed };
  } catch (err) {
    throw new DatabaseError('Failed to add student', err);
  }
}

export function addStudentsBulk(classId: number, names: string[]): void {
  const cid = sqlInt(classId);
  const database = getDb();
  try {
    database.exec('BEGIN TRANSACTION');
    for (const name of names) {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) continue;
      database.exec(
        `INSERT INTO students (class_id, name) VALUES (${cid}, ${sqlStr(trimmed)})`
      );
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw new DatabaseError('Failed to add students in bulk', err);
  }
}

export function deleteStudent(id: number): void {
  try {
    getDb().run('DELETE FROM attendance WHERE student_id = ?', [id]);
    getDb().run('DELETE FROM students WHERE id = ?', [id]);
  } catch (err) {
    throw new DatabaseError('Failed to delete student', err);
  }
}

export function deleteStudentsBulk(ids: number[]): void {
  const database = getDb();
  try {
    database.exec('BEGIN TRANSACTION');
    for (const id of ids) {
      database.run('DELETE FROM attendance WHERE student_id = ?', [id]);
      database.run('DELETE FROM students WHERE id = ?', [id]);
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw new DatabaseError('Failed to delete students in bulk', err);
  }
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export interface AttendanceRow {
  id?: number;
  student_id: number;
  date: string;
  status: string;
  session_name: string;
  notes: string | null;
}

export function getStudentHistory(studentId: number): AttendanceRow[] {
  try {
    const stmt = getDb().prepare(
      'SELECT date, status, session_name, notes FROM attendance WHERE student_id = ? ORDER BY date DESC, session_name ASC'
    );
    stmt.bind([studentId]);
    const results: AttendanceRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as AttendanceRow;
      results.push(row);
    }
    stmt.free();
    return results;
  } catch (err) {
    throw new DatabaseError('Failed to get student history', err);
  }
}

export function getAttendanceByClassAndDate(classId: number, date: string, sessionName: string): AttendanceRow[] {
  try {
    const stmt = getDb().prepare(`
      SELECT a.* FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE s.class_id = ? AND a.date = ? AND a.session_name = ?
    `);
    stmt.bind([classId, date, sessionName]);
    const results: AttendanceRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as unknown as AttendanceRow;
      results.push(row);
    }
    stmt.free();
    return results;
  } catch (err) {
    throw new DatabaseError('Failed to get attendance', err);
  }
}

export function getSessionsForDate(classId: number, date: string): string[] {
  try {
    const cid = sqlInt(classId);
    const d = sqlStr(date);
    const result = getDb().exec(`
      SELECT DISTINCT session_name FROM (
        SELECT session_name FROM sessions WHERE class_id = ${cid} AND date = ${d}
        UNION
        SELECT a.session_name FROM attendance a
        JOIN students s ON a.student_id = s.id
        WHERE s.class_id = ${cid} AND a.date = ${d}
      )
      ORDER BY session_name
    `);
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values.map(row => row[0] as string);
    }
    return ['Session 1'];
  } catch (err) {
    return ['Session 1'];
  }
}

export function saveSession(classId: number, date: string, sessionName: string): void {
  try {
    getDb().exec(
      `INSERT OR IGNORE INTO sessions (class_id, date, session_name)
       VALUES (${sqlInt(classId)}, ${sqlStr(date)}, ${sqlStr(sessionName)})`
    );
  } catch (err) {
    throw new DatabaseError('Failed to save session', err);
  }
}

export function saveAttendance(
  studentId: number,
  date: string,
  status: string,
  sessionName: string,
  notes?: string
): void {
  try {
    getDb().exec(
      `INSERT INTO attendance (student_id, date, status, session_name, notes)
       VALUES (${sqlInt(studentId)}, ${sqlStr(date)}, ${sqlStr(status)}, ${sqlStr(sessionName)}, ${sqlStr(notes ?? null)})
       ON CONFLICT(student_id, date, session_name) DO UPDATE SET status = excluded.status, notes = excluded.notes`
    );
  } catch (err) {
    throw new DatabaseError('Failed to save attendance', err);
  }
}

export function saveAttendanceBulk(
  records: { student_id: number; date: string; status: string; session_name: string; notes?: string }[]
): void {
  const database = getDb();
  try {
    database.exec('BEGIN TRANSACTION');
    for (const record of records) {
      database.exec(
        `INSERT INTO attendance (student_id, date, status, session_name, notes)
         VALUES (${sqlInt(record.student_id)}, ${sqlStr(record.date)}, ${sqlStr(record.status)}, ${sqlStr(record.session_name)}, ${sqlStr(record.notes ?? null)})
         ON CONFLICT(student_id, date, session_name) DO UPDATE SET status = excluded.status, notes = excluded.notes`
      );
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw new DatabaseError('Failed to save attendance in bulk', err);
  }
}

// ─── Export Data ─────────────────────────────────────────────────────────────

export interface ExportDataResult {
  students: { id: number; name: string }[];
  attendance: { student_id: number; date: string; status: string; session_name: string; notes: string | null }[];
}

export function getExportData(
  classId: number,
  startDate?: string,
  endDate?: string
): ExportDataResult {
  try {
    // Get students
    const studentsStmt = getDb().prepare(
      'SELECT id, name FROM students WHERE class_id = ? ORDER BY name ASC'
    );
    studentsStmt.bind([classId]);
    const students: { id: number; name: string }[] = [];
    while (studentsStmt.step()) {
      students.push(studentsStmt.getAsObject() as { id: number; name: string });
    }
    studentsStmt.free();

    // Get attendance
    let query = `SELECT student_id, date, status, session_name, notes FROM attendance
      WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)`;
    const params: any[] = [classId];

    if (startDate && endDate) {
      query += ' AND date >= ? AND date <= ?';
      params.push(startDate, endDate);
    }
    query += ' ORDER BY date ASC, session_name ASC';

    const attendanceStmt = getDb().prepare(query);
    attendanceStmt.bind(params);
    const attendance: { student_id: number; date: string; status: string; session_name: string; notes: string | null }[] = [];
    while (attendanceStmt.step()) {
      attendance.push(
        attendanceStmt.getAsObject() as {
          student_id: number;
          date: string;
          status: string;
          session_name: string;
          notes: string | null;
        }
      );
    }
    attendanceStmt.free();

    return { students, attendance };
  } catch (err) {
    throw new DatabaseError('Failed to get export data', err);
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  try {
    const result = getDb().exec(`SELECT value FROM settings WHERE key = ${sqlStr(key)}`);
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as string;
    }
    return null;
  } catch (err) {
    throw new DatabaseError(`Failed to get setting: ${key}`, err);
  }
}

export function setSetting(key: string, value: string): void {
  try {
    getDb().exec(
      `INSERT INTO settings (key, value) VALUES (${sqlStr(key)}, ${sqlStr(value)})
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
  } catch (err) {
    throw new DatabaseError(`Failed to set setting: ${key}`, err);
  }
}

export function deleteSetting(key: string): void {
  try {
    getDb().exec(`DELETE FROM settings WHERE key = ${sqlStr(key)}`);
  } catch (err) {
    throw new DatabaseError(`Failed to delete setting: ${key}`, err);
  }
}
