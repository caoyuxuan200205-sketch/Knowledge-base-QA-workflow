export interface QaEvidence {
  id: string;
  source: string;
  text: string;
  kind: 'material' | 'provided-qa';
  truncated?: boolean;
}

export const reviewDimensions = ['原文一致性', '问答匹配', '游客相关性', '独立可理解性', '确定性与时效', '表达质量'] as const;
export type ReviewDimension = typeof reviewDimensions[number];
export type MachineVerdict = '未发现明显问题' | '建议修改' | '依据不足';
export interface ReviewCheck {
  dimension: ReviewDimension;
  status: 'ok' | 'issue' | 'uncertain';
  reason: string;
  citations: Array<{ evidenceId: string; quote: string }>;
}
export interface MachineReviewResult {
  verdict: MachineVerdict;
  summary: string;
  checks: ReviewCheck[];
  limitations: string[];
  citations?: Array<{ evidenceId: string; quote: string; source: string }>;
  suggestion?: { question: string; answer: string };
}
export interface MachineReview {
  attemptId: string;
  inputKey: string;
  status: 'running' | 'complete' | 'failed' | 'stopped';
  model: { id: string; name: string; modelId: string; provider: string; baseUrl: string };
  promptVersion: string;
  startedAt: string;
  finishedAt?: string;
  result?: MachineReviewResult;
  error?: string;
}
export interface QaRevision {
  question: string;
  answer: string;
  savedAt: string;
  reviewAttemptId: string;
}
