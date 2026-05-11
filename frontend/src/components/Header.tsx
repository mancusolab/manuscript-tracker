import { useState } from 'react'
import { api, auth, type User } from '../api/client'

interface HeaderProps {
  user: User;
  lastSyncAt: string | null;
  onRefresh: () => void;
}

export default function Header({ user, lastSyncAt, onRefresh }: HeaderProps) {
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
