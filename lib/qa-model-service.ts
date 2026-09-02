import { callModel } from '@/lib/llm-adapter';
import { createQaEvidence, rawRowText } from '@/lib/qa-evidence';
import { checkGenerationStopped, runGenerationJobs } from '@/lib/generation-control';
import type { ModelConfig } from '@/lib/model-registry';
import { prepareVisitorRows, visitorQaInstructions } from '@/lib/qa-source-policy';
import { categories, classifyKnowledge, generateQaFromParsedSources, type KnowledgeCategory, type ParsedSourceFile, type QaItem } from '@/lib/museum-workflow';

interface GeneratedPayload {
  items?: Array<{
    question?: unknown;
    answer?: unknown;
    category?: unknown;
    sourceRows?: unknown;
  }>;
}

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseJsonObject(content: string): GeneratedPayload {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned) as unknown;
  if (Array.isArray(parsed)) return { items: parsed };
  if (!parsed || typeof parsed !== 'object') throw new Error('模型输出不是有效的 QA 对象');
  return parsed as GeneratedPayload;
}

function splitRows<T>(rows: T[], batchSize = 12) {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += batchSize) batches.push(rows.slice(index, index + batchSize));
  return batches;
}

function selectedClone(source: ParsedSourceFile, sheetNames: Set<string>): ParsedSourceFile {
  return { ...source, sheets: source.sheets.map((sheet) => ({ ...sheet, selected: sheetNames.has(sheet.name) })) };
}

export async function generateQaWithModel(
  sources: ParsedSourceFile[],
  model: ModelConfig,
  apiKey: string,
  onProgress?: (completed: number, total: number, label: string) => void,
  onBatch?: (batchItems: QaItem[]) => void,
  shouldAbort?: () => boolean,
  signal?: AbortSignal,
) {
  checkGenerationStopped(signal, shouldAbort);
  if (!apiKey) throw new Error('当前模型还没有填写 API Key');

  const directSources: ParsedSourceFile[] = [];
  const aiJobs: Array<{ source: ParsedSourceFile; sheetName: string; rows: ReturnType<typeof prepareVisitorRows> }> = [];
  let excludedRows = 0;

  sources.forEach((source) => {
    const directSheetNames = new Set(source.sheets.filter((sheet) => sheet.selected && sheet.mapping.question && sheet.mapping.answer).map((sheet) => sheet.name));
    if (directSheetNames.size) directSources.push(selectedClone(source, directSheetNames));
    source.sheets.filter((sheet) => sheet.selected && !directSheetNames.has(sheet.name)).forEach((sheet) => {
      const prepared = prepareVisitorRows(sheet.rows);
      excludedRows += sheet.rows.length - prepared.length;
      splitRows(prepared).forEach((rows) => aiJobs.push({ source, sheetName: sheet.name, rows }));
    });
  });

  const output = generateQaFromParsedSources(directSources);
  let completed = 0;
  const preprocessingNote = excludedRows ? ` · 生成前跳过 ${excludedRows} 条文件管理或未确认方案资料` : '';
  onProgress?.(0, aiJobs.length, (aiJobs.length ? '准备调用模型' : output.length ? '正在迁移已有 QA' : '没有可用于生成游客问答的资料，无需调用模型') + preprocessingNote);
  onBatch?.([...output]);

  let requestSeq = 0;

  async function runJob(job: (typeof aiJobs)[number], requestSignal: AbortSignal) {
    const seq = ++requestSeq;
    onProgress?.(completed, aiJobs.length, `正在请求第 ${seq}/${aiJobs.length} 批 · ${job.source.fileName} · ${job.sheetName}${preprocessingNote}`);
    const sourceRows = job.rows.map(({ row, sourceRow }) => ({ ...row, sourceRow }));
    const content = await callModel(model, apiKey, [
      {
        role: 'system',
        content: `${visitorQaInstructions}\n分类只能使用：${categories.join('、')}。返回JSON对象：{"items":[{"question":"","answer":"","category":"","sourceRows":[2]}]}。sourceRows只引用本批资料提供的sourceRow，不要编造位置。`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          sourceMetadataOnly: { fileName: job.source.fileName, sheetName: job.sheetName },
          task: '来源标识只用于溯源，不围绕文件出题；仅从以下正文中选择对游客有用且有事实依据的知识，无有效知识则返回空items。',
          sourceRows,
        }),
      },
    ], { temperature: 0.15, maxOutputTokens: Math.min(12000, model.maxOutputTokens), structuredOutput: true, signal: requestSignal });
    checkGenerationStopped(requestSignal, shouldAbort);

    const parsed = parseJsonObject(content);
    const batchOutput: QaItem[] = [];
    for (const candidate of parsed.items ?? []) {
      if (typeof candidate.question !== 'string' || typeof candidate.answer !== 'string' || !candidate.question.trim() || !candidate.answer.trim()) continue;
      const category = typeof candidate.category === 'string' && categories.includes(candidate.category as KnowledgeCategory)
        ? candidate.category as KnowledgeCategory
        : classifyKnowledge(`${candidate.question} ${candidate.answer}`);
      const requestedRows = Array.isArray(candidate.sourceRows) ? candidate.sourceRows : [];
      const rows = [...new Set(requestedRows.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && job.rows.some((row) => row.sourceRow === value)))];
      const sourceSheet = job.source.sheets.find((sheet) => sheet.name === job.sheetName)!;
      const evidence = rows.map((row) => createQaEvidence(`${job.source.fileName} · ${job.sheetName} · 第 ${row} 行`, rawRowText(sourceSheet.rows[row - 2])));
      const item: QaItem = {
        id: createId(),
        question: candidate.question.trim(),
        answer: candidate.answer.trim(),
        category,
        source: `${job.source.fileName} · ${job.sheetName}${rows.length ? ` · 第 ${rows.join('、')} 行` : ''}`,
        evidence,
        evidenceNote: !rows.length ? '生成时未提供有效的原文引用，无法完成事实核验。' : requestedRows.some((row) => !rows.includes(row as number)) ? '生成时包含无效引用，已剔除；现有依据可能不完整。' : undefined,
        status: '待审核',
        confidence: 0.82,
        updatedAt: new Date().toISOString(),
      };
      output.push(item);
      batchOutput.push(item);
    }
    onBatch?.(batchOutput);
    completed += 1;
    onProgress?.(completed, aiJobs.length, `${job.source.fileName} · ${job.sheetName}${preprocessingNote}`);
  }

  await runGenerationJobs(aiJobs, 3, runJob, signal, shouldAbort);

  const seen = new Set<string>();
  return output.filter((item: QaItem) => {
    const key = item.question.replace(/[？?\s]/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
