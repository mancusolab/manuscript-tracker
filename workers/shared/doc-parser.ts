import type { ParsedSection } from './types';

// Simple hash for paragraph content comparison
async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

interface DocElement {
  paragraph?: {
    paragraphStyle?: { namedStyleType?: string };
    elements?: Array<{ textRun?: { content?: string } }>;
  };
}

// Section definitions with their heading patterns
const SECTION_DEFS = [
  { id: 'abstract', pattern: /^abstract/i },
  { id: 'introduction', pattern: /^introduction/i },
  { id: 'materials-methods', pattern: /^material/i },
  { id: 'results', pattern: /^results/i },
  { id: 'discussion', pattern: /^discussion/i },
  { id: 'supplement', pattern: /^supplement/i },
];

function getElementText(element: DocElement): string {
  if (!element.paragraph?.elements) return '';
  return element.paragraph.elements
    .map(e => e.textRun?.content || '')
    .join('')
    .trim();
}

function isHeading(element: DocElement): boolean {
  const style = element.paragraph?.paragraphStyle?.namedStyleType || '';
  return style.startsWith('HEADING');
}

function matchSection(headingText: string): string | null {
  for (const def of SECTION_DEFS) {
    if (def.pattern.test(headingText.trim())) {
      return def.id;
    }
  }
  return null;
}

export async function parseDocument(doc: any): Promise<ParsedSection[]> {
  const body = doc.body?.content as DocElement[] || [];
  // Use a map to merge duplicate section headings
  const sectionMap = new Map<string, { index: number; text: string; hash: string }[]>();
  let currentSectionId: string | null = null;

  for (const element of body) {
    const text = getElementText(element);
    if (!text) continue;

    if (isHeading(element)) {
      const sectionId = matchSection(text);
      if (sectionId) {
        currentSectionId = sectionId;
        if (!sectionMap.has(sectionId)) {
          sectionMap.set(sectionId, []);
        }
        continue;
      }
    }

    // Add paragraph to current section
    if (currentSectionId && text.length > 0) {
      const hash = await hashText(text);
      const paragraphs = sectionMap.get(currentSectionId)!;
      paragraphs.push({
        index: paragraphs.length,
        text,
        hash,
      });
    }
  }

  // Convert map to array in defined order
  const orderedIds = SECTION_DEFS.map(d => d.id);
  const sections: ParsedSection[] = [];
  for (const id of orderedIds) {
    const paragraphs = sectionMap.get(id);
    if (paragraphs && paragraphs.length > 0) {
      sections.push({ id, paragraphs });
    }
  }

  return sections;
}

export function getSnippet(text: string, maxLen = 60): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
