import { useState } from 'react'
import type { Section } from '../api/client'
import SectionPanel from './SectionPanel'

interface SectionListProps {
  sections: Section[];
  onRefresh: () => void;
  refreshKey: number;
}

export default function SectionList({ sections, onRefresh, refreshKey }: SectionListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-serif text-lg font-semibold text-ink">Sections</h2>
        <span className="text-sm text-muted">
          {sections.filter(s => s.status === 'complete').length}/{sections.length} complete
        </span>
      </div>
      {sections.map(section => (
        <SectionPanel
          key={section.id}
          section={section}
          isExpanded={expandedId === section.id}
          onToggle={() => setExpandedId(expandedId === section.id ? null : section.id)}
          onRefresh={onRefresh}
          refreshKey={refreshKey}
        />
      ))}
    </div>
  );
}
