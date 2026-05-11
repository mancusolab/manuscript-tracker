import type { Section } from '../api/client'

interface ProgressBarProps {
  sections: Section[];
}

const SECTION_COLORS: Record<string, string> = {
  complete: 'bg-emerald-500',
  in_review: 'bg-amber-400',
  edited: 'bg-red-400',
  needs_review: 'bg-orange-400',
  draft: 'bg-gray-300',
};

export default function ProgressBar({ sections }: ProgressBarProps) {
  const total = sections.length;
  const completed = sections.filter(s => s.status === 'complete').length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const perSection = total > 0 ? 100 / total : 0;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-serif text-lg font-semibold">Manuscript Progress</h2>
        <span className="text-sm font-mono text-muted">
          {percent}% — {completed}/{total} sections complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-6 bg-gray-100 rounded-full overflow-hidden flex">
        {sections.map(section => (
          <div
            key={section.id}
            className={`h-full ${SECTION_COLORS[section.status] || 'bg-gray-300'} transition-all duration-500 relative group`}
            style={{ width: `${perSection}%` }}
            title={`${section.name}: ${section.status}`}
          >
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-[10px] font-medium text-white drop-shadow truncate px-1">
                {section.name}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Complete
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> In Review
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> Edited
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block" /> Draft
        </span>
      </div>
    </div>
  );
}
