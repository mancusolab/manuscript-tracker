import { useState } from 'react'
import { api } from '../api/client'

interface SetupPageProps {
  onComplete: () => void;
}

export default function SetupPage({ onComplete }: SetupPageProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.setup(url);
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to set up manuscript. Please check the URL and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-lg px-6">
        <h1 className="text-3xl font-serif font-bold text-ink tracking-tight mb-3">
          Set Up Your Manuscript
        </h1>
        <p className="text-muted mb-8">
          Paste the URL of your Google Doc to start tracking.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/..."
            required
            className="w-full border border-gray-300 rounded px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink"
          />
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting || !url.trim()}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? 'Setting up...' : 'Start Tracking'}
          </button>
        </form>
      </div>
    </div>
  );
}
