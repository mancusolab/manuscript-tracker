import { useState, useEffect } from 'react'
import { api, type Section, type ActivityItem, type Annotation, type ProgressEntry } from '../api/client'
import ProgressBar from './ProgressBar'
import ActivityTimeline from './ActivityTimeline'
import AnnotationTrail from './AnnotationTrail'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In Review',
  edited: 'Edited',
  needs_review: 'Needs Review',
  complete: 'Complete',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

interface SharedDashboardProps {
  slug: string;
}

export default function SharedDashboard({ slug }: SharedDashboardProps) {
  const [userName, setUserName] = useState('');
  const [userPicture, setUserPicture] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [progressEntries, setProgressEntries] = useState<ProgressEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSharedDashboard(slug)
      .then(data => {
        setUserName(data.user.name);
        setUserPicture(data.user.picture);
        setSections(data.sections);
        setActivity(data.activity);
      })
      .catch(() => setError('Manuscript not found'))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (expandedId) {
      api.getSharedAnnotations(slug, expandedId).then(data => {
        setAnnotations(data.annotations);
        setProgressEntries(data.progress);
      });
    }
  }, [expandedId, slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted font-serif italic">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted font-serif italic">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif font-bold text-ink tracking-tight">
              Manuscript Tracker
            </h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted">
            {userPicture && (
              <img src={userPicture} alt={userName} className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
            )}
            <span>{userName}'s manuscript</span>
            <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded">Read-only</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <ProgressBar sections={sections} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="font-serif text-lg font-semibold text-ink">Sections</h2>
              <span className="text-sm text-muted">
                {sections.filter(s => s.status === 'complete').length}/{sections.length} complete
              </span>
            </div>
            {sections.map(section => (
              <div key={section.id} className="card">
                <button
                  onClick={() => setExpandedId(expandedId === section.id ? null : section.id)}
                  className="w-full text-left flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-muted text-sm font-mono w-5">{section.sort_order}.</span>
                    <h2 className="font-serif text-lg font-semibold">{section.name}</h2>
                    <span className={`status-badge status-${section.status}`}>
                      {STATUS_LABELS[section.status] || section.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted">
                    {section.unresolved_count > 0 && (
                      <span className="text-amber-600 font-medium">{section.unresolved_count} needs review</span>
                    )}
                    <svg className={`w-4 h-4 transition-transform ${expandedId === section.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {expandedId === section.id && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    {progressEntries.length > 0 && (
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-muted mb-2">Progress Log</h3>
                        <div className="space-y-2">
                          {progressEntries.map(entry => (
                            <div key={entry.id} className="border-l-4 border-accent bg-accent-light/30 pl-4 py-2">
                              <p className="text-sm">
                                <span className="font-medium">{entry.logged_by}</span> set status to{' '}
                                <span className={`status-badge status-${entry.status} text-[10px]`}>{STATUS_LABELS[entry.status] || entry.status}</span>
                              </p>
                              {entry.note && <p className="text-sm text-muted mt-0.5 italic">"{entry.note}"</p>}
                              <p className="text-xs text-muted mt-1">{formatDate(entry.timestamp)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {annotations.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-muted mb-2">Advisor Edits</h3>
                        <div className="space-y-3">
                          {annotations.map(a => (
                            <AnnotationTrail key={a.id} annotation={a} onAddress={() => {}} />
                          ))}
                        </div>
                      </div>
                    )}
                    {annotations.length === 0 && progressEntries.length === 0 && (
                      <p className="text-sm text-muted py-4 italic">No activity yet.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-6">
            <ActivityTimeline items={activity} />
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-4 text-center text-xs text-muted">
          Manuscript Tracker — <a href="/" className="underline">Track your own manuscript</a>
        </div>
      </footer>
    </div>
  );
}
