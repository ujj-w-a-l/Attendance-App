import React from 'react';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children, title, onBack, actions }) => {
  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans transition-colors duration-300">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-black/5 px-4 py-4 sm:px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <button 
                onClick={onBack}
                className="p-2 hover:bg-black/5 rounded-full transition-colors"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {actions}
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
};
