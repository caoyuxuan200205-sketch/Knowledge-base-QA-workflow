import type { QaEvidence } from '@/lib/qa-review-types';

export function createQaEvidence(source: string, text: string, kind: QaEvidence['kind'] = 'material'): QaEvidence {
  return { id: crypto.randomUUID(), source, text: text.slice(0, 16000), kind, truncated: text.length > 16000 };
}

export function rawRowText(row: Record<string, unknown>): string {
  return Object.entries(row).filter(([key]) => key !== 'sourceRow').map(([key, value]) => `${key}：${typeof value === 'string' ? value : JSON.stringify(value) ?? ''}`).join('\n');
}
