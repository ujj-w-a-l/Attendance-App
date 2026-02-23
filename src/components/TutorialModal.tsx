import React from 'react';
import { motion } from 'motion/react';
import { X, Users, CalendarCheck, Download, Trash2, Upload, MessageSquare, ArrowUpDown } from 'lucide-react';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TutorialModal: React.FC<TutorialModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const features = [
    {
      icon: <Users className="text-indigo-600" size={24} />,
      title: "Managing Classes & Students",
      description: "Create classes from the main dashboard. Inside a class, you can add students manually or import them in bulk using an Excel/CSV file. Use the 'Delete' button to remove students or entire classes."
    },
    {
      icon: <CalendarCheck className="text-emerald-600" size={24} />,
      title: "Taking Attendance",
      description: "Click 'Take Attendance' in any class. Simply tap a student's name or their status button to toggle between Present and Absent. Changes are saved automatically!"
    },
    {
      icon: <MessageSquare className="text-blue-600" size={24} />,
      title: "Adding Notes",
      description: "While taking attendance, click the 'Notes' button to reveal the notes column. You can add specific comments for any student's daily record."
    },
    {
      icon: <ArrowUpDown className="text-amber-600" size={24} />,
      title: "Sorting & Bulk Actions",
      description: "Sort students alphabetically or by attendance status. Use 'Select Multiple' to quickly mark several students as present or absent at once."
    },
    {
      icon: <Download className="text-purple-600" size={24} />,
      title: "Exporting Data",
      description: "Need a report? Click 'Export' to download a CSV file of your attendance records for any specific date range. You can do this from the class view or while taking attendance."
    }
  ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-2xl shadow-xl border border-black/5 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] pointer-events-auto"
        >
          <div className="p-6 border-b border-black/5 flex items-center justify-between bg-indigo-600 text-white">
            <div>
              <h2 className="font-bold text-2xl">Welcome to ClassTrack!</h2>
              <p className="text-indigo-100 mt-1">Here's a quick guide to get you started.</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
              <X size={24} />
            </button>
          </div>
          
          <div className="overflow-y-auto p-6 flex-1 space-y-6 bg-gray-50">
            {features.map((feature, index) => (
              <div key={index} className="flex gap-4 p-4 bg-white rounded-xl shadow-sm border border-black/5">
                <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center shrink-0">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="font-bold text-lg text-gray-900 mb-1">{feature.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
          
          <div className="p-6 border-t border-black/5 bg-white flex justify-end">
            <button
              onClick={onClose}
              className="px-8 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
            >
              Got it, let's go!
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
};
