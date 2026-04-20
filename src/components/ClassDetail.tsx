import React, { useState, useEffect, useMemo } from 'react';
import { Class, Student, AttendanceRecord } from '../types';
import { api } from '../api';
import { UserPlus, Upload, Trash2, Check, X, History, ArrowUpDown, FileSpreadsheet, Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { ConfirmDialog } from './ConfirmDialog';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { exportCsvFile } from '../native-utils';
import { toast } from 'sonner';

interface ClassDetailProps {
  cls: Class;
  onTakeAttendance: () => void;
}

export const ClassDetail: React.FC<ClassDetailProps> = ({ cls, onTakeAttendance }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [newStudentName, setNewStudentName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  
  const [selectedStudents, setSelectedStudents] = useState<Set<number>>(new Set());
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  const [studentHistory, setStudentHistory] = useState<AttendanceRecord[]>([]);

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [exportEndDate, setExportEndDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd'));

  const [searchQuery, setSearchQuery] = useState('');

  const filteredStudents = useMemo(() => {
    const sorted = [...students].sort((a, b) => {
      return sortOrder === 'asc' 
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    });

    if (!searchQuery.trim()) return sorted;
    
    return sorted.filter(s => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [students, searchQuery, sortOrder]);

  useEffect(() => {
    loadStudents();
  }, [cls.id]);

  const loadStudents = async () => {
    const data = await api.getStudents(cls.id);
    setStudents(data);
  };

  const handleExport = async () => {
    try {
      const data = await api.getExportData(cls.id, exportStartDate, exportEndDate);
      
      // Pivot data: Rows are students, Columns are dates
      const datesSet = new Set<string>();
      data.attendance.forEach(a => datesSet.add(a.date));
      const dates = Array.from(datesSet).sort();
      
      const csvData = data.students.map(student => {
        const row: any = { 'Student Name': student.name };
        dates.forEach(d => {
          const record = data.attendance.find(a => a.student_id === student.id && a.date === d);
          row[d] = record ? record.status.toUpperCase() : 'ABSENT';
          if (record?.notes) {
            row[`${d} Notes`] = record.notes;
          }
        });
        return row;
      });
      const csv = Papa.unparse(csvData);
      await exportCsvFile(`attendance_${cls.name}_${exportStartDate}_to_${exportEndDate}.csv`, csv);
      setIsExportModalOpen(false);
      toast.success('Attendance exported successfully');
    } catch (error) {
      console.error('Export failed', error);
      toast.error('Failed to export attendance');
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newStudentName.trim()) {
      try {
        await api.addStudent(cls.id, newStudentName.trim());
        setNewStudentName('');
        setIsAdding(false);
        loadStudents();
        toast.success('Student added successfully');
      } catch (error: any) {
        toast.error(error.message || 'Failed to add student');
      }
    }
  };

  const handleDeleteStudent = async () => {
    if (studentToDelete) {
      try {
        await api.deleteStudent(studentToDelete.id);
        setStudentToDelete(null);
        setSelectedStudents(prev => {
          const next = new Set(prev);
          next.delete(studentToDelete.id);
          return next;
        });
        loadStudents();
        toast.success('Student deleted successfully');
      } catch (error: any) {
        toast.error(error.message || 'Failed to delete student');
      }
    }
  };

  const handleBulkDelete = async () => {
    if (selectedStudents.size > 0) {
      try {
        await api.deleteStudentsBulk(Array.from(selectedStudents));
        setSelectedStudents(new Set());
        setIsBulkDeleting(false);
        setIsDeleteMode(false);
        loadStudents();
        toast.success(`${selectedStudents.size} students deleted`);
      } catch (error: any) {
        toast.error(error.message || 'Failed to delete students');
      }
    }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        
        // Extract names from the first column, skipping empty rows
        const names = data
          .map(row => row[0])
          .filter(name => typeof name === 'string' && name.trim().length > 0);

        // Remove header if it looks like one
        if (names.length > 0 && ['name', 'student name', 'student'].includes(names[0].toLowerCase())) {
          names.shift();
        }

        if (names.length > 0) {
          try {
            await api.addStudentsBulk(cls.id, names);
            loadStudents();
            setIsImportModalOpen(false);
            toast.success(`Successfully imported ${names.length} students`);
          } catch (error: any) {
            toast.error(error.message || 'Failed to import students');
          }
        } else {
          toast.error('No valid names found in the first column of the file.');
        }
      } catch (error) {
        console.error('Error parsing file:', error);
        toast.error('Failed to parse the file. Please ensure it is a valid Excel or CSV file.');
      }
    };
    reader.readAsBinaryString(file);
    // Reset file input
    e.target.value = '';
  };

  const toggleSelectAll = () => {
    if (selectedStudents.size === students.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(students.map(s => s.id)));
    }
  };

  const toggleSelectStudent = (id: number) => {
    setSelectedStudents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const viewHistory = async (student: Student) => {
    setHistoryStudent(student);
    const history = await api.getStudentHistory(student.id);
    setStudentHistory(history);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">{cls.name}</h2>
          <p className="text-black/40">{students.length} Students enrolled</p>
        </div>
        <button
          onClick={onTakeAttendance}
          className="w-full sm:w-auto bg-indigo-600 text-white px-6 py-3.5 rounded-2xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95 text-center"
        >
          Take Attendance
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-black/5 overflow-hidden">
        <div className="p-4 border-b border-black/5 bg-black/[0.02] [0.02] flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center justify-between sm:justify-start gap-4 w-full sm:w-auto">
              <h3 className="font-semibold">Student Roster</h3>
              {isDeleteMode && selectedStudents.size > 0 && (
                <button
                  onClick={() => setIsBulkDeleting(true)}
                  className="text-sm font-medium text-red-600 bg-red-50 px-4 py-2 rounded-lg hover:bg-red-100 transition-colors"
                >
                  Delete Selected ({selectedStudents.size})
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
              <button
                onClick={() => setIsExportModalOpen(true)}
                className="justify-center bg-white border border-black/10 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-black/5 transition-colors flex items-center gap-2"
              >
                <Download size={18} />
                Export
              </button>
              <button
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="justify-center bg-white border border-black/10 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-black/5 transition-colors flex items-center gap-2"
              >
                <ArrowUpDown size={18} />
                Sort
              </button>
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="justify-center bg-white border border-black/10 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-black/5 transition-colors flex items-center gap-2"
              >
                <Upload size={18} />
                Import
              </button>
              <button
                onClick={() => {
                  setIsDeleteMode(!isDeleteMode);
                  if (isDeleteMode) setSelectedStudents(new Set());
                }}
                className={`justify-center border px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
 isDeleteMode ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-black/10 hover:bg-black/5'
 }`}
              >
                <Trash2 size={18} />
                {isDeleteMode ? 'Cancel' : 'Delete'}
              </button>
              <button
                onClick={() => setIsAdding(true)}
                className="justify-center bg-white border border-black/10 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-black/5 transition-colors flex items-center gap-2"
              >
                <UserPlus size={18} />
                Add Student
              </button>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-black/30 group-focus-within:text-indigo-500 transition-colors">
              <Search size={18} />
            </div>
            <input
              type="text"
              placeholder="Search students..."
              className="w-full bg-white border border-black/5 rounded-xl py-2.5 pl-10 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-black/20 hover:text-black/40 transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="divide-y divide-black/5">
          {isAdding && (
            <form onSubmit={handleAddStudent} className="p-4 bg-indigo-50/50 flex flex-col sm:flex-row gap-3">
              <input
                autoFocus
                type="text"
                placeholder="Student Full Name"
                className="flex-1 bg-white border border-indigo-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={newStudentName}
                onChange={(e) => setNewStudentName(e.target.value)}
              />
              <div className="flex gap-2">
                <button type="submit" className="flex-1 sm:flex-none flex justify-center items-center p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700">
                  <Check size={20} />
                </button>
                <button type="button" onClick={() => setIsAdding(false)} className="flex-1 sm:flex-none flex justify-center items-center p-3 bg-black/5 rounded-xl hover:bg-black/10">
                  <X size={20} />
                </button>
              </div>
            </form>
          )}

          {students.length > 0 && (
            <div className="p-4 flex items-center gap-3 bg-gray-50 text-xs font-bold uppercase tracking-wider text-black/40">
              {isDeleteMode && (
                <div className="w-6 shrink-0 flex justify-center">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    checked={selectedStudents.size === students.length && students.length > 0}
                    onChange={toggleSelectAll}
                  />
                </div>
              )}
              <div className="w-8 shrink-0">No.</div>
              <div className="flex-1">Name</div>
              <div className="w-24 text-right shrink-0">Actions</div>
            </div>
          )}

          {students.length === 0 && !isAdding ? (
            <div className="p-12 text-center text-black/30">
              <p>No students in this class yet.</p>
              <p className="text-sm">Add them manually or import a file.</p>
            </div>
          ) : (
            filteredStudents.map((student, index) => (
              <div key={student.id} className="p-4 flex items-center gap-3 group hover:bg-black/[0.01]">
                {isDeleteMode && (
                  <div className="w-6 shrink-0 flex justify-center">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={selectedStudents.has(student.id)}
                      onChange={() => toggleSelectStudent(student.id)}
                    />
                  </div>
                )}
                <div className="text-xs font-mono text-black/20 w-8 shrink-0">{index + 1}</div>
                <div className="font-medium flex-1 min-w-0 truncate">{student.name}</div>
                
                <div className="flex items-center gap-1 w-24 justify-end shrink-0">
                  <button
                    onClick={() => viewHistory(student)}
                    className="p-2 text-black/40 hover:text-indigo-600 transition-colors"
                    title="View History"
                  >
                    <History size={18} />
                  </button>
                  {isDeleteMode && (
                    <button
                      onClick={() => setStudentToDelete(student)}
                      className="p-2 text-black/20 hover:text-red-500 transition-colors"
                      title="Delete Student"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!studentToDelete}
        title="Delete Student"
        message={`Are you sure you want to delete "${studentToDelete?.name}"? Their attendance records will also be removed.`}
        confirmText="Delete"
        onConfirm={handleDeleteStudent}
        onCancel={() => setStudentToDelete(null)}
      />

      <ConfirmDialog
        isOpen={isBulkDeleting}
        title="Delete Students"
        message={`Are you sure you want to delete ${selectedStudents.size} selected students? Their attendance records will also be removed.`}
        confirmText="Delete All"
        onConfirm={handleBulkDelete}
        onCancel={() => setIsBulkDeleting(false)}
      />

      {/* History Modal */}
      <AnimatePresence>
        {historyStudent && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
              onClick={() => setHistoryStudent(null)}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white rounded-2xl shadow-xl border border-black/5 w-full max-w-md overflow-hidden flex flex-col max-h-[80vh] pointer-events-auto"
              >
                <div className="p-4 border-b border-black/5 flex items-center justify-between bg-gray-50">
                  <h3 className="font-bold text-lg">{historyStudent.name}'s History</h3>
                  <button onClick={() => setHistoryStudent(null)} className="p-2 hover:bg-black/5 rounded-full">
                    <X size={20} />
                  </button>
                </div>
                <div className="overflow-y-auto p-4 flex-1">
                  {studentHistory.length === 0 ? (
                    <p className="text-center text-black/40 py-8">No attendance records found.</p>
                  ) : (
                    <div className="space-y-3">
                      {studentHistory.map((record, i) => (
                        <div key={i} className="flex flex-col p-3 rounded-xl border border-black/5 bg-gray-50/50 [0.02]">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex flex-col">
                              <span className="font-medium text-sm">{format(new Date(record.date), 'MMM d, yyyy')}</span>
                              <span className="text-[10px] uppercase font-bold text-black/40">{record.session_name}</span>
                            </div>
                            <span className={`text-xs font-bold px-2 py-1 rounded-md ${
 record.status === 'present' ? 'bg-emerald-100 text-emerald-700 ' : 'bg-red-100 text-red-700 '
 }`}>
                              {record.status.toUpperCase()}
                            </span>
                          </div>
                          {record.notes && (
                            <p className="text-xs text-black/60 mt-1 italic">Note: {record.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Import Modal */}
      <AnimatePresence>
        {isImportModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
              onClick={() => setIsImportModalOpen(false)}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white rounded-2xl shadow-xl border border-black/5 w-full max-w-lg overflow-hidden flex flex-col pointer-events-auto"
              >
                <div className="p-4 border-b border-black/5 flex items-center justify-between bg-gray-50">
                  <h3 className="font-bold text-lg">Import Students</h3>
                  <button onClick={() => setIsImportModalOpen(false)} className="p-2 hover:bg-black/5 rounded-full">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6 space-y-6">
                  <div className="space-y-2">
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                      <FileSpreadsheet size={20} className="text-emerald-600" />
                      How to prepare your file
                    </h4>
                    <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
                      <li>Use Microsoft Excel, Google Sheets, or any spreadsheet software.</li>
                      <li>Put all student names in the <strong>first column (Column A)</strong>.</li>
                      <li>You can include a header row (e.g., "Name") or just start with names.</li>
                      <li>Save or export the file as <strong>.xlsx</strong>, <strong>.xls</strong>, or <strong>.csv</strong>.</li>
                    </ul>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <p className="text-sm font-medium text-gray-700 mb-2">Example format:</p>
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr>
                          <th className="border border-gray-300 px-3 py-1 bg-gray-100 w-1/2">A (Names)</th>
                          <th className="border border-gray-300 px-3 py-1 bg-gray-100 w-1/2 text-gray-400 font-normal italic">B (Optional)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="border border-gray-300 px-3 py-1 font-medium">John Doe</td>
                          <td className="border border-gray-300 px-3 py-1 text-gray-400">...</td>
                        </tr>
                        <tr>
                          <td className="border border-gray-300 px-3 py-1 font-medium">Jane Smith</td>
                          <td className="border border-gray-300 px-3 py-1 text-gray-400">...</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-center pt-2">
                    <label className="cursor-pointer bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95 flex items-center gap-2">
                      <Upload size={20} />
                      Select File to Import
                      <input 
                        type="file" 
                        accept=".xlsx, .xls, .csv" 
                        className="hidden" 
                        onChange={handleFileImport} 
                      />
                    </label>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
      {/* Export Modal */}
      <AnimatePresence>
        {isExportModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
              onClick={() => setIsExportModalOpen(false)}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white rounded-2xl shadow-xl border border-black/5 w-full max-w-sm overflow-hidden pointer-events-auto"
              >
                <div className="p-4 border-b border-black/5 flex items-center justify-between bg-gray-50">
                  <h3 className="font-bold text-lg">Export Attendance</h3>
                  <button onClick={() => setIsExportModalOpen(false)} className="p-2 hover:bg-black/5 rounded-full">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                    <input
                      type="date"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                    />
                  </div>
                  <div className="pt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setExportStartDate(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
                        setExportEndDate(format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), 'yyyy-MM-dd'));
                      }}
                      className="text-xs font-medium text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
                    >
                      This Month
                    </button>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 flex gap-3 justify-end">
                  <button
                    onClick={() => setIsExportModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExport}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors flex items-center gap-2"
                  >
                    <Download size={16} />
                    Download CSV
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

