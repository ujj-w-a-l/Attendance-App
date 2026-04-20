import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import * as db from './db';
import initSqlJs from 'sql.js/dist/sql-asm.js';

// Mock the WASM import to avoid errors in Node
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({
  default: 'mock-wasm-url'
}));

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
}));

describe('db.ts', () => {
  beforeEach(async () => {
    db.resetDbForTesting();
    // We need to initialize the real SQL.js (ASM version) for actual data testing
    // But initDatabase in db.ts calls initSqlJs which we need to control.
    // The easiest way is to let initDatabase run but mock the initSqlJs call inside it.
  });

  it('should add and retrieve classes', async () => {
    // Actually, let's just use the real initSqlJs in db.ts by mocking the import
    // Wait, the current db.ts uses WASM and fetch.
    // I'll mock the 'sql.js' module to return the ASM version.
    
    await db.initDatabase();
    
    const className = 'Test Class';
    const cls = db.addClass(className);
    expect(cls.name).toBe(className);
    expect(cls.id).toBeTypeOf('number');

    const classes = db.getAllClasses();
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe(className);
  });

  it('should add and retrieve students', async () => {
    await db.initDatabase();
    const cls = db.addClass('Class 1');
    
    const studentName = 'John Doe';
    const student = db.addStudent(cls.id, studentName);
    expect(student.name).toBe(studentName);
    expect(student.class_id).toBe(cls.id);

    const students = db.getStudentsByClass(cls.id);
    expect(students).toHaveLength(1);
    expect(students[0].name).toBe(studentName);
  });

  it('should handle attendance', async () => {
    await db.initDatabase();
    const cls = db.addClass('Class 1');
    const student = db.addStudent(cls.id, 'Student 1');
    const date = '2023-10-01';
    
    db.saveAttendance(student.id, date, 'present', 'Session 1', 'Good job');
    
    const history = db.getStudentHistory(student.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('present');
    expect(history[0].notes).toBe('Good job');
    
    const attendance = db.getAttendanceByClassAndDate(cls.id, date, 'Session 1');
    expect(attendance).toHaveLength(1);
    expect(attendance[0].student_id).toBe(student.id);
  });

  it('should throw ValidationError for empty names', async () => {
    await db.initDatabase();
    expect(() => db.addClass('')).toThrow('Class name cannot be empty');
  });
});

// Mock the main sql.js module to use the ASM version for tests
vi.mock('sql.js', async () => {
  const initSqlJs = await import('sql.js/dist/sql-asm.js');
  return {
    default: initSqlJs.default
  };
});
