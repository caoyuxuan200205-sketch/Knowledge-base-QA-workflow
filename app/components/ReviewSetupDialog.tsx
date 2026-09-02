'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, LoaderCircle, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { needsMachineReview } from '@/lib/qa-review';
import { MACHINE_REVIEW_CONCURRENCY } from '@/lib/qa-review-service';
import { createReviewMaterialIndex, type ReviewDocument } from '@/lib/review-materials';
import { readReviewDocument } from '@/lib/review-material-reader';
import { loadReviewDocuments, saveReviewDocuments } from '@/lib/review-material-storage';
import type { QaItem } from '@/lib/museum-workflow';

interface ReviewSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: QaItem[];
  busy: boolean;
  modelName: string;
  modelReady: boolean;
  modelIssue?: string;
  sameModel: boolean;
  onOpenModels: () => void;
  onStart: (items: QaItem[]) => void;
}

export function ReviewSetupDialog({ open, onOpenChange, items, busy, modelName, modelReady, modelIssue, sameModel, onOpenModels, onStart }: ReviewSetupDialogProps) {
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [ready, setReady] = useState(false);
  const [loadingFile, setLoadingFile] = useState('');
  const [storageError, setStorageError] = useState('');
  const documentsRef = useRef<ReviewDocument[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef(0);
  const saveRef = useRef(0);
  useEffect(() => {
    let active = true;
    void loadReviewDocuments().then(saved => {
      if (active) { documentsRef.current = saved; setDocuments(saved); }
    }).catch(() => {
      if (active) setStorageError('本机审核资料读取失败，可以重新上传；已保存在 QA 中的关联片段仍可使用。');
    }).finally(() => { if (active) setReady(true); });
    return () => { active = false; batchRef.current++; saveRef.current++; };
  }, []);

  function updateDocuments(next: ReviewDocument[]) {
    documentsRef.current = next; setDocuments(next);
    const save = ++saveRef.current;
    void saveReviewDocuments(next).then(() => { if (save === saveRef.current) setStorageError(''); }).catch(() => {
      if (save === saveRef.current) setStorageError('审核资料未能保存到本机。当前页面仍可使用，刷新后可能需要重新上传。');
    });
  }

  async function addFiles(files: File[]) {
    if (!ready || busy || loadingFile || !files.length) return;
    const batch = ++batchRef.current;
    try {
      for (const file of files) {
        setLoadingFile(file.name);
        const parsed = await readReviewDocument(file);
        if (batch !== batchRef.current) return;
        // A successful upload replaces an earlier version of the same file.
        const retained = parsed.error ? documentsRef.current : documentsRef.current.filter(document => document.fileName !== parsed.fileName);
        updateDocuments([...retained, parsed]);
      }
    } finally { if (batch === batchRef.current) setLoadingFile(''); }
  }

  const index = useMemo(() => createReviewMaterialIndex(documents), [documents]);
  const targets = useMemo(() => !open ? [] : items.filter(item => item.status === '待审核').map(item => index.match(item)).filter(needsMachineReview), [open, items, index]);
  const missingEvidence = targets.filter(item => !item.evidence?.some(entry => entry.kind === 'material' && entry.text.trim())).length;
  const selectedDocuments = index.documents.length;
  const failedWithoutMaterials = documents.some(document => document.error) && !selectedDocuments;
  const canStart = ready && !busy && !loadingFile && !failedWithoutMaterials && modelReady && targets.length > 0;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85vh] overflow-y-auto bg-card sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>开始 QA 机审</DialogTitle>
        <DialogDescription>为当前筛选范围内的待审核 QA 上传原始资料。系统匹配相关片段后审核，已完成且依据未变化的条目会跳过。</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-medium">上传审核依据</p><p className="mt-1 text-xs text-muted-foreground">PDF、Word（.docx）、TXT · 支持多文件 · 单个文件最多 20 MB</p></div>
          <Button variant="outline" disabled={!ready || busy || Boolean(loadingFile)} onClick={() => inputRef.current?.click()}>{loadingFile ? <LoaderCircle className="animate-spin" /> : <Upload />}{loadingFile ? '读取中…' : '选择原始文件'}</Button>
        </div>
        <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.txt" className="hidden" onChange={event => {
          const files = Array.from(event.target.files ?? []); event.target.value = ''; void addFiles(files);
        }} />
        {!ready && <p className="text-xs text-muted-foreground">正在恢复已上传资料…</p>}
        {loadingFile && <p role="status" className="truncate text-xs text-muted-foreground">正在读取：{loadingFile}</p>}
        {documents.length > 0 && <div className="max-h-60 space-y-2 overflow-y-auto">
          {documents.map(document => <div key={document.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <input type="checkbox" aria-label={`本次使用 ${document.fileName}`} checked={document.selected} disabled={Boolean(document.error) || busy || Boolean(loadingFile)} className="mt-1 accent-primary" onChange={event => updateDocuments(documentsRef.current.map(entry => entry.id === document.id ? { ...entry, selected: event.target.checked } : entry))} />
              <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{document.fileName}</p><p className="mt-1 text-xs text-muted-foreground">{document.passages.length} 个原文片段 · {(document.size / 1024 / 1024).toFixed(2)} MB</p></div>
              <Button variant="ghost" size="icon-sm" aria-label={`移除 ${document.fileName}`} disabled={busy || Boolean(loadingFile)} onClick={() => updateDocuments(documentsRef.current.filter(entry => entry.id !== document.id))}><Trash2 /></Button>
            </div>
            {document.error && <p role="alert" className="mt-2 text-xs text-destructive">{document.error}</p>}
            {document.warnings.map(warning => <p key={warning} className="mt-2 text-xs leading-5 text-amber-700">{warning}</p>)}
            {!!document.passages.length && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">查看原文预览</summary>{document.passages.slice(0, 2).map(passage => <div key={passage.id} className="mt-2"><p className="font-medium">{passage.source}</p><p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap leading-5">{passage.text}</p></div>)}</details>}
          </div>)}
        </div>}
        <p className="text-xs leading-5 text-muted-foreground">已选 {selectedDocuments} 个文件。{selectedDocuments ? '本次以选中文件重新匹配依据，相关片段随 QA 保存。' : '不选择新文件时，沿用 QA 已有关联依据。'} 扫描页需先 OCR；Word 和 TXT 按段落定位。</p>
        <p className="text-xs leading-5 text-muted-foreground">文件文字保存在当前浏览器；确认审核后，仅将相关片段发送给所选模型。移除文件不删除历史 QA 中已保存的片段。</p>
      </div>
      {storageError && <p role="alert" className="text-xs text-amber-700">{storageError}</p>}
      {failedWithoutMaterials && <p role="alert" className="text-xs text-destructive">上传的文件未能提供可用原文，请重新上传或移除失败文件后继续。</p>}
      <div className="rounded-xl border border-info-border bg-info p-3 text-sm text-info-foreground">
        <p>本次 {targets.length} 条 · 使用 {modelName} · 同时审核 {MACHINE_REVIEW_CONCURRENCY} 条</p>
        <p className="mt-1 text-xs leading-5">{missingEvidence ? `${missingEvidence} 条未找到独立原文，将标记依据不足，模型仅检查问答与表达。` : '将依据匹配的原文返回简短结论，发现问题时附原文引用。'} 审核会产生 API 用量。</p>
      </div>
      {!!targets.length && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看依据匹配预览（前 {Math.min(3, targets.length)} 条）</summary>
        {targets.slice(0, 3).map(item => <div key={item.id} className="mt-2 rounded-lg border border-border p-3"><p className="font-medium text-foreground">{item.question}</p><p className="mt-1 leading-5">{item.evidence?.filter(entry => entry.kind === 'material').map(entry => entry.source).filter((value, position, all) => all.indexOf(value) === position).join('；') || '未找到相关原文'}</p></div>)}
      </details>}
      {!targets.length && ready && !loadingFile && <p className="text-xs text-muted-foreground">当前没有需要机审的待审核 QA。可调整筛选、上传新依据，或在 QA 详情中重审本条。</p>}
      {sameModel && <p className="text-xs text-muted-foreground">审核与生成使用同一模型，可在模型配置中选用不同模型作交叉检查。</p>}
      {!modelReady && <p className="text-sm text-destructive">{modelIssue || '请先配置 QA 审核模型。'}</p>}
      <button type="button" className="w-fit text-xs text-primary underline" onClick={onOpenModels}>前往模型配置</button>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={!canStart} onClick={() => { if (canStart) onStart(targets); }}><FileText /> 确认机审</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
