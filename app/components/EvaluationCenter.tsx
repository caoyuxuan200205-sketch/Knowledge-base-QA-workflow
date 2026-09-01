'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Download, FileJson, Filter, Gauge, LoaderCircle, Plus, Search, ShieldCheck, Sparkles, Target, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
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
import { categories, type QaItem } from '@/lib/museum-workflow';

interface EvaluationCenterProps {
  qaItems: QaItem[];
  items: EvaluationItem[];
  museumName: string;
  activeModelName: string;
  modelReady: boolean;
  onItemsChange: (items: EvaluationItem[]) => void;
  onGenerateWithModel: (qaItems: QaItem[], dimensions: EvaluationDimension[], mode: 'replace' | 'append', onProgress: (completed: number, total: number, label: string) => void) => Promise<number>;
}

const statuses: EvaluationStatus[] = ['待审核', '已通过', '需修改'];
const difficulties: EvaluationDifficulty[] = ['基础', '进阶', '挑战'];
const dimensionHelp: Record<EvaluationDimension, string> = {
  标准问答: '验证基础事实是否答对',
  同义改写: '验证换一种说法后仍能命中',
  口语表达: '验证真实游客的自然问法',
  要点完整性: '验证多要点答案是否遗漏',
  抗幻觉边界: '验证资料外细节不被编造',
};

