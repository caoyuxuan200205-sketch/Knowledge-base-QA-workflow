import type { QaItem } from '@/lib/museum-workflow';
import type { QaEvidence } from '@/lib/qa-review-types';

export interface ReviewDocument {
  id: string;
  fileName: string;
  size: number;
  selected: boolean;
  passages: QaEvidence[];
  warnings: string[];
  incomplete: boolean;
  error?: string;
}

export function createReviewPassages(documentId: string, sections: Array<{ source: string; text: string }>): QaEvidence[] {
  const passages: QaEvidence[] = [];
  sections.forEach((section, sectionIndex) => {
    const text = section.text.trim();
    // Overlap excerpts so conditions at a chunk boundary remain available.
    for (let start = 0; start < text.length; start += 1200) {
      passages.push({ id: `${documentId}:${sectionIndex}:${start}`, source: section.source, text: text.slice(start, start + 1500), kind: 'material' });
      if (start + 1500 >= text.length) break;
    }
  });
  return passages;
}

const stopWords = new Set(['什么', '多少', '哪里', '如何', '怎么', '是否', '可以', '哪些', '介绍', '一下', '请问', '这个', '那个', '时候', '有关', '进行', '一个', '以及', 'the', 'is', 'a', 'of', 'to', 'and']);
function terms(value: string) {
  const output = new Set<string>();
  for (const word of value.toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? []) {
    if (/^[a-z0-9]+$/.test(word)) { if (!stopWords.has(word)) output.add(word); }
    else for (let i = 0; i + 1 < word.length; i++) {
      const term = word.slice(i, i + 2);
      if (!stopWords.has(term)) output.add(term);
    }
  }
  return output;
}

export function createReviewMaterialIndex(documents: ReviewDocument[]) {
  const selected = documents.filter(document => document.selected && !document.error);
  const entries = selected.flatMap(document => document.passages.map((passage, index) => ({ document, passage, index, tokens: terms(passage.text) })));
  const frequency = new Map<string, number>();
  entries.forEach(entry => entry.tokens.forEach(term => frequency.set(term, (frequency.get(term) ?? 0) + 1)));
  const weight = (term: string) => Math.log(1 + (entries.length + 1) / ((frequency.get(term) ?? 0) + 1));

  return {
    documents: selected,
    match(item: QaItem): QaItem {
      if (!selected.length) return item;
      const questionTerms = terms(item.question);
      const answerTerms = terms(item.answer);
      const queryWeight = [...questionTerms].reduce((sum, term) => sum + weight(term), 0);
      const ranked = entries.map(entry => {
        const matches = [...questionTerms].filter(term => entry.tokens.has(term));
        const matchedWeight = matches.reduce((sum, term) => sum + weight(term), 0);
        const coverage = queryWeight ? matchedWeight / queryWeight : 0;
        const answerScore = [...answerTerms].filter(term => entry.tokens.has(term)).reduce((sum, term) => sum + weight(term), 0);
        const sourceHint = item.source.includes(entry.document.fileName) ? 1.3 : 1;
        return { ...entry, relevant: matches.length >= Math.min(2, questionTerms.size) && matches.length > 0 && coverage >= 0.12,
          score: (matchedWeight * 3 + Math.min(answerScore, matchedWeight) * 0.5) * sourceHint };
      }).filter(entry => entry.relevant).sort((a, b) => b.score - a.score);

      const evidence: QaEvidence[] = [];
      const used = new Set<string>();
      const matchedDocuments = new Set<ReviewDocument>();
      const add = (document: ReviewDocument, passage?: QaEvidence) => {
        if (!passage || used.has(passage.id) || evidence.length >= 8) return;
        used.add(passage.id); evidence.push(passage); matchedDocuments.add(document);
      };
      // Select across documents first, then add nearby context to the best matches.
      ranked.slice(0, 5).forEach(entry => add(entry.document, entry.passage));
      for (const entry of ranked.slice(0, 2)) {
        add(entry.document, entry.document.passages[entry.index - 1]);
        add(entry.document, entry.document.passages[entry.index + 1]);
      }
      const incomplete = [...matchedDocuments].filter(document => document.incomplete);
      return { ...item,
        evidence: evidence.length ? evidence : (item.evidence ?? []).filter(entry => entry.kind === 'provided-qa'),
        evidenceNote: !evidence.length ? '本次上传的原始资料中未找到与问题相关的片段，不能据此判断答案错误或确认事实正确。'
          : incomplete.length ? `相关资料存在未提取的内容（${incomplete.map(document => document.fileName).join('、')}），请人工核查。` : undefined,
      };
    },
  };
}
