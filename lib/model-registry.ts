export type ModelProtocol = 'openai-chat-completions';

export interface ModelCapabilities {
  toolCall: boolean;
  images: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  modelId: string;
  provider: string;
  baseUrl: string;
  protocol: ModelProtocol;
  maxInputTokens: number;
  maxOutputTokens: number;
  enabled: boolean;
  capabilities: ModelCapabilities;
}

export const defaultModels: ModelConfig[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'Deepseek-v4-flash',
    modelId: 'Deepseek-v4-flash',
    provider: '微信 Coding Plan',
    baseUrl: 'https://chatapi.weixin.qq.com/openai/v1/chat/completions',
    protocol: 'openai-chat-completions',
    maxInputTokens: 200000,
    maxOutputTokens: 48000,
    enabled: true,
    capabilities: { toolCall: true, images: false, reasoning: true, structuredOutput: true },
  },
  {
    id: 'glm-5-2',
    name: 'GLM-5.2',
    modelId: 'GLM-5.2',
    provider: '微信 Coding Plan',
    baseUrl: 'https://chatapi.weixin.qq.com/openai/v1/chat/completions',
    protocol: 'openai-chat-completions',
    maxInputTokens: 200000,
    maxOutputTokens: 48000,
    enabled: true,
    capabilities: { toolCall: true, images: false, reasoning: true, structuredOutput: true },
  },
  {
    id: 'linghub-company-model',
    name: '数字文博灵枢',
    modelId: 'deepseek-v4-flash',
    provider: '公司模型平台',
    baseUrl: 'https://linghub.shuziwenbo.cn/v1/chat/completions',
    protocol: 'openai-chat-completions',
    maxInputTokens: 128000,
    maxOutputTokens: 16000,
    enabled: false,
    capabilities: { toolCall: false, images: false, reasoning: false, structuredOutput: false },
  },
];

export function createCustomModel(): ModelConfig {
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: `custom-${suffix}`,
    name: '自定义模型',
    modelId: '',
    provider: '自定义服务商',
    baseUrl: '',
    protocol: 'openai-chat-completions',
    maxInputTokens: 128000,
    maxOutputTokens: 16000,
    enabled: true,
    capabilities: { toolCall: false, images: false, reasoning: false, structuredOutput: true },
  };
}

export function modelConfigIssues(model: ModelConfig) {
  const issues: string[] = [];
  if (!model.name.trim()) issues.push('缺少显示名称');
  if (!model.modelId.trim()) issues.push('缺少模型 ID');
  if (!model.baseUrl.trim()) issues.push('缺少接口地址');
  else {
    try {
      const url = new URL(model.baseUrl);
      if (!['https:', 'http:'].includes(url.protocol)) issues.push('接口地址协议不正确');
    } catch {
      issues.push('接口地址格式不正确');
    }
  }
  if (model.maxInputTokens <= 0 || model.maxOutputTokens <= 0) issues.push('Token 上限必须大于 0');
  return issues;
}
