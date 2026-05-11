import { useState } from 'react'
import type { Annotation } from '../api/client'

interface AnnotationTrailProps {
  annotation: Annotation;
  onAddress: (id: number, note?: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const CHANGE_VERBS: Record<string, string> = {
  added: 'added',
  modified: 'edited',
  deleted: 'deleted',
  commented: 'commented on',
};

export default function AnnotationTrail({ annotation, onAddress }: AnnotationTrailProps) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');

  const isResolved = annotation.status === 'addressed';
  const verb = CHANGE_VERBS[annotation.change_type] || 'modified';

  const handleSubmit = () => {
    onAddress(annotation.id, note || undefined);
    setShowNote(false);
    setNote('');
  };

  return (
    <div className={isResolved ? 'annotation-addressed' : 'annotation-needs-review'}>
      {/* Paragraph reference */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-mono text-muted mb-1">
            ¶{annotation.paragraph_index + 1}
            {annotation.paragraph_snippet && (
              <span className="ml-2 italic text-gray-400">"{annotation.paragraph_snippet}"</span>
            )}
          </p>

          {/* Annotation message */}
          <p className="text-sm">
            <span className="font-medium">{annotation.author_name}</span>
            {' '}{verb} this on {formatDate(annotation.created_at)}
            {!isResolved && (
              <span className="ml-1.5 text-amber-600 font-medium">— Needs Review</span>
            )}
          </p>

          {/* Comment content */}
          {annotation.comment_text && (
            <p className="text-sm mt-1 bg-white/60 border border-gray-200 rounded px-2 py-1 italic text-ink">
              "{annotation.comment_text}"
            </p>
          )}

          {/* Resolution message */}
          {isResolved && annotation.addressed_at && (
            <p className="text-sm text-emerald-700 mt-1">
              {annotation.addressed_by} addressed this on {formatDate(annotation.addressed_at)}
              {annotation.addressed_note && (
                <span className="italic ml-1">— {annotation.addressed_note}</span>
              )}
            </p>
          )}
        </div>

        {/* Action button */}
        {!isResolved && (
          <div className="flex-shrink-0">
            {showNote ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Optional note..."
                  className="border border-gray-300 rounded px-2 py-1 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-ink"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  autoFocus
                />
                <button onClick={handleSubmit} className="btn-small bg-emerald-600 text-white border-emerald-600">
                  Done
                </button>
                <button onClick={() => setShowNote(false)} className="btn-small">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNote(true)}
                className="btn-small border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                Mark Addressed
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
