import * as db from './db';
import Papa from 'papaparse';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Get the stored Google access token.
 * Returns null if not authenticated.
 */
function getAccessToken(): string | null {
  const tokensJson = db.getSetting('google_tokens');
  if (!tokensJson) return null;
  try {
    const tokens = JSON.parse(tokensJson);
    return tokens.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Make an authenticated request to the Google Drive API.
 */
async function driveRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getAccessToken();
  if (!token) throw new Error('Not authenticated with Google');

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Token expired - clear tokens so user can re-authenticate
    db.deleteSetting('google_tokens');
    await db.persist();
    throw new Error('Google authentication expired. Please reconnect.');
  }

  return response;
}

/**
 * Find a folder by name (optionally under a parent folder).
 * Returns the folder ID or null if not found.
 */
async function findFolder(
  name: string,
  parentId?: string
): Promise<string | null> {
  let q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) {
    q += ` and '${parentId}' in parents`;
  }

  const response = await driveRequest(
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`
  );
  const data = await response.json();

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

/**
 * Create a folder in Google Drive.
 * Returns the folder ID.
 */
async function createFolder(
  name: string,
  parentId?: string
): Promise<string> {
  const metadata: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const response = await driveRequest(`${DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  const data = await response.json();
  return data.id;
}

/**
 * Find or create a folder by name.
 */
async function findOrCreateFolder(
  name: string,
  parentId?: string
): Promise<string> {
  const existingId = await findFolder(name, parentId);
  if (existingId) return existingId;
  return createFolder(name, parentId);
}

/**
 * Find a file by name in a specific folder.
 * Returns the file ID or null.
 */
async function findFile(
  name: string,
  parentId: string
): Promise<string | null> {
  const q = `name='${name}' and '${parentId}' in parents and trashed=false`;
  const response = await driveRequest(
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`
  );
  const data = await response.json();

  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

/**
 * Upload or update a CSV file in Google Drive.
 */
async function uploadCsv(
  fileName: string,
  csvContent: string,
  parentId: string
): Promise<void> {
  const existingFileId = await findFile(fileName, parentId);

  if (existingFileId) {
    // Update existing file
    await driveRequest(
      `${DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/csv' },
        body: csvContent,
      }
    );
  } else {
    // Create new file using multipart upload
    const metadata = {
      name: fileName,
      parents: [parentId],
    };

    const boundary = '-------classtrack_boundary';
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/csv\r\n\r\n` +
      `${csvContent}\r\n` +
      `--${boundary}--`;

    await driveRequest(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
  }
}

/**
 * Perform a full sync of all class attendance data to Google Drive.
 * Creates folder structure: ClassTrack Attendance / {ClassName} / {ClassName} - {Month}.csv
 */
export async function performDriveSync(): Promise<void> {
  const token = getAccessToken();
  if (!token) return;

  try {
    // Find or create main folder
    const mainFolderId = await findOrCreateFolder('ClassTrack Attendance');

    // Get all classes
    const classes = db.getAllClasses();

    for (const cls of classes) {
      // Find or create class folder
      const classFolderId = await findOrCreateFolder(cls.name, mainFolderId);

      // Generate CSV for current month
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
        .toISOString()
        .split('T')[0];
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        .toISOString()
        .split('T')[0];
      const monthName = now.toLocaleString('default', {
        month: 'long',
        year: 'numeric',
      });
      const fileName = `${cls.name} - ${monthName}.csv`;

      // Get export data
      const exportData = db.getExportData(cls.id, startOfMonth, endOfMonth);

      // Build CSV data
      const datesSet = new Set<string>();
      exportData.attendance.forEach((a) => datesSet.add(a.date));
      const dates = Array.from(datesSet).sort();

      const csvData = exportData.students.map((student) => {
        const row: any = { 'Student Name': student.name };
        dates.forEach((d) => {
          const record = exportData.attendance.find(
            (a) => a.student_id === student.id && a.date === d
          );
          row[d] = record ? record.status.toUpperCase() : 'N/A';
          if (record?.notes) {
            row[`${d} Notes`] = record.notes;
          }
        });
        return row;
      });

      const csv = Papa.unparse(csvData);

      // Upload to Drive
      await uploadCsv(fileName, csv, classFolderId);
    }
  } catch (error) {
    console.error('Drive sync error:', error);
    throw error;
  }
}
