import { useState } from 'react'
import { api, type User } from '../api/client'

interface SettingsPageProps {
  user: User;
  onClose: () => void;
}

export default function SettingsPage({ user, onClose }: SettingsPageProps) {
  const [docUrl, setDocUrl] = useState(
    user.google_doc_id
      ? `https://docs.google.com/document/d/${user.google_doc_id}/edit`
      : ''
  );
  const [ownerEmails, setOwnerEmails] = useState((user as any).owner_emails ?? '');
  const [displayNames, setDisplayNames] = useState((user as any).owner_display_names ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.updateSettings({
        google_doc_url: docUrl || undefined,
        owner_emails: ownerEmails || undefined,
        owner_display_names: displayNames || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm max-w-lg w-full mx-4 p-8">
        <h2 className="text-2xl font-serif font-bold text-ink tracking-tight mb-6">
          Settings
        </h2>
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Google Doc URL
            </label>
            <input
              type="url"
              value={docUrl}
              onChange={e => setDocUrl(e.target.value)}
              placeholder="https://docs.google.com/document/d/..."
              className="w-full border border-gray-300 rounded px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Additional owner emails
            </label>
            <input
              type="text"
              value={ownerEmails}
              onChange={e => setOwnerEmails(e.target.value)}
              placeholder="other-email@gmail.com, another@example.com"
              className="w-full border border-gray-300 rounded px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Display names
            </label>
            <input
              type="text"
              value={displayNames}
              onChange={e => setDisplayNames(e.target.value)}
              placeholder="Your Name, Other Display Name"
              className="w-full border border-gray-300 rounded px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
