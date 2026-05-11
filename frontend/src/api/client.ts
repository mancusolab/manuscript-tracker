const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : (import.meta.env.VITE_API_URL || '');

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface Section {
  id: string;
  name: string;
  status: string;
  last_edited_by: string | null;
  last_edited_at: string | null;
  sort_order: number;
  unresolved_count: number;
  total_annotations: number;
}

export interface Annotation {
  id: number;
  section_id: string;
  paragraph_index: number;
  paragraph_snippet: string | null;
  author_email: string;
  author_name: string;
  change_type: string;
  status: string;
  addressed_by: string | null;
  addressed_at: string | null;
  addressed_note: string | null;
  comment_text: string | null;
  created_at: string;
}

export interface ActivityItem {
  type: string;
  section_id: string;
  section_name: string;
  author: string;
  detail: string;
  timestamp: string;
}

export interface ProgressEntry {
  id: number;
  section_id: string;
  status: string;
  note: string | null;
  logged_by: string;
  timestamp: string;
}

export const api = {
  getSections: () => fetchJSON<Section[]>('/api/sections'),

  getAnnotations: (sectionId: string) =>
    fetchJSON<Annotation[]>(`/api/sections/${sectionId}/annotations`),

  addressAnnotation: (id: number, addressedBy: string, note?: string) =>
    fetchJSON('/api/annotations/' + id + '/address', {
      method: 'PATCH',
      body: JSON.stringify({ addressed_by: addressedBy, note }),
    }),

  updateSectionStatus: (sectionId: string, status: string) =>
    fetchJSON(`/api/sections/${sectionId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  getActivity: () => fetchJSON<ActivityItem[]>('/api/activity'),

  getProgress: (sectionId?: string) =>
    fetchJSON<ProgressEntry[]>('/api/progress' + (sectionId ? `?section_id=${sectionId}` : '')),

  addProgress: (entry: { section_id: string; status: string; note: string; logged_by: string }) =>
    fetchJSON('/api/progress', { method: 'POST', body: JSON.stringify(entry) }),

  deleteProgress: (id: number) =>
    fetchJSON(`/api/progress/${id}`, { method: 'DELETE' }),

  triggerSync: () =>
    fetch(`${API_BASE}/sync`, { method: 'POST' }),
};
