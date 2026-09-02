/* oxlint-disable react(react-compiler) -- client workspace state is intentionally restored from localStorage */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveRestore,
  Check,
  CheckCircle2,
  CircleAlert,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Settings2,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { ReviewSetupDialog } from '@/app/components/ReviewSetupDialog';
import { MachineReviewPanel } from '@/app/components/MachineReviewPanel';
import { QaImportDialog } from '@/app/components/QaImportDialog';
import { machineReviewStatus, machineReviewStatuses, applyReviewEvent, recoverMachineReview, adoptReviewSuggestion, updateQaContent, type MachineReviewStatus } from '@/lib/qa-review';
import { reviewQaItems } from '@/lib/qa-review-service';
import { ImportCenter, type ImportHistoryItem } from '@/app/components/ImportCenter';
import { EvaluationCenter } from '@/app/components/EvaluationCenter';
import { ModelSettings } from '@/app/components/ModelSettings';
import type { EvaluationDimension, EvaluationItem } from '@/lib/evaluation-workflow';
import { defaultModels, type ModelConfig } from '@/lib/model-registry';
import { readModelSecret } from '@/lib/model-secrets';
import { restoreModelAssignments, resolveModelAssignment, type ModelAssignments } from '@/lib/model-assignments';
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

function includeNewDefaultModels(savedModels: ModelConfig[]) {
  const refreshed = savedModels.map((model) => {
    if (model.id !== 'linghub-company-model' || model.modelId.trim()) return model;
    const preset = defaultModels.find((candidate) => candidate.id === model.id);
    return preset ? { ...model, modelId: preset.modelId } : model;
  });
  const savedIds = new Set(refreshed.map((model) => model.id));
  return [...refreshed, ...defaultModels.filter((model) => !savedIds.has(model.id))];
}

