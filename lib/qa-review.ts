import type { QaItem } from '@/lib/museum-workflow';
import { reviewDimensions, type MachineReview, type MachineReviewResult, type ReviewCheck, type QaEvidence } from '@/lib/qa-review-types';

export const REVIEW_PROMPT_VERSION = 'museum-review-v3-sources';
// The brief format keeps the same review criteria; existing detailed results stay usable.
const compatiblePromptVersions = new Set(['museum-review-v1', 'museum-review-v2-brief', REVIEW_PROMPT_VERSION]);
export const machineReviewStatuses = ['未机审', '审核中', '未发现明显问题', '建议修改', '依据不足', '请求失败', '已停止', '结果已过期'] as const;
export type MachineReviewStatus = typeof machineReviewStatuses[number];

// Change-detection checksum only, not a security/authentication hash. Include
// revision so even editing and then reverting a QA invalidates the old result.
export function reviewInputKey(item: QaItem) {
  const text = JSON.stringify([item.question, item.answer, item.category, item.source, item.revision ?? 0, item.evidence ?? [], item.evidenceNote ?? '']);
  let first = 2166136261; let second = 5381;
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(index);
  }
  return `${text.length}:${first >>> 0}:${second >>> 0}`;
}

export function machineReviewStatus(item: QaItem): MachineReviewStatus {
  const review = item.machineReview;
  if (!review) return '未机审';
  if (review.inputKey !== reviewInputKey(item) || !compatiblePromptVersions.has(review.promptVersion)) return '结果已过期';
  if (review.status === 'running') return '审核中';
  if (review.status === 'failed') return '请求失败';
  if (review.status === 'stopped') return '已停止';
  return review.result?.verdict ?? '请求失败';
}

export function needsMachineReview(item: QaItem) {
  return ['未机审', '请求失败', '已停止', '结果已过期'].includes(machineReviewStatus(item));
}

export function updateQaContent(item: QaItem, patch: Partial<QaItem>): QaItem {
  const changed = ['question', 'answer', 'category', 'source', 'evidence', 'evidenceNote'].some((key) =>
    key in patch && JSON.stringify(patch[key as keyof QaItem]) !== JSON.stringify(item[key as keyof QaItem]));
  return { ...item, ...patch, revision: (item.revision ?? 0) + (changed ? 1 : 0),
    status: changed && item.status === '已通过' ? '待审核' : patch.status ?? item.status, updatedAt: new Date().toISOString() };
}

export function applyReviewEvent(item: QaItem, review: MachineReview): QaItem {
  if (review.inputKey !== reviewInputKey(item)) return item;
  if (review.status !== 'running' && item.machineReview?.attemptId !== review.attemptId) return item;
  const history = review.status === 'running' && item.machineReview?.result
    ? [...(item.machineReviewHistory ?? []), item.machineReview] : item.machineReviewHistory;
  // Never change the human review state or QA text on machine review completion.
  return { ...item, machineReview: review, machineReviewHistory: history };
}

export function recoverMachineReview(item: QaItem): QaItem {
  return item.machineReview?.status === 'running' ? { ...item, machineReview: { ...item.machineReview, status: 'stopped', error: '页面关闭或刷新中断了审核，可重新机审。', finishedAt: new Date().toISOString() } } : item;
}

export function adoptReviewSuggestion(item: QaItem): QaItem {
  const review = item.machineReview;
  if (review?.status !== 'complete' || review.inputKey !== reviewInputKey(item) || !compatiblePromptVersions.has(review.promptVersion) || !review.result?.suggestion) return item;
  return { ...updateQaContent(item, { ...review.result.suggestion, status: '待审核' }),
    revisions: [...(item.revisions ?? []), { question: item.question, answer: item.answer, savedAt: new Date().toISOString(), reviewAttemptId: review.attemptId }] };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('机审输出格式不正确');
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 3000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('机审输出字段缺失或超长');
  return value.trim();
}
const compact = (value: string) => value.replace(/\s+/g, '');

