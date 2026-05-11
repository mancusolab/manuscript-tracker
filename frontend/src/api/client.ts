export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  google_doc_id: string | null;
  token_status: string;
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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

export const auth = {
  login: () => {
    window.location.href = '/auth/login';
  },

  logout: async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/';
  },

  me: async (): Promise<User | null> => {
    const res = await fetch('/auth/me');
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
};

export const api = {
  setup: (docUrl: string) =>
    fetchJSON('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ google_doc_url: docUrl }),
    }),

  getSections: () => fetchJSON<Section[]>('/api/sections'),

  getAnnotations: (sectionId: string) =>
    fetchJSON<Annotation[]>(`/api/sections/${sectionId}/annotations`),

  addressAnnotation: (id: number, note?: string) =>
    fetchJSON('/api/annotations/' + id + '/address', {
      method: 'PATCH',
      body: JSON.stringify({ note }),
    }),

  updateSectionStatus: (sectionId: string, status: string) =>
    fetchJSON(`/api/sections/${sectionId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  getActivity: () => fetchJSON<ActivityItem[]>('/api/activity'),

  getProgress: (sectionId?: string) =>
    fetchJSON<ProgressEntry[]>('/api/progress' + (sectionId ? `?section_id=${sectionId}` : '')),

  addProgress: (entry: { section_id: string; status: string; note: string }) =>
    fetchJSON('/api/progress', { method: 'POST', body: JSON.stringify(entry) }),

  deleteProgress: (id: number) =>
    fetchJSON(`/api/progress/${id}`, { method: 'DELETE' }),

  triggerSync: () =>
    fetch('/api/sync', { method: 'POST' }),

  updateSettings: (settings: { google_doc_url?: string; owner_emails?: string; owner_display_names?: string }) =>
    fetchJSON('/api/settings', { method: 'PATCH', body: JSON.stringify(settings) }),
};
