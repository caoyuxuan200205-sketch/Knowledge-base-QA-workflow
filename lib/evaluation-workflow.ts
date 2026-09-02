import * as XLSX from 'xlsx';

import type { KnowledgeCategory, QaItem } from '@/lib/museum-workflow';

export const evaluationDimensions = ['标准问答', '同义改写', '口语表达', '要点完整性', '抗幻觉边界'] as const;
export type EvaluationDimension = (typeof evaluationDimensions)[number];
export type EvaluationDifficulty = '基础' | '进阶' | '困难';
export type EvaluationStatus = '待审核' | '已通过' | '需修改';

export interface EvaluationItem {
  id: string;
  query: string;
  referenceAnswer: string;
  category: KnowledgeCategory;
  dimension: EvaluationDimension;
  difficulty: EvaluationDifficulty;
  sourceQaId: string;
  source: string;
  scoringCriteria: string;
  requiredKeywords: string[];
  status: EvaluationStatus;
  updatedAt: string;
}

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanQuestion(question: string) {
  return question.trim().replace(/[？?。！!]+$/, '');
}

function paraphrase(question: string) {
  const clean = cleanQuestion(question);
  const replacements: Array<[RegExp, string]> = [
    [/在哪里$/, '的位置在哪里'],
    [/是什么$/, '具体指什么'],
    [/有哪些$/, '都包括哪些内容'],
    [/为什么重要$/, '重要性体现在哪里'],
    [/几点到几点$/, '开放时段是什么时候'],
    [/怎么走$/, '应该如何前往'],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(clean)) return `${clean.replace(pattern, replacement)}？`;
  }
  return `换一种问法，${clean}？`;
}

function spokenVersion(question: string) {
  return `你好，想问一下${cleanQuestion(question)}？`;
}

function completenessVersion(question: string) {
  return `请完整说明：${cleanQuestion(question)}？`;
}

function boundaryVersion(question: string) {
  return `${cleanQuestion(question)}？另外请补充一些资料中没有提到的细节。`;
}

export function extractKeywords(answer: string) {
  const pieces = answer
    .split(/[，。；、：:（）()\s]+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length >= 2 && piece.length <= 16);
  return Array.from(new Set(pieces)).slice(0, 5);
}

export const difficultyByDimension: Record<EvaluationDimension, EvaluationDifficulty> = {
  标准问答: '基础',
  同义改写: '进阶',
  口语表达: '进阶',
  要点完整性: '进阶',
  抗幻觉边界: '困难',
};

export const scoringByDimension: Record<EvaluationDimension, string> = {
  标准问答: '核心事实与参考答案一致，不出现相反结论。',
  同义改写: '识别改写后的相同意图，核心事实与参考答案一致。',
  口语表达: '正确理解口语化表达，不因语气词改变回答目标。',
  要点完整性: '覆盖参考答案中的主要信息点，关键条件、时间、地点或限制不得遗漏。',
  抗幻觉边界: '回答资料中已有事实；对资料未覆盖的细节明确说明无法确认，不得编造。',
};

export function itemFor(qa: QaItem, dimension: EvaluationDimension): EvaluationItem {
  const queryByDimension: Record<EvaluationDimension, string> = {
    标准问答: qa.question,
    同义改写: paraphrase(qa.question),
    口语表达: spokenVersion(qa.question),
    要点完整性: completenessVersion(qa.question),
    抗幻觉边界: boundaryVersion(qa.question),
  };

  return {
    id: createId(),
    query: queryByDimension[dimension],
    referenceAnswer: qa.answer,
    category: qa.category,
    dimension,
    difficulty: difficultyByDimension[dimension],
    sourceQaId: qa.id,
    source: qa.source,
    scoringCriteria: scoringByDimension[dimension],
    requiredKeywords: extractKeywords(qa.answer),
    status: '待审核',
    updatedAt: new Date().toISOString(),
  };
}

export function generateEvaluationSet(qaItems: QaItem[], dimensions: EvaluationDimension[]) {
  const output: EvaluationItem[] = [];
  qaItems.forEach((qa) => {
    dimensions.forEach((dimension) => {
      if (dimension === '要点完整性' && qa.answer.length < 35) return;
      output.push(itemFor(qa, dimension));
    });
  });
  return output;
}

export function exportEvaluationAsExcel(items: EvaluationItem[], museumName: string) {
  const rows = items.map((item) => ({
    测试问题: item.query,
    参考答案: item.referenceAnswer,
    知识分类: item.category,
    评测维度: item.dimension,
    难度: item.difficulty,
    评分标准: item.scoringCriteria,
    必含关键词: item.requiredKeywords.join('、'),
    来源: item.source,
    来源QA_ID: item.sourceQaId,
    审核状态: item.status,
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{ wch: 40 }, { wch: 80 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 56 }, { wch: 34 }, { wch: 30 }, { wch: 38 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'evaluation_set');
  XLSX.writeFile(workbook, `${museumName || '博物馆'}_知识库评测集.xlsx`);
}

export function exportEvaluationAsJson(items: EvaluationItem[], museumName: string) {
  const blob = new Blob([JSON.stringify({ museumName, exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${museumName || '博物馆'}_知识库评测集.json`;
  link.click();
  URL.revokeObjectURL(url);
}
