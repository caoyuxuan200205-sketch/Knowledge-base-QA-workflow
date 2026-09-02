import { modelConfigIssues, type ModelConfig } from '@/lib/model-registry';

export const LOCAL_RULES = '__local_rules__';
export const modelPurposes = [
  { id: 'qaGeneration', label: 'QA 生成', description: '从馆方资料生成候选问答' },
  { id: 'qaReview', label: 'QA 审核', description: '手动启动机审，提供原文核对和修改建议' },
  { id: 'evaluationGeneration', label: '测评集生成', description: '根据 QA 生成不同维度的测试题' },
] as const;
export type ModelPurpose = typeof modelPurposes[number]['id'];
export type ModelAssignments = Record<ModelPurpose, string>;

// Only old workspaces inherit the old global selection. New role settings never
// silently fall back to another model when a model is disabled or removed.
export function restoreModelAssignments(saved: unknown, legacyModelId = ''): ModelAssignments {
  const record = saved && typeof saved === 'object' ? saved as Record<string, unknown> : null;
  const value = (role: ModelPurpose) => {
    if (!record) return role === 'qaReview' ? '' : legacyModelId;
    const selected = record[role];
    return typeof selected === 'string' && !(role === 'qaReview' && selected === LOCAL_RULES) ? selected : '';
  };
  return { qaGeneration: value('qaGeneration'), qaReview: value('qaReview'), evaluationGeneration: value('evaluationGeneration') };
}

export function resolveModelAssignment(assignment: string, models: ModelConfig[], readKey: (id: string) => string) {
  const engine: 'rules' | 'model' = assignment === LOCAL_RULES ? 'rules' : 'model';
  const model = engine === 'model' ? models.find((candidate) => candidate.id === assignment) : undefined;
  const apiKey = model ? readKey(model.id).trim() : '';
  const issue = engine === 'rules' ? ''
    : !assignment ? '尚未选择模型'
    : !model ? '所选模型已不存在，请重新选择'
    : !model.enabled ? '所选模型已停用'
    : modelConfigIssues(model).length ? `模型配置不完整：${modelConfigIssues(model).join('；')}`
    : !apiKey ? '尚未填写 API Key'
    : '';
  return { engine, model, apiKey, name: engine === 'rules' ? '本地规则' : model?.name ?? '未配置模型', issue, ready: !issue };
}
