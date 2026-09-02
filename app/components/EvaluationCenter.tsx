'use client';

import { useMemo, useState } from 'react';
import { Check, Download, LoaderCircle, Search, Sparkles, Target, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  evaluationDimensions,
  exportEvaluationAsExcel,
  exportEvaluationAsJson,
  generateEvaluationSet,
  type EvaluationDifficulty,
  type EvaluationDimension,
  type EvaluationItem,
  type EvaluationStatus,
} from '@/lib/evaluation-workflow';
import type { QaItem } from '@/lib/museum-workflow';

interface EvaluationCenterProps {
  qaItems: QaItem[];
  items: EvaluationItem[];
  museumName: string;
  activeModelName: string;
  modelReady: boolean;
  engine: 'rules' | 'model';
  configurationIssue: string;
  onOpenModelSettings: () => void;
  runInProgress?: boolean;
  stopping?: boolean;
  onStop: () => void;
  onItemsChange: (items: EvaluationItem[]) => void;
  onGenerateWithModel: (qaItems: QaItem[], dimensions: EvaluationDimension[], mode: 'replace' | 'append', onProgress: (completed: number, total: number, label: string) => void) => Promise<number>;
}

const statuses: EvaluationStatus[] = ['待审核', '已通过', '需修改'];
const difficulties: EvaluationDifficulty[] = ['基础', '进阶', '困难'];
const dimensionHelp: Record<EvaluationDimension, string> = {
  标准问答: '验证基础事实是否答对',
  同义改写: '验证换一种说法后仍能命中',
  口语表达: '验证真实游客的自然问法',
  要点完整性: '验证多要点答案是否遗漏',
  抗幻觉边界: '验证资料外细节不被编造',
};