export default function Home() {
  const [activeView, setActiveView] = useState<'import' | 'review' | 'evaluation' | 'models'>('import');
  const [museumName, setMuseumName] = useState('湖南博物院');
  const [items, setItems] = useState<QaItem[]>(demoQa);
  const [sources, setSources] = useState<ParsedSourceFile[]>([]);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [evaluationItems, setEvaluationItems] = useState<EvaluationItem[]>([]);
  const [models, setModels] = useState<ModelConfig[]>(defaultModels);
  const [modelAssignments, setModelAssignments] = useState<ModelAssignments>(() => restoreModelAssignments(undefined, defaultModels[0].id));
  const [, refreshModelKeys] = useState(0);
  const [selectedId, setSelectedId] = useState(demoQa[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'全部' | KnowledgeCategory>('全部');
  const [statusFilter, setStatusFilter] = useState<'全部' | ReviewStatus>('全部');
  const [notice, setNotice] = useState('已载入示例数据，可以直接编辑或导入馆方资料。');
  const [storageError, setStorageError] = useState('');
  const [machineFilter, setMachineFilter] = useState<'全部' | MachineReviewStatus>('全部');
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [generationRun, setGenerationRun] = useState<{ completed: number; total: number; label: string; kind?: 'review' } | null>(null);
  const runActiveRef = useRef(false);
  const generationController = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved) as { museumName?: string; items?: QaItem[]; history?: ImportHistoryItem[]; evaluationItems?: EvaluationItem[]; models?: ModelConfig[]; activeModelId?: string; modelAssignments?: unknown };
          if (data.museumName) setMuseumName(data.museumName);
          if (Array.isArray(data.items)) {
            setItems(data.items.map(recoverMachineReview));
            setSelectedId(data.items[0]?.id ?? '');
            setNotice(`已恢复本地工作区，共 ${data.items.length} 条 QA。`);
          }
          if (data.history) setHistory(data.history);
          if (data.evaluationItems) {
            setEvaluationItems(data.evaluationItems.map((item) => ({
              ...item,
              difficulty: (item.difficulty as string) === '挑战' ? '困难' : item.difficulty,
            })));
          }
          if (data.models?.length) setModels(data.modelAssignments ? data.models : includeNewDefaultModels(data.models));
          setModelAssignments(restoreModelAssignments(data.modelAssignments, data.activeModelId ?? defaultModels[0].id));
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
    let error = '';
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ museumName, items, history, evaluationItems, models, modelAssignments }));
    } catch {
      error = '本机保存失败（空间不足或存储不可用）。请先导出 JSON 备份，暂勿刷新或关闭页面。';
    }
    queueMicrotask(() => setStorageError(error));
  }, [modelAssignments, evaluationItems, history, hydrated, items, models, museumName]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !keyword || `${item.question} ${item.answer} ${item.source}`.toLowerCase().includes(keyword);
      const matchesCategory = categoryFilter === '全部' || item.category === categoryFilter;
      const matchesStatus = statusFilter === '全部' || item.status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus && (machineFilter === '全部' || machineReviewStatus(item) === machineFilter);
    });
  }, [categoryFilter, items, search, statusFilter, machineFilter]);

  const selected = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0];
  const qaAssignment = resolveModelAssignment(modelAssignments.qaGeneration, models, (id) => hydrated ? readModelSecret(id) : '');
  const evaluationAssignment = resolveModelAssignment(modelAssignments.evaluationGeneration, models, (id) => hydrated ? readModelSecret(id) : '');
  const reviewAssignment = resolveModelAssignment(modelAssignments.qaReview, models, (id) => hydrated ? readModelSecret(id) : '');

  async function startMachineReview(targets: QaItem[]) {
    if (runActiveRef.current) { setNotice('已有任务进行中，请先完成或停止当前任务。'); return; }
    if (!reviewAssignment.ready || !reviewAssignment.model) { setNotice(`请配置 QA 审核模型：${reviewAssignment.issue || '未选择模型'}`); return; }
    if (!targets.length) { setNotice('当前没有需要机审的待审核 QA；已完成的条目可在详情中重审。'); return; }
    runActiveRef.current = true;
    const controller = new AbortController();
    generationController.current = controller;
    setReviewDialogOpen(false);
    setStopping(false);
    setGenerationRun({ kind: 'review', completed: 0, total: targets.length, label: '正在机审' });
    // Attach selected materials before running events so their input keys match.
    const targetById = new Map(targets.map(item => [item.id, item]));
    setItems(current => current.map(item => {
      const target = targetById.get(item.id);
      return target ? { ...item, evidence: target.evidence, evidenceNote: target.evidenceNote } : item;
    }));
    let completed = 0;
    try {
      const result = await reviewQaItems(targets, reviewAssignment.model, reviewAssignment.apiKey, (id, review) => {
        if (controller.signal.aborted && review.status !== 'stopped') return;
        setItems((current) => current.map((item) => item.id === id ? applyReviewEvent(item, review) : item));
      }, (count, total) => {
        completed = count;
        if (!controller.signal.aborted) setGenerationRun({ kind: 'review', completed: count, total, label: '正在机审' });
      }, controller.signal);
      setNotice(`机审结束：完成 ${result.completed - result.failed} 条，失败 ${result.failed} 条。内容发生变化的条目需重审，人工审核状态未改变。`);
    } catch (error) {
      setNotice(controller.signal.aborted ? `已停止机审，保留已处理的 ${completed} 条记录；未完成条目可重新机审。` : `机审中断：${error instanceof Error ? error.message : '请求失败'}`);
    } finally {
      runActiveRef.current = false;
      generationController.current = null;
      setGenerationRun(null);
      setStopping(false);
    }
  }

  function adoptSuggestion(id: string) {
    if (runActiveRef.current || !window.confirm('采用机审建议？原问题和答案会留存，采用后回到待审核，并需要重新机审。')) return;
    setItems((current) => current.map((item) => item.id === id ? adoptReviewSuggestion(item) : item));
  }

  async function handleImport(importSources: ParsedSourceFile[], mode: 'append' | 'replace', onProgress: (completed: number, total: number, label: string) => void) {
    if (runActiveRef.current) throw new Error('已有生成任务正在进行中，请等待完成后再导入。');
    if (!qaAssignment.ready) throw new Error(`请到模型配置页设置 QA 生成：${qaAssignment.issue}`);

    if (qaAssignment.engine === 'model' && qaAssignment.model) {
      runActiveRef.current = true;
      const controller = new AbortController();
      generationController.current = controller;
      setStopping(false);
      setGenerationRun({ completed: 0, total: 0, label: '准备调用模型' });
      let generatedCount = 0;
      let replaced = false;
      try {
        await generateQaWithModel(
          importSources,
          qaAssignment.model,
          qaAssignment.apiKey,
          (completed, total, label) => {
            if (controller.signal.aborted) return;
            setGenerationRun({ completed, total, label });
            onProgress(completed, total, label);
          },
          (batchItems) => {
            if (controller.signal.aborted) return;
            if (!batchItems.length) return;
            generatedCount += batchItems.length;
            if (mode === 'replace' && !replaced) {
              replaced = true;
              setItems(batchItems);
            } else {
              setItems((current) => mergeInto(current, batchItems));
            }
          },
          () => controller.signal.aborted,
          controller.signal,
        );
      } catch (error) {
        const message = controller.signal.aborted
          ? `已停止生成，保留本次已生成的 ${generatedCount} 条候选 QA。可选择“追加到现有知识库”重新生成，已有相同问题会去重。`
          : `生成中断：${error instanceof Error ? error.message : '请求失败'}。保留本次已生成的 ${generatedCount} 条候选 QA。`;
        setNotice(message);
        throw new Error(message);
      } finally {
        runActiveRef.current = false;
        generationController.current = null;
        setStopping(false);
        setGenerationRun(null);
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
    if (!evaluationAssignment.ready || !evaluationAssignment.model) throw new Error(`请到模型配置页设置测评集生成：${evaluationAssignment.issue || '请选择模型'}`);

    runActiveRef.current = true;
    const controller = new AbortController();
    generationController.current = controller;
    setStopping(false);
    setGenerationRun({ completed: 0, total: 0, label: '准备生成评测集' });
    let count = 0;
    let replaced = false;
    try {
      await generateEvaluationWithModel(
        evaluationSources,
        dimensions,
        evaluationAssignment.model,
        evaluationAssignment.apiKey,
        (completed, total, label) => {
          if (controller.signal.aborted) return;
          setGenerationRun({ completed, total, label });
          onProgress(completed, total, label);
        },
        (batchItems) => {
          if (controller.signal.aborted) return;
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
        () => controller.signal.aborted,
        controller.signal,
      );
    } catch (error) {
      const message = controller.signal.aborted
        ? `已停止评测集生成，保留本次已生成的 ${count} 条评测题。`
        : `评测集生成中断：${error instanceof Error ? error.message : '请求失败'}。保留本次已生成的 ${count} 条评测题。`;
      setNotice(message);
      throw new Error(message);
    } finally {
      runActiveRef.current = false;
      generationController.current = null;
      setStopping(false);
      setGenerationRun(null);
    }
    return count;
  }

  function stopGeneration() {
    if (!generationController.current || generationController.current.signal.aborted) return;
    setStopping(true);
    generationController.current.abort();
    setNotice('正在取消请求，已完成的结果会保留。已发出的请求是否继续计费，以模型服务商为准。');
  }

  function updateItem(id: string, patch: Partial<QaItem>) {
    setItems((current) => current.map((item) => item.id === id ? updateQaContent(item, patch) : item));
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

  function importReadyQa(incoming: QaItem[]) {
    if (!hydrated || runActiveRef.current) throw new Error('请先完成或停止当前任务，再导入 QA。');
    if (!incoming.length || incoming.some(item => !item.question.trim() || !item.answer.trim())) throw new Error('问题和答案不能为空。');
    setItems(current => [...current, ...incoming]);
    setSelectedId(incoming[0].id);
    setSearch(''); setCategoryFilter('全部'); setStatusFilter('全部'); setMachineFilter('全部');
    setNotice(`已导入 ${incoming.length} 条 QA，全部设为待审核。`);
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
    if (!window.confirm(`将当前筛选出的 ${filteredItems.length} 条 QA 全部标记为已通过？请确认已核对内容。`)) return;
    const visibleIds = new Set(filteredItems.map((item) => item.id));
    setItems((current) => current.map((item) => (visibleIds.has(item.id) ? { ...item, status: '已通过', updatedAt: new Date().toISOString() } : item)));
    setNotice(`已批量通过 ${visibleIds.size} 条当前筛选结果。`);
  }

  function clearQaItems() {
    if (!hydrated || !items.length || runActiveRef.current) return;
    if (!window.confirm(`确认清空全部 ${items.length} 条 QA（包括筛选隐藏的条目）？此操作不可恢复。已生成的测评集和导入记录会保留。`)) return;
    const clearedCount = items.length;
    setItems([]);
    setSelectedId('');
    setSearch('');
    setCategoryFilter('全部');
    setStatusFilter('全部');
    setMachineFilter('全部');
    setNotice(`已清空全部 ${clearedCount} 条 QA。`);
  }

  function resetWorkspace() {
    if (!window.confirm('将清空当前 QA 和测评集并恢复示例数据，无法撤销。确定继续？')) return;
    localStorage.removeItem(STORAGE_KEY);
    setItems(demoQa);
    setEvaluationItems([]);
    setSelectedId(demoQa[0]?.id ?? '');
    setMuseumName('湖南博物院');
    setNotice('工作区已恢复为示例数据。');
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 min-h-16 border-b border-sidebar-border bg-sidebar/95 px-4 py-3 backdrop-blur-xl md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/workbench-logo.png" alt="知识库生产评测工作台" className="size-8 shrink-0 object-contain" />
            <span className="text-xl font-bold tracking-tight text-foreground">知识库生产评测工作台</span>
            <label htmlFor="museum-name" className="sr-only">当前博物馆</label>
            <Input id="museum-name" value={museumName} onChange={(event) => setMuseumName(event.target.value)} className="h-8 w-32 border-transparent bg-transparent text-sm sm:w-44 text-muted-foreground hover:text-foreground focus:text-foreground" />
          </div>
          {generationRun ? (
            <div className="flex items-center gap-3 text-xs text-primary">
              <span className="flex items-center gap-1.5" title={generationRun.label}><LoaderCircle className="size-3.5 animate-spin" />{generationRun.kind === 'review' ? '机审中' : '生成中'} {generationRun.completed}/{generationRun.total} {generationRun.kind === 'review' ? '条' : '批'}</span>
              <Button variant="outline" size="sm" disabled={stopping} onClick={stopGeneration}>{stopping ? '正在停止…' : generationRun.kind === 'review' ? '停止机审' : '停止生成'}</Button>
            </div>
          ) : <span className="text-xs text-muted-foreground">{storageError ? '本机保存异常' : '自动保存到本机'}</span>}
        </div>
      </header>
      {storageError && <div role="alert" className="mx-auto flex max-w-[1640px] flex-wrap items-center gap-3 px-6 py-2 text-sm text-[#934f3f]">{storageError}<Button variant="outline" size="sm" onClick={() => exportQaAsJson(items, museumName)}>导出 QA 完整备份</Button></div>}

      <div className="grid gap-5 px-4 py-5 md:px-6 lg:min-h-[calc(100dvh-64px)] lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
        <aside className="relative isolate lg:before:pointer-events-none lg:before:absolute lg:before:-inset-y-5 lg:before:-left-6 lg:before:-right-4 lg:before:-z-10 lg:before:border-r lg:before:border-sidebar-border lg:before:bg-sidebar lg:before:content-['']">
          <nav aria-label="工作流导航" className="flex gap-2 overflow-x-auto py-1 lg:sticky lg:top-20 lg:flex-col">
            {([
              ['import', '资料导入', FileSpreadsheet],
              ['review', 'QA 审核', CheckCircle2],
              ['evaluation', '测评集', Sparkles],
              ['models', '模型配置', Settings2],
            ] as const).map(([target, label, Icon]) => (
              <button key={target} type="button" aria-current={activeView === target ? 'page' : undefined} onClick={() => setActiveView(target)} className={`group flex h-[60px] shrink-0 items-center gap-3 rounded-2xl border px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring ${activeView === target ? 'border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'border-transparent text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'}`}>
                <span className={`grid size-9 shrink-0 place-items-center rounded-xl border transition-colors ${activeView === target ? 'border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground' : 'border-sidebar-border bg-card text-sidebar-foreground group-hover:text-primary'}`}><Icon className="size-[18px]" /></span>
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {activeView === 'import' ? (
          <ImportCenter sources={sources} history={history} engine={qaAssignment.engine} activeModelName={qaAssignment.name} modelReady={qaAssignment.ready} configurationIssue={qaAssignment.issue} onOpenModelSettings={() => setActiveView('models')} runInProgress={Boolean(generationRun)} stopping={stopping} onStop={stopGeneration} runLabel={generationRun ? `${generationRun.completed}/${generationRun.total} ${generationRun.kind === 'review' ? '条' : '批'} · ${generationRun.label}` : ''} onSourcesChange={setSources} onImport={handleImport} />
        ) : activeView === 'models' ? (
          <ModelSettings models={models} assignments={modelAssignments} onModelsChange={setModels} onAssignmentsChange={setModelAssignments} onSecretsChange={() => refreshModelKeys((value) => value + 1)} runInProgress={Boolean(generationRun)} />
        ) : activeView === 'evaluation' ? (
          <EvaluationCenter qaItems={items} items={evaluationItems} museumName={museumName} engine={evaluationAssignment.engine} activeModelName={evaluationAssignment.name} modelReady={evaluationAssignment.ready} configurationIssue={evaluationAssignment.issue} onOpenModelSettings={() => setActiveView('models')} runInProgress={Boolean(generationRun)} stopping={stopping} onStop={stopGeneration} onItemsChange={setEvaluationItems} onGenerateWithModel={handleEvaluationGenerate} />
        ) : (
        <section className="min-w-0 space-y-4">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
            <div>
              <h1 className="text-2xl font-semibold">QA 审核</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <QaImportDialog disabled={!hydrated || Boolean(generationRun)} onImport={importReadyQa} />
              <Button variant="outline" disabled={Boolean(generationRun)} onClick={() => setReviewDialogOpen(true)}>开始机审</Button>
              <Button className="bg-primary text-primary-foreground hover:bg-primary-hover" onClick={() => exportQaAsExcel(items, museumName)} disabled={!items.length}><Download /> 导出 QA</Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" />}>更多</DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={addBlankItem}>新增 QA</DropdownMenuItem>
                  <DropdownMenuItem disabled={!items.length} onClick={() => exportQaAsJson(items, museumName)}>导出 JSON</DropdownMenuItem>
                  <DropdownMenuItem disabled={!filteredItems.length} onClick={approveVisible}>通过当前筛选结果</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" disabled={Boolean(generationRun)} onClick={resetWorkspace}>清空并恢复示例</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <ReviewSetupDialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen} items={filteredItems} busy={Boolean(generationRun)} modelName={reviewAssignment.name} modelReady={reviewAssignment.ready} modelIssue={reviewAssignment.issue} sameModel={modelAssignments.qaReview === modelAssignments.qaGeneration} onOpenModels={() => { setReviewDialogOpen(false); setActiveView('models'); }} onStart={targets => void startMachineReview(targets)} />

          {notice && <output className="flex items-center justify-between gap-3 rounded-xl border border-info-border bg-info px-4 py-3 text-xs leading-5 text-info-foreground"><span>{notice}</span><button type="button" aria-label="关闭提示" className="shrink-0 px-2 text-muted-foreground" onClick={() => setNotice('')}>×</button></output>}

          <div className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="按审核状态筛选">
            {(['全部', ...statuses] as const).map((status) => <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)} className={`rounded-lg px-3 py-2 text-sm ${statusFilter === status ? 'bg-accent font-medium text-primary' : 'text-muted-foreground hover:bg-accent'}`}>{status} <span className="ml-1 text-xs tabular-nums">{status === '全部' ? items.length : items.filter((item) => item.status === status).length}</span></button>)}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索问题、答案或来源" className="h-10 border-input bg-card pl-9" />
              </div>
              <NativeSelect aria-label="筛选知识分类" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as '全部' | KnowledgeCategory)} className="w-full lg:w-40">
                <NativeSelectOption value="全部">全部分类</NativeSelectOption>
                {categories.map((category) => <NativeSelectOption key={category} value={category}>{category}</NativeSelectOption>)}
              </NativeSelect>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer whitespace-nowrap">机审筛选{machineFilter !== '全部' ? ` · ${machineFilter}` : ''}</summary><NativeSelect aria-label="筛选机审结果" className="mt-2 w-40" value={machineFilter} onChange={(event) => setMachineFilter(event.target.value as '全部' | MachineReviewStatus)}><NativeSelectOption value="全部">全部机审状态</NativeSelectOption>{machineReviewStatuses.map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}</NativeSelect></details>
              <Button variant="ghost" className="text-muted-foreground" onClick={() => { setSearch(''); setCategoryFilter('全部'); setStatusFilter('全部'); setMachineFilter('全部'); }}><ArchiveRestore /> 重置筛选</Button>
          </div>

          <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
            <Card className="border-0 bg-card shadow-sm ring-border">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 pb-3">
                <div><p className="font-semibold">候选问答</p><p className="text-xs text-muted-foreground">显示 {filteredItems.length} 条</p></div>
                <Button variant="ghost" size="sm" className="text-[#8d4c3d] hover:bg-[#fff0ec] hover:text-[#8d4c3d]" disabled={!hydrated || !items.length || Boolean(generationRun)} title={generationRun ? '请先完成或停止当前任务' : '清空全部 QA，包括筛选隐藏的条目'} onClick={clearQaItems}><Trash2 /> 一键清空</Button>
              </div>
              <div className="max-h-[650px] overflow-y-auto px-2">
                {filteredItems.length ? filteredItems.map((item, index) => (
                  <button key={item.id} type="button" aria-label={`审核问题：${item.question}`} onClick={() => setSelectedId(item.id)} className={`my-2 w-full rounded-xl border p-3 text-left transition ${selected?.id === item.id ? 'border-ring bg-accent shadow-sm' : 'border-transparent hover:border-border hover:bg-muted'} ${item.status !== '待审核' ? 'opacity-65 saturate-75' : ''}`}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={`border-0 ${categoryTone[item.category]}`}>{item.category}</Badge>
                          <Badge variant="outline" className={statusTone[item.status]}>{item.status}</Badge>
                          {item.machineReview && <span className="text-xs text-muted-foreground">机审：{machineReviewStatus(item)}</span>}
                        </div>
                        <p className="mt-2 line-clamp-2 font-medium leading-6 text-foreground">{item.question}</p>
                        <p className="mt-1 truncate text-xs leading-5 text-muted-foreground">{item.answer}</p>
                      </div>
                    </div>
                  </button>
                )) : (
                  <div className="grid min-h-80 place-items-center px-8 text-center"><div><Search className="mx-auto size-8 text-muted-foreground/50" /><p className="mt-3 font-medium">{items.length ? '没有匹配结果' : '暂无候选问答'}</p><p className="mt-1 text-xs text-muted-foreground">{items.length ? '调整筛选条件或导入新的资料。' : '导入新的资料或新增 QA 后开始审核。'}</p></div></div>
                )}
              </div>
            </Card>

            <Card className="border-0 bg-card shadow-sm ring-border">
              {selected ? (
                <CardContent className="space-y-5">
                  <div className="flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-center">
                    <div><p className="font-sans text-xl font-semibold">审核当前问答</p><p className="mt-1 text-xs text-muted-foreground">修改会自动保存到本机</p></div>
                    <div className="flex flex-wrap gap-2">
                      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />}>更多</DropdownMenuTrigger><DropdownMenuContent align="end" className="w-36"><DropdownMenuItem onClick={() => updateItem(selected.id, { status: '待审核' })}>退回待审核</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={removeCurrent}>删除此条</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
                      <Button variant="outline" className="border-[#d2b0a7] text-[#8d4c3d]" onClick={() => reviewAndNext('需修改')}><CircleAlert /> 标记修改</Button>
                      <Button className="bg-primary text-primary-foreground hover:bg-primary-hover" onClick={() => reviewAndNext('已通过')}><Check /> 通过并下一条</Button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 text-sm font-medium">知识分类
                      <NativeSelect aria-label="当前问答知识分类" value={selected.category} onChange={(event) => updateItem(selected.id, { category: event.target.value as KnowledgeCategory })} className="w-full">
                        {categories.map((category) => <NativeSelectOption key={category} value={category}>{category}</NativeSelectOption>)}
                      </NativeSelect>
                    </div>

                  </div>

                  <label htmlFor="qa-question" className="block space-y-2 text-sm font-medium">问题
                    <Textarea id="qa-question" value={selected.question} onChange={(event) => updateItem(selected.id, { question: event.target.value, status: selected.status === '已通过' ? '待审核' : selected.status })} className="min-h-20 border-input bg-card text-base leading-6" />
                  </label>
                  <label htmlFor="qa-answer" className="block space-y-2 text-sm font-medium">答案
                    <Textarea id="qa-answer" value={selected.answer} onChange={(event) => updateItem(selected.id, { answer: event.target.value, status: selected.status === '已通过' ? '待审核' : selected.status })} className="min-h-48 border-input bg-card leading-7" />
                  </label>
                  <label htmlFor="qa-source" className="block space-y-2 text-sm font-medium">来源
                    <Input id="qa-source" value={selected.source} onChange={(event) => updateItem(selected.id, { source: event.target.value })} className="h-10 border-input bg-card" />
                  </label>
                  <MachineReviewPanel item={selected} busy={Boolean(generationRun)} onRetry={() => { if (window.confirm('对当前 QA 调用审核模型？会产生 API 用量。')) void startMachineReview([selected]); }} onAdopt={() => adoptSuggestion(selected.id)} />


                </CardContent>
              ) : (
                <div className="grid min-h-[560px] place-items-center p-8 text-center"><div><FileSpreadsheet className="mx-auto size-10 text-muted-foreground/50" /><p className="mt-4 font-sans text-xl font-semibold">选择一条问答开始审核</p></div></div>
              )}
            </Card>
          </div>
        </section>
        )}
      </div>
    </main>
  );
}
