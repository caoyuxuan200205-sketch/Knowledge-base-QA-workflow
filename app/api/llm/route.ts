interface ProxyRequest {
  url?: unknown;
  apiKey?: unknown;
  modelId?: unknown;
  messages?: unknown;
  temperature?: unknown;
  maxOutputTokens?: unknown;
  structuredOutput?: unknown;
}

function blockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized.endsWith('.local')
    || /^127\./.test(normalized)
    || /^10\./.test(normalized)
    || /^192\.168\./.test(normalized)
    || /^169\.254\./.test(normalized)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

export async function POST(request: Request) {
  let input: ProxyRequest;
  try {
    input = await request.json() as ProxyRequest;
  } catch {
    return Response.json({ error: '请求内容不是有效 JSON' }, { status: 400 });
  }

  if (typeof input.url !== 'string' || typeof input.apiKey !== 'string' || typeof input.modelId !== 'string' || !Array.isArray(input.messages)) {
    return Response.json({ error: '模型请求参数不完整' }, { status: 400 });
  }

  let endpoint: URL;
  try {
    endpoint = new URL(input.url);
  } catch {
    return Response.json({ error: '模型接口地址无效' }, { status: 400 });
  }
  if (endpoint.protocol !== 'https:' || blockedHostname(endpoint.hostname)) {
    return Response.json({ error: '只允许访问公开 HTTPS 模型接口' }, { status: 400 });
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages,
        temperature: typeof input.temperature === 'number' ? input.temperature : 0.2,
        max_tokens: typeof input.maxOutputTokens === 'number' ? input.maxOutputTokens : 8000,
        ...(input.structuredOutput ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(120000),
    });

    const text = await upstream.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: upstream.ok ? '模型返回了无法解析的内容' : `模型服务请求失败（${upstream.status}）` };
    }
    return Response.json(payload, { status: upstream.status });
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError' ? '模型请求超时' : '无法连接模型服务';
    return Response.json({ error: message }, { status: 502 });
  }
}
