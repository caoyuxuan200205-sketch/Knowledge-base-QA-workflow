'use client';

import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  FileText,
  HelpCircle,
  History,
  RotateCw,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { machineReviewStatus } from '@/lib/qa-review';
import type { QaItem } from '@/lib/museum-workflow';
import type { MachineReviewStatus } from '@/lib/qa-review';

const statusBadgeStyles: Record<MachineReviewStatus, { badge: string; icon: typeof CheckCircle2 }> = {
  未机审: { badge: 'border-border bg-muted/60 text-muted-foreground', icon: Bot },
  审核中: { badge: 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300', icon: RotateCw },
  未发现明显问题: { badge: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300', icon: CheckCircle2 },
  建议修改: { badge: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300', icon: AlertTriangle },
  依据不足: { badge: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300', icon: HelpCircle },
  请求失败: { badge: 'border-destructive/30 bg-destructive/10 text-destructive', icon: AlertCircle },
  已停止: { badge: 'border-border bg-muted text-muted-foreground', icon: Clock },
  结果已过期: { badge: 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-300', icon: AlertTriangle },
};

export function MachineReviewPanel({
  item,
  busy,
  onRetry,
  onAdopt,
}: {
  item: QaItem;
  busy: boolean;
  onRetry: () => void;
  onAdopt: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = machineReviewStatus(item);
  const review = item.machineReview;
  const result = review?.result;
  const stale = status === '结果已过期';
  const styleConfig = statusBadgeStyles[status] ?? statusBadgeStyles['未机审'];
  const StatusIcon = styleConfig.icon;

  return (
    <>
      {/* Detail card entry section */}
      <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 shadow-xs transition-colors hover:border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Bot className="size-4.5" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold tracking-tight">机审意见</span>
                <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${styleConfig.badge}`}>
                  <StatusIcon className={`size-3 ${status === '审核中' ? 'animate-spin' : ''}`} />
                  {status}
                </span>
              </div>
              {result?.summary ? (
                <p className="line-clamp-1 text-xs text-muted-foreground max-w-[280px] sm:max-w-md md:max-w-lg">
                  {result.summary}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {status === '未机审' ? '尚未进行机器智能审核，可点击机审' : '机审不代替人工决策，仅供审核参考'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpen(true)}
              className="text-xs font-medium"
            >
              查看机审意见
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={busy}
              onClick={onRetry}
              className="text-xs font-medium"
            >
              {review ? '重审本条' : '机审本条'}
            </Button>
          </div>
        </div>
      </div>

      {/* Machine Review Dialog Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden sm:max-w-2xl">
          <DialogHeader className="p-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2.5">
              <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                <Bot className="size-5 text-primary" />
                机审意见详情
              </DialogTitle>
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${styleConfig.badge}`}>
                <StatusIcon className={`size-3 ${status === '审核中' ? 'animate-spin' : ''}`} />
                {status}
              </span>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              {review ? (
                <span>
                  模型：{review.model.name}（{review.model.modelId}） · 时间：{new Date(review.finishedAt ?? review.startedAt).toLocaleString('zh-CN')}
                </span>
              ) : (
                <span>当前问答尚未发起机审。机审只提出独立参考建议，不会自动通过或覆盖人工数据。</span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable Modal Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
            {stale && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>QA 内容、依据材料或审核规则已发生变化，以下旧结论仅供追溯参考，建议重新机审。</div>
              </div>
            )}

            {review?.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive flex items-start gap-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div>{review.error}</div>
              </div>
            )}

            {result ? (
              <>
                {/* Summary Card */}
                <div className="rounded-lg border border-border/80 bg-muted/30 p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Sparkles className="size-4 text-primary" />
                    <span>综合结论</span>
                  </div>
                  <p className="leading-6 text-sm">{result.summary}</p>
                  {result.limitations.map((message) => (
                    <p key={message} className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                      ⚠ {message}
                    </p>
                  ))}
                </div>

                {Boolean(result.citations?.length) && <div className="space-y-2 rounded-lg border border-border bg-card p-3.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><FileText className="size-3.5" /> 结论引用的原文</p>
                  {result.citations!.map((citation, index) => <blockquote key={`${citation.evidenceId}-${index}`} className="border-l-2 border-primary/60 bg-muted/30 p-3 text-xs leading-5">
                    <p className="whitespace-pre-wrap">{citation.quote}</p>
                    <p className="mt-2 font-medium text-muted-foreground">{citation.source}</p>
                  </blockquote>)}
                </div>}

                {/* Historical detailed reviews retain their dimension checks. */}
                {Boolean(result.checks.length) && <div className="space-y-2.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    六项维度检查结果
                  </p>
                  <div className="divide-y divide-border rounded-lg border border-border bg-card">
                    {result.checks.map((check) => (
                      <div key={check.dimension} className="p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm text-foreground">{check.dimension}</span>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border ${
                              check.status === 'ok'
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : check.status === 'issue'
                                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                                  : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                            }`}
                          >
                            {check.status === 'ok' ? '未发现问题' : check.status === 'issue' ? '需关注' : '待核实'}
                          </span>
                        </div>
                        <p className="text-xs leading-5 text-muted-foreground">{check.reason}</p>
                        {check.citations.map((citation, index) => (
                          <blockquote
                            key={`${citation.evidenceId}-${index}`}
                            className="mt-2 rounded-r border-l-2 border-primary/60 bg-muted/30 p-2 text-xs leading-5 text-muted-foreground"
                          >
                            <p className="font-sans italic">“{citation.quote}”</p>
                            <span className="mt-1 block text-[11px] text-muted-foreground/80">
                              来源：{item.evidence?.find((entry) => entry.id === citation.evidenceId)?.source ?? '原资料片段'}
                            </span>
                          </blockquote>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                }

                {/* Suggestion Section */}
                {result.suggestion && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-primary flex items-center gap-1.5">
                        <Sparkles className="size-4" />
                        建议修改稿（未自动应用）
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || stale || review?.status !== 'complete'}
                        onClick={() => {
                          onAdopt();
                          setOpen(false);
                        }}
                        className="bg-card hover:bg-accent text-xs"
                      >
                        采用此建议并保留原稿
                      </Button>
                    </div>
                    <div className="space-y-2 text-xs leading-5">
                      <div className="rounded border bg-card p-2.5">
                        <span className="font-medium text-muted-foreground block mb-1">建议问题：</span>
                        <p className="text-foreground whitespace-pre-wrap font-medium">{result.suggestion.question}</p>
                      </div>
                      <div className="rounded border bg-card p-2.5">
                        <span className="font-medium text-muted-foreground block mb-1">建议答案：</span>
                        <p className="text-foreground whitespace-pre-wrap">{result.suggestion.answer}</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              !review?.error && (
                <div className="py-8 text-center space-y-2">
                  <Bot className="mx-auto size-10 text-muted-foreground/40" />
                  <p className="font-medium text-sm">暂无机审结果</p>
                  <p className="text-xs text-muted-foreground">点击下方“机审本条”开始调用大模型进行多维度审核。</p>
                </div>
              )
            )}

            {/* Evidence details */}
            <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5 font-medium text-xs text-muted-foreground">
                <FileText className="size-3.5" />
                <span>原文依据 · {item.evidence?.length ?? 0} 个片段</span>
              </div>
              {!item.evidence?.length && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  此 QA 没有保存原文。可在“开始机审”中上传原始资料后审核，文件名本身不能作为事实依据。
                </p>
              )}
              {item.evidenceNote && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{item.evidenceNote}</p>
              )}
              {item.evidence?.map((entry) => (
                <div key={entry.id} className="rounded border border-border/60 bg-muted/20 p-2 text-xs leading-5">
                  <p className="font-medium text-foreground">
                    {entry.source}
                    {entry.kind === 'provided-qa' ? ' · 导入 QA（非独立证据）' : ''}
                    {entry.truncated ? ' · 片段已截断' : ''}
                  </p>
                  <p className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{entry.text}</p>
                </div>
              ))}
            </div>

            {/* Revisions & History */}
            {Boolean(item.revisions?.length || item.machineReviewHistory?.length) && (
              <div className="rounded-lg border border-border bg-card p-3.5 space-y-3">
                <div className="flex items-center gap-1.5 font-medium text-xs text-muted-foreground">
                  <History className="size-3.5" />
                  <span>历史记录</span>
                </div>
                {Boolean(item.revisions?.length) && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-foreground">采用建议前的原稿（{item.revisions!.length} 版）</p>
                    {item.revisions!.map((version, index) => (
                      <div key={`${version.savedAt}-${index}`} className="rounded border bg-muted/20 p-2 text-xs leading-5">
                        <p className="text-muted-foreground text-[11px]">{new Date(version.savedAt).toLocaleString('zh-CN')}</p>
                        <p className="mt-0.5 font-medium text-foreground">{version.question}</p>
                        <p className="text-muted-foreground line-clamp-2">{version.answer}</p>
                      </div>
                    ))}
                  </div>
                )}
                {Boolean(item.machineReviewHistory?.length) && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs font-medium text-foreground">历史机审日志（{item.machineReviewHistory!.length} 次）</p>
                    {item.machineReviewHistory!.map((previous) => (
                      <div key={previous.attemptId} className="rounded border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{previous.model.name}</span>
                          <span className="text-[11px]">{new Date(previous.finishedAt ?? previous.startedAt).toLocaleString('zh-CN')}</span>
                        </div>
                        <p className="mt-1 text-foreground font-medium">{previous.result?.verdict}</p>
                        <p className="text-muted-foreground">{previous.result?.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dialog Footer */}
          <DialogFooter className="p-4 border-t border-border shrink-0 bg-muted/30 flex items-center justify-between sm:justify-between">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                onRetry();
              }}
              className="text-xs font-medium"
            >
              <RotateCw className="size-3.5 mr-1" />
              {review ? '重审本条' : '机审本条'}
            </Button>
            <DialogClose render={<Button size="sm" variant="outline" className="text-xs">关闭</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
