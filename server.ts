import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import Papa from "papaparse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("attendance.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY (class_id) REFERENCES classes (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    UNIQUE(student_id, date)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

try {
  db.exec(`ALTER TABLE attendance ADD COLUMN notes TEXT`);
} catch (e) {
  // Ignore if column already exists
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  
  // Classes
  app.get("/api/classes", (req, res) => {
    const classes = db.prepare("SELECT * FROM classes").all();
    res.json(classes);
  });

  app.post("/api/classes", (req, res) => {
    const { name } = req.body;
    const info = db.prepare("INSERT INTO classes (name) VALUES (?)").run(name);
    res.json({ id: info.lastInsertRowid, name });
  });

  app.delete("/api/classes/:id", (req, res) => {
    db.prepare("DELETE FROM classes WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Students
  app.get("/api/classes/:classId/students", (req, res) => {
    const students = db.prepare("SELECT * FROM students WHERE class_id = ?").all(req.params.classId);
    res.json(students);
  });

  app.post("/api/classes/:classId/students", (req, res) => {
    const { name } = req.body;
    const info = db.prepare("INSERT INTO students (class_id, name) VALUES (?, ?)").run(req.params.classId, name);
    res.json({ id: info.lastInsertRowid, class_id: req.params.classId, name });
  });

  app.post("/api/classes/:classId/students/bulk", (req, res) => {
    const { students } = req.body; // Array of names
    const insert = db.prepare("INSERT INTO students (class_id, name) VALUES (?, ?)");
    const insertMany = db.transaction((classId, studentNames) => {
      for (const name of studentNames) insert.run(classId, name);
    });
    insertMany(req.params.classId, students);
    res.json({ success: true });
  });

  app.delete("/api/students/:id", (req, res) => {
    db.prepare("DELETE FROM students WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/students/bulk-delete", (req, res) => {
    const { ids } = req.body;
    const del = db.prepare("DELETE FROM students WHERE id = ?");
    const delMany = db.transaction((studentIds) => {
      for (const id of studentIds) del.run(id);
    });
    delMany(ids);
    res.json({ success: true });
  });

  app.get("/api/students/:studentId/attendance", (req, res) => {
    const attendance = db.prepare(`
      SELECT date, status, notes FROM attendance 
      WHERE student_id = ? 
      ORDER BY date DESC
    `).all(req.params.studentId);
    res.json(attendance);
  });

  // Attendance
  app.get("/api/classes/:classId/attendance", (req, res) => {
    const { date } = req.query;
    const attendance = db.prepare(`
      SELECT a.* FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE s.class_id = ? AND a.date = ?
    `).all(req.params.classId, date);
    res.json(attendance);
  });

  app.post("/api/attendance", (req, res) => {
    const { student_id, date, status, notes } = req.body;
    const info = db.prepare(`
      INSERT INTO attendance (student_id, date, status, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, notes = excluded.notes
    `).run(student_id, date, status, notes || null);
    
    // Trigger background sync
    performDriveSync();
    
    res.json({ success: true });
  });

  // Bulk Attendance (for saving a whole day)
  app.post("/api/attendance/bulk", (req, res) => {
    const { records } = req.body; // Array of { student_id, date, status, notes }
    const upsert = db.prepare(`
      INSERT INTO attendance (student_id, date, status, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, notes = excluded.notes
    `);
    const upsertMany = db.transaction((records) => {
      for (const record of records) {
        upsert.run(record.student_id, record.date, record.status, record.notes || null);
      }
    });
    upsertMany(records);
    
    // Trigger background sync
    performDriveSync();
    
    res.json({ success: true });
  });

  // Export Data
  app.get("/api/export/:classId", (req, res) => {
    const { startDate, endDate } = req.query;
    
    const students = db.prepare("SELECT id, name FROM students WHERE class_id = ? ORDER BY name ASC").all(req.params.classId);
    
    let attQuery = `SELECT student_id, date, status, notes FROM attendance WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)`;
    const attParams: any[] = [req.params.classId];
    
    if (startDate && endDate) {
      attQuery += ` AND date >= ? AND date <= ?`;
      attParams.push(startDate, endDate);
    }
    attQuery += ` ORDER BY date ASC`;
    
    const attendance = db.prepare(attQuery).all(...attParams);
    
    res.json({ students, attendance });
  });

  // Google OAuth & Drive Sync
  const getOAuthClient = (req?: express.Request) => {
    // For background sync, we might not have a request object, but redirectUri is only needed for initial auth
    const redirectUri = req ? `${process.env.APP_URL || `${req.protocol}://${req.get('host')}`}/auth/callback` : process.env.APP_URL ? `${process.env.APP_URL}/auth/callback` : 'http://localhost:3000/auth/callback';
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  };

  async function performDriveSync() {
    const tokensRow = db.prepare("SELECT value FROM settings WHERE key = 'google_tokens'").get() as { value: string } | undefined;
    if (!tokensRow) return;

    try {
      const tokens = JSON.parse(tokensRow.value);
      const oauth2Client = getOAuthClient();
      oauth2Client.setCredentials(tokens);

      // Handle token refresh if necessary
      oauth2Client.on('tokens', (newTokens) => {
        const updatedTokens = { ...tokens, ...newTokens };
        db.prepare("INSERT INTO settings (key, value) VALUES ('google_tokens', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(updatedTokens));
      });

      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      // Find or create main "ClassTrack Attendance" folder
      let mainFolderId: string;
      const mainFolderRes = await drive.files.list({
        q: "name='ClassTrack Attendance' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: "files(id, name)",
      });

      if (mainFolderRes.data.files && mainFolderRes.data.files.length > 0) {
        mainFolderId = mainFolderRes.data.files[0].id!;
      } else {
        const folderMetadata = {
          name: 'ClassTrack Attendance',
          mimeType: 'application/vnd.google-apps.folder',
        };
        const folder = await drive.files.create({
          requestBody: folderMetadata,
          fields: 'id',
        });
        mainFolderId = folder.data.id!;
      }

      const classes = db.prepare("SELECT * FROM classes").all() as { id: number, name: string }[];
      
      for (const cls of classes) {
        // Find or create class folder inside main folder
        let classFolderId: string;
        const classFolderRes = await drive.files.list({
          q: `name='${cls.name}' and '${mainFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: "files(id, name)",
        });

        if (classFolderRes.data.files && classFolderRes.data.files.length > 0) {
          classFolderId = classFolderRes.data.files[0].id!;
        } else {
          const folderMetadata = {
            name: cls.name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [mainFolderId]
          };
          const folder = await drive.files.create({
            requestBody: folderMetadata,
            fields: 'id',
          });
          classFolderId = folder.data.id!;
        }

        // Generate CSV for current month
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
        const fileName = `${cls.name} - ${monthName}.csv`;

        const students = db.prepare("SELECT id, name FROM students WHERE class_id = ? ORDER BY name ASC").all(cls.id) as { id: number, name: string }[];
        
        let attQuery = `SELECT student_id, date, status, notes FROM attendance WHERE student_id IN (SELECT id FROM students WHERE class_id = ?) AND date >= ? AND date <= ? ORDER BY date ASC`;
        const attendance = db.prepare(attQuery).all(cls.id, startOfMonth, endOfMonth) as { student_id: number, date: string, status: string, notes: string }[];
        
        const datesSet = new Set<string>();
        attendance.forEach(a => datesSet.add(a.date));
        const dates = Array.from(datesSet).sort();
        
        const csvData = students.map(student => {
          const row: any = { 'Student Name': student.name };
          dates.forEach(d => {
            const record = attendance.find(a => a.student_id === student.id && a.date === d);
            row[d] = record ? record.status.toUpperCase() : 'N/A';
            if (record?.notes) {
              row[`${d} Notes`] = record.notes;
            }
          });
          return row;
        });

        const csv = Papa.unparse(csvData);

        // Check if file already exists for this month
        const fileRes = await drive.files.list({
          q: `name='${fileName}' and '${classFolderId}' in parents and trashed=false`,
          fields: "files(id, name)",
        });

        const fileMetadata = {
          name: fileName,
          parents: [classFolderId]
        };
        const media = {
          mimeType: 'text/csv',
          body: csv
        };

        if (fileRes.data.files && fileRes.data.files.length > 0) {
          // Update existing file
          await drive.files.update({
            fileId: fileRes.data.files[0].id!,
            media: media
          });
        } else {
          // Create new file
          await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id'
          });
        }
      }
    } catch (error) {
      console.error("Background sync error:", error);
    }
  }

  app.get("/api/auth/url", (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(400).json({ error: "Google OAuth credentials not configured" });
    }
    const oauth2Client = getOAuthClient(req);
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/drive.file"],
      prompt: "consent"
    });
    res.json({ url });
  });

  app.get(["/auth/callback", "/auth/callback/"], async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).send("No code provided");

    try {
      const oauth2Client = getOAuthClient(req);
      const { tokens } = await oauth2Client.getToken(code);
      
      db.prepare("INSERT INTO settings (key, value) VALUES ('google_tokens', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(tokens));

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("OAuth callback error:", error);
      res.status(500).send("Authentication failed");
    }
  });

  app.get("/api/auth/status", (req, res) => {
    const tokensRow = db.prepare("SELECT value FROM settings WHERE key = 'google_tokens'").get() as { value: string } | undefined;
    res.json({ authenticated: !!tokensRow });
  });

  app.post("/api/auth/disconnect", (req, res) => {
    db.prepare("DELETE FROM settings WHERE key = 'google_tokens'").run();
    res.json({ success: true });
  });

  app.post("/api/sync", async (req, res) => {
    const tokensRow = db.prepare("SELECT value FROM settings WHERE key = 'google_tokens'").get() as { value: string } | undefined;
    if (!tokensRow) {
      return res.status(401).json({ error: "Not authenticated with Google" });
    }

    try {
      await performDriveSync();
      res.json({ success: true });
    } catch (error) {
      console.error("Sync error:", error);
      res.status(500).json({ error: "Failed to sync with Google Drive" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
