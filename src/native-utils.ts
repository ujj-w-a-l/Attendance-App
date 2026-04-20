import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Toast } from '@capacitor/toast';

/**
 * Check if the app is running on a native platform (Android/iOS).
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Show a native toast notification.
 */
export async function showToast(text: string, duration: 'short' | 'long' = 'short'): Promise<void> {
  if (isNativePlatform()) {
    await Toast.show({ text, duration });
  }
}

/**
 * Save a CSV file and share it (on native) or trigger a download (on web).
 * On Android, saves to the app's Documents directory and opens a share sheet.
 * On web, creates a blob download link.
 */
export async function exportCsvFile(
  fileName: string,
  csvContent: string
): Promise<void> {
  if (isNativePlatform()) {
    try {
      // Write file to Documents directory
      const result = await Filesystem.writeFile({
        path: fileName,
        data: csvContent,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });

      // Share the file
      await Share.share({
        title: fileName,
        text: `Attendance export: ${fileName}`,
        url: result.uri,
        dialogTitle: 'Export Attendance',
      });

      await showToast('File exported successfully');
    } catch (error) {
      console.error('Export error:', error);
      // Fallback to web download
      await webDownload(fileName, csvContent);
    }
  } else {
    await webDownload(fileName, csvContent);
  }
}

/**
 * Web-based file download (fallback for non-native platforms).
 */
async function webDownload(fileName: string, content: string): Promise<void> {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });

  // Use the File System Access API if available (Chrome, Edge, etc.)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'CSV File',
            accept: { 'text/csv': ['.csv'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      // If user aborts, don't fall back to standard download
      if (err.name === 'AbortError') {
        return;
      }
      console.error('showSaveFilePicker failed:', err);
    }
  }

  // Fallback for browsers that don't support showSaveFilePicker (Safari, Firefox)
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
