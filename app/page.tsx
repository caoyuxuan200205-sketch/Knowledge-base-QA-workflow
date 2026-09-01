/* oxlint-disable react(react-compiler) -- client workspace state is intentionally restored from localStorage */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Download,
  FileJson,
  FileSpreadsheet,
  Filter,
  LibraryBig,
  LoaderCircle,
  Settings2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { ImportCenter, type ImportHistoryItem } from '@/app/components/ImportCenter';
import { EvaluationCenter } from '@/app/components/EvaluationCenter';
import { ModelSettings } from '@/app/components/ModelSettings';
import type { EvaluationDimension, EvaluationItem } from '@/lib/evaluation-workflow';
import { defaultModels, type ModelConfig } from '@/lib/model-registry';
import { readModelSecret } from '@/lib/model-secrets';
import { generateEvaluationWithModel } from '@/lib/evaluation-model-service';
import { generateQaWithModel } from '@/lib/qa-model-service';
import {
  categories,
  demoQa,
  exportQaAsExcel,
  exportQaAsJson,
  generateQaFromParsedSources,
  type KnowledgeCategory,
  type ParsedSourceFile,
  type QaItem,
  type ReviewStatus,
} from '@/lib/museum-workflow';

const STORAGE_KEY = 'museum-kb-workflow-v1';
const statuses: ReviewStatus[] = ['待审核', '已通过', '需修改'];

const categoryTone: Record<KnowledgeCategory, string> = {
  文物信息: 'bg-[#ede3c8] text-[#755d25]',
  展览内容: 'bg-[#dde8ec] text-[#315f6c]',
  馆务服务: 'bg-[#e2ece6] text-[#32614d]',
  参观政策: 'bg-[#eee1dc] text-[#804b3c]',
  基建导览: 'bg-[#e5e1ee] text-[#5d4f79]',
  其他: 'bg-[#e8e6e1] text-[#68645c]',
};

const statusTone: Record<ReviewStatus, string> = {
  待审核: 'border-[#d9bd72] bg-[#fff8e4] text-[#80631b]',
  已通过: 'border-[#9bc0ac] bg-[#eaf5ee] text-[#2e644a]',
  需修改: 'border-[#d7a79a] bg-[#fff0ec] text-[#914f3f]',
};

function todayLabel() {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
}

