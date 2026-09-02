'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, LoaderCircle, Upload } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { createImportedQaItems, detectQaImportMapping, parseQaImportWorkbook, validateQaImport, type QaImportSheet, type QaImportMapping } from '@/lib/qa-import';
import type { QaItem } from '@/lib/museum-workflow';

export function QaImportDialog({ disabled, onImport }: { disabled: boolean; onImport: (items: QaItem[]) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<QaImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<QaImportMapping>({ question: -1, answer: -1 });
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const sheet = sheets[sheetIndex];
  const validation = useMemo(() => sheet ? validateQaImport(sheet, mapping) : null, [sheet, mapping]);
  useEffect(() => () => { requestRef.current++; }, []);

  function changeOpen(value: boolean) {
    setOpen(value);
    if (!value) {
      requestRef.current++;
      setLoading(false); setSheets([]); setFileName(''); setError('');
    }
  }

  async function readFile(file: File) {
    const request = ++requestRef.current;
    setLoading(true); setError(''); setSheets([]); setFileName(file.name);
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error('请选择 Excel 文件（.xlsx 或 .xls）。');
      const data = await file.arrayBuffer();
      if (request !== requestRef.current) return;
      const parsed = parseQaImportWorkbook(data);
      const preferred = parsed.findIndex(candidate => {
        const detected = detectQaImportMapping(candidate);
        return candidate.rows.length && detected.question >= 0 && detected.answer >= 0;
      });
      const index = Math.max(0, preferred);
      setSheets(parsed); setSheetIndex(index); setMapping(detectQaImportMapping(parsed[index]));
    } catch (cause) {
      if (request === requestRef.current) setError(cause instanceof Error ? cause.message : '读取文件失败，请重试。');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  function submit() {
    if (disabled || loading || !sheet || !validation || validation.errors.length) return;
    try {
      onImport(createImportedQaItems(fileName, sheet, mapping));
      changeOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败，请重试。'); }
  }

  return <>
    <Button variant="outline" disabled={disabled} onClick={() => changeOpen(true)}><Upload /> 导入 QA</Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入 QA 表格</DialogTitle>
          <DialogDescription>上传已经整理好的 Excel。首个非空行为表头，问题和答案两列必填，每行内容也不能为空。导入后追加到候选问答，状态为待审核。</DialogDescription>
        </DialogHeader>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (file) void readFile(file);
        }} />
        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-dashed border-input bg-muted p-4">
          <Button variant="outline" disabled={loading || disabled} onClick={() => inputRef.current?.click()}>{loading ? <LoaderCircle className="animate-spin" /> : <Upload />}{loading ? '读取中…' : fileName ? '重新选择' : '选择 Excel'}</Button>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={fileName}>{fileName || '支持 .xlsx、.xls'}</span>
          <a href="/templates/qa-import-template.xlsx" download="QA导入模板.xlsx" className={buttonVariants({ variant: 'outline' })}><Download /> 下载模板</a>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {sheet && <>
          <label className="space-y-2 text-sm">工作表<NativeSelect className="mt-2 w-full" value={sheetIndex} onChange={event => {
            const index = Number(event.target.value); setSheetIndex(index); setMapping(detectQaImportMapping(sheets[index])); setError('');
          }}>{sheets.map((entry, index) => <NativeSelectOption key={entry.name} value={index}>{entry.name} · {entry.rows.length} 行</NativeSelectOption>)}</NativeSelect></label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['question', 'answer'] as const).map(field => <label key={field} className="text-sm">{field === 'question' ? '问题列' : '答案列'} <span className="text-destructive">*</span>
              <NativeSelect required className="mt-2 w-full" value={mapping[field]} onChange={event => { setMapping(current => ({ ...current, [field]: Number(event.target.value) })); setError(''); }}>
                <NativeSelectOption value={-1}>请选择列</NativeSelectOption>
                {sheet.columns.map(column => <NativeSelectOption key={column.index} value={column.index}>{column.label}</NativeSelectOption>)}
              </NativeSelect>
            </label>)}
          </div>
          {Boolean(validation?.errors.length) && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs leading-6 text-destructive">
            <p className="font-medium">请修正以下问题后再导入（共 {validation!.errors.length} 项）</p>
            {validation!.errors.slice(0, 8).map(message => <p key={message}>{message}</p>)}
            {validation!.errors.length > 8 && <p>另有 {validation!.errors.length - 8} 项，请检查 Excel 中的问题和答案是否完整。</p>}
          </div>}
          {Boolean(validation?.rows.length) && <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full table-fixed text-left text-xs"><caption className="p-3 text-left text-muted-foreground">预览前 {Math.min(5, validation!.rows.length)} 条，共 {validation!.rows.length} 条</caption>
              <thead className="border-y border-border bg-muted"><tr><th className="w-16 p-3">行号</th><th className="w-1/3 p-3">问题</th><th className="p-3">答案</th></tr></thead>
              <tbody className="divide-y divide-border">{validation!.rows.slice(0, 5).map(row => <tr key={row.rowNumber}>
                <td className="p-3 align-top text-muted-foreground">{row.rowNumber}</td>
                <td className="p-3 align-top"><p className="line-clamp-3 break-words whitespace-pre-wrap">{row.question || <span className="text-destructive">未填写</span>}</p></td>
                <td className="p-3 align-top"><p className="line-clamp-3 break-words whitespace-pre-wrap">{row.answer || <span className="text-destructive">未填写</span>}</p></td>
              </tr>)}</tbody>
            </table>
          </div>}
        </>}
        <p className="text-xs leading-5 text-muted-foreground">直接保留表格中的问题和答案，不调用生成模型。“来源”“知识分类”列可选。QA 表格本身不作为独立原文依据。</p>
        <DialogFooter><Button variant="outline" onClick={() => changeOpen(false)}>取消</Button><Button disabled={disabled || loading || !validation?.rows.length || Boolean(validation?.errors.length)} onClick={submit}>确认导入{validation?.rows.length ? ` ${validation.rows.length} 条` : ''}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