export function EvaluationCenter({ qaItems, items, museumName, activeModelName, modelReady, engine, configurationIssue, onOpenModelSettings, runInProgress = false, onItemsChange, onGenerateWithModel }: EvaluationCenterProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generationMode, setGenerationMode] = useState<'append' | 'replace'>('append');
  const [sourceMode, setSourceMode] = useState<'approved' | 'all'>('approved');
  const [selectedDimensions, setSelectedDimensions] = useState<EvaluationDimension[]>(['标准问答', '同义改写', '口语表达', '抗幻觉边界']);
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [dimensionFilter, setDimensionFilter] = useState<'全部' | EvaluationDimension>('全部');
  const [statusFilter, setStatusFilter] = useState<'全部' | EvaluationStatus>('全部');
  const [notice, setNotice] = useState('优先使用已审核通过的 QA 生产评测集，避免把错误答案固化为评分标准。出题模型在模型配置页统一设置。');
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  const eligibleQa = useMemo(() => sourceMode === 'approved' ? qaItems.filter((item) => item.status === '已通过') : qaItems, [qaItems, sourceMode]);
  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesKeyword = !keyword || `${item.query} ${item.referenceAnswer} ${item.source}`.toLowerCase().includes(keyword);
      const matchesDimension = dimensionFilter === '全部' || item.dimension === dimensionFilter;
      const matchesStatus = statusFilter === '全部' || item.status === statusFilter;
      return matchesKeyword && matchesDimension && matchesStatus;
    });
  }, [dimensionFilter, items, search, statusFilter]);
  const selected = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0];
  const stats = useMemo(() => {
    const approved = items.filter((item) => item.status === '已通过').length;
    const coveredQa = new Set(items.map((item) => item.sourceQaId)).size;
    const coveredCategories = new Set(items.map((item) => item.category)).size;
    const coveredDimensions = new Set(items.map((item) => item.dimension)).size;
    return {
      approved,
      coveredQa,
      coveredCategories,
      coveredDimensions,
      qaCoverage: qaItems.length ? Math.round((coveredQa / qaItems.length) * 100) : 0,
    };
  }, [items, qaItems.length]);

  function toggleDimension(dimension: EvaluationDimension, checked: boolean) {
    setSelectedDimensions((current) => checked ? Array.from(new Set([...current, dimension])) : current.filter((item) => item !== dimension));
  }

  async function generate(mode: 'replace' | 'append') {
    if (!eligibleQa.length) {
      setNotice(sourceMode === 'approved' ? '目前没有已审核通过的 QA，请先完成 QA 审核，或切换为“全部 QA”。' : '目前没有可用 QA。');
      return;
    }
    if (!selectedDimensions.length) {
      setNotice('请至少选择一个评测维度。');
      return;
    }
    if (engine === 'model' && !modelReady) {
      setNotice(`测评集生成：${configurationIssue}。请到模型配置页完善。`);
      return;
    }
    if (mode === 'replace' && items.length && !window.confirm(`将替换现有 ${items.length} 条测评题。确定重新生成？`)) return;
    setSettingsOpen(false);
    setGenerating(true);
    setGenerationStatus(engine === 'model' ? `正在调用 ${activeModelName} 出题…` : '正在使用本地规则生成…');
    try {
      if (engine === 'model') {
        const count = await onGenerateWithModel(eligibleQa, selectedDimensions, mode, (completed, total, label) => {
          setGenerationStatus(total > 0 ? `模型出题 ${completed}/${total} · ${label}` : label);
        });
        if (!count) {
          setNotice('没有生成评测题，请调整 QA 范围或评测维度后重试。');
          return;
        }
        setNotice(`已由 ${activeModelName} 从 ${eligibleQa.length} 条 QA 生成 ${count} 条评测题（逐批入库）：“标准问答”直接取自来源QA，其余维度由模型出题，请逐条审核。`);
        return;
      }
      const generated = generateEvaluationSet(eligibleQa, selectedDimensions);
      if (!generated.length) {
        setNotice('没有生成评测题，请调整 QA 范围或评测维度后重试。');
        return;
      }
      const next = mode === 'replace' ? generated : [...items, ...generated].filter((item, index, all) => {
        const key = `${item.sourceQaId}:${item.dimension}:${item.query.replace(/\s/g, '')}`;
        return all.findIndex((candidate) => `${candidate.sourceQaId}:${candidate.dimension}:${candidate.query.replace(/\s/g, '')}` === key) === index;
      });
      onItemsChange(next);
      setSelectedId(generated[0]?.id ?? next[0]?.id ?? '');
      setNotice(`已从 ${eligibleQa.length} 条 QA 生成 ${generated.length} 条评测题；要点较短的答案会跳过“要点完整性”维度。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '生成失败，请检查模型配置后重试');
    } finally {
      setGenerating(false);
      setGenerationStatus('');
    }
  }

  function updateItem(id: string, patch: Partial<EvaluationItem>) {
    onItemsChange(items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }

  function reviewAndNext(status: EvaluationStatus) {
    if (!selected) return;
    updateItem(selected.id, { status });
    const index = filteredItems.findIndex((item) => item.id === selected.id);
    const next = filteredItems[index + 1];
    if (next) {
      setSelectedId(next.id);
    } else {
      setNotice('已处理完当前筛选下的最后一条。');
    }
  }

  function removeCurrent() {
    if (!selected) return;
    if (!window.confirm(`确认删除这条评测题？此操作不可恢复。\n\n「${selected.query.slice(0, 40)}」`)) return;
    const index = filteredItems.findIndex((item) => item.id === selected.id);
    onItemsChange(items.filter((item) => item.id !== selected.id));
    const remaining = filteredItems.filter((item) => item.id !== selected.id);
    const next = remaining[index] ?? remaining[remaining.length - 1];
    if (next) setSelectedId(next.id);
    setNotice('已删除 1 条评测题。');
  }

  function clearEvaluationItems() {
    if (!items.length || runInProgress) return;
    if (!window.confirm(`确认清空全部 ${items.length} 条测评题？此操作不可恢复。`)) return;
    onItemsChange([]);
    setSelectedId('');
    setSearch('');
    setDimensionFilter('全部');
    setStatusFilter('全部');
    setNotice(`已清空全部 ${items.length} 条测评题。`);
  }

  function addManualBoundaryItem() {
    const qa = eligibleQa[0] ?? qaItems[0];
    if (!qa) return;
    const item: EvaluationItem = {
      id: crypto.randomUUID(),
      query: '请输入需要验证拒答或边界判断的问题',
      referenceAnswer: qa.answer,
      category: qa.category,
      dimension: '抗幻觉边界',
      difficulty: '困难',
      sourceQaId: qa.id,
      source: qa.source,
      scoringCriteria: '资料覆盖范围内如实回答；无法从资料确认的部分明确说明，不得编造。',
      requiredKeywords: [],
      status: '待审核',
      updatedAt: new Date().toISOString(),
    };
    onItemsChange([item, ...items]);
    setSelectedId(item.id);
  }

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-2xl font-semibold">测评集</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="bg-primary text-primary-foreground hover:bg-primary-hover" disabled={generating || runInProgress} onClick={() => setSettingsOpen(true)}><Sparkles /> 生成测评集</Button>
          <Button variant="outline" onClick={() => exportEvaluationAsExcel(items, museumName)} disabled={!items.length}><Download /> 导出</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>更多</DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled={!qaItems.length} onClick={addManualBoundaryItem}>新增边界题</DropdownMenuItem>
              <DropdownMenuItem disabled={!items.length} onClick={() => exportEvaluationAsJson(items, museumName)}>导出 JSON</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={!items.length || runInProgress} onClick={() => { if (window.confirm(`确认清空全部 ${items.length} 条测评题？无法撤销。`)) onItemsChange([]); }}>清空测评集</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-card sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>生成测评集</DialogTitle>
            <DialogDescription>优先使用已通过的 QA，选择本次需要的测评维度。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>出题：{activeModelName}</span><button type="button" className="underline" onClick={() => { setSettingsOpen(false); onOpenModelSettings(); }}>模型配置</button></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="eval-source" className="space-y-2 text-sm">QA 范围<NativeSelect id="eval-source" value={sourceMode} onChange={(event) => setSourceMode(event.target.value as 'approved' | 'all')} className="mt-2 w-full"><NativeSelectOption value="approved">仅已通过 QA（推荐）</NativeSelectOption><NativeSelectOption value="all">全部 QA</NativeSelectOption></NativeSelect></label>
            <label htmlFor="eval-mode" className="space-y-2 text-sm">生成方式<NativeSelect id="eval-mode" value={generationMode} onChange={(event) => setGenerationMode(event.target.value as 'append' | 'replace')} className="mt-2 w-full"><NativeSelectOption value="append">追加新题</NativeSelectOption><NativeSelectOption value="replace">替换现有测评集</NativeSelectOption></NativeSelect></label>
          </div>
          <div className="space-y-2">
            {evaluationDimensions.map((dimension) => <label key={dimension} htmlFor={`dimension-${dimension}`} className="flex cursor-pointer items-start gap-3 py-2">
              <Checkbox id={`dimension-${dimension}`} checked={selectedDimensions.includes(dimension)} onCheckedChange={(checked) => toggleDimension(dimension, checked === true)} />
              <span><span className="text-sm font-medium">{dimension}</span><span className="ml-2 text-xs text-muted-foreground">{dimensionHelp[dimension]}</span></span>
            </label>)}
          </div>
          <p className="text-xs text-muted-foreground">{eligibleQa.length} 条 QA · {selectedDimensions.length} 个维度</p>
          {!modelReady && <output className="text-sm text-[#934f3f]">{configurationIssue}，请到模型配置页完善。</output>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button>
            <Button className="bg-primary text-primary-foreground" disabled={generating || runInProgress || !modelReady || !eligibleQa.length || !selectedDimensions.length} onClick={() => void generate(generationMode)}>开始生成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {generationStatus && <output className="flex items-center gap-2 text-sm text-primary"><LoaderCircle className="size-4 animate-spin" />{generationStatus}</output>}

      {notice && <output className="flex items-center justify-between gap-3 rounded-xl border border-info-border bg-info px-4 py-3 text-xs leading-5 text-info-foreground"><span>{notice}</span><button type="button" aria-label="关闭测评提示" className="shrink-0 px-2" onClick={() => setNotice('')}>×</button></output>}
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border pb-3 text-sm text-muted-foreground">
        <span>共 {items.length} 题</span><span>已通过 {stats.approved} 题</span><span>来源 QA 覆盖 {stats.qaCoverage}%</span><span>{stats.coveredDimensions}/{evaluationDimensions.length} 个维度</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索测试问题、参考答案或来源" className="h-10 border-input bg-card pl-9" /></div><NativeSelect aria-label="筛选评测维度" value={dimensionFilter} onChange={(event) => setDimensionFilter(event.target.value as '全部' | EvaluationDimension)} className="w-full lg:w-40"><NativeSelectOption value="全部">全部维度</NativeSelectOption>{evaluationDimensions.map((dimension) => <NativeSelectOption key={dimension} value={dimension}>{dimension}</NativeSelectOption>)}</NativeSelect><NativeSelect aria-label="筛选评测状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '全部' | EvaluationStatus)} className="w-full lg:w-36"><NativeSelectOption value="全部">全部状态</NativeSelectOption>{statuses.map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}</NativeSelect></div>

      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
        <Card className="border-0 bg-card shadow-sm ring-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3">
            <div>
              <p className="font-semibold">评测样本</p>
              <p className="text-xs text-muted-foreground">显示 {filteredItems.length} 条</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-[#8d4c3d] hover:bg-[#fff0ec] hover:text-[#8d4c3d]"
              disabled={!items.length || runInProgress}
              title={runInProgress ? '请先完成或停止当前任务' : '清空全部测评题'}
              onClick={clearEvaluationItems}
            >
              <Trash2 /> 一键清空
            </Button>
          </div>
          <div className="max-h-[650px] overflow-y-auto px-2">{filteredItems.length ? filteredItems.map((item, index) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`my-2 w-full rounded-xl border p-3 text-left transition ${selected?.id === item.id ? 'border-ring bg-accent' : 'border-transparent hover:border-border hover:bg-muted'} ${item.status !== '待审核' ? 'opacity-65 saturate-75' : ''}`}><div className="flex items-start gap-3"><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><Badge className="border-0 bg-accent text-primary">{item.dimension}</Badge><Badge variant="outline">{item.difficulty}</Badge><Badge variant="outline">{item.status}</Badge></div><p className="mt-2 line-clamp-2 font-medium leading-6">{item.query}</p><p className="mt-1 truncate text-xs leading-5 text-muted-foreground">{item.referenceAnswer}</p></div></div></button>) : <div className="grid min-h-80 place-items-center px-8 text-center"><div><Target className="mx-auto size-9 text-muted-foreground/50" /><p className="mt-3 font-medium">还没有评测样本</p><p className="mt-1 text-xs text-muted-foreground">点击“生成测评集”开始。</p></div></div>}</div>
        </Card>

        <Card className="border-0 bg-card shadow-sm ring-border">{selected ? <CardContent className="space-y-5"><div className="flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-center"><div><p className="font-sans text-xl font-semibold">审核评测样本</p><p className="mt-1 text-xs text-muted-foreground">确保问题自然、参考答案正确、评分标准可执行</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" className="border-[#d2b0a7] text-[#8d4c3d]" onClick={removeCurrent}><Trash2 /> 删除</Button><Button variant="outline" className="border-[#d2b0a7] text-[#8d4c3d]" onClick={() => reviewAndNext('需修改')}>需修改</Button><Button className="bg-primary text-primary-foreground hover:bg-primary-hover" onClick={() => reviewAndNext('已通过')}><Check /> 通过并下一条</Button></div></div>
          <div className="grid gap-4 sm:grid-cols-3"><label className="space-y-2 text-sm font-medium">评测维度<NativeSelect value={selected.dimension} onChange={(event) => updateItem(selected.id, { dimension: event.target.value as EvaluationDimension, status: '待审核' })} className="w-full">{evaluationDimensions.map((dimension) => <NativeSelectOption key={dimension} value={dimension}>{dimension}</NativeSelectOption>)}</NativeSelect></label><label className="space-y-2 text-sm font-medium">难度<NativeSelect value={selected.difficulty} onChange={(event) => updateItem(selected.id, { difficulty: event.target.value as EvaluationDifficulty })} className="w-full">{difficulties.map((difficulty) => <NativeSelectOption key={difficulty} value={difficulty}>{difficulty}</NativeSelectOption>)}</NativeSelect></label><label className="space-y-2 text-sm font-medium">审核状态<NativeSelect value={selected.status} onChange={(event) => updateItem(selected.id, { status: event.target.value as EvaluationStatus })} className="w-full">{statuses.map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}</NativeSelect></label></div>
          <label className="block space-y-2 text-sm font-medium">测试问题<Textarea value={selected.query} onChange={(event) => updateItem(selected.id, { query: event.target.value, status: '待审核' })} className="min-h-24 border-input bg-card text-base leading-6" /></label>
          <label className="block space-y-2 text-sm font-medium">参考答案<Textarea value={selected.referenceAnswer} onChange={(event) => updateItem(selected.id, { referenceAnswer: event.target.value, status: '待审核' })} className="min-h-40 border-input bg-card leading-7" /></label>
          <label className="block space-y-2 text-sm font-medium">评分标准<Textarea value={selected.scoringCriteria} onChange={(event) => updateItem(selected.id, { scoringCriteria: event.target.value, status: '待审核' })} className="min-h-24 border-input bg-card leading-6" /></label>
          <label className="block space-y-2 text-sm font-medium">必含关键词（用顿号分隔）<Input value={selected.requiredKeywords.join('、')} onChange={(event) => updateItem(selected.id, { requiredKeywords: event.target.value.split(/[、,，]/).map((value) => value.trim()).filter(Boolean) })} className="h-10 border-input bg-card" /></label>
          <div className="rounded-xl border border-border bg-muted p-4 text-xs leading-5 text-muted-foreground"><p>来源：{selected.source}</p></div>
        </CardContent> : <div className="grid min-h-[560px] place-items-center p-8 text-center"><div><Target className="mx-auto size-10 text-muted-foreground/50" /><p className="mt-4 font-sans text-xl font-semibold">选择一条评测题开始审核</p></div></div>}</Card>
      </div>
    </section>
  );
}
