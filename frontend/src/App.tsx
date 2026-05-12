import { useState, useEffect, useCallback } from 'react'
import { api, auth, type Section, type ActivityItem, type User } from './api/client'
import Header from './components/Header'
import SectionList from './components/SectionList'
import ActivityTimeline from './components/ActivityTimeline'
import ProgressForm from './components/ProgressForm'
import ProgressBar from './components/ProgressBar'
import LoginPage from './components/LoginPage'
import SetupPage from './components/SetupPage'
import SettingsPage from './components/SettingsPage'
import SharedDashboard from './components/SharedDashboard'

type AppState = 'loading' | 'logged_out' | 'onboarding' | 'dashboard' | 'shared';

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [shareSlug, setShareSlug] = useState<string | null>(null);

  useEffect(() => {
    // Check if this is a /share/:slug URL
    const match = window.location.pathname.match(/^\/share\/([^/]+)/);
    if (match) {
      setShareSlug(match[1]);
      setAppState('shared');
      return;
    }

    auth.me().then(u => {
      if (!u) {
        setAppState('logged_out');
      } else if (!u.google_doc_id) {
        setUser(u);
        setAppState('onboarding');
      } else {
        setUser(u);
        setAppState('dashboard');
      }
    }).catch(() => {
      setAppState('logged_out');
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [sectionsData, activityData] = await Promise.all([
        api.getSections(),
        api.getActivity(),
      ]);
      setSections(sectionsData);
      setActivity(activityData);
      setLastSyncAt(new Date().toISOString());
      setRefreshKey(k => k + 1);
    } catch (e) {
      console.error('Failed to fetch data:', e);
    }
  }, []);

  useEffect(() => {
    if (appState === 'dashboard') {
      refresh();
    }
  }, [appState, refresh]);

  if (appState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted font-serif italic">Loading...</p>
      </div>
    );
  }

  if (appState === 'shared' && shareSlug) {
    return <SharedDashboard slug={shareSlug} />;
  }

  if (appState === 'logged_out') {
    return <LoginPage />;
  }

  if (appState === 'onboarding') {
    return (
      <SetupPage
        onComplete={async () => {
          const u = await auth.me();
          if (u) {
            setUser(u);
            setAppState('dashboard');
          }
        }}
      />
    );
  }

  if (showSettings) {
    return (
      <SettingsPage
        user={user!}
        onClose={async () => {
          setShowSettings(false);
          const u = await auth.me();
          if (u) setUser(u);
        }}
      />
    );
  }

  const shareUrl = user?.share_slug ? `${window.location.origin}/share/${user.share_slug}` : null;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen">
      <Header user={user!} lastSyncAt={lastSyncAt} onRefresh={refresh} onSettings={() => setShowSettings(true)} />

      <main className="max-w-5xl mx-auto px-6 py-8">
        <ProgressBar sections={sections} />

        {shareUrl && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted">
            <span>Share with advisors:</span>
            <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{shareUrl}</code>
            <button
              onClick={handleCopy}
              className="btn-small border-gray-300 text-ink hover:bg-gray-50"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 space-y-6">
            <SectionList
              sections={sections}
              onRefresh={refresh}
              refreshKey={refreshKey}
            />
          </div>

          <div className="space-y-6">
            <ProgressForm
              sections={sections}
              onSubmit={refresh}
            />
            <ActivityTimeline items={activity} />
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-4 text-center text-xs text-muted">
          Manuscript Tracker — Syncs with Google Docs automatically
        </div>
      </footer>
    </div>
  );
}
