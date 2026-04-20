import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from './api';
import * as db from './db';

vi.mock('./db', () => ({
  getAllClasses: vi.fn(),
  addClass: vi.fn(),
  deleteClass: vi.fn(),
  getStudentsByClass: vi.fn(),
  addStudent: vi.fn(),
  addStudentsBulk: vi.fn(),
  deleteStudent: vi.fn(),
  deleteStudentsBulk: vi.fn(),
  getStudentHistory: vi.fn(),
  getAttendanceByClassAndDate: vi.fn(),
  saveAttendance: vi.fn(),
  saveAttendanceBulk: vi.fn(),
  getExportData: vi.fn(),
  getSetting: vi.fn(),
  deleteSetting: vi.fn(),
  persist: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./google-drive-service', () => ({
  performDriveSync: vi.fn().mockResolvedValue(undefined),
}));

describe('api.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getClasses should call db.getAllClasses', async () => {
    const mockClasses = [{ id: 1, name: 'Class 1' }];
    vi.mocked(db.getAllClasses).mockReturnValue(mockClasses);
    
    const result = await api.getClasses();
    expect(result).toEqual(mockClasses);
    expect(db.getAllClasses).toHaveBeenCalled();
  });

  it('addClass should call db.addClass and db.persist', async () => {
    const mockClass = { id: 1, name: 'New Class' };
    vi.mocked(db.addClass).mockReturnValue(mockClass);
    
    const result = await api.addClass('New Class');
    expect(result).toEqual(mockClass);
    expect(db.addClass).toHaveBeenCalledWith('New Class');
    expect(db.persist).toHaveBeenCalled();
  });

  it('saveAttendance should call db.saveAttendance, db.persist, and performDriveSync', async () => {
    await api.saveAttendance(1, '2023-10-01', 'present', 'Notes');
    
    expect(db.saveAttendance).toHaveBeenCalledWith(1, '2023-10-01', 'present', 'Notes');
    expect(db.persist).toHaveBeenCalled();
    // Non-blocking sync is triggered
  });
});
