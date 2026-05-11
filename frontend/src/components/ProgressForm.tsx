import { useState } from 'react'
import { api, type Section } from '../api/client'

interface ProgressFormProps {
  sections: Section[];
  ownerEmail: string;
  onSubmit: () => void;
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In Review' },
  { value: 'complete', label: 'Complete' },
];

export default function ProgressForm({ sections, ownerEmail, onSubmit }: ProgressFormProps) {
  const [sectionId, setSectionId] = useState(sections[0]?.id || '');
  const [status, setStatus] = useState('draft');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSubmitting(true);
    try {
      await api.addProgress({
        section_id: sectionId,
        status,
        note: note.trim(),
        logged_by: ownerEmail,
      });
      setNote('');
      onSubmit();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card">
      <h2 className="font-serif text-lg font-semibold mb-3">Log Progress</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-3">
          <select
            value={sectionId}
            onChange={e => setSectionId(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-ink"
          >
            {sections.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-ink"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g., Finished first draft of methods..."
            className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ink"
          />
          <button
            type="submit"
            disabled={submitting || !note.trim()}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Log'}
          </button>
        </div>
      </form>
    </div>
  );
}
