import type { ModelConfig } from '@/lib/model-registry';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelCallOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
  structuredOutput?: boolean;
  allowReasoningFallback?: boolean;
}

export interface OpenAICompatibleRequest {
  url: string;
  init: RequestInit;
}

export class ModelHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'ModelHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMilliseconds(value: string | null) {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : undefined;
}

/**
 * Provider-neutral request builder. The workflow only passes a selected model;
 * provider-specific fields stay inside this adapter layer.
 */
export function buildModelRequest(
  model: ModelConfig,
  apiKey: string,
  messages: ChatMessage[],
  options: ModelCallOptions = {},
): OpenAICompatibleRequest {
  if (!apiKey.trim()) throw new Error('缺少 API Key');
  if (!model.baseUrl.trim() || !model.modelId.trim()) throw new Error('模型配置不完整');

  return {
    url: model.baseUrl,
    init: {
      signal: options.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelId,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: Math.min(options.maxOutputTokens ?? 8000, model.maxOutputTokens),
        ...(options.structuredOutput && model.capabilities.structuredOutput
          ? { response_format: { type: 'json_object' } }
          : {}),
      }),
    },
  };
}

function readTextContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const record = part as { text?: unknown; content?: unknown; value?: unknown };
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    if (typeof record.value === 'string') return record.value;
    return '';
  }).filter(Boolean).join('\n').trim();
}

export function readModelResponse(payload: unknown, options: { allowReasoningFallback?: boolean } = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('模型返回格式不正确');
  const response = payload as {
    choices?: Array<{
      message?: { content?: unknown; reasoning_content?: unknown };
      text?: unknown;
      finish_reason?: unknown;
    }>;
    output_text?: unknown;
  };
  const choice = response.choices?.[0];
  const content = readTextContent(choice?.message?.content)
    || readTextContent(choice?.text)
    || readTextContent(response.output_text);
  if (content) return content;

  const reasoning = readTextContent(choice?.message?.reasoning_content);
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : '';
  if (reasoning && options.allowReasoningFallback) return '连接成功（接口已返回推理内容）';
  if (reasoning) {
    throw new Error(`模型只返回了推理内容，没有最终答案${finishReason ? `（结束原因：${finishReason}）` : ''}`);
  }
  if (finishReason === 'length') throw new Error('模型输出额度不足，最终答案在生成前被截断');
  throw new Error(`模型没有返回有效内容${finishReason ? `（结束原因：${finishReason}）` : ''}`);
}

export async function callModel(
  model: ModelConfig,
  apiKey: string,
  messages: ChatMessage[],
  options: ModelCallOptions = {},
) {
  options.signal?.throwIfAborted();
  const response = await fetch('/api/llm', {
    signal: options.signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: model.baseUrl,
      apiKey,
      modelId: model.modelId,
      messages,
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: Math.min(options.maxOutputTokens ?? 8000, model.maxOutputTokens),
      structuredOutput: Boolean(options.structuredOutput && model.capabilities.structuredOutput),
    }),
  });
  const payload = await response.json() as unknown;
  options.signal?.throwIfAborted();
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error: unknown }).error : undefined;
    const message = typeof detail === 'string' ? detail : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string' ? detail.message : `请求失败（${response.status}）`;
    throw new ModelHttpError(message, response.status, retryAfterMilliseconds(response.headers?.get('retry-after') ?? null));
  }
  return readModelResponse(payload, { allowReasoningFallback: options.allowReasoningFallback });
}

export async function testModelConnection(model: ModelConfig, apiKey: string) {
  const content = await callModel(model, apiKey, [
    { role: 'system', content: '你正在执行连接测试。' },
    { role: 'user', content: '请只回复：连接成功' },
  ], { temperature: 0, maxOutputTokens: 512, allowReasoningFallback: true });
  return content.trim();
}
