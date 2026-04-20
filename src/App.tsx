import React, { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { ClassList } from './components/ClassList';
import { ClassDetail } from './components/ClassDetail';
import { AttendanceSheet } from './components/AttendanceSheet';
import { TutorialModal } from './components/TutorialModal';
import { ClassCardSkeleton } from './components/Skeleton';
import { Class } from './types';
import { api } from './api';
import { LogOut, HelpCircle } from 'lucide-react';
import { Toaster, toast } from 'sonner';

type View = 'dashboard' | 'classDetail' | 'attendance';

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  useEffect(() => {
    loadClasses();
  }, []);

  const loadClasses = async () => {
    setIsLoading(true);
    try {
      const data = await api.getClasses();
      setClasses(data);
    } catch (error) {
      console.error('Failed to load classes', error);
      toast.error('Failed to load classes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddClass = async (name: string) => {
    try {
      await api.addClass(name);
      loadClasses();
      toast.success('Class added successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add class');
    }
  };

  const handleDeleteClass = async (id: number) => {
    try {
      await api.deleteClass(id);
      loadClasses();
      toast.success('Class deleted successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete class');
    }
  };

  const handleSelectClass = (cls: Class) => {
    setSelectedClass(cls);
    setView('classDetail');
  };

  const handleBack = () => {
    if (view === 'attendance') {
      setView('classDetail');
    } else if (view === 'classDetail') {
      setView('dashboard');
      setSelectedClass(null);
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <ClassCardSkeleton key={i} />
          ))}
        </div>
      );
    }

    switch (view) {
      case 'dashboard':
        return (
          <ClassList
            classes={classes}
            onSelectClass={handleSelectClass}
            onAddClass={handleAddClass}
            onDeleteClass={handleDeleteClass}
          />
        );
      case 'classDetail':
        return selectedClass ? (
          <ClassDetail
            cls={selectedClass}
            onTakeAttendance={() => setView('attendance')}
          />
        ) : null;
      case 'attendance':
        return selectedClass ? (
          <AttendanceSheet cls={selectedClass} />
        ) : null;
      default:
        return null;
    }
  };

  const getTitle = () => {
    if (view === 'dashboard') return 'My Classes';
    if (view === 'classDetail') return selectedClass?.name || 'Class Detail';
    if (view === 'attendance') return `Attendance: ${selectedClass?.name}`;
    return 'ClassTrack';
  };

  return (
    <>
      <Toaster position="top-center" richColors />
      <Layout
        title={getTitle()}
        onBack={view !== 'dashboard' ? handleBack : undefined}
        actions={
          view === 'dashboard' ? (
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsTutorialOpen(true)}
                className="flex items-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl hover:bg-indigo-100 transition-colors shadow-sm"
              >
                <HelpCircle size={20} />
                <span>Tutorial</span>
              </button>
              <div className="flex items-center gap-2 text-black/40 text-sm font-medium">
                <span className="hidden sm:inline">Teacher Mode</span>
                <LogOut size={18} />
              </div>
            </div>
          ) : null
        }
      >
        {renderContent()}
      </Layout>
      <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
    </>
  );
}