export function EvaluationCenter({ qaItems, items, museumName, activeModelName, modelReady, onItemsChange, onGenerateWithModel }: EvaluationCenterProps) {
  const [sourceMode, setSourceMode] = useState<'approved' | 'all'>('approved');
  const [selectedDimensions, setSelectedDimensions] = useState<EvaluationDimension[]>(['标准问答', '同义改写', '口语表达', '抗幻觉边界']);
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [dimensionFilter, setDimensionFilter] = useState<'全部' | EvaluationDimension>('全部');
  const [statusFilter, setStatusFilter] = useState<'全部' | EvaluationStatus>('全部');
  const [notice, setNotice] = useState('优先使用已审核通过的 QA 生产评测集，避免把错误答案固化为评分标准。评测题默认由当前大模型生成。');
  const [engine, setEngine] = useState<'rules' | 'model'>('rules');
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const engineTouched = useRef(false);

  useEffect(() => {
    if (modelReady && !engineTouched.current) setEngine('model');
  }, [modelReady]);

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
  const selected = items.find((item) => item.id === selectedId) ?? filteredItems[0];
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
      setNotice(`请先到模型管理页为 ${activeModelName} 填写 API Key 并测试连接。`);
      return;
    }
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

  function addManualBoundaryItem() {
    const qa = eligibleQa[0] ?? qaItems[0];
    if (!qa) return;
    const item: EvaluationItem = {
      id: crypto.randomUUID(),
      query: '请输入需要验证拒答或边界判断的问题',
      referenceAnswer: qa.answer,
      category: qa.category,
      dimension: '抗幻觉边界',
      difficulty: '挑战',
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
          <p className="text-sm text-[#78877f]">知识生产 / 评测集生产</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold">用 QA 构建可复用评测集</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#697a73]">评测题与来源 QA 绑定，覆盖事实正确性、表达鲁棒性、答案完整性和抗幻觉边界，可用于后续模型或知识库版本回归测试。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-[#cfc6b4] bg-[#fffdf8]" onClick={addManualBoundaryItem} disabled={!qaItems.length}><Plus /> 新增边界题</Button>
          <Button variant="outline" className="border-[#cfc6b4] bg-[#fffdf8]" onClick={() => exportEvaluationAsJson(items, museumName)} disabled={!items.length}><FileJson /> JSON</Button>
          <Button className="bg-[#1f5143] text-white hover:bg-[#173e34]" onClick={() => exportEvaluationAsExcel(items, museumName)} disabled={!items.length}><Download /> 导出评测集</Button>
        </div>
      </div>

      <Card className="border-0 bg-[#203f36] text-white shadow-sm ring-0">
        <CardContent className="space-y-5">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div><div className="flex items-center gap-2"><Sparkles className="size-5 text-[#e9ce7e]" /><p className="font-serif text-xl font-semibold">生成策略</p></div><p className="mt-2 text-sm text-[#c4d0cc]">选择 QA 范围和评测维度，再生成待审核题目。</p></div>
            <div className="flex flex-wrap gap-2">
              <NativeSelect aria-label="选择出题引擎" value={engine} onChange={(event) => { engineTouched.current = true; setEngine(event.target.value as 'rules' | 'model'); }} className="w-52 text-white [&_select]:border-white/20 [&_select]:bg-white/5"><NativeSelectOption value="model">大模型出题：{activeModelName}</NativeSelectOption><NativeSelectOption value="rules">本地规则（不消耗额度）</NativeSelectOption></NativeSelect>
              <NativeSelect aria-label="评测集来源范围" value={sourceMode} onChange={(event) => setSourceMode(event.target.value as 'approved' | 'all')} className="w-44 text-white [&_select]:border-white/20 [&_select]:bg-white/5"><NativeSelectOption value="approved">仅已通过 QA（推荐）</NativeSelectOption><NativeSelectOption value="all">全部 QA</NativeSelectOption></NativeSelect>
              <Button variant="outline" className="border-white/25 bg-white/5 text-white hover:bg-white/10" disabled={generating} onClick={() => void generate('append')}>{generating ? <LoaderCircle className="animate-spin" /> : null} 追加生成</Button>
              <Button className="bg-[#e2c773] text-[#203f36] hover:bg-[#f0d98d]" disabled={generating} onClick={() => void generate('replace')}>{generating ? <LoaderCircle className="animate-spin" /> : <Sparkles />} 重新生成</Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {evaluationDimensions.map((dimension) => (
              <label key={dimension} className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/15 bg-white/5 p-3">
                <Checkbox checked={selectedDimensions.includes(dimension)} onCheckedChange={(checked) => toggleDimension(dimension, checked === true)} className="mt-0.5" />
                <span><span className="block text-sm font-medium">{dimension}</span><span className="mt-1 block text-xs leading-5 text-white/60">{dimensionHelp[dimension]}</span></span>
              </label>
            ))}
          </div>
          <p className="text-xs text-white/65">当前可用来源：{eligibleQa.length} 条 QA · 已选择 {selectedDimensions.length} 个维度{generationStatus ? ` · ${generationStatus}` : ''}</p>
        </CardContent>
      </Card>

      <output className="flex items-center gap-2 rounded-xl border border-[#d9d0bd] bg-[#fffaf0] px-4 py-3 text-sm text-[#6f6245]"><Target className="size-4 text-[#b38b2c]" />{notice}</output>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['评测题总量', items.length, Target, '条测试样本'],
          ['来源 QA 覆盖', `${stats.qaCoverage}%`, Gauge, `${stats.coveredQa} / ${qaItems.length} 条`],
          ['知识分类', `${stats.coveredCategories}/${categories.length}`, Filter, '分类覆盖'],
          ['评测维度', `${stats.coveredDimensions}/${evaluationDimensions.length}`, ShieldCheck, '维度覆盖'],
          ['已审核通过', stats.approved, CheckCircle2, `${items.length ? Math.round(stats.approved / items.length * 100) : 0}% 完成`],
        ].map(([label, value, Icon, hint]) => (
          <Card key={String(label)} className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]"><CardContent className="flex items-start justify-between gap-2"><div><p className="text-xs text-[#7a8881]">{label as string}</p><p className="mt-2 font-serif text-2xl font-semibold">{value as string | number}</p><p className="mt-1 text-xs text-[#87938e]">{hint as string}</p></div><span className="grid size-9 place-items-center rounded-xl bg-[#e7eee9] text-[#2e604f]"><Icon className="size-4" /></span></CardContent></Card>
        ))}
      </div>

      <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]"><CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#829089]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索测试问题、参考答案或来源" className="h-10 border-[#d4cdbf] bg-[#faf8f2] pl-9" /></div><NativeSelect aria-label="筛选评测维度" value={dimensionFilter} onChange={(event) => setDimensionFilter(event.target.value as '全部' | EvaluationDimension)} className="w-full lg:w-40"><NativeSelectOption value="全部">全部维度</NativeSelectOption>{evaluationDimensions.map((dimension) => <NativeSelectOption key={dimension} value={dimension}>{dimension}</NativeSelectOption>)}</NativeSelect><NativeSelect aria-label="筛选评测状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '全部' | EvaluationStatus)} className="w-full lg:w-36"><NativeSelectOption value="全部">全部状态</NativeSelectOption>{statuses.map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}</NativeSelect></CardContent></Card>

      <div className="grid min-h-[560px] gap-4 2xl:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)]">
        <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
          <div className="flex items-center justify-between border-b border-[#e3ddd1] px-4 pb-3"><div><p className="font-semibold">评测样本</p><p className="text-xs text-[#829089]">显示 {filteredItems.length} 条</p></div><Button variant="ghost" size="sm" className="text-[#8c4e40]" onClick={() => onItemsChange([])} disabled={!items.length}><Trash2 /> 清空</Button></div>
          <div className="max-h-[650px] overflow-y-auto px-2">{filteredItems.length ? filteredItems.map((item, index) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`my-2 w-full rounded-xl border p-3 text-left transition ${selected?.id === item.id ? 'border-[#7ca08e] bg-[#eef4ef]' : 'border-transparent hover:border-[#e2dbce] hover:bg-[#f8f5ee]'} ${item.status !== '待审核' ? 'opacity-65 saturate-75' : ''}`}><div className="flex items-start gap-3"><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[#ebe6d9] text-xs font-semibold">{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2"><Badge className="border-0 bg-[#e3ece6] text-[#35634f]">{item.dimension}</Badge><Badge variant="outline">{item.difficulty}</Badge><Badge variant="outline">{item.status}</Badge></div><p className="mt-2 line-clamp-2 font-medium leading-6">{item.query}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#75827c]">{item.referenceAnswer}</p></div></div></button>) : <div className="grid min-h-80 place-items-center px-8 text-center"><div><Target className="mx-auto size-9 text-[#a5ada9]" /><p className="mt-3 font-medium">还没有评测样本</p><p className="mt-1 text-xs text-[#89938e]">从上方选择策略并生成评测集。</p></div></div>}</div>
        </Card>

        <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">{selected ? <CardContent className="space-y-5"><div className="flex flex-col justify-between gap-3 border-b border-[#e3ddd1] pb-4 sm:flex-row sm:items-center"><div><p className="font-serif text-xl font-semibold">审核评测样本</p><p className="mt-1 text-xs text-[#83908a]">确保问题自然、参考答案正确、评分标准可执行</p></div><div className="flex gap-2"><Button variant="outline" className="border-[#d2b0a7] text-[#8d4c3d]" onClick={removeCurrent}><Trash2 /> 删除</Button><Button variant="outline" className="border-[#d2b0a7] text-[#8d4c3d]" onClick={() => reviewAndNext('需修改')}>需修改</Button><Button className="bg-[#1f5143] text-white hover:bg-[#173e34]" onClick={() => reviewAndNext('已通过')}><Check /> 通过</Button></div></div>
          <div className="grid gap-4 sm:grid-cols-3"><label className="space-y-2 text-sm font-medium">评测维度<NativeSelect value={selected.dimension} onChange={(event) => updateItem(selected.id, { dimension: event.target.value as EvaluationDimension, status: '待审核' })} className="w-full">{evaluationDimensions.map((dimension) => <NativeSelectOption key={dimension} value={dimension}>{dimension}</NativeSelectOption>)}</NativeSelect></label><label className="space-y-2 text-sm font-medium">难度<NativeSelect value={selected.difficulty} onChange={(event) => updateItem(selected.id, { difficulty: event.target.value as EvaluationDifficulty })} className="w-full">{difficulties.map((difficulty) => <NativeSelectOption key={difficulty} value={difficulty}>{difficulty}</NativeSelectOption>)}</NativeSelect></label><label className="space-y-2 text-sm font-medium">审核状态<NativeSelect value={selected.status} onChange={(event) => updateItem(selected.id, { status: event.target.value as EvaluationStatus })} className="w-full">{statuses.map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}</NativeSelect></label></div>
          <label className="block space-y-2 text-sm font-medium">测试问题<Textarea value={selected.query} onChange={(event) => updateItem(selected.id, { query: event.target.value, status: '待审核' })} className="min-h-24 border-[#d4cdbf] bg-[#faf8f2] text-base leading-6" /></label>
          <label className="block space-y-2 text-sm font-medium">参考答案<Textarea value={selected.referenceAnswer} onChange={(event) => updateItem(selected.id, { referenceAnswer: event.target.value, status: '待审核' })} className="min-h-40 border-[#d4cdbf] bg-[#faf8f2] leading-7" /></label>
          <label className="block space-y-2 text-sm font-medium">评分标准<Textarea value={selected.scoringCriteria} onChange={(event) => updateItem(selected.id, { scoringCriteria: event.target.value, status: '待审核' })} className="min-h-24 border-[#d4cdbf] bg-[#faf8f2] leading-6" /></label>
          <label className="block space-y-2 text-sm font-medium">必含关键词（用顿号分隔）<Input value={selected.requiredKeywords.join('、')} onChange={(event) => updateItem(selected.id, { requiredKeywords: event.target.value.split(/[、,，]/).map((value) => value.trim()).filter(Boolean) })} className="h-10 border-[#d4cdbf] bg-[#faf8f2]" /></label>
          <div className="rounded-xl border border-[#ddd5c7] bg-[#f7f4ec] p-4 text-xs leading-5 text-[#66766f]"><p>来源：{selected.source}</p><p className="mt-1">来源 QA：{selected.sourceQaId}</p></div>
        </CardContent> : <div className="grid min-h-[560px] place-items-center p-8 text-center"><div><Target className="mx-auto size-10 text-[#a7afaa]" /><p className="mt-4 font-serif text-xl font-semibold">选择一条评测题开始审核</p></div></div>}</Card>
      </div>
    </section>
  );
}
