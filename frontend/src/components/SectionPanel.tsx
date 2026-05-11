import { useState, useEffect } from 'react'
import { api, type Section, type Annotation, type ProgressEntry } from '../api/client'
import AnnotationTrail from './AnnotationTrail'

interface SectionPanelProps {
  section: Section;
  isExpanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  ownerEmail: string;
  refreshKey: number;
}

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

export default function SectionPanel({ section, isExpanded, onToggle, onRefresh, ownerEmail, refreshKey }: SectionPanelProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [progressEntries, setProgressEntries] = useState<ProgressEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Re-fetch when expanded OR when refreshKey changes (parent logged progress)
  useEffect(() => {
    if (isExpanded) {
      setLoading(true);
      Promise.all([
        api.getAnnotations(section.id),
        api.getProgress(section.id),
      ]).then(([ann, prog]) => {
        setAnnotations(ann);
        setProgressEntries(prog);
      }).finally(() => setLoading(false));
    }
  }, [isExpanded, section.id, refreshKey]);

  const handleAddress = async (annotationId: number, note?: string) => {
    await api.addressAnnotation(annotationId, ownerEmail, note);
    const updated = await api.getAnnotations(section.id);
    setAnnotations(updated);
    onRefresh();
  };

  const handleStatusChange = async (newStatus: string) => {
    await api.updateSectionStatus(section.id, newStatus);
    onRefresh();
  };

  const handleDeleteProgress = async (id: number) => {
    await api.deleteProgress(id);
    const updated = await api.getProgress(section.id);
    setProgressEntries(updated);
    onRefresh();
  };

  return (
    <div className="card">
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <span className="text-muted text-sm font-mono w-5">
            {section.sort_order}.
          </span>
          <h2 className="font-serif text-lg font-semibold">{section.name}</h2>
          <span className={`status-badge status-${section.status}`}>
            {STATUS_LABELS[section.status] || section.status}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          {section.unresolved_count > 0 && (
            <span className="text-amber-600 font-medium">
              {section.unresolved_count} needs review
            </span>
          )}
          {section.last_edited_by && (
            <span>
              Last edited by {section.last_edited_by}
            </span>
          )}
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          {/* Status controls */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-muted">Set status:</span>
            {['draft', 'in_review', 'complete'].map(s => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                className={`btn-small ${section.status === s ? 'bg-ink text-white' : 'bg-white text-ink border-gray-300'}`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-muted py-4">Loading...</p>
          ) : (
            <>
              {/* Progress log for this section */}
              {progressEntries.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-muted mb-2">Progress Log</h3>
                  <div className="space-y-2">
                    {progressEntries.map(entry => (
                      <div key={entry.id} className="border-l-4 border-accent bg-accent-light/30 pl-4 py-2 flex items-start justify-between">
                        <div>
                          <p className="text-sm">
                            <span className="font-medium">{entry.logged_by}</span>
                            {' '}set status to{' '}
                            <span className={`status-badge status-${entry.status} text-[10px]`}>
                              {STATUS_LABELS[entry.status] || entry.status}
                            </span>
                          </p>
                          {entry.note && (
                            <p className="text-sm text-muted mt-0.5 italic">"{entry.note}"</p>
                          )}
                          <p className="text-xs text-muted mt-1">{formatDate(entry.timestamp)}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteProgress(entry.id)}
                          className="text-xs text-red-400 hover:text-red-600 ml-2 flex-shrink-0"
                          title="Delete this entry"
                        >
                          undo
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Annotations */}
              {annotations.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted mb-2">Advisor Edits</h3>
                  <div className="space-y-3">
                    {annotations.map(a => (
                      <AnnotationTrail
                        key={a.id}
                        annotation={a}
                        onAddress={handleAddress}
                      />
                    ))}
                  </div>
                </div>
              )}

              {annotations.length === 0 && progressEntries.length === 0 && (
                <p className="text-sm text-muted py-4 italic">No activity yet. Progress logs and advisor edits will appear here.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
