import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { initDatabase } from './db';
import './index.css';

function Root() {
  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDatabase()
      .then(() => setDbReady(true))
      .catch((err) => {
        console.error('Failed to initialize database:', err);
        const detail = err?.message || String(err);
        setError(`Failed to initialize the database. Please restart the app.\n\nDetails: ${detail}`);
      });
  }, []);

  if (error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: '2rem',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div>
          <p style={{ fontSize: '1.25rem', fontWeight: 600, color: '#dc2626', marginBottom: '0.5rem' }}>
            Initialization Error
          </p>
          <p style={{ color: '#6b7280', whiteSpace: 'pre-wrap' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!dbReady) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '1rem',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          width: '3rem',
          height: '3rem',
          border: '3px solid #e5e7eb',
          borderTopColor: '#6366f1',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <p style={{ color: '#6b7280', fontWeight: 500 }}>Loading ClassTrack...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