function mergeInto(current: QaItem[], incoming: QaItem[]) {
  const keys = new Set(current.map((item) => item.question.replace(/[？?\s]/g, '').toLowerCase()));
  const additions = incoming.filter((item) => {
    const key = item.question.replace(/[？?\s]/g, '').toLowerCase();
    if (!key || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  return additions.length ? [...current, ...additions] : current;
}

export default function Home() {
  const [activeView, setActiveView] = useState<'import' | 'review' | 'evaluation' | 'models'>('import');
  const [museumName, setMuseumName] = useState('湖南博物院');
  const [items, setItems] = useState<QaItem[]>(demoQa);
  const [sources, setSources] = useState<ParsedSourceFile[]>([]);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [evaluationItems, setEvaluationItems] = useState<EvaluationItem[]>([]);
  const [models, setModels] = useState<ModelConfig[]>(defaultModels);
  const [activeModelId, setActiveModelId] = useState(defaultModels[0].id);
  const [selectedId, setSelectedId] = useState(demoQa[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'全部' | KnowledgeCategory>('全部');
  const [statusFilter, setStatusFilter] = useState<'全部' | ReviewStatus>('全部');
  const [notice, setNotice] = useState('已载入示例数据，可以直接编辑或导入馆方资料。');
  const [hydrated, setHydrated] = useState(false);
  const [generationRun, setGenerationRun] = useState<{ completed: number; total: number; label: string } | null>(null);
  const runActiveRef = useRef(false);
  const stopRef = useRef(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved) as { museumName?: string; items?: QaItem[]; history?: ImportHistoryItem[]; evaluationItems?: EvaluationItem[]; models?: ModelConfig[]; activeModelId?: string };
          if (data.museumName) setMuseumName(data.museumName);
          if (data.items?.length) {
            setItems(data.items);
            setSelectedId(data.items[0].id);
            setNotice(`已恢复本地工作区，共 ${data.items.length} 条 QA。`);
          }
          if (data.history) setHistory(data.history);
          if (data.evaluationItems) setEvaluationItems(data.evaluationItems);
          if (data.models?.length) setModels(data.models);
          if (data.activeModelId) setActiveModelId(data.activeModelId);
        }
      } catch {
        setNotice('本地历史数据读取失败，已载入示例数据。');
      } finally {
        setHydrated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ museumName, items, history, evaluationItems, models, activeModelId }));
  }, [activeModelId, evaluationItems, history, hydrated, items, models, museumName]);

  const stats = useMemo(() => {
    const approved = items.filter((item) => item.status === '已通过').length;
    const needsWork = items.filter((item) => item.status === '需修改').length;
    const categoriesCount = new Set(items.map((item) => item.category)).size;
    return { approved, needsWork, categoriesCount, progress: items.length ? Math.round((approved / items.length) * 100) : 0 };
  }, [items]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !keyword || `${item.question} ${item.answer} ${item.source}`.toLowerCase().includes(keyword);
      const matchesCategory = categoryFilter === '全部' || item.category === categoryFilter;
      const matchesStatus = statusFilter === '全部' || item.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [categoryFilter, items, search, statusFilter]);

  const selected = items.find((item) => item.id === selectedId) ?? filteredItems[0];
  const activeModel = models.find((model) => model.id === activeModelId) ?? models.find((model) => model.enabled) ?? models[0];
  const activeModelKey = hydrated && activeModel ? readModelSecret(activeModel.id) : '';

  async function handleImport(importSources: ParsedSourceFile[], mode: 'append' | 'replace', engine: 'rules' | 'model', onProgress: (completed: number, total: number, label: string) => void) {
    if (runActiveRef.current) throw new Error('已有生成任务正在进行中，请等待完成后再导入。');
    if (engine === 'model' && !activeModel) throw new Error('请先选择一个可用模型');

    if (engine === 'model' && activeModel) {
      runActiveRef.current = true;
      stopRef.current = false;
      setGenerationRun({ completed: 0, total: 0, label: '准备调用模型' });
      let generatedCount = 0;
      let replaced = false;
      try {
        await generateQaWithModel(
          importSources,
          activeModel,
          activeModelKey,
          (completed, total, label) => {
            setGenerationRun({ completed, total, label });
            onProgress(completed, total, label);
          },
          (batchItems) => {
            if (!batchItems.length) return;
            generatedCount += batchItems.length;
            if (mode === 'replace' && !replaced) {
              replaced = true;
              setItems(batchItems);
            } else {
              setItems((current) => mergeInto(current, batchItems));
            }
          },
          () => stopRef.current,
        );
      } finally {
        runActiveRef.current = false;
        setGenerationRun(null);
      }
      if (stopRef.current) {
        throw new Error(`已停止生成：已入库 ${generatedCount} 条候选 QA。重新导入可继续（已入库的会自动去重）。`);
      }
      if (!generatedCount) {
        setNotice('没有生成可用的 QA，请检查所选工作表和字段映射。');
        return;
      }
      setHistory((current) => [{ id: crypto.randomUUID(), fileNames: importSources.map((source) => source.fileName), importedAt: new Date().toISOString(), generatedCount, mode }, ...current].slice(0, 20));
      setNotice(`导入完成：${importSources.length} 个文件生成 ${generatedCount} 条候选 QA，已逐批入库，可边生成边审核。`);
      setSearch('');
      setCategoryFilter('全部');
      setStatusFilter('全部');
      setActiveView('review');
      return;
    }

    const generated = generateQaFromParsedSources(importSources);
    if (!generated.length) {
      setNotice('没有生成可用的 QA，请检查所选工作表和字段映射。');
      return;
    }
    const merged = mode === 'replace' ? generated : [...items, ...generated].filter((item, index, all) => {
      const key = item.question.replace(/[？?\s]/g, '').toLowerCase();
      return all.findIndex((candidate) => candidate.question.replace(/[？?\s]/g, '').toLowerCase() === key) === index;
    });
    setItems(merged);
    setSelectedId(generated[0]?.id ?? merged[0]?.id ?? '');
    setHistory((current) => [{ id: crypto.randomUUID(), fileNames: importSources.map((source) => source.fileName), importedAt: new Date().toISOString(), generatedCount: generated.length, mode }, ...current].slice(0, 20));
    setNotice(`导入完成：${importSources.length} 个文件生成 ${generated.length} 条候选 QA。`);
    setSearch('');
    setCategoryFilter('全部');
    setStatusFilter('全部');
    setActiveView('review');
  }

  async function handleEvaluationGenerate(
    evaluationSources: QaItem[],
    dimensions: EvaluationDimension[],
    mode: 'replace' | 'append',
    onProgress: (completed: number, total: number, label: string) => void,
  ): Promise<number> {
    if (runActiveRef.current) throw new Error('已有生成任务正在进行中，请等待完成。');
    if (!activeModel) throw new Error('请先选择一个可用模型');

    runActiveRef.current = true;
    stopRef.current = false;
    setGenerationRun({ completed: 0, total: 0, label: '准备生成评测集' });
    let count = 0;
    let replaced = false;
    try {
      await generateEvaluationWithModel(
        evaluationSources,
        dimensions,
        activeModel,
        activeModelKey,
        (completed, total, label) => {
          setGenerationRun({ completed, total, label });
          onProgress(completed, total, label);
        },
        (batchItems) => {
          if (!batchItems.length) return;
          count += batchItems.length;
          if (mode === 'replace' && !replaced) {
            replaced = true;
            setEvaluationItems(batchItems);
          } else {
            setEvaluationItems((current) => {
              const keys = new Set(current.map((item) => `${item.sourceQaId}:${item.dimension}:${item.query.replace(/\s/g, '')}`));
              const additions = batchItems.filter((item) => {
                const key = `${item.sourceQaId}:${item.dimension}:${item.query.replace(/\s/g, '')}`;
                if (keys.has(key)) return false;
                keys.add(key);
                return true;
              });
              return additions.length ? [...current, ...additions] : current;
            });
          }
        },
        () => stopRef.current,
      );
    } finally {
      runActiveRef.current = false;
      setGenerationRun(null);
    }
    if (stopRef.current) {
      throw new Error(`已停止评测集生成，已入库 ${count} 条评测题。`);
    }
    return count;
  }

  function stopGeneration() {
    stopRef.current = true;
    setNotice('正在停止，请等待当前批次完成…');
  }

  function updateItem(id: string, patch: Partial<QaItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item)));
  }

  function reviewAndNext(status: '已通过' | '需修改') {
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
    if (!window.confirm(`确认删除这条 QA？此操作不可恢复。\n\n「${selected.question.slice(0, 40)}」`)) return;
    const index = filteredItems.findIndex((item) => item.id === selected.id);
    setItems((current) => current.filter((item) => item.id !== selected.id));
    const remaining = filteredItems.filter((item) => item.id !== selected.id);
    const next = remaining[index] ?? remaining[remaining.length - 1];
    if (next) setSelectedId(next.id);
    setNotice('已删除 1 条 QA。');
  }

  function addBlankItem() {
    const item: QaItem = {
      id: crypto.randomUUID(),
      question: '请输入问题',
      answer: '请输入有来源依据的答案',
      category: '其他',
      source: '人工新增',
      status: '待审核',
      confidence: 1,
      updatedAt: new Date().toISOString(),
    };
    setItems((current) => [item, ...current]);
    setSelectedId(item.id);
  }

  function approveVisible() {
    const visibleIds = new Set(filteredItems.map((item) => item.id));
    setItems((current) => current.map((item) => (visibleIds.has(item.id) ? { ...item, status: '已通过', updatedAt: new Date().toISOString() } : item)));
    setNotice(`已批量通过 ${visibleIds.size} 条当前筛选结果。`);
  }

  function resetWorkspace() {
    localStorage.removeItem(STORAGE_KEY);
    setItems(demoQa);
    setEvaluationItems([]);
    setSelectedId(demoQa[0]?.id ?? '');
    setMuseumName('湖南博物院');
    setNotice('工作区已恢复为示例数据。');
  }

  return (
    <main className="min-h-screen bg-[#f4f1e9] text-[#19372e]">
      <header className="sticky top-0 z-30 border-b border-[#d8d1c1] bg-[#faf8f2]/95 px-5 py-3 backdrop-blur-xl md:px-8">
        <div className="mx-auto flex max-w-[1640px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#1f5143] text-[#f2d887] shadow-sm">
              <LibraryBig className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-serif text-lg font-semibold tracking-wide">知识库生产与评测工作台</p>
              <p className="hidden text-xs text-[#73847d] sm:block">资料导入 · QA 生产 · 评测集 · 一键导出</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-[#74847e] lg:inline">{todayLabel()} · 数据保存在本机</span>
            {generationRun && (
              <>
                <span className="hidden items-center gap-1.5 rounded-lg bg-[#e9f1eb] px-2.5 py-1.5 text-xs font-medium text-[#1f5143] md:inline-flex" title={generationRun.label}>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  生成任务 {generationRun.completed}/{generationRun.total} 批 · 已逐批入库
                </span>
                <Button variant="outline" className="h-8 border-[#d7a79a] bg-[#fff0ec] px-2.5 text-xs text-[#914f3f]" onClick={stopGeneration}>停止</Button>
              </>
            )}
            <NativeSelect aria-label="快捷切换大模型" value={activeModel?.id ?? ''} onChange={(event) => setActiveModelId(event.target.value)} className="hidden w-48 xl:block">
              {models.filter((model) => model.enabled).map((model) => <NativeSelectOption key={model.id} value={model.id}>{model.name}</NativeSelectOption>)}
            </NativeSelect>
            <Button variant="outline" size="icon-lg" aria-label="打开模型设置" className="border-[#cfc6b4] bg-[#fffdf8]" onClick={() => setActiveView('models')}><Settings2 /></Button>
            <Button variant="outline" className="h-9 border-[#cfc6b4] bg-[#fffdf8]" onClick={() => setActiveView('import')}>
              <Upload /> 导入资料
            </Button>
            <Button className="h-9 bg-[#1f5143] text-white hover:bg-[#173e34]" onClick={() => exportQaAsExcel(items, museumName)} disabled={!items.length}>
              <Download /> 导出 Excel
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1640px] gap-5 px-5 py-5 md:px-8 xl:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card className="border-0 bg-[#e9e4d7] shadow-none ring-[#d6cebd]">
            <CardContent className="space-y-5">
              <div>
                <label htmlFor="museum-name" className="text-[11px] font-semibold tracking-[0.16em] text-[#78877f]">当前博物馆</label>
                <Input id="museum-name" value={museumName} onChange={(event) => setMuseumName(event.target.value)} className="mt-2 h-10 border-[#cfc6b4] bg-[#f8f5ed] font-serif text-base font-semibold" />
              </div>
              <nav aria-label="工作流步骤" className="space-y-1.5">
                {([
                  ['01', '资料导入', items.length > 3, 'import'],
                  ['02', 'QA 生产与审核', stats.approved > 0, 'review'],
                  ['03', '评测集生产', evaluationItems.length > 0, 'evaluation'],
                ] as const).map(([number, label, done, target]) => {
                  const isActive = activeView === target;
                  return (
                  <button type="button" onClick={() => setActiveView(target)} key={String(label)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${isActive ? 'bg-[#1f5143] text-white shadow-sm' : 'text-[#536962] hover:bg-[#f3efe6]'}`}>
                    <span className={`grid size-7 place-items-center rounded-lg text-xs ${isActive ? 'bg-white/12' : 'bg-[#f8f5ed]'}`}>{done ? <Check className="size-3.5" /> : number}</span>
                    <span className="font-medium">{label}</span>
                    <ChevronRight className="ml-auto size-4 opacity-50" />
                  </button>
                  );
                })}
              </nav>
              <div className="rounded-xl border border-[#d4cbb9] bg-[#f8f5ed] p-3">
                <Progress value={stats.progress} className="gap-2">
                  <ProgressLabel className="text-xs">审核进度</ProgressLabel>
                  <span className="ml-auto text-xs tabular-nums text-[#728078]">{stats.progress}%</span>
                </Progress>
                <p className="mt-2 text-xs leading-5 text-[#728078]">已通过 {stats.approved} / {items.length} 条知识</p>
              </div>
              <button type="button" onClick={() => setActiveView('models')} className={`w-full rounded-xl border p-3 text-left transition ${activeView === 'models' ? 'border-[#6f9583] bg-[#1f5143] text-white' : 'border-[#d4cbb9] bg-[#f8f5ed] text-[#536962] hover:border-[#9eaa9f]'}`}>
                <div className="flex items-center gap-2"><Settings2 className="size-4" /><span className="text-sm font-medium">模型管理</span><Badge className={`ml-auto border-0 ${activeView === 'models' ? 'bg-white/15 text-white' : 'bg-[#e3ece6] text-[#35634f]'}`}>{models.filter((model) => model.enabled).length}</Badge></div>
                <p className={`mt-2 truncate text-xs ${activeView === 'models' ? 'text-white/70' : 'text-[#7c8983]'}`}>当前：{activeModel?.name ?? '未选择'}</p>
              </button>
            </CardContent>
          </Card>

          <Card className="border-0 bg-[#203f36] text-white shadow-none ring-0">
            <CardContent>
              <Sparkles className="size-5 text-[#e9ce7e]" />
              <p className="mt-3 font-serif text-lg font-semibold">处理说明</p>
              <p className="mt-2 text-xs leading-5 text-[#c1cec9]">已有“问题、答案”列时直接迁移；普通表格或文本会按文物、展览、服务、政策等类型生成候选QA。</p>
            </CardContent>
          </Card>
        </aside>

        {activeView === 'import' ? (
          <ImportCenter sources={sources} history={history} activeModelName={activeModel?.name ?? '未选择模型'} modelReady={Boolean(activeModelKey)} runInProgress={Boolean(generationRun)} runLabel={generationRun ? `${generationRun.completed}/${generationRun.total} 批 · ${generationRun.label}` : ''} onSourcesChange={setSources} onImport={handleImport} />
        ) : activeView === 'models' ? (
          <ModelSettings models={models} activeModelId={activeModel?.id ?? ''} onModelsChange={setModels} onActiveModelChange={setActiveModelId} />
        ) : activeView === 'evaluation' ? (
          <EvaluationCenter qaItems={items} items={evaluationItems} museumName={museumName} activeModelName={activeModel?.name ?? '未选择模型'} modelReady={Boolean(activeModelKey)} onItemsChange={setEvaluationItems} onGenerateWithModel={handleEvaluationGenerate} />
        ) : (
        <section className="min-w-0 space-y-4">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div>
              <p className="text-sm text-[#78877f]">知识生产 / QA 审核</p>
              <h1 className="mt-1 font-serif text-3xl font-semibold">审核并完善知识库</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="border-[#cfc6b4] bg-[#fffdf8]" onClick={addBlankItem}><Plus /> 新增 QA</Button>
              <Button variant="outline" className="border-[#cfc6b4] bg-[#fffdf8]" onClick={() => exportQaAsJson(items, museumName)} disabled={!items.length}><FileJson /> 导出 JSON</Button>
              <Button className="bg-[#1f5143] text-white hover:bg-[#173e34]" onClick={approveVisible} disabled={!filteredItems.length}><CheckCircle2 /> 批量通过</Button>
            </div>
          </div>

          <output className="flex items-center gap-2 rounded-xl border border-[#d9d0bd] bg-[#fffaf0] px-4 py-3 text-sm text-[#6f6245]">
            <Sparkles className="size-4 text-[#b38b2c]" />
            <span>{notice}</span>
          </output>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['知识总量', items.length, FileSpreadsheet, '条候选 QA'],
              ['已通过', stats.approved, CheckCircle2, `${stats.progress}% 完成`],
              ['需修改', stats.needsWork, CircleAlert, '建议优先处理'],
              ['知识分类', stats.categoriesCount, Filter, '个维度已覆盖'],
            ].map(([label, value, Icon, hint]) => (
              <Card key={String(label)} className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
                <CardContent className="flex items-start justify-between gap-3">
                  <div><p className="text-xs text-[#7a8881]">{label as string}</p><p className="mt-2 font-serif text-3xl font-semibold">{value as number}</p><p className="mt-1 text-xs text-[#87938e]">{hint as string}</p></div>
                  <span className="grid size-9 place-items-center rounded-xl bg-[#e7eee9] text-[#2e604f]"><Icon className="size-4" /></span>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
            <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#829089]" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索问题、答案或来源" className="h-10 border-[#d4cdbf] bg-[#faf8f2] pl-9" />
              </div>
              <NativeSelect aria-label="筛选知识分类" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as '全部' | KnowledgeCategory)} className="w-full lg:w-40">
                <NativeSelectOption value="全部">全部分类</NativeSelectOption>
                {categories.map((category) => <NativeSelectOption key={category} value={category}>{category}</NativeSelectOption>)}
              </NativeSelect>
              <NativeSelect aria-label="筛选审核状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '全部' | ReviewStatus)} className="w-full lg:w-36">
                <NativeSelectOption value="全部">全部状态</NativeSelectOption>
                {statuses.map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}
              </NativeSelect>
              <Button variant="ghost" className="text-[#6c7973]" onClick={() => { setSearch(''); setCategoryFilter('全部'); setStatusFilter('全部'); }}><ArchiveRestore /> 重置筛选</Button>
            </CardContent>
          </Card>

          <div className="grid min-h-[560px] gap-4 2xl:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)]">
            <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
              <div className="flex items-center justify-between border-b border-[#e3ddd1] px-4 pb-3">
                <div><p className="font-semibold">候选问答</p><p className="text-xs text-[#829089]">显示 {filteredItems.length} 条</p></div>
                <Button variant="ghost" size="sm" className="text-[#8c4e40]" onClick={resetWorkspace}><Trash2 /> 清空并重置</Button>
              </div>
              <div className="max-h-[650px] overflow-y-auto px-2">
                {filteredItems.length ? filteredItems.map((item, index) => (
                  <button key={item.id} type="button" aria-label={`审核问题：${item.question}`} onClick={() => setSelectedId(item.id)} className={`my-2 w-full rounded-xl border p-3 text-left transition ${selected?.id === item.id ? 'border-[#7ca08e] bg-[#eef4ef] shadow-sm' : 'border-transparent hover:border-[#e2dbce] hover:bg-[#f8f5ee]'} ${item.status !== '待审核' ? 'opacity-65 saturate-75' : ''}`}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[#ebe6d9] text-xs font-semibold text-[#6e776f]">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={`border-0 ${categoryTone[item.category]}`}>{item.category}</Badge>
                          <Badge variant="outline" className={statusTone[item.status]}>{item.status}</Badge>
                        </div>
                        <p className="mt-2 line-clamp-2 font-medium leading-6 text-[#233e35]">{item.question}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#75827c]">{item.answer}</p>
                      </div>
                    </div>
                  </button>
                )) : (
                  <div className="grid min-h-80 place-items-center px-8 text-center"><div><Search className="mx-auto size-8 text-[#a5ada9]" /><p className="mt-3 font-medium">没有匹配结果</p><p className="mt-1 text-xs text-[#89938e]">调整筛选条件或导入新的资料。</p></div></div>
                )}
              </div>
            </Card>

            <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
              {selected ? (
                <CardContent className="space-y-5">
                  <div className="flex flex-col justify-between gap-3 border-b border-[#e3ddd1] pb-4 sm:flex-row sm:items-center">
                    <div><p className="font-serif text-xl font-semibold">审核当前问答</p><p className="mt-1 text-xs text-[#83908a]">修改会自动保存到本机</p></div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="border-[#d2b0a7] text-[#8d4c3d]" onClick={removeCurrent}><Trash2 /> 删除</Button>
                      <Button variant="outline" className="border-[#d2b0a7] text-[#8d4c3d]" onClick={() => reviewAndNext('需修改')}><CircleAlert /> 标记修改</Button>
                      <Button className="bg-[#1f5143] text-white hover:bg-[#173e34]" onClick={() => reviewAndNext('已通过')}><Check /> 审核通过</Button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 text-sm font-medium">知识分类
                      <NativeSelect aria-label="当前问答知识分类" value={selected.category} onChange={(event) => updateItem(selected.id, { category: event.target.value as KnowledgeCategory })} className="w-full">
                        {categories.map((category) => <NativeSelectOption key={category} value={category}>{category}</NativeSelectOption>)}
                      </NativeSelect>
                    </div>
                    <div className="space-y-2 text-sm font-medium">审核状态
                      <NativeSelect aria-label="当前问答审核状态" value={selected.status} onChange={(event) => updateItem(selected.id, { status: event.target.value as ReviewStatus })} className="w-full">
                        {statuses.map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}
                      </NativeSelect>
                    </div>
                  </div>

                  <label htmlFor="qa-question" className="block space-y-2 text-sm font-medium">问题
                    <Textarea id="qa-question" value={selected.question} onChange={(event) => updateItem(selected.id, { question: event.target.value, status: selected.status === '已通过' ? '待审核' : selected.status })} className="min-h-20 border-[#d4cdbf] bg-[#faf8f2] text-base leading-6" />
                  </label>
                  <label htmlFor="qa-answer" className="block space-y-2 text-sm font-medium">答案
                    <Textarea id="qa-answer" value={selected.answer} onChange={(event) => updateItem(selected.id, { answer: event.target.value, status: selected.status === '已通过' ? '待审核' : selected.status })} className="min-h-48 border-[#d4cdbf] bg-[#faf8f2] leading-7" />
                  </label>
                  <label htmlFor="qa-source" className="block space-y-2 text-sm font-medium">来源
                    <Input id="qa-source" value={selected.source} onChange={(event) => updateItem(selected.id, { source: event.target.value })} className="h-10 border-[#d4cdbf] bg-[#faf8f2]" />
                  </label>

                  <div className="grid gap-3 rounded-xl border border-[#ddd5c7] bg-[#f7f4ec] p-4 text-xs text-[#66766f] sm:grid-cols-3">
                    <div><p className="text-[#89948f]">自动可信度</p><p className="mt-1 text-sm font-semibold text-[#28493e]">{Math.round(selected.confidence * 100)}%</p></div>
                    <div><p className="text-[#89948f]">答案长度</p><p className="mt-1 text-sm font-semibold text-[#28493e]">{selected.answer.length} 字</p></div>
                    <div><p className="text-[#89948f]">最后更新</p><p className="mt-1 text-sm font-semibold text-[#28493e]">{new Date(selected.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p></div>
                  </div>
                </CardContent>
              ) : (
                <div className="grid min-h-[560px] place-items-center p-8 text-center"><div><FileSpreadsheet className="mx-auto size-10 text-[#a7afaa]" /><p className="mt-4 font-serif text-xl font-semibold">选择一条问答开始审核</p></div></div>
              )}
            </Card>
          </div>
        </section>
        )}
      </div>
    </main>
  );
}
