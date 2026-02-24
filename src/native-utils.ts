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
      webDownload(fileName, csvContent);
    }
  } else {
    webDownload(fileName, csvContent);
  }
}

/**
 * Web-based file download (fallback for non-native platforms).
 */
function webDownload(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
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
