'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, File, FileSpreadsheet, FileText, LoaderCircle, Sparkles, Trash2, UploadCloud } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { inspectSourceFile, type ParsedSourceFile } from '@/lib/museum-workflow';

const MAX_IMPORT_FILE_SIZE_MB = 20;

export interface ImportHistoryItem {
  id: string;
  fileNames: string[];
  importedAt: string;
  generatedCount: number;
  mode: 'append' | 'replace';
}

interface ImportCenterProps {
  sources: ParsedSourceFile[];
  history: ImportHistoryItem[];
  onSourcesChange: (sources: ParsedSourceFile[]) => void;
  activeModelName: string;
  modelReady: boolean;
  engine: 'rules' | 'model';
  configurationIssue: string;
  onOpenModelSettings: () => void;
  runInProgress?: boolean;
  stopping?: boolean;
  onStop: () => void;
  runLabel?: string;
  onImport: (sources: ParsedSourceFile[], mode: 'append' | 'replace', onProgress: (completed: number, total: number, label: string) => void) => Promise<void>;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sourceRowCount(source: ParsedSourceFile) {
  return source.sheets.filter((sheet) => sheet.selected).reduce((sum, sheet) => sum + sheet.rows.length, 0);
}

function sourceDescription(source: ParsedSourceFile) {
  if (source.extension === 'pdf') return `${source.sheets.length} 页`;
  if (source.extension === 'docx' || source.extension === 'doc') return 'Word 文档';
  if (source.extension === 'txt') return '文本资料';
  return `${source.sheets.length} 个工作表`;
}

function SourceIcon({ extension }: { extension: ParsedSourceFile['extension'] }) {
  if (['pdf', 'docx', 'doc'].includes(extension)) return <FileText className="size-5" />;
  if (extension === 'txt') return <File className="size-5" />;
  return <FileSpreadsheet className="size-5" />;
}

export function ImportCenter({ sources, history, activeModelName, modelReady, engine, configurationIssue, onOpenModelSettings, runInProgress = false, runLabel = '', onSourcesChange, onImport }: ImportCenterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  const selectedRows = useMemo(() => sources.reduce((sum, source) => sum + sourceRowCount(source), 0), [sources]);
  const validSources = sources.filter((source) => !source.error && source.sheets.some((sheet) => sheet.selected && sheet.rows.length));

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setBusy(true);
    try {
      const parsed = await Promise.all(files.map(async (file) => {
        if (file.size > MAX_IMPORT_FILE_SIZE_MB * 1024 * 1024) {
          return {
            id: crypto.randomUUID(), fileName: file.name, size: file.size,
            extension: file.name.split('.').pop()?.toLowerCase() ?? '', sheets: [],
            error: `单个文件不能超过 ${MAX_IMPORT_FILE_SIZE_MB} MB，请拆分后上传。`,
          } satisfies ParsedSourceFile;
        }
        if (file.name.toLowerCase().endsWith('.pdf')) {
          const { inspectPdfFile } = await import('@/lib/pdf-client');
          return inspectPdfFile(file);
        }
        return inspectSourceFile(file);
      }));
      onSourcesChange([...sources, ...parsed]);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function removeSource(sourceId: string) {
    onSourcesChange(sources.filter((source) => source.id !== sourceId));
  }

  async function generate(importMode: 'append' | 'replace' = 'append') {
    if (importMode === 'replace' && !window.confirm('本次生成将替换现有 QA 知识库。确定继续？')) return;
    setGenerating(true);
    setGenerationStatus(engine === 'model' ? `正在调用 ${activeModelName}…` : '正在使用本地规则生成…');
    try {
      await onImport(validSources, importMode, (completed, total, label) => {
        setGenerationStatus(total > 0 ? `模型处理中 ${completed}/${total} · ${label}` : label);
      });
    } catch (error) {
      setGenerationStatus(error instanceof Error ? error.message : '生成失败，请检查配置后重试');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="min-w-0 space-y-5">
      <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.csv,.txt" className="hidden" onChange={(event) => event.target.files && void addFiles(event.target.files)} />

      <div>
        <h1 className="text-2xl font-semibold">资料导入</h1>
        <p className="mt-1 text-sm text-muted-foreground">添加馆方资料，统一生成面向游客的候选问答。</p>
      </div>

      <div
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}
        className={`rounded-2xl border-2 border-dashed px-5 py-10 sm:py-12 transition ${dragging ? 'border-primary bg-accent' : 'border-input bg-card'}`}
      >
        <div className="flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent text-primary"><UploadCloud className="size-6" /></span>
            <div>
              <p className="font-sans text-xl font-semibold">{sources.length ? `已添加 ${sources.length} 个文件` : '拖入资料文件'}</p>
              <p className="mt-1 text-sm text-muted-foreground">{sources.length ? `共 ${selectedRows} 条资料待处理，还可以继续添加` : '支持 PDF、Word（.docx）、Excel、CSV、TXT，可一次选择多个文件'}</p>
              <p className="mt-2 text-xs text-muted-foreground">单个文件最大 {MAX_IMPORT_FILE_SIZE_MB} MB</p>
            </div>
          </div>
          <Button type="button" variant="outline" className="shrink-0 border-border bg-card" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <UploadCloud />}
            {busy ? '正在解析' : sources.length ? '继续添加' : '选择文件'}
          </Button>
        </div>

        {sources.length > 0 && (
          <div className="mt-4 divide-y divide-border border-t border-border">
            {sources.map((source) => {
              const hasWarning = Boolean(source.error || source.requiresOcr || source.warnings?.length);
              return (
                <div key={source.id} className="py-3 text-left">
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center text-muted-foreground"><SourceIcon extension={source.extension} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" title={source.fileName}>{source.fileName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatFileSize(source.size)} · {sourceDescription(source)}</p>
                    </div>
                    {hasWarning ? <AlertCircle className="size-4 shrink-0 text-[#a35544]" /> : <CheckCircle2 className="size-4 shrink-0 text-[#4d8069]" />}
                  </div>
                  <div className="mt-1 flex items-center justify-between pl-11 text-xs">
                    <span className={hasWarning ? 'text-[#a35544]' : 'text-muted-foreground'}>{source.error ?? `${sourceRowCount(source)} 条资料已就绪`}</span>
                    <Button type="button" variant="ghost" size="xs" className="text-[#8d4e40]" onClick={() => removeSource(source.id)}><Trash2 /> 移除</Button>
                  </div>
                  {source.warnings?.map((warning) => <p key={warning} className="mt-2 rounded-lg bg-[#fff0d6] px-2.5 py-2 text-xs leading-5 text-[#805e2f]">{warning}</p>)}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="text-xs text-muted-foreground">QA 生成：{activeModelName}<button type="button" className="ml-3 underline underline-offset-4" onClick={onOpenModelSettings}>配置</button></div>
        <div className="flex items-center gap-2">
          <Button className="bg-primary text-primary-foreground hover:bg-primary-hover" disabled={generating || runInProgress || !validSources.length || !modelReady} onClick={() => void generate()}>{generating || runInProgress ? <LoaderCircle className="animate-spin" /> : <Sparkles />} 生成 QA</Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>更多</DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem variant="destructive" disabled={generating || runInProgress || !validSources.length || !modelReady} onClick={() => void generate('replace')}>生成并替换现有 QA</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <details className="text-xs leading-5 text-muted-foreground"><summary className="cursor-pointer">处理说明</summary><p className="mt-2">默认追加生成，已有相同问题会去重。文本型 PDF 自动解析，扫描页提示 OCR 并跳过。Word 支持 .docx（单个文件最多 20 MB），提取正文和表格文字，图片不做 OCR；旧版 .doc 请先另存为 .docx。生成前跳过可识别的文件编制信息和未确认方案；已有 QA 直接迁移。</p></details>
      {(generationStatus || runInProgress || !modelReady) && <div className={`rounded-xl border px-4 py-3 text-sm ${!modelReady ? 'border-[#d9b09f] bg-[#fff1ed] text-[#8c4d3f]' : 'border-info-border bg-info text-info-foreground'}`}>{!modelReady ? `QA 生成：${configurationIssue}。请到模型配置页完善。` : runInProgress && !generationStatus ? `后台生成进行中：${runLabel}。已完成的批次已实时入库，可到“QA 生产与审核”页先审核，不要刷新页面。` : generationStatus}</div>}

      {history.length > 0 && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">最近导入 · {history.length} 次</summary>
          <div className="divide-y divide-border px-4">{history.slice(0, 5).map((entry) => <div key={entry.id} className="flex flex-col justify-between gap-2 py-3 text-sm sm:flex-row sm:items-center"><div><p className="font-medium">{entry.fileNames.join('、')}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(entry.importedAt).toLocaleString('zh-CN')} · {entry.mode === 'append' ? '追加' : '替换'}</p></div><Badge variant="outline" className="border-[#a9c5b6] bg-[#edf5f0] text-primary">生成 {entry.generatedCount} 条</Badge></div>)}</div>
        </details>
      )}
    </section>
  );
}
