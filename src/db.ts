import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
// Use Vite's ?url import so the WASM is emitted as a properly hashed asset
// and served from a URL that works regardless of host/origin. This avoids
// relying on a bare "/sql-wasm.wasm" path resolving correctly in the
// Capacitor WebView.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

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
      notes TEXT,
      FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
      UNIQUE(student_id, date)
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

/** Get the raw database instance (for advanced queries) */
export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
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
  if (!Number.isFinite(n)) throw new Error(`sqlInt: not a finite number (${value})`);
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
    const row = stmt.getAsObject() as ClassRow;
    results.push(row);
  }
  stmt.free();
  return results;
}

export function addClass(name: string): ClassRow {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Class name cannot be empty');
  const database = getDb();
  database.exec(`INSERT INTO classes (name) VALUES (${sqlStr(trimmed)})`);
  const id = database.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
  return { id, name: trimmed };
}

export function deleteClass(id: number): void {
  // Manual cascade since sql.js PRAGMA foreign_keys may not be reliable
  const students = getDb().exec('SELECT id FROM students WHERE class_id = ?', [id]);
  if (students.length > 0 && students[0].values.length > 0) {
    const studentIds = students[0].values.map(row => row[0] as number);
    for (const sid of studentIds) {
      getDb().run('DELETE FROM attendance WHERE student_id = ?', [sid]);
    }
  }
  getDb().run('DELETE FROM students WHERE class_id = ?', [id]);
  getDb().run('DELETE FROM classes WHERE id = ?', [id]);
}

// ─── Students ───────────────────────────────────────────────────────────────

export interface StudentRow {
  id: number;
  class_id: number;
  name: string;
}

export function getStudentsByClass(classId: number): StudentRow[] {
  const stmt = getDb().prepare('SELECT * FROM students WHERE class_id = ?');
  stmt.bind([classId]);
  const results: StudentRow[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as StudentRow;
    results.push(row);
  }
  stmt.free();
  return results;
}

export function addStudent(classId: number, name: string): StudentRow {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Student name cannot be empty');
  const database = getDb();
  database.exec(
    `INSERT INTO students (class_id, name) VALUES (${sqlInt(classId)}, ${sqlStr(trimmed)})`
  );
  const id = database.exec('SELECT last_insert_rowid() as id')[0].values[0][0] as number;
  return { id, class_id: classId, name: trimmed };
}

export function addStudentsBulk(classId: number, names: string[]): void {
  const cid = sqlInt(classId);
  const database = getDb();
  for (const name of names) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) continue;
    database.exec(
      `INSERT INTO students (class_id, name) VALUES (${cid}, ${sqlStr(trimmed)})`
    );
  }
}

export function deleteStudent(id: number): void {
  getDb().run('DELETE FROM attendance WHERE student_id = ?', [id]);
  getDb().run('DELETE FROM students WHERE id = ?', [id]);
}

export function deleteStudentsBulk(ids: number[]): void {
  for (const id of ids) {
    getDb().run('DELETE FROM attendance WHERE student_id = ?', [id]);
    getDb().run('DELETE FROM students WHERE id = ?', [id]);
  }
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export interface AttendanceRow {
  id?: number;
  student_id: number;
  date: string;
  status: string;
  notes: string | null;
}

export function getStudentHistory(studentId: number): AttendanceRow[] {
  const stmt = getDb().prepare(
    'SELECT date, status, notes FROM attendance WHERE student_id = ? ORDER BY date DESC'
  );
  stmt.bind([studentId]);
  const results: AttendanceRow[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as AttendanceRow;
    results.push(row);
  }
  stmt.free();
  return results;
}

export function getAttendanceByClassAndDate(classId: number, date: string): AttendanceRow[] {
  const stmt = getDb().prepare(`
    SELECT a.* FROM attendance a
    JOIN students s ON a.student_id = s.id
    WHERE s.class_id = ? AND a.date = ?
  `);
  stmt.bind([classId, date]);
  const results: AttendanceRow[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as AttendanceRow;
    results.push(row);
  }
  stmt.free();
  return results;
}

export function saveAttendance(
  studentId: number,
  date: string,
  status: string,
  notes?: string
): void {
  getDb().exec(
    `INSERT INTO attendance (student_id, date, status, notes)
     VALUES (${sqlInt(studentId)}, ${sqlStr(date)}, ${sqlStr(status)}, ${sqlStr(notes ?? null)})
     ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, notes = excluded.notes`
  );
}

export function saveAttendanceBulk(
  records: { student_id: number; date: string; status: string; notes?: string }[]
): void {
  const database = getDb();
  for (const record of records) {
    database.exec(
      `INSERT INTO attendance (student_id, date, status, notes)
       VALUES (${sqlInt(record.student_id)}, ${sqlStr(record.date)}, ${sqlStr(record.status)}, ${sqlStr(record.notes ?? null)})
       ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, notes = excluded.notes`
    );
  }
}

// ─── Export Data ─────────────────────────────────────────────────────────────

export interface ExportDataResult {
  students: { id: number; name: string }[];
  attendance: { student_id: number; date: string; status: string; notes: string | null }[];
}

export function getExportData(
  classId: number,
  startDate?: string,
  endDate?: string
): ExportDataResult {
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
  let query = `SELECT student_id, date, status, notes FROM attendance
    WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)`;
  const params: any[] = [classId];

  if (startDate && endDate) {
    query += ' AND date >= ? AND date <= ?';
    params.push(startDate, endDate);
  }
  query += ' ORDER BY date ASC';

  const attendanceStmt = getDb().prepare(query);
  attendanceStmt.bind(params);
  const attendance: { student_id: number; date: string; status: string; notes: string | null }[] = [];
  while (attendanceStmt.step()) {
    attendance.push(
      attendanceStmt.getAsObject() as {
        student_id: number;
        date: string;
        status: string;
        notes: string | null;
      }
    );
  }
  attendanceStmt.free();

  return { students, attendance };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const result = getDb().exec(`SELECT value FROM settings WHERE key = ${sqlStr(key)}`);
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0] as string;
  }
  return null;
}

export function setSetting(key: string, value: string): void {
  getDb().exec(
    `INSERT INTO settings (key, value) VALUES (${sqlStr(key)}, ${sqlStr(value)})
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
}

export function deleteSetting(key: string): void {
  getDb().exec(`DELETE FROM settings WHERE key = ${sqlStr(key)}`);
}
