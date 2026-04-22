import { Class, Student, AttendanceRecord, ExportData } from './types';
import * as db from './db';
import { performDriveSync } from './google-drive-service';

/**
 * API layer that provides the same interface as the original HTTP-based API,
 * but uses the local SQLite database (sql.js) instead of server calls.
 * This makes the app fully offline-capable on Android.
 */
export const api = {
  getClasses: async (): Promise<Class[]> => {
    return db.getAllClasses();
  },

  addClass: async (name: string): Promise<Class> => {
    const cls = db.addClass(name);
    await db.persist();
    return cls;
  },

  deleteClass: async (id: number): Promise<void> => {
    db.deleteClass(id);
    await db.persist();
  },

  getStudents: async (classId: number): Promise<Student[]> => {
    return db.getStudentsByClass(classId);
  },

  addStudent: async (classId: number, name: string): Promise<Student> => {
    const student = db.addStudent(classId, name);
    await db.persist();
    return student;
  },

  addStudentsBulk: async (classId: number, students: string[]): Promise<void> => {
    db.addStudentsBulk(classId, students);
    await db.persist();
  },

  deleteStudent: async (id: number): Promise<void> => {
    db.deleteStudent(id);
    await db.persist();
  },

  deleteStudentsBulk: async (ids: number[]): Promise<void> => {
    db.deleteStudentsBulk(ids);
    await db.persist();
  },

  getStudentHistory: async (studentId: number): Promise<AttendanceRecord[]> => {
    return db.getStudentHistory(studentId) as unknown as AttendanceRecord[];
  },

  getAttendance: async (classId: number, date: string, sessionName: string): Promise<AttendanceRecord[]> => {
    return db.getAttendanceByClassAndDate(classId, date, sessionName) as unknown as AttendanceRecord[];
  },

  getSessions: async (classId: number, date: string): Promise<string[]> => {
    return db.getSessionsForDate(classId, date);
  },

  saveSession: async (classId: number, date: string, sessionName: string): Promise<void> => {
    db.saveSession(classId, date, sessionName);
    await db.persist();
  },

  saveAttendance: async (
    student_id: number,
    date: string,
    status: 'present' | 'absent',
    sessionName: string,
    notes?: string
  ): Promise<void> => {
    db.saveAttendance(student_id, date, status, sessionName, notes);
    await db.persist();
    // Trigger background sync (non-blocking)
    performDriveSync().catch(() => {});
  },

  saveAttendanceBulk: async (records: AttendanceRecord[]): Promise<void> => {
    db.saveAttendanceBulk(records);
    await db.persist();
    // Trigger background sync (non-blocking)
    performDriveSync().catch(() => {});
  },

  getExportData: async (
    classId: number,
    startDate?: string,
    endDate?: string
  ): Promise<ExportData> => {
    return db.getExportData(classId, startDate, endDate);
  },

  // Auth methods now use local settings + Google Auth plugin
  getAuthStatus: async (): Promise<{ authenticated: boolean }> => {
    const tokens = db.getSetting('google_tokens');
    return { authenticated: !!tokens };
  },

  getAuthUrl: async (): Promise<{ url: string }> => {
    // Not used in Android - native Google Sign-In handles this
    return { url: '' };
  },

  disconnectAuth: async (): Promise<{ success: boolean }> => {
    db.deleteSetting('google_tokens');
    await db.persist();
    return { success: true };
  },

  syncToDrive: async (): Promise<{ success: boolean }> => {
    const tokens = db.getSetting('google_tokens');
    if (!tokens) {
      throw new Error('Not authenticated with Google');
    }
    await performDriveSync();
    return { success: true };
  },
};
