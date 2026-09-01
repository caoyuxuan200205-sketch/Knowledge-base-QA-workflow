/* oxlint-disable react(react-compiler) -- session-only secrets are restored after client mount */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, BrainCircuit, Braces, Check, Copy, Eye, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2, Wrench } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { createCustomModel, modelConfigIssues, type ModelCapabilities, type ModelConfig } from '@/lib/model-registry';
import { readModelSecrets, removeModelSecret, saveModelSecret } from '@/lib/model-secrets';
import { testModelConnection } from '@/lib/llm-adapter';

interface ModelSettingsProps {
  models: ModelConfig[];
  activeModelId: string;
  onModelsChange: (models: ModelConfig[]) => void;
  onActiveModelChange: (modelId: string) => void;
}

export function ModelSettings({ models, activeModelId, onModelsChange, onActiveModelChange }: ModelSettingsProps) {
  const [selectedId, setSelectedId] = useState(activeModelId || models[0]?.id || '');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const selected = models.find((model) => model.id === selectedId) ?? models[0];
  const issues = useMemo(() => selected ? modelConfigIssues(selected) : [], [selected]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setApiKeys(readModelSecrets());
      } catch {
        setApiKeys({});
      }
    });
  }, []);

  function updateModel(modelId: string, patch: Partial<ModelConfig>) {
    onModelsChange(models.map((model) => model.id === modelId ? { ...model, ...patch } : model));
  }

  function updateCapability(modelId: string, key: keyof ModelCapabilities, value: boolean) {
    onModelsChange(models.map((model) => model.id === modelId ? { ...model, capabilities: { ...model.capabilities, [key]: value } } : model));
  }

  function saveKey(modelId: string, value: string) {
    setApiKeys(saveModelSecret(modelId, value));
    setTestResult(null);
  }

  function addModel() {
    const model = createCustomModel();
    onModelsChange([...models, model]);
    setSelectedId(model.id);
  }

  function cloneModel(model: ModelConfig) {
    const clone = { ...model, id: `${model.id}-copy-${Math.random().toString(36).slice(2, 6)}`, name: `${model.name} 副本`, capabilities: { ...model.capabilities } };
    onModelsChange([...models, clone]);
    setSelectedId(clone.id);
  }

  function removeModel(modelId: string) {
    if (models.length <= 1) return;
    const next = models.filter((model) => model.id !== modelId);
    onModelsChange(next);
    const nextSelected = next[0]?.id ?? '';
    setSelectedId(nextSelected);
    if (activeModelId === modelId) onActiveModelChange(nextSelected);
    setApiKeys(removeModelSecret(modelId));
  }

  function shareKeyWithProvider(model: ModelConfig) {
    const key = apiKeys[model.id] ?? '';
    if (!key) return;
    let next = readModelSecrets();
    models.filter((candidate) => candidate.provider === model.provider).forEach((candidate) => {
      next = saveModelSecret(candidate.id, key);
    });
    setApiKeys(next);
    setTestResult({ ok: true, message: `已同步到 ${models.filter((candidate) => candidate.provider === model.provider).length} 个同服务商模型` });
  }

  async function handleTest(model: ModelConfig) {
    const key = apiKeys[model.id] ?? '';
    if (!key) {
      setTestResult({ ok: false, message: '请先填写 API Key' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const message = await testModelConnection(model, key);
      setTestResult({ ok: true, message: `连接正常：${message.slice(0, 80)}` });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : '连接测试失败' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm text-[#78877f]">系统设置 / 模型管理</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold">快速切换大模型</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#697a73]">模型参数和接口地址保存在本机；API Key 只暂存在当前浏览器会话，不写入项目文件或长期存储。</p>
        </div>
        <Button className="bg-[#1f5143] text-white hover:bg-[#173e34]" onClick={addModel}><Plus /> 新增模型</Button>
      </div>

      <Card className="border-0 bg-[#203f36] text-white shadow-sm ring-0">
        <CardContent className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-[#e9ce7e]"><Bot className="size-5" /></span>
            <div><p className="font-serif text-xl font-semibold">当前工作模型</p><p className="mt-1 text-sm text-[#c1cec9]">后续事实抽取、QA生成和质量检查默认使用这个模型。</p></div>
          </div>
          <NativeSelect aria-label="快捷切换当前模型" value={activeModelId} onChange={(event) => { onActiveModelChange(event.target.value); setSelectedId(event.target.value); }} className="w-full text-white lg:w-64 [&_select]:h-10 [&_select]:border-white/20 [&_select]:bg-white/5">
            {models.filter((model) => model.enabled).map((model) => <NativeSelectOption key={model.id} value={model.id}>{model.name}</NativeSelectOption>)}
          </NativeSelect>
        </CardContent>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
          <div className="border-b border-[#e3ddd1] px-4 pb-3"><p className="font-semibold">模型注册表</p><p className="text-xs text-[#829089]">{models.length} 个模型 · {models.filter((model) => model.enabled).length} 个已启用</p></div>
          <div className="max-h-[720px] space-y-2 overflow-y-auto px-2">
            {models.map((model) => {
              const modelIssues = modelConfigIssues(model);
              const hasKey = Boolean(apiKeys[model.id]);
              return (
                <button key={model.id} type="button" onClick={() => setSelectedId(model.id)} aria-label={`配置模型 ${model.name}`} className={`w-full rounded-xl border p-3 text-left transition ${selected?.id === model.id ? 'border-[#7ca08e] bg-[#edf4ef]' : 'border-transparent bg-[#faf8f2] hover:border-[#ddd5c7]'}`}>
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e7eee9] text-[#315e4d]"><Bot className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{model.name}</p>{model.id === activeModelId && <Badge className="border-0 bg-[#1f5143] text-white">使用中</Badge>}</div>
                      <p className="mt-1 truncate text-xs text-[#7d8983]">{model.provider} · {model.modelId || '未填写模型 ID'}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5"><Badge variant="outline" className={model.enabled ? 'border-[#a5c1b2] text-[#3f6a56]' : 'text-[#8c8a83]'}>{model.enabled ? '已启用' : '已停用'}</Badge><Badge variant="outline" className={hasKey ? 'border-[#a5c1b2] text-[#3f6a56]' : 'border-[#d8b99c] text-[#8a6240]'}>{hasKey ? 'Key 已暂存' : '等待 Key'}</Badge>{modelIssues.length > 0 && <Badge variant="outline" className="border-[#d6a69a] text-[#934f3f]">配置不完整</Badge>}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
          {selected ? (
            <CardContent className="space-y-6">
              <div className="flex flex-col justify-between gap-3 border-b border-[#e3ddd1] pb-4 sm:flex-row sm:items-center">
                <div><p className="font-serif text-xl font-semibold">模型配置</p><p className="mt-1 text-xs text-[#83908a]">OpenAI Chat Completions 兼容接口</p></div>
                <div className="flex gap-2"><Button variant="outline" onClick={() => cloneModel(selected)}><Copy /> 复制</Button><Button variant="outline" className="text-[#914f3f]" disabled={models.length <= 1} onClick={() => removeModel(selected.id)}><Trash2 /> 删除</Button></div>
              </div>

              {issues.length > 0 ? <div className="flex gap-2 rounded-xl border border-[#dfb3a8] bg-[#fff1ed] p-3 text-sm text-[#8c4d3f]"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{issues.join('；')}</span></div> : <div className="flex gap-2 rounded-xl border border-[#a9c6b7] bg-[#edf6f0] p-3 text-sm text-[#35634f]"><ShieldCheck className="size-4" /><span>基础配置完整，等待API Key后即可接通调用。</span></div>}

              <div className="grid gap-4 md:grid-cols-2">
                <label htmlFor="model-name" className="space-y-2 text-sm font-medium">显示名称<Input id="model-name" value={selected.name} onChange={(event) => updateModel(selected.id, { name: event.target.value })} className="h-10 border-[#d4cdbf] bg-[#faf8f2]" /></label>
                <label htmlFor="model-id" className="space-y-2 text-sm font-medium">模型 ID<Input id="model-id" value={selected.modelId} onChange={(event) => updateModel(selected.id, { modelId: event.target.value })} placeholder="例如 GLM-5.2" className="h-10 border-[#d4cdbf] bg-[#faf8f2]" /></label>
                <label htmlFor="model-provider" className="space-y-2 text-sm font-medium">服务商<Input id="model-provider" value={selected.provider} onChange={(event) => updateModel(selected.id, { provider: event.target.value })} className="h-10 border-[#d4cdbf] bg-[#faf8f2]" /></label>
                <div className="space-y-2 text-sm font-medium">接口协议<NativeSelect aria-label="接口协议" value={selected.protocol} className="w-full" disabled><NativeSelectOption value="openai-chat-completions">OpenAI Chat Completions</NativeSelectOption></NativeSelect></div>
              </div>

              <label htmlFor="model-url" className="block space-y-2 text-sm font-medium">接口地址<Input id="model-url" value={selected.baseUrl} onChange={(event) => updateModel(selected.id, { baseUrl: event.target.value })} placeholder="https://.../v1/chat/completions" className="h-10 border-[#d4cdbf] bg-[#faf8f2] font-mono text-xs" /></label>

              <div className="grid gap-4 md:grid-cols-2">
                <label htmlFor="model-input-tokens" className="space-y-2 text-sm font-medium">最大输入 Token<Input id="model-input-tokens" type="number" min={1} value={selected.maxInputTokens} onChange={(event) => updateModel(selected.id, { maxInputTokens: Number(event.target.value) })} className="h-10 border-[#d4cdbf] bg-[#faf8f2]" /></label>
                <label htmlFor="model-output-tokens" className="space-y-2 text-sm font-medium">最大输出 Token<Input id="model-output-tokens" type="number" min={1} value={selected.maxOutputTokens} onChange={(event) => updateModel(selected.id, { maxOutputTokens: Number(event.target.value) })} className="h-10 border-[#d4cdbf] bg-[#faf8f2]" /></label>
              </div>

              <div className="rounded-xl border border-[#ddd5c7] bg-[#f8f5ee] p-4">
                <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">API Key</p><p className="mt-1 text-xs text-[#83908a]">仅保存在当前浏览器会话，关闭会话后自动清除</p></div><KeyRound className="size-5 text-[#91783d]" /></div>
                <div className="mt-3 flex gap-2"><Input type={showKey ? 'text' : 'password'} value={apiKeys[selected.id] ?? ''} onChange={(event) => saveKey(selected.id, event.target.value)} placeholder="在这里粘贴 API Key" autoComplete="off" className="h-10 border-[#d4cdbf] bg-[#fffdf8] font-mono" /><Button variant="outline" size="icon-lg" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey((value) => !value)}><Eye /></Button></div>
                <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!apiKeys[selected.id]} onClick={() => shareKeyWithProvider(selected)}>同步到同服务商模型</Button><Button size="sm" className="bg-[#1f5143] text-white hover:bg-[#173e34]" disabled={testing || issues.length > 0 || !apiKeys[selected.id]} onClick={() => void handleTest(selected)}>{testing ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}测试连接</Button></div>
                {testResult && <p className={`mt-3 text-xs ${testResult.ok ? 'text-[#35634f]' : 'text-[#934f3f]'}`}>{testResult.message}</p>}
              </div>

              <div>
                <p className="text-sm font-semibold">模型能力</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {([
                    ['toolCall', '工具调用', Wrench],
                    ['images', '图片输入', Eye],
                    ['reasoning', '推理模式', BrainCircuit],
                    ['structuredOutput', '结构化输出', Braces],
                  ] as const).map(([key, label, Icon]) => <div key={key} className="flex items-center justify-between rounded-xl border border-[#ddd6c9] bg-[#faf8f2] px-4 py-3"><div className="flex items-center gap-2"><Icon className="size-4 text-[#63766e]" /><span className="text-sm">{label}</span></div><Switch checked={selected.capabilities[key]} onCheckedChange={(checked) => updateCapability(selected.id, key, checked)} aria-label={`切换${label}`} /></div>)}
                </div>
              </div>

              <div className="flex flex-col justify-between gap-3 border-t border-[#e3ddd1] pt-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3"><Switch checked={selected.enabled} onCheckedChange={(checked) => updateModel(selected.id, { enabled: checked })} aria-label="启用模型" /><span className="text-sm">允许在快捷切换中使用</span></div>
                <Button className="bg-[#1f5143] text-white hover:bg-[#173e34]" disabled={!selected.enabled || issues.length > 0} onClick={() => onActiveModelChange(selected.id)}>{selected.id === activeModelId ? <Check /> : <Bot />}{selected.id === activeModelId ? '当前正在使用' : '设为当前模型'}</Button>
              </div>
            </CardContent>
          ) : null}
        </Card>
      </div>
    </section>
  );
}