export function parseMachineReview(content: string, item: QaItem, evidence: QaEvidence[], inputTruncated = false): MachineReviewResult {
  const data = object(JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
  if (!['未发现明显问题', '建议修改', '依据不足'].includes(String(data.verdict))) throw new Error('机审结论无效');
  const summary = data.summary === undefined ? String(data.verdict) : text(data.summary);
  const limitations: string[] = [];
  if (!evidence.some((entry) => entry.text.trim() && entry.kind === 'material')) limitations.push(evidence.length ? '仅有导入的 QA 行，不能作为独立事实核验依据。' : '缺少原文，当前只能检查问答与表达。');
  if (item.evidenceNote) limitations.push(item.evidenceNote);
  if (inputTruncated || evidence.some((entry) => entry.truncated)) limitations.push('依据片段过长，审核上下文不完整，请人工核查。');
  if (data.checks === undefined) {
    const citations: NonNullable<MachineReviewResult['citations']> = [];
    if (data.citations !== undefined) {
      if (!Array.isArray(data.citations) || data.citations.length > 2) throw new Error('机审引用格式错误，最多返回两条原文引用。');
      for (const entry of data.citations) {
        const candidate = object(entry);
        const reference = evidence.find(passage => passage.id === candidate.evidenceId && passage.kind === 'material');
        const quote = typeof candidate.quote === 'string' ? candidate.quote.trim() : '';
        if (!reference || !quote || quote.length > 1000 || !compact(reference.text).includes(compact(quote))) {
          limitations.push('模型引用未能与提供的原文匹配，已隐藏该引用，不视为核验通过。');
        } else citations.push({ evidenceId: reference.id, quote, source: reference.source });
      }
    }
    const verdict = limitations.length ? '依据不足' : data.verdict as MachineReviewResult['verdict'];
    return {
      verdict,
      summary: limitations.length && data.verdict === '未发现明显问题' ? limitations[0] : summary,
      checks: [],
      limitations: [...new Set(limitations)],
      citations,
    };
  }
  // Accept the previous detailed response format and continue validating its citations.
  if (!Array.isArray(data.checks) || data.checks.length !== reviewDimensions.length) throw new Error('机审没有完整返回六个审核维度');
  const seen = new Set<string>();
  const checks: ReviewCheck[] = data.checks.map((entry) => {
    const check = object(entry);
    if (!reviewDimensions.includes(check.dimension as ReviewCheck['dimension']) || seen.has(String(check.dimension))) throw new Error('机审维度缺失或重复');
    seen.add(String(check.dimension));
    if (!['ok', 'issue', 'uncertain'].includes(String(check.status)) || !Array.isArray(check.citations)) throw new Error('机审检查项格式错误');
    const citations: ReviewCheck['citations'] = [];
    for (const citation of check.citations) {
      const candidate = object(citation);
      const reference = evidence.find((entry) => entry.id === candidate.evidenceId);
      const quote = typeof candidate.quote === 'string' ? candidate.quote.trim() : '';
      if (!reference || !quote || quote.length > 4000 || !compact(reference.text).includes(compact(quote))) {
        limitations.push('模型引用未能与提供的原文匹配，已隐藏该引用，不视为核验通过。');
      } else citations.push({ evidenceId: reference.id, quote });
    }
    return { dimension: check.dimension as ReviewCheck['dimension'], status: check.status as ReviewCheck['status'], reason: text(check.reason), citations };
  });
  const factual = checks.find((entry) => entry.dimension === '原文一致性')!;
  if (factual.status !== 'uncertain' && !factual.citations.length) limitations.push('原文一致性检查未给出可核对的引用。');
  if (limitations.length) {
    factual.status = 'uncertain';
    factual.reason = `依据核验未完成，不能确认事实正确。模型原意见：${factual.reason}`;
  }
  const verdict = limitations.length || checks.some((entry) => entry.status === 'uncertain') || data.verdict === '依据不足'
    ? '依据不足' : checks.some((entry) => entry.status === 'issue') || data.verdict === '建议修改' ? '建议修改' : '未发现明显问题';
  let suggestion: MachineReviewResult['suggestion'];
  if (data.suggestion !== undefined && data.suggestion !== null) {
    const candidate = object(data.suggestion);
    suggestion = { question: text(candidate.question, 2000), answer: text(candidate.answer, 12000) };
    if (suggestion.question === item.question && suggestion.answer === item.answer) suggestion = undefined;
  }
  return { verdict, summary, checks, limitations: [...new Set(limitations)], suggestion };
}
