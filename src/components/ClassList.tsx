import React, { useState, useEffect } from 'react';
import { Class } from '../types';
import { Plus, Users, Trash2, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { ConfirmDialog } from './ConfirmDialog';
import { api } from '../api';

interface ClassListProps {
  classes: Class[];
  onSelectClass: (cls: Class) => void;
  onAddClass: (name: string) => void;
  onDeleteClass: (id: number) => void;
}

export const ClassList: React.FC<ClassListProps> = ({ classes, onSelectClass, onAddClass, onDeleteClass }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [classToDelete, setClassToDelete] = useState<Class | null>(null);
  
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    checkAuthStatus();
    
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        checkAuthStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkAuthStatus = async () => {
    try {
      const { authenticated } = await api.getAuthStatus();
      setIsAuthenticated(authenticated);
    } catch (error) {
      console.error("Failed to check auth status", error);
    }
  };

  const handleConnect = async () => {
    try {
      const { url } = await api.getAuthUrl();
      const authWindow = window.open(url, 'oauth_popup', 'width=600,height=700');
      if (!authWindow) {
        alert('Please allow popups for this site to connect your Google account.');
      }
    } catch (error) {
      console.error('OAuth error:', error);
      alert('Failed to initiate Google connection. Please check your credentials.');
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.disconnectAuth();
      setIsAuthenticated(false);
    } catch (error) {
      console.error("Failed to disconnect", error);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMessage('Syncing...');
    try {
      await api.syncToDrive();
      setSyncMessage('Synced successfully!');
      setTimeout(() => setSyncMessage(''), 3000);
    } catch (error: any) {
      console.error("Sync failed", error);
      setSyncMessage(error.message || 'Sync failed');
      setTimeout(() => setSyncMessage(''), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newClassName.trim()) {
      onAddClass(newClassName.trim());
      setNewClassName('');
      setIsAdding(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {classes.map((cls) => (
          <motion.div
            key={cls.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-black/5 cursor-pointer group relative flex flex-col justify-between min-h-[140px]"
            onClick={() => onSelectClass(cls)}
          >
            <div className="flex items-start gap-4 mb-2">
              <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 shrink-0">
                <Users size={24} />
              </div>
              <div className="flex-1 pr-8">
                <h3 className="font-semibold text-lg leading-tight mb-1">{cls.name}</h3>
                <p className="text-sm text-black/40">Manage students & attendance</p>
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setClassToDelete(cls);
              }}
              className="absolute top-4 right-4 p-3 text-black/20 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity bg-white sm:bg-transparent rounded-full shadow-sm sm:shadow-none border sm:border-transparent border-black/5"
            >
              <Trash2 size={18} />
            </button>
          </motion.div>
        ))}

        {isAdding ? (
          <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl shadow-sm border-2 border-dashed border-indigo-200 flex flex-col justify-center min-h-[140px]">
            <input
              autoFocus
              type="text"
              placeholder="Class Name (e.g. Grade 10-A)"
              className="w-full bg-transparent border-b-2 border-indigo-500 py-2 mb-4 focus:outline-none font-medium text-lg"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
            />
            <div className="flex gap-2 mt-auto">
              <button
                type="submit"
                className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="flex-1 bg-black/5 py-3 rounded-xl font-bold hover:bg-black/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="border-2 border-dashed border-black/10 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 text-black/40 hover:border-indigo-300 hover:text-indigo-500 transition-all min-h-[140px]"
          >
            <div className="w-12 h-12 bg-black/5 rounded-full flex items-center justify-center group-hover:bg-indigo-50">
              <Plus size={24} />
            </div>
            <span className="font-medium">Add New Class</span>
          </button>
        )}
      </div>

      <div className="mt-12 flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-3 rounded-xl shadow-sm border border-black/5 max-w-md mx-auto">
        <div className="flex items-center gap-2">
          <Cloud size={20} className="text-indigo-600" />
          <div>
            <h2 className="font-semibold text-sm">Google Drive Sync</h2>
            <p className="text-xs text-black/40">Auto-syncs monthly attendance</p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {isAuthenticated ? (
            <>
              {syncMessage && <span className="text-xs font-medium text-indigo-600">{syncMessage}</span>}
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                Sync
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center justify-center p-1.5 text-black/40 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Disconnect Google Drive"
              >
                <CloudOff size={16} />
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-white border border-black/10 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-black/5 transition-colors"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!classToDelete}
        title="Delete Class"
        message={`Are you sure you want to delete "${classToDelete?.name}"? All students and attendance records will be permanently removed.`}
        confirmText="Delete"
        onConfirm={() => classToDelete && onDeleteClass(classToDelete.id)}
        onCancel={() => setClassToDelete(null)}
      />
    </>
  );
};
