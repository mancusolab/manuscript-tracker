import { useState, useEffect, useCallback } from 'react'
import { api, type Section, type ActivityItem } from './api/client'
import Header from './components/Header'
import SectionList from './components/SectionList'
import ActivityTimeline from './components/ActivityTimeline'
import ProgressForm from './components/ProgressForm'
import ProgressBar from './components/ProgressBar'

const OWNER_EMAIL = import.meta.env.VITE_OWNER_EMAIL || 'owner@example.com';

export default function App() {
  const [sections, setSections] = useState<Section[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted font-serif italic">Loading manuscript data...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header lastSyncAt={lastSyncAt} onRefresh={refresh} />

      <main className="max-w-5xl mx-auto px-6 py-8">
        <ProgressBar sections={sections} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 space-y-6">
            <SectionList
              sections={sections}
              onRefresh={refresh}
              ownerEmail={OWNER_EMAIL}
              refreshKey={refreshKey}
            />
          </div>

          <div className="space-y-6">
            <ProgressForm
              sections={sections}
              ownerEmail={OWNER_EMAIL}
              onSubmit={refresh}
            />
            <ActivityTimeline items={activity} />
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-4 text-center text-xs text-muted">
          Manuscript Tracker — Syncs with Google Docs every 15 minutes
        </div>
      </footer>
    </div>
  );
}
