'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { needsMachineReview } from '@/lib/qa-review';
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
  const pendingItems = useMemo(() => items.filter(item => item.status === '待审核'), [items]);
  const targets = useMemo(() => !open ? [] : pendingItems.map(item => index.match(item)).filter(needsMachineReview), [open, pendingItems, index]);
  const selectedDocuments = index.documents.length;
  const failedWithoutMaterials = documents.some(document => document.error) && !selectedDocuments;
  const canStart = ready && !busy && !loadingFile && !failedWithoutMaterials && modelReady && targets.length > 0;

  // Check how many pending items already have built-in material evidence from platform generation
  const builtInEvidenceCount = useMemo(() => {
    return pendingItems.filter(item => item.evidence && item.evidence.some(e => e.kind === 'material' && e.text?.trim())).length;
  }, [pendingItems]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-card sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>开始 QA 机审</DialogTitle>
          <DialogDescription>
            基于原文事实对待审核 QA 进行机器核验。平台生成的问答默认使用已有依据，已审且依据未变条目自动跳过。
          </DialogDescription>
        </DialogHeader>

        {/* Core Review & Evidence Status */}
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                待审条目：<span className="text-base font-semibold text-primary">{targets.length}</span> 条
                {pendingItems.length > targets.length && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    （共 {pendingItems.length} 条，{pendingItems.length - targets.length} 条已审跳过）
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedDocuments > 0 ? (
                  <span className="text-primary">已启用 {selectedDocuments} 份参考文件重新比对匹配依据</span>
                ) : builtInEvidenceCount > 0 ? (
                  <span>已关联生成依据（{builtInEvidenceCount} 条具备原文），无需上传文件，可直接机审</span>
                ) : (
                  <span className="text-amber-700">外部导入条目暂无原文依据，建议补充参考资料</span>
                )}
              </p>
            </div>

            <button
              type="button"
              disabled={!ready || busy || Boolean(loadingFile)}
              onClick={() => inputRef.current?.click()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              {loadingFile ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              <span>{loadingFile ? '读取中…' : '上传补充文件'}</span>
            </button>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={event => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              void addFiles(files);
            }}
          />

          {/* Discreet small-text note for supplementary materials */}
          <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
            <span>补充或更新参考资料（可选 · PDF/Word/TXT 最大 100 MB，仅用于替换依据或外部导入 QA）</span>
            {documents.length > 0 && (
              <span>已添加 {documents.length} 份文件</span>
            )}
          </div>

          {/* Show uploaded document list only when user has actually added files */}
          {documents.length > 0 && (
            <div className="max-h-44 space-y-1.5 overflow-y-auto pt-1">
              {documents.map(document => (
                <div key={document.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card/80 px-2.5 py-1.5 text-xs">
                  <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={document.selected}
                      disabled={Boolean(document.error) || busy || Boolean(loadingFile)}
                      className="accent-primary size-3.5"
                      onChange={event => updateDocuments(documentsRef.current.map(entry => entry.id === document.id ? { ...entry, selected: event.target.checked } : entry))}
                    />
                    <span className="truncate font-medium text-foreground">{document.fileName}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      ({document.passages.length} 个片段 · {(document.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                  </label>
                  <button
                    type="button"
                    aria-label={`移除 ${document.fileName}`}
                    disabled={busy || Boolean(loadingFile)}
                    onClick={() => updateDocuments(documentsRef.current.filter(entry => entry.id !== document.id))}
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 p-0.5"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {storageError && <p role="alert" className="text-xs text-amber-700">{storageError}</p>}
        {failedWithoutMaterials && <p role="alert" className="text-xs text-destructive">上传的文件未能提供可用原文，请重新上传或移除失败文件后继续。</p>}

        {/* Evidence Matching Preview */}
        {!!targets.length && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium hover:text-foreground">
              查看依据匹配预览（前 {Math.min(3, targets.length)} 条）
            </summary>
            <div className="mt-2 space-y-2">
              {targets.slice(0, 3).map(item => (
                <div key={item.id} className="rounded-lg border border-border bg-muted/20 p-2.5">
                  <p className="font-medium text-foreground">{item.question}</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    {item.evidence?.filter(entry => entry.kind === 'material').map(entry => entry.source).filter((value, position, all) => all.indexOf(value) === position).join('；') || '未找到相关原文'}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}

        {!targets.length && ready && !loadingFile && (
          <p className="text-xs text-muted-foreground">当前筛选范围内没有需要机审的待审核 QA（已全部完成或无需审核）。</p>
        )}
        {sameModel && (
          <p className="text-[11px] text-muted-foreground">提示：审核与生成当前使用同一模型，可在模型配置中选用不同模型以实现交叉审查。</p>
        )}
        {!modelReady && (
          <p className="text-sm text-destructive">{modelIssue || '请先配置 QA 审核模型。'}</p>
        )}

        <div className="flex items-center justify-between pt-1">
          <button type="button" className="text-xs text-primary underline" onClick={onOpenModels}>前往模型配置</button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={!canStart} onClick={() => { if (canStart) onStart(targets); }}>
              <FileText /> 确认机审 {targets.length > 0 ? `(${targets.length})` : ''}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
