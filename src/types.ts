export interface Class {
  id: number;
  name: string;
}

export interface Student {
  id: number;
  class_id: number;
  name: string;
}

export interface AttendanceRecord {
  id?: number;
  student_id: number;
  date: string;
  status: 'present' | 'absent';
  session_name: string;
  notes?: string;
}

export interface ExportData {
  students: { id: number; name: string }[];
  attendance: { 
    student_id: number; 
    date: string; 
    status: string; 
    session_name: string;
    notes: string | null 
  }[];
}
