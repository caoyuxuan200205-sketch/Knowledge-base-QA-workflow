/* oxlint-disable react(react-compiler) -- session-only secrets are restored after client mount */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, BrainCircuit, Braces, Copy, Eye, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2, Wrench } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { createCustomModel, modelConfigIssues, type ModelCapabilities, type ModelConfig } from '@/lib/model-registry';
import { readModelSecrets, removeModelSecret, saveModelSecret } from '@/lib/model-secrets';
import { testModelConnection } from '@/lib/llm-adapter';
import { LOCAL_RULES, modelPurposes, resolveModelAssignment, type ModelAssignments } from '@/lib/model-assignments';

interface ModelSettingsProps {
  models: ModelConfig[];
  assignments: ModelAssignments;
  onModelsChange: (models: ModelConfig[]) => void;
  onAssignmentsChange: (assignments: ModelAssignments) => void;
  onSecretsChange: () => void;
  runInProgress: boolean;
}

export function ModelSettings({ models, assignments, onModelsChange, onAssignmentsChange, onSecretsChange, runInProgress }: ModelSettingsProps) {
  const [selectedId, setSelectedId] = useState(assignments.qaGeneration !== LOCAL_RULES ? assignments.qaGeneration || models[0]?.id || '' : models[0]?.id || '');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [newModel, setNewModel] = useState<ModelConfig | null>(null);
  const [newModelKey, setNewModelKey] = useState('');
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
    onSecretsChange();
    setTestResult(null);
  }

  function openAddModel() {
    setNewModel(createCustomModel());
    setNewModelKey('');
  }

  function addModel() {
    if (!newModel || modelConfigIssues(newModel).length > 0) return;
    const model = {
      ...newModel,
      name: newModel.name.trim(),
      modelId: newModel.modelId.trim(),
      provider: newModel.provider.trim(),
      baseUrl: newModel.baseUrl.trim(),
    };
    onModelsChange([...models, model]);
    if (newModelKey.trim()) setApiKeys(saveModelSecret(model.id, newModelKey.trim()));
    onSecretsChange();
    setSelectedId(model.id);
    setNewModel(null);
    setNewModelKey('');
  }

  function cloneModel(model: ModelConfig) {
    const clone = { ...model, id: `${model.id}-copy-${Math.random().toString(36).slice(2, 6)}`, name: `${model.name} 副本`, capabilities: { ...model.capabilities } };
    onModelsChange([...models, clone]);
    setSelectedId(clone.id);
    setTestResult(null);
    setEditorOpen(true);
  }

  function removeModel(modelId: string) {
    if (models.length <= 1) return;
    if (!window.confirm('删除此模型配置？已分配的用途需要重新选择模型。')) return;
    setEditorOpen(false);
    const next = models.filter((model) => model.id !== modelId);
    onModelsChange(next);
    const nextSelected = next[0]?.id ?? '';
    setSelectedId(nextSelected);
    // Keep role bindings visible as unavailable; never choose a replacement on behalf of the user.
    setApiKeys(removeModelSecret(modelId));
    onSecretsChange();
  }

  function shareKeyWithProvider(model: ModelConfig) {
    const key = apiKeys[model.id] ?? '';
    if (!key) return;
    let next = readModelSecrets();
    models.filter((candidate) => candidate.provider === model.provider).forEach((candidate) => {
      next = saveModelSecret(candidate.id, key);
    });
    setApiKeys(next);
    onSecretsChange();
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
    <section className="min-w-0 space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-semibold">模型配置</h1>
          <p className="mt-1 text-xs text-muted-foreground">按用途选择，自动保存。API Key 仅暂存在当前浏览器会话。</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary-hover" onClick={openAddModel}><Plus /> 新增模型</Button>
      </div>

      <Dialog open={Boolean(newModel)} onOpenChange={(open) => { if (!open) { setNewModel(null); setNewModelKey(''); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-card p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle className="font-sans text-2xl font-semibold">新增模型</DialogTitle>
            <DialogDescription>填写完成后模型才会加入注册表。API Key 仅保存在当前浏览器会话。</DialogDescription>
          </DialogHeader>

          {newModel && (
            <div className="space-y-5 px-6 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <label htmlFor="new-model-name" className="space-y-2 text-sm font-medium">显示名称<Input id="new-model-name" value={newModel.name} onChange={(event) => setNewModel({ ...newModel, name: event.target.value })} placeholder="例如：公司知识生产模型" className="h-10 border-input bg-card" /></label>
                <label htmlFor="new-model-id" className="space-y-2 text-sm font-medium">模型 ID<Input id="new-model-id" value={newModel.modelId} onChange={(event) => setNewModel({ ...newModel, modelId: event.target.value })} placeholder="由模型平台提供" className="h-10 border-input bg-card" /></label>
                <label htmlFor="new-model-provider" className="space-y-2 text-sm font-medium">服务商<Input id="new-model-provider" value={newModel.provider} onChange={(event) => setNewModel({ ...newModel, provider: event.target.value })} placeholder="例如：公司模型平台" className="h-10 border-input bg-card" /></label>
                <div className="space-y-2 text-sm font-medium">接口协议<p className="mt-2 py-2 text-sm font-normal text-muted-foreground">OpenAI Chat Completions</p></div>
              </div>

              <label htmlFor="new-model-url" className="block space-y-2 text-sm font-medium">接口地址<Input id="new-model-url" value={newModel.baseUrl} onChange={(event) => setNewModel({ ...newModel, baseUrl: event.target.value })} placeholder="https://.../v1/chat/completions" className="h-10 border-input bg-card font-mono text-xs" /><span className="block text-xs font-normal text-muted-foreground">请填写完整的 Chat Completions 地址，而不是仅填写 /v1。</span></label>

              <details><summary className="cursor-pointer text-sm text-muted-foreground">高级设置 · Token 上限</summary><div className="mt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <label htmlFor="new-model-input-tokens" className="space-y-2 text-sm font-medium">最大输入 Token<Input id="new-model-input-tokens" type="number" min={1} value={newModel.maxInputTokens} onChange={(event) => setNewModel({ ...newModel, maxInputTokens: Number(event.target.value) })} className="h-10 border-input bg-card" /></label>
                <label htmlFor="new-model-output-tokens" className="space-y-2 text-sm font-medium">最大输出 Token<Input id="new-model-output-tokens" type="number" min={1} value={newModel.maxOutputTokens} onChange={(event) => setNewModel({ ...newModel, maxOutputTokens: Number(event.target.value) })} className="h-10 border-input bg-card" /></label>
              </div>
              </div></details>

              <label htmlFor="new-model-key" className="block space-y-2 text-sm font-medium">API Key（可稍后填写）<Input id="new-model-key" type="password" value={newModelKey} onChange={(event) => setNewModelKey(event.target.value)} placeholder="仅暂存在当前浏览器会话" autoComplete="off" className="h-10 border-input bg-card font-mono" /></label>

              {modelConfigIssues(newModel).length > 0 && <div className="flex gap-2 rounded-xl border border-[#dfb3a8] bg-[#fff1ed] p-3 text-sm text-[#8c4d3f]"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{modelConfigIssues(newModel).join('；')}</span></div>}
            </div>
          )}

          <DialogFooter className="mx-0 mb-0 rounded-none border-border bg-muted px-6 py-4">
            <Button variant="outline" onClick={() => { setNewModel(null); setNewModelKey(''); }}>取消</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary-hover" disabled={!newModel || modelConfigIssues(newModel).length > 0} onClick={addModel}><Plus /> 创建模型</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div aria-label="工作流模型分工" className="border-b border-border pb-4">
          <div className="grid gap-x-5 gap-y-3 lg:grid-cols-3">
            {modelPurposes.map((purpose) => {
              const value = assignments[purpose.id];
              const resolved = resolveModelAssignment(value, models, (id) => apiKeys[id] ?? '');
              const missing = value && value !== LOCAL_RULES && !models.some((model) => model.id === value);
              return (
                <div key={purpose.id} className="min-w-0">
                  <div className="flex items-center gap-2">
                  <label htmlFor={`model-purpose-${purpose.id}`} className="shrink-0 text-sm text-muted-foreground">{purpose.label}</label>
                  <NativeSelect id={`model-purpose-${purpose.id}`} aria-describedby={`model-purpose-help-${purpose.id}`} value={value} disabled={runInProgress} onChange={(event) => onAssignmentsChange({ ...assignments, [purpose.id]: event.target.value })} className="min-w-0 flex-1 text-foreground [&_select]:border-input [&_select]:bg-card">
                    <NativeSelectOption value="">{purpose.id === 'qaReview' ? '暂不设置' : '请选择模型'}</NativeSelectOption>
                    {purpose.id !== 'qaReview' && <NativeSelectOption value={LOCAL_RULES}>本地规则（不调用模型）</NativeSelectOption>}
                    {missing && <NativeSelectOption value={value} disabled>原模型已删除 · 请重新选择</NativeSelectOption>}
                    {models.map((model) => <NativeSelectOption key={model.id} value={model.id} disabled={!model.enabled}>{model.name}{!model.enabled ? '（已停用）' : ''}</NativeSelectOption>)}
                  </NativeSelect>
                  </div>
                  <span id={`model-purpose-help-${purpose.id}`} className="sr-only">{purpose.description}。选择后自动保存。</span>
                  {resolved.issue && !(purpose.id === 'qaReview' && !value) && <output className="mt-1 block text-xs leading-5 text-[#934f3f]">{resolved.issue}</output>}
                </div>
              );
            })}
          </div>
          {runInProgress && <p className="mt-2 text-xs text-[#80631b]">生成任务进行中，完成或停止后可调整用途分配。</p>}
      </div>

      <div>
        <Card className="border-0 bg-card shadow-sm ring-border">
          <div className="border-b border-border px-4 pb-3"><p className="font-semibold">已添加的模型</p><p className="text-xs text-muted-foreground">{models.length} 个模型 · {models.filter((model) => model.enabled).length} 个已启用</p></div>
          <div className="max-h-[720px] space-y-2 overflow-y-auto px-2">
            {models.map((model) => {
              const modelIssues = modelConfigIssues(model);
              const hasKey = Boolean(apiKeys[model.id]);
              return (
                <button key={model.id} type="button" onClick={() => { setSelectedId(model.id); setEditorOpen(true); setTestResult(null); setShowKey(false); }} aria-label={`配置模型 ${model.name}`} className="w-full rounded-lg px-3 py-3 text-left transition hover:bg-muted">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-primary"><Bot className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{model.name}</p>{modelPurposes.filter((purpose) => assignments[purpose.id] === model.id).map((purpose) => <Badge key={purpose.id} className="border-0 bg-primary text-primary-foreground">{purpose.label}</Badge>)}</div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{model.provider} · {model.modelId || '未填写模型 ID'}</p>
                      <p className={`mt-1 text-xs ${!model.enabled || modelIssues.length || !hasKey ? 'text-[#98653c]' : 'text-muted-foreground'}`}>{!model.enabled ? '已停用' : modelIssues.length ? '配置不完整' : !hasKey ? '等待 API Key' : '配置就绪'} · 点击编辑</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Dialog open={editorOpen} onOpenChange={(open) => { if (!testing) { setEditorOpen(open); setShowKey(false); } }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto bg-card sm:max-w-2xl" showCloseButton={!testing}>
          {selected ? (
            <div className="space-y-5">
              <div className="flex flex-col justify-between gap-3 border-b border-border pb-4 pr-6 sm:flex-row sm:items-center">
                <DialogHeader><DialogTitle>编辑模型</DialogTitle><DialogDescription>修改自动保存 · API Key 仅暂存在当前会话</DialogDescription></DialogHeader>
                <div className="flex gap-2"><Button variant="outline" disabled={testing} onClick={() => cloneModel(selected)}><Copy /> 复制</Button><Button variant="outline" className="text-[#914f3f]" disabled={models.length <= 1 || testing} onClick={() => removeModel(selected.id)}><Trash2 /> 删除</Button></div>
              </div>

              {issues.length > 0 && <div className="flex gap-2 rounded-xl border border-[#dfb3a8] bg-[#fff1ed] p-3 text-sm text-[#8c4d3f]"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{issues.join('；')}</span></div>}

              <div className="grid gap-4 md:grid-cols-2">
                <label htmlFor="model-name" className="space-y-2 text-sm font-medium">显示名称<Input id="model-name" value={selected.name} onChange={(event) => updateModel(selected.id, { name: event.target.value })} className="h-10 border-input bg-card" /></label>
                <label htmlFor="model-id" className="space-y-2 text-sm font-medium">模型 ID<Input id="model-id" value={selected.modelId} onChange={(event) => updateModel(selected.id, { modelId: event.target.value })} placeholder="例如 GLM-5.2" className="h-10 border-input bg-card" /></label>
                <label htmlFor="model-provider" className="space-y-2 text-sm font-medium">服务商<Input id="model-provider" value={selected.provider} onChange={(event) => updateModel(selected.id, { provider: event.target.value })} className="h-10 border-input bg-card" /></label>
                <div className="space-y-2 text-sm font-medium">接口协议<p className="mt-2 py-2 text-sm font-normal text-muted-foreground">OpenAI Chat Completions</p></div>
              </div>

              <label htmlFor="model-url" className="block space-y-2 text-sm font-medium">接口地址<Input id="model-url" value={selected.baseUrl} onChange={(event) => updateModel(selected.id, { baseUrl: event.target.value })} placeholder="https://.../v1/chat/completions" className="h-10 border-input bg-card font-mono text-xs" /></label>



              <div className="rounded-xl border border-border bg-muted p-4">
                <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">API Key</p><p className="mt-1 text-xs text-muted-foreground">仅保存在当前浏览器会话，关闭会话后自动清除</p></div><KeyRound className="size-5 text-primary" /></div>
                <div className="mt-3 flex gap-2"><Input type={showKey ? 'text' : 'password'} value={apiKeys[selected.id] ?? ''} onChange={(event) => saveKey(selected.id, event.target.value)} placeholder="在这里粘贴 API Key" autoComplete="off" className="h-10 border-input bg-card font-mono" /><Button variant="outline" size="icon-lg" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey((value) => !value)}><Eye /></Button></div>
                <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!apiKeys[selected.id]} onClick={() => shareKeyWithProvider(selected)}>同步到同服务商模型</Button><Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary-hover" disabled={testing || issues.length > 0 || !apiKeys[selected.id]} onClick={() => void handleTest(selected)}>{testing ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}测试连接</Button></div>
                {testResult && <p className={`mt-3 text-xs ${testResult.ok ? 'text-primary' : 'text-[#934f3f]'}`}>{testResult.message}</p>}
              </div>

              <details className="border-t border-border pt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground">高级设置 · Token 与模型能力</summary>
                <div className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label htmlFor="model-input-tokens" className="space-y-2 text-sm font-medium">最大输入 Token<Input id="model-input-tokens" type="number" min={1} value={selected.maxInputTokens} onChange={(event) => updateModel(selected.id, { maxInputTokens: Number(event.target.value) })} className="h-10 border-input bg-card" /></label>
                <label htmlFor="model-output-tokens" className="space-y-2 text-sm font-medium">最大输出 Token<Input id="model-output-tokens" type="number" min={1} value={selected.maxOutputTokens} onChange={(event) => updateModel(selected.id, { maxOutputTokens: Number(event.target.value) })} className="h-10 border-input bg-card" /></label>
              </div>
                <p className="text-sm font-semibold">模型能力</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {([
                    ['toolCall', '工具调用', Wrench],
                    ['images', '图片输入', Eye],
                    ['reasoning', '推理模式', BrainCircuit],
                    ['structuredOutput', '结构化输出', Braces],
                  ] as const).map(([key, label, Icon]) => <div key={key} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"><div className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" /><span className="text-sm">{label}</span></div><Switch checked={selected.capabilities[key]} onCheckedChange={(checked) => updateCapability(selected.id, key, checked)} aria-label={`切换${label}`} /></div>)}
                </div>
                </div>
              </details>

              <div className="flex flex-col justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3"><Switch checked={selected.enabled} onCheckedChange={(checked) => updateModel(selected.id, { enabled: checked })} aria-label="启用模型" /><span className="text-sm">启用后可分配给工作流用途</span></div>
                <p className="text-xs text-muted-foreground">用途分配在上方统一设置</p>
              </div>
            </div>
          ) : null}
          <DialogFooter><Button variant="outline" disabled={testing} onClick={() => setEditorOpen(false)}>完成</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
