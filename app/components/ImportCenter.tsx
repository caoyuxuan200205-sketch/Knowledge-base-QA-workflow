'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, File, FileSpreadsheet, FileText, Files, LoaderCircle, Plus, Sparkles, Trash2, UploadCloud } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inspectSourceFile, type ColumnMapping, type ParsedSourceFile } from '@/lib/museum-workflow';

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
  runInProgress?: boolean;
  runLabel?: string;
  onImport: (sources: ParsedSourceFile[], mode: 'append' | 'replace', engine: 'rules' | 'model', onProgress: (completed: number, total: number, label: string) => void) => Promise<void>;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sourceRowCount(source: ParsedSourceFile) {
  return source.sheets.filter((sheet) => sheet.selected).reduce((sum, sheet) => sum + sheet.rows.length, 0);
}

function previewValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value) ?? '—';
}

export function ImportCenter({ sources, history, activeModelName, modelReady, runInProgress = false, runLabel = '', onSourcesChange, onImport }: ImportCenterProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState(sources[0]?.id ?? '');
  const [activeSheetName, setActiveSheetName] = useState('');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [engine, setEngine] = useState<'rules' | 'model'>('rules');
  const [generating, setGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const engineTouched = useRef(false);

  useEffect(() => {
    if (modelReady && !engineTouched.current) setEngine('model');
  }, [modelReady]);

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? sources[0];
  const activeSheet = selectedSource?.sheets.find((sheet) => sheet.name === activeSheetName)
    ?? selectedSource?.sheets.find((sheet) => sheet.selected)
    ?? selectedSource?.sheets[0];
  const selectedRows = useMemo(() => sources.reduce((sum, source) => sum + sourceRowCount(source), 0), [sources]);
  const validSources = sources.filter((source) => !source.error && source.sheets.some((sheet) => sheet.selected && sheet.rows.length));

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setBusy(true);
    const parsed = await Promise.all(files.map(async (file) => {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const { inspectPdfFile } = await import('@/lib/pdf-client');
        return inspectPdfFile(file);
      }
      return inspectSourceFile(file);
    }));
    onSourcesChange([...sources, ...parsed]);
    setSelectedSourceId(parsed[0]?.id ?? selectedSourceId);
    setActiveSheetName(parsed[0]?.sheets[0]?.name ?? '');
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function updateSheet(sourceId: string, sheetName: string, patch: { selected?: boolean; mapping?: Partial<ColumnMapping> }) {
    onSourcesChange(sources.map((source) => source.id !== sourceId ? source : {
      ...source,
      sheets: source.sheets.map((sheet) => sheet.name !== sheetName ? sheet : {
        ...sheet,
        ...(patch.selected === undefined ? {} : { selected: patch.selected }),
        mapping: { ...sheet.mapping, ...patch.mapping },
      }),
    }));
  }

  function removeSource(sourceId: string) {
    const next = sources.filter((source) => source.id !== sourceId);
    onSourcesChange(next);
    if (selectedSourceId === sourceId) {
      setSelectedSourceId(next[0]?.id ?? '');
      setActiveSheetName(next[0]?.sheets[0]?.name ?? '');
    }
  }

  async function generate() {
    setGenerating(true);
    setGenerationStatus(engine === 'model' ? `正在调用 ${activeModelName}…` : '正在使用本地规则生成…');
    try {
      await onImport(validSources, importMode, engine, (completed, total, label) => {
        setGenerationStatus(total > 0 ? `模型处理中 ${completed}/${total} · ${label}` : label);
      });
    } catch (error) {
      setGenerationStatus(error instanceof Error ? error.message : '生成失败，请检查配置后重试');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="space-y-5">
      <input ref={inputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,.txt" className="hidden" onChange={(event) => event.target.files && void addFiles(event.target.files)} />

      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm text-[#78877f]">知识生产 / 资料导入</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold">整理本批馆方资料</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#697a73]">先检查文件、工作表和字段映射，确认后再生成候选问答。这里不会自动覆盖现有知识库。</p>
        </div>
        <Button className="h-9 bg-[#1f5143] text-white hover:bg-[#173e34]" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Plus />} 添加资料</Button>
      </div>

      <div
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files); }}
        className={`rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${dragging ? 'border-[#1f5143] bg-[#e9f1eb]' : 'border-[#bdb4a2] bg-[#fffdf8]'}`}
      >
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#e5eee8] text-[#1f5143]"><UploadCloud className="size-6" /></span>
        <p className="mt-3 font-serif text-xl font-semibold">拖入多个资料文件</p>
        <p className="mt-1 text-sm text-[#78867f]">支持 PDF、Excel、CSV、TXT，单次可选择多个文件</p>
        <p className="mt-1 text-xs text-[#9a8c78]">文本型 PDF 可直接解析；扫描版 PDF 会提示需要 OCR</p>
        <Button variant="outline" className="mt-4 border-[#cfc6b4] bg-[#faf8f2]" onClick={() => inputRef.current?.click()} disabled={busy}>选择文件</Button>
      </div>

      {sources.length > 0 ? (
        <div className="grid gap-4 2xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
            <div className="flex items-center justify-between border-b border-[#e3ddd1] px-4 pb-3">
              <div><p className="font-semibold">本批文件</p><p className="text-xs text-[#829089]">{sources.length} 个文件 · {selectedRows} 条资料已选</p></div>
              <Badge className="border-0 bg-[#e4eee8] text-[#32614d]">批量导入</Badge>
            </div>
            <div className="max-h-[610px] space-y-2 overflow-y-auto px-2">
              {sources.map((source) => {
                const isSelected = source.id === selectedSource?.id;
                return (
                  <div key={source.id} className={`rounded-xl border p-3 transition ${isSelected ? 'border-[#7ca08e] bg-[#edf4ef]' : 'border-transparent bg-[#faf8f2] hover:border-[#ddd5c7]'}`}>
                    <button type="button" aria-label={`查看文件 ${source.fileName}`} onClick={() => { setSelectedSourceId(source.id); setActiveSheetName(source.sheets.find((sheet) => sheet.selected)?.name ?? source.sheets[0]?.name ?? ''); }} className="w-full text-left">
                      <div className="flex items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e9e4d8] text-[#596b64]">{source.extension === 'pdf' ? <FileText className="size-4" /> : source.extension === 'txt' ? <File className="size-4" /> : <FileSpreadsheet className="size-4" />}</span>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{source.fileName}</p><p className="mt-1 text-xs text-[#829089]">{formatFileSize(source.size)} · {source.sheets.length} {source.extension === 'pdf' ? '页' : '个工作表'}</p></div>
                        {source.error || source.requiresOcr ? <AlertCircle className="size-4 text-[#a35544]" /> : <CheckCircle2 className="size-4 text-[#4d8069]" />}
                      </div>
                    </button>
                    <div className="mt-3 flex items-center justify-between border-t border-[#ded8cc] pt-2 text-xs">
                      <span className={source.error || source.requiresOcr ? 'text-[#a35544]' : 'text-[#6e7c76]'}>{source.error ?? (source.requiresOcr && sourceRowCount(source) === 0 ? '等待 OCR' : `${sourceRowCount(source)} ${source.extension === 'pdf' ? '个语义条目' : '行'}待处理`)}</span>
                      <Button variant="ghost" size="xs" className="text-[#8d4e40]" onClick={() => removeSource(source.id)}><Trash2 /> 移除</Button>
                    </div>
                    {source.warnings?.map((warning) => <p key={warning} className="mt-2 rounded-lg bg-[#fff0d6] px-2.5 py-2 text-xs leading-5 text-[#805e2f]">{warning}</p>)}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
            {selectedSource && !selectedSource.error && activeSheet ? (
              <CardContent className="space-y-5">
                <div className="flex flex-col justify-between gap-3 border-b border-[#e3ddd1] pb-4 md:flex-row md:items-start">
                  <div><p className="font-serif text-xl font-semibold">解析与字段映射</p><p className="mt-1 text-xs text-[#83908a]">{selectedSource.fileName}</p></div>
                  <div className="flex flex-wrap gap-2">{selectedSource.sheets.map((sheet) => <button key={sheet.name} type="button" onClick={() => setActiveSheetName(sheet.name)} className={`rounded-lg border px-2.5 py-1.5 text-xs ${sheet.name === activeSheet.name ? 'border-[#6f9583] bg-[#e9f1eb] text-[#315c4b]' : 'border-[#d7d0c3] text-[#6f7c76]'}`}>{sheet.name}</button>)}</div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-[#d9d2c5] bg-[#f8f5ee] px-4 py-3">
                  <div><p className="text-sm font-medium">处理此{selectedSource.extension === 'pdf' ? '页面' : '工作表'}</p><p className="text-xs text-[#829089]">{activeSheet.rows.length} {selectedSource.extension === 'pdf' ? '个语义条目' : '行'} · {activeSheet.headers.length} 个字段</p>{activeSheet.warning && <p className="mt-1 text-xs text-[#a15f42]">{activeSheet.warning}</p>}</div>
                  <Checkbox checked={activeSheet.selected} disabled={activeSheet.requiresOcr} onCheckedChange={(checked) => updateSheet(selectedSource.id, activeSheet.name, { selected: checked === true })} aria-label={`是否导入 ${activeSheet.name}`} />
                </div>

                {selectedSource.extension !== 'pdf' && <div className="grid gap-4 md:grid-cols-3">
                  {([['question', '问题列', '用于已有QA迁移'], ['answer', '答案列', '与问题列配合使用'], ['name', '名称列', '用于普通资料生成QA']] as const).map(([key, label, hint]) => (
                    <div key={key} className="space-y-2">
                      <div><p className="text-sm font-medium">{label}</p><p className="text-[11px] text-[#89948f]">{hint}</p></div>
                      <NativeSelect aria-label={label} value={activeSheet.mapping[key]} onChange={(event) => updateSheet(selectedSource.id, activeSheet.name, { mapping: { [key]: event.target.value } })} className="w-full">
                        <NativeSelectOption value="">不指定</NativeSelectOption>
                        {activeSheet.headers.map((header) => <NativeSelectOption key={header} value={header}>{header}</NativeSelectOption>)}
                      </NativeSelect>
                    </div>
                  ))}
                </div>}

                <div>
                  <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">数据预览</p><p className="text-xs text-[#83908a]">前 {Math.min(8, activeSheet.rows.length)} {selectedSource.extension === 'pdf' ? '个条目' : '行'}</p></div>
                  <div className="max-h-[340px] overflow-auto rounded-xl border border-[#ddd6c9]">
                    <Table>
                      <TableHeader className="sticky top-0 bg-[#eee9de]"><TableRow>{activeSheet.headers.slice(0, 8).map((header) => <TableHead key={header} className="max-w-56 text-xs">{header}</TableHead>)}</TableRow></TableHeader>
                      <TableBody>{activeSheet.rows.slice(0, 8).map((row, rowIndex) => <TableRow key={`${activeSheet.name}-${rowIndex}`}>{activeSheet.headers.slice(0, 8).map((header) => <TableCell key={header} className="max-w-64 truncate text-xs text-[#66766f]" title={previewValue(row[header])}>{previewValue(row[header])}</TableCell>)}</TableRow>)}</TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            ) : (
              <div className="grid min-h-[500px] place-items-center p-8 text-center"><div><AlertCircle className="mx-auto size-9 text-[#aa7567]" /><p className="mt-3 font-medium">此文件无法解析</p><p className="mt-1 text-xs text-[#89938e]">{selectedSource?.error ?? '请选择一个文件查看解析结果。'}</p></div></div>
            )}
          </Card>
        </div>
      ) : (
        <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]"><CardContent className="grid min-h-48 place-items-center text-center"><div><Files className="mx-auto size-9 text-[#a1aaa5]" /><p className="mt-3 font-medium">本批次还没有资料</p><p className="mt-1 text-xs text-[#88938d]">先添加馆方提供的 PDF、表格或文本。</p></div></CardContent></Card>
      )}

      <Card className="border-0 bg-[#203f36] text-white shadow-sm ring-0">
        <CardContent className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div><div className="flex items-center gap-2"><Sparkles className="size-5 text-[#e9ce7e]" /><p className="font-serif text-xl font-semibold">确认导入方式</p></div><p className="mt-2 text-sm text-[#c1cec9]">已选择 {validSources.length} 个有效文件、{selectedRows} 条资料。生成后可在QA审核页继续修改。</p></div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <NativeSelect aria-label="选择生成引擎" value={engine} onChange={(event) => { engineTouched.current = true; setEngine(event.target.value as 'rules' | 'model'); }} className="w-full text-white sm:w-56 [&_select]:border-white/20 [&_select]:bg-white/5"><NativeSelectOption value="model">大模型生成：{activeModelName}（推荐）</NativeSelectOption><NativeSelectOption value="rules">本地规则（不消耗额度）</NativeSelectOption></NativeSelect>
            <NativeSelect aria-label="选择导入方式" value={importMode} onChange={(event) => setImportMode(event.target.value as 'append' | 'replace')} className="w-full text-white sm:w-48 [&_select]:border-white/20 [&_select]:bg-white/5"><NativeSelectOption value="append">追加到现有知识库</NativeSelectOption><NativeSelectOption value="replace">替换现有知识库</NativeSelectOption></NativeSelect>
            <Button className="h-10 bg-[#e2c773] px-5 text-[#203f36] hover:bg-[#f0d98d]" disabled={generating || runInProgress || !validSources.length || selectedRows === 0 || (engine === 'model' && !modelReady)} onClick={() => void generate()}>{generating || runInProgress ? <LoaderCircle className="animate-spin" /> : <Sparkles />} 生成候选 QA</Button>
          </div>
        </CardContent>
      </Card>
      {(generationStatus || runInProgress || (engine === 'model' && !modelReady)) && <div className={`rounded-xl border px-4 py-3 text-sm ${engine === 'model' && !modelReady ? 'border-[#d9b09f] bg-[#fff1ed] text-[#8c4d3f]' : 'border-[#c9c0ad] bg-[#fffaf0] text-[#6f6245]'}`}>{engine === 'model' && !modelReady ? `请先到模型管理页为 ${activeModelName} 填写 API Key 并测试连接。` : runInProgress && !generationStatus ? `后台生成进行中：${runLabel}。已完成的批次已实时入库，可到“QA 生产与审核”页先审核，不要刷新页面。` : generationStatus}</div>}

      {history.length > 0 && (
        <Card className="border-0 bg-[#fffdf8] shadow-sm ring-[#ded7ca]">
          <div className="border-b border-[#e3ddd1] px-4 pb-3"><p className="font-semibold">最近导入</p><p className="text-xs text-[#829089]">保存在当前浏览器</p></div>
          <div className="divide-y divide-[#e6e0d5] px-4">{history.slice(0, 5).map((entry) => <div key={entry.id} className="flex flex-col justify-between gap-2 py-3 text-sm sm:flex-row sm:items-center"><div><p className="font-medium">{entry.fileNames.join('、')}</p><p className="mt-1 text-xs text-[#829089]">{new Date(entry.importedAt).toLocaleString('zh-CN')} · {entry.mode === 'append' ? '追加' : '替换'}</p></div><Badge variant="outline" className="border-[#a9c5b6] bg-[#edf5f0] text-[#35634f]">生成 {entry.generatedCount} 条</Badge></div>)}</div>
        </Card>
      )}
    </section>
  );
}
