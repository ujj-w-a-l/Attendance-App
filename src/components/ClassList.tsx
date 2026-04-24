import React, { useState, useEffect, useMemo } from 'react';
import { Class } from '../types';
import { Plus, Users, Trash2, Cloud, CloudOff, RefreshCw, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { ConfirmDialog } from './ConfirmDialog';
import { api } from '../api';
import { isNativePlatform, showToast } from '../native-utils';
import * as db from '../db';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { toast } from 'sonner';

interface ClassListProps {
  classes: Class[];
  onSelectClass: (cls: Class) => void;
  onAddClass: (name: string) => void | Promise<void>;
  onDeleteClass: (id: number) => void;
}

export const ClassList: React.FC<ClassListProps> = ({ classes, onSelectClass, onAddClass, onDeleteClass }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [classToDelete, setClassToDelete] = useState<Class | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredClasses = useMemo(() => {
    return classes.filter(cls => 
      cls.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [classes, searchQuery]);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  useEffect(() => {
    checkAuthStatus();
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
      if (isNativePlatform()) {
        // Use native Google Sign-In on Android
        const user = await GoogleAuth.signIn();
        if (user && user.authentication) {
          // Store the tokens for Drive API access
          const tokens = {
            access_token: user.authentication.accessToken,
            id_token: user.authentication.idToken,
            refresh_token: user.authentication.refreshToken || null,
          };
          db.setSetting('google_tokens', JSON.stringify(tokens));
          await db.persist();
          setIsAuthenticated(true);
          await showToast('Connected to Google Drive');
          toast.success('Connected to Google Drive');
        }
      } else {
        // Web fallback: use the Google Identity Services popup
        const clientId = (window as any).__GOOGLE_CLIENT_ID__;
        if (!clientId) {
          toast.error('Google Client ID not configured. Please set VITE_GOOGLE_CLIENT_ID in your environment.');
          return;
        }

        const tokenClient = (window as any).google?.accounts?.oauth2?.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: async (response: any) => {
            if (response.access_token) {
              const tokens = { access_token: response.access_token };
              db.setSetting('google_tokens', JSON.stringify(tokens));
              await db.persist();
              setIsAuthenticated(true);
              toast.success('Connected to Google Drive');
            }
          },
        });

        if (tokenClient) {
          tokenClient.requestAccessToken();
        } else {
          toast.error('Google Identity Services not loaded. Please check your internet connection.');
        }
      }
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      const message = error?.message || 'Failed to connect to Google. Please try again.';
      if (isNativePlatform()) {
        await showToast(message, 'long');
      }
      toast.error(message);
    }
  };

  const handleDisconnect = async () => {
    try {
      if (isNativePlatform()) {
        try {
          await GoogleAuth.signOut();
        } catch {
          // Ignore sign-out errors
        }
      }
      await api.disconnectAuth();
      setIsAuthenticated(false);
      if (isNativePlatform()) {
        await showToast('Disconnected from Google Drive');
      }
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
      if (isNativePlatform()) {
        await showToast('Synced to Google Drive');
      }
      setTimeout(() => setSyncMessage(''), 3000);
    } catch (error: any) {
      console.error("Sync failed", error);
      const msg = error.message || 'Sync failed';
      setSyncMessage(msg);
      if (msg.includes('expired') || msg.includes('authentication')) {
        setIsAuthenticated(false);
      }
      setTimeout(() => setSyncMessage(''), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newClassName.trim();
    if (!name) return;
    try {
      await onAddClass(name);
      setNewClassName('');
      setIsAdding(false);
    } catch (error: any) {
      console.error('Failed to add class:', error);
      const message = error?.message || 'Failed to add class. Please try again.';
      if (isNativePlatform()) {
        await showToast(message, 'long');
      }
      toast.error(message);
    }
  };

  return (
    <>
      <div className="mb-6 relative group">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-black/30 group-focus-within:text-indigo-500 transition-colors">
          <Search size={20} />
        </div>
        <input
          type="text"
          placeholder="Search classes..."
          className="w-full bg-white border border-black/5 rounded-2xl py-4 pl-12 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-all"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-black/20 hover:text-black/40 transition-colors"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredClasses.map((cls) => (
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
