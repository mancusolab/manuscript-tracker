import { useState } from 'react'
import { api, auth, type User } from '../api/client'

interface HeaderProps {
  user: User;
  lastSyncAt: string | null;
  onRefresh: () => void;
  onSettings?: () => void;
}

export default function Header({ user, lastSyncAt, onRefresh, onSettings }: HeaderProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await api.triggerSync();
      onRefresh();
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-ink tracking-tight">
            Manuscript Tracker
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {lastSyncAt && (
            <span className="text-muted">
              Last sync: {new Date(lastSyncAt).toLocaleString()}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-secondary"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
          <div className="flex items-center gap-2 ml-2">
            {user.picture && (
              <img
                src={user.picture}
                alt={user.name}
                className="w-7 h-7 rounded-full"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="text-muted">{user.name}</span>
            {onSettings && (
              <button
                onClick={onSettings}
                className="text-muted hover:text-ink"
                title="Settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
              </button>
            )}
            <button
              onClick={() => auth.logout()}
              className="text-muted hover:text-ink underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
