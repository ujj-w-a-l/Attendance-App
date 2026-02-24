import React, { useState, useEffect } from 'react';
import { Class, Student, AttendanceRecord } from '../types';
import { api } from '../api';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { CheckCircle2, XCircle, Download, Calendar as CalendarIcon, MessageSquare, CheckSquare, Square, ArrowUpDown, X, ListChecks } from 'lucide-react';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'motion/react';
import { exportCsvFile } from '../native-utils';

interface AttendanceSheetProps {
  cls: Class;
}

export const AttendanceSheet: React.FC<AttendanceSheetProps> = ({ cls }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [attendance, setAttendance] = useState<Record<number, { status: 'present' | 'absent', notes: string }>>({});
  
  const [isSelectMultiple, setIsSelectMultiple] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  
  const [selectedStudents, setSelectedStudents] = useState<Set<number>>(new Set());
  const [sortOrder, setSortOrder] = useState<'name-asc' | 'name-desc' | 'status'>('name-asc');
  
  const [activeNoteStudent, setActiveNoteStudent] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [exportEndDate, setExportEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  useEffect(() => {
    loadData();
  }, [cls.id, date]);

  const loadData = async () => {
    const [studentList, attendanceList] = await Promise.all([
      api.getStudents(cls.id),
      api.getAttendance(cls.id, date)
    ]);

    setStudents(studentList);
    
    const initialAttendance: Record<number, { status: 'present' | 'absent', notes: string }> = {};
    studentList.forEach(s => {
      const record = attendanceList.find(a => a.student_id === s.id);
      initialAttendance[s.id] = {
        status: record ? record.status : 'present',
        notes: record?.notes || ''
      };
    });
    setAttendance(initialAttendance);
    setSelectedStudents(new Set());
  };

  const toggleStatus = async (studentId: number) => {
    const currentStatus = attendance[studentId]?.status || 'present';
    const newStatus = currentStatus === 'present' ? 'absent' : 'present';
    const currentNotes = attendance[studentId]?.notes || '';
    
    setAttendance(prev => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        status: newStatus
      }
    }));
    
    try {
      await api.saveAttendance(studentId, date, newStatus, currentNotes);
    } catch (error) {
      console.error('Failed to save attendance', error);
      // Revert on failure
      setAttendance(prev => ({
        ...prev,
        [studentId]: {
          ...prev[studentId],
          status: currentStatus
        }
      }));
    }
  };

  const handleExport = async () => {
    const data = await api.getExportData(cls.id, exportStartDate, exportEndDate);
    
    // Pivot data: Rows are students, Columns are dates
    const datesSet = new Set<string>();
    data.attendance.forEach(a => datesSet.add(a.date));
    const dates = Array.from(datesSet).sort();
    
    const csvData = data.students.map(student => {
      const row: any = { 'Student Name': student.name };
      dates.forEach(d => {
        const record = data.attendance.find(a => a.student_id === student.id && a.date === d);
        row[d] = record ? record.status.toUpperCase() : 'N/A';
        if (record?.notes) {
          row[`${d} Notes`] = record.notes;
        }
      });
      return row;
    });

    const csv = Papa.unparse(csvData);
    await exportCsvFile(`attendance_${cls.name}_${exportStartDate}_to_${exportEndDate}.csv`, csv);
    setIsExportModalOpen(false);
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

  const bulkMark = async (status: 'present' | 'absent') => {
    const recordsToSave: AttendanceRecord[] = [];
    
    setAttendance(prev => {
      const next = { ...prev };
      selectedStudents.forEach(id => {
        if (next[id]) {
          next[id] = { ...next[id], status };
          recordsToSave.push({
            student_id: id,
            date,
            status,
            notes: next[id].notes
          });
        }
      });
      return next;
    });
    
    setSelectedStudents(new Set());
    
    if (recordsToSave.length > 0) {
      try {
        await api.saveAttendanceBulk(recordsToSave);
      } catch (error) {
        console.error('Failed to save bulk attendance', error);
      }
    }
  };

  const saveNote = async () => {
    if (activeNoteStudent !== null) {
      const currentStatus = attendance[activeNoteStudent]?.status || 'present';
      
      setAttendance(prev => ({
        ...prev,
        [activeNoteStudent]: {
          ...prev[activeNoteStudent],
          notes: noteText
        }
      }));
      
      const studentId = activeNoteStudent;
      setActiveNoteStudent(null);
      
      try {
        await api.saveAttendance(studentId, date, currentStatus, noteText);
      } catch (error) {
        console.error('Failed to save note', error);
      }
    }
  };

  const sortedStudents = [...students].sort((a, b) => {
    if (sortOrder === 'name-asc') return a.name.localeCompare(b.name);
    if (sortOrder === 'name-desc') return b.name.localeCompare(a.name);
    if (sortOrder === 'status') {
      const statusA = attendance[a.id]?.status || 'present';
      const statusB = attendance[b.id]?.status || 'present';
      if (statusA === statusB) return a.name.localeCompare(b.name);
      return statusA === 'present' ? -1 : 1;
    }
    return 0;
  });

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-black/5">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
            <CalendarIcon size={20} />
          </div>
          <input
            type="date"
            className="font-semibold text-lg focus:outline-none bg-transparent w-full sm:w-auto"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white border border-black/10 px-4 py-2.5 rounded-xl font-medium hover:bg-black/5 transition-colors"
          >
            <Download size={18} />
            Export attendance
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-black/5 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b border-black/5 bg-black/[0.02] gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            {isSelectMultiple && (
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 text-sm font-medium text-black/60 hover:text-black transition-colors py-2"
              >
                {selectedStudents.size === students.length && students.length > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                Select All
              </button>
            )}
            {isSelectMultiple && selectedStudents.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-2 py-1.5 rounded-md">
                  {selectedStudents.size} selected
                </span>
                <button
                  onClick={() => bulkMark('present')}
                  className="text-sm font-medium text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg hover:bg-emerald-100 transition-colors"
                >
                  Mark Present
                </button>
                <button
                  onClick={() => bulkMark('absent')}
                  className="text-sm font-medium text-red-600 bg-red-50 px-4 py-2 rounded-lg hover:bg-red-100 transition-colors"
                >
                  Mark Absent
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
            <div className="flex items-center gap-2 w-full sm:w-auto mb-2 sm:mb-0">
              <span className="text-sm font-medium text-black/40 whitespace-nowrap">Sort by:</span>
              <select
                className="bg-white border border-black/10 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 sm:flex-none"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
              >
                <option value="name-asc">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="status">Status</option>
              </select>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => {
                  setIsSelectMultiple(!isSelectMultiple);
                  if (isSelectMultiple) setSelectedStudents(new Set());
                }}
                className={`flex-1 sm:flex-none justify-center border px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                  isSelectMultiple ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-black/10 hover:bg-black/5'
                }`}
              >
                <ListChecks size={18} />
                Select Multiple
              </button>
              <button
                onClick={() => setShowNotes(!showNotes)}
                className={`flex-1 sm:flex-none justify-center border px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 ${
                  showNotes ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-black/10 hover:bg-black/5'
                }`}
              >
                <MessageSquare size={18} />
                Notes
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-black/5 bg-indigo-50/50 text-indigo-700 text-sm flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <CheckCircle2 size={18} />
          </div>
          <p>
            <strong>How to take attendance:</strong> Click on a student's name or their status button to toggle between Present and Absent. Changes are saved automatically.
          </p>
        </div>

        <div className="flex items-center p-4 border-b border-black/5 bg-gray-50 text-xs font-bold uppercase tracking-wider text-black/40 gap-3">
          {isSelectMultiple && <div className="w-6 shrink-0"></div>}
          <div className="flex-1">Student Name</div>
          <div className="w-[100px] text-center shrink-0">Status</div>
          {showNotes && <div className="w-10 text-center shrink-0">Notes</div>}
        </div>

        <div className="divide-y divide-black/5">
          {sortedStudents.map((student) => {
            const data = attendance[student.id] || { status: 'present', notes: '' };
            const status = data.status;
            const hasNote = data.notes.trim().length > 0;

            return (
              <div 
                key={student.id} 
                className="flex items-center p-4 hover:bg-black/[0.01] transition-colors gap-3"
              >
                {isSelectMultiple && (
                  <div className="flex justify-center shrink-0 w-6">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      checked={selectedStudents.has(student.id)}
                      onChange={() => toggleSelectStudent(student.id)}
                    />
                  </div>
                )}
                <div 
                  className="font-medium cursor-pointer flex-1 min-w-0"
                  onClick={() => toggleStatus(student.id)}
                >
                  <div className="truncate">{student.name}</div>
                  {showNotes && hasNote && (
                    <p className="text-xs text-black/40 font-normal truncate mt-0.5">
                      {data.notes}
                    </p>
                  )}
                </div>
                <div className="flex justify-center cursor-pointer shrink-0 w-[100px]" onClick={() => toggleStatus(student.id)}>
                  <div className={`
                    flex items-center justify-center gap-1.5 w-full py-1.5 rounded-full text-sm font-bold transition-all
                    ${status === 'present' 
                      ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                      : 'bg-red-50 text-red-600 border border-red-100'}
                  `}>
                    {status === 'present' ? (
                      <>
                        <CheckCircle2 size={16} />
                        Present
                      </>
                    ) : (
                      <>
                        <XCircle size={16} />
                        Absent
                      </>
                    )}
                  </div>
                </div>
                {showNotes && (
                  <div className="flex justify-center shrink-0 w-10">
                    <button
                      onClick={() => {
                        setActiveNoteStudent(student.id);
                        setNoteText(data.notes);
                      }}
                      className={`p-2 rounded-xl transition-colors ${hasNote ? 'text-indigo-600 bg-indigo-50' : 'text-black/20 hover:text-indigo-600 hover:bg-indigo-50'}`}
                    >
                      <MessageSquare size={18} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {students.length === 0 && (
            <div className="p-12 text-center text-black/30 col-span-full">
              No students found for this class.
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-8 text-xs text-black/40 font-medium uppercase tracking-widest py-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          Present: {Object.values(attendance).filter(s => (s as {status: string}).status === 'present').length}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          Absent: {Object.values(attendance).filter(s => (s as {status: string}).status === 'absent').length}
        </div>
      </div>

      {/* Note Modal */}
      <AnimatePresence>
        {activeNoteStudent !== null && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
              onClick={() => setActiveNoteStudent(null)}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white rounded-2xl shadow-xl border border-black/5 w-full max-w-sm overflow-hidden pointer-events-auto"
              >
                <div className="p-4 border-b border-black/5 flex items-center justify-between bg-gray-50">
                  <h3 className="font-bold text-lg">Add Note</h3>
                  <button onClick={() => setActiveNoteStudent(null)} className="p-2 hover:bg-black/5 rounded-full">
                    <X size={20} />
                  </button>
                </div>
                <div className="p-4">
                  <textarea
                    autoFocus
                    className="w-full h-32 p-3 border border-black/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    placeholder="Add comments about attendance, behavior, etc."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                </div>
                <div className="bg-gray-50 px-4 py-3 flex gap-3 justify-end">
                  <button
                    onClick={() => setActiveNoteStudent(null)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveNote}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                  >
                    Save Note
                  </button>
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
                        setExportStartDate(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
                        setExportEndDate(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
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
