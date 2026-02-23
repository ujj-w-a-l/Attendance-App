import { Class, Student, AttendanceRecord, ExportData } from "./types";

export const api = {
  getClasses: async (): Promise<Class[]> => {
    const res = await fetch("/api/classes");
    return res.json();
  },
  addClass: async (name: string): Promise<Class> => {
    const res = await fetch("/api/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.json();
  },
  deleteClass: async (id: number): Promise<void> => {
    await fetch(`/api/classes/${id}`, { method: "DELETE" });
  },
  getStudents: async (classId: number): Promise<Student[]> => {
    const res = await fetch(`/api/classes/${classId}/students`);
    return res.json();
  },
  addStudent: async (classId: number, name: string): Promise<Student> => {
    const res = await fetch(`/api/classes/${classId}/students`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.json();
  },
  addStudentsBulk: async (classId: number, students: string[]): Promise<void> => {
    await fetch(`/api/classes/${classId}/students/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ students }),
    });
  },
  deleteStudent: async (id: number): Promise<void> => {
    await fetch(`/api/students/${id}`, { method: "DELETE" });
  },
  deleteStudentsBulk: async (ids: number[]): Promise<void> => {
    await fetch(`/api/students/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  },
  getStudentHistory: async (studentId: number): Promise<AttendanceRecord[]> => {
    const res = await fetch(`/api/students/${studentId}/attendance`);
    return res.json();
  },
  getAttendance: async (classId: number, date: string): Promise<AttendanceRecord[]> => {
    const res = await fetch(`/api/classes/${classId}/attendance?date=${date}`);
    return res.json();
  },
  saveAttendance: async (student_id: number, date: string, status: 'present' | 'absent', notes?: string): Promise<void> => {
    await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id, date, status, notes }),
    });
  },
  saveAttendanceBulk: async (records: AttendanceRecord[]): Promise<void> => {
    await fetch("/api/attendance/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records }),
    });
  },
  getExportData: async (classId: number, startDate?: string, endDate?: string): Promise<ExportData> => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`/api/export/${classId}${qs}`);
    return res.json();
  },
  getAuthStatus: async (): Promise<{ authenticated: boolean }> => {
    const res = await fetch('/api/auth/status');
    return res.json();
  },
  getAuthUrl: async (): Promise<{ url: string }> => {
    const res = await fetch('/api/auth/url');
    return res.json();
  },
  disconnectAuth: async (): Promise<{ success: boolean }> => {
    const res = await fetch('/api/auth/disconnect', { method: 'POST' });
    return res.json();
  },
  syncToDrive: async (): Promise<{ success: boolean }> => {
    const res = await fetch('/api/sync', { method: 'POST' });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to sync');
    }
    return res.json();
  }
};
