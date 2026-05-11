import type { ActivityItem } from '../api/client'

interface ActivityTimelineProps {
  items: ActivityItem[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function dotColor(item: ActivityItem): string {
  if (item.type === 'progress') return 'bg-accent';
  if (item.detail.includes('addressed') || item.detail.includes('Addressed')) return 'bg-emerald-500';
  return 'bg-amber-500';
}

export default function ActivityTimeline({ items }: ActivityTimelineProps) {
  if (items.length === 0) {
    return (
      <div className="card">
        <h2 className="font-serif text-lg font-semibold mb-3">Activity</h2>
        <p className="text-sm text-muted italic">No activity yet. Changes will appear here after the first sync.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="font-serif text-lg font-semibold mb-4">Activity</h2>
      <div className="space-y-0">
        {items.map((item, i) => (
          <div key={i} className="flex gap-3 pb-4">
            <div className="flex flex-col items-center">
              <div className={`timeline-dot ${dotColor(item)}`} />
              {i < items.length - 1 && (
                <div className="w-px flex-1 bg-gray-200 mt-1" />
              )}
            </div>
            <div className="min-w-0 pb-1">
              <p className="text-sm leading-snug">
                <span className="font-medium">{item.section_name}</span>
                <span className="text-muted"> — </span>
                {item.detail}
              </p>
              <p className="text-xs text-muted mt-0.5">{formatDate(item.timestamp)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
