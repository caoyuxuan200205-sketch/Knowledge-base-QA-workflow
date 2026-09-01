import * as XLSX from 'xlsx';

export const categories = ['文物信息', '展览内容', '馆务服务', '参观政策', '基建导览', '其他'] as const;
export type KnowledgeCategory = (typeof categories)[number];
export type ReviewStatus = '待审核' | '已通过' | '需修改';

export interface QaItem {
  id: string;
  question: string;
  answer: string;
  category: KnowledgeCategory;
  source: string;
  status: ReviewStatus;
  confidence: number;
  updatedAt: string;
}

export type DataRow = Record<string, unknown>;

export interface ColumnMapping {
  question: string;
  answer: string;
  name: string;
}

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: DataRow[];
  selected: boolean;
  mapping: ColumnMapping;
  warning?: string;
  requiresOcr?: boolean;
}

export interface ParsedSourceFile {
  id: string;
  fileName: string;
  size: number;
  extension: string;
  sheets: ParsedSheet[];
  error?: string;
  warnings?: string[];
  requiresOcr?: boolean;
}

const questionHeaders = ['问题', 'question', '问', 'q', '标准问题'];
const answerHeaders = ['答案', 'answer', '答', 'a', '标准答案'];
const nameHeaders = ['文物名称', '展览名称', '服务名称', '项目名称', '名称', '标题', 'name', 'title'];

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalize(value: unknown) {
  let text = '';
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = String(value);
  else if (typeof value === 'symbol') text = value.description ?? '';
  else if (typeof value === 'function') text = value.name;
  else if (value !== null && value !== undefined) text = JSON.stringify(value) ?? '';
  return text.replace(/\s+/g, ' ').trim();
}

function findKey(row: DataRow, candidates: string[]) {
  const keys = Object.keys(row);
  return keys.find((key) => candidates.some((candidate) => key.trim().toLowerCase() === candidate.toLowerCase()));
}

function detectMapping(headers: string[]): ColumnMapping {
  const fakeRow = Object.fromEntries(headers.map((header) => [header, '']));
  return {
    question: findKey(fakeRow, questionHeaders) ?? '',
    answer: findKey(fakeRow, answerHeaders) ?? '',
    name: findKey(fakeRow, nameHeaders) ?? '',
  };
}

export function classifyKnowledge(text: string): KnowledgeCategory {
  const normalized = text.toLowerCase();
  const rules: Array<[KnowledgeCategory, string[]]> = [
    ['参观政策', ['预约', '门票', '退票', '证件', '开放时间', '闭馆', '入馆', '拍照', '闪光灯', '直播', '宠物', '收费']],
    ['基建导览', ['洗手间', '卫生间', '母婴室', '电梯', '寄存', '停车', '交通', '楼层', '服务台', '饮水', '充电宝', '无障碍', '地址', '路线']],
    ['展览内容', ['展览', '陈列', '展厅', '单元', '临展', '常设展']],
    ['文物信息', ['文物', '出土', '墓', '漆器', '帛画', '铜器', '陶器', '玉器', '材质', '工艺', '纹饰', '铭文', '年代', '遗体']],
    ['馆务服务', ['讲解', '导览', '租借', '咨询', '服务', '失物', '医疗', '商店', '餐饮']],
  ];

  for (const [category, keywords] of rules) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return category;
  }
  return '其他';
}

function inferQuestion(name: string, category: KnowledgeCategory) {
  if (category === '文物信息') return `${name}是什么？`;
  if (category === '展览内容') return `介绍一下${name}`;
  if (category === '参观政策') return `${name}有哪些规定？`;
  if (category === '基建导览') return `${name}在哪里？`;
  if (category === '馆务服务') return `${name}提供什么服务？`;
  return `请介绍一下${name}`;
}

function rowSummary(row: DataRow, skippedKeys: string[] = []) {
  return Object.entries(row)
    .filter(([key, value]) => !skippedKeys.includes(key) && normalize(value))
    .map(([key, value]) => `${key}：${normalize(value)}`)
    .join('；');
}

function makeItem(question: string, answer: string, source: string): QaItem {
  const category = classifyKnowledge(`${question} ${answer}`);
  return {
    id: createId(),
    question: normalize(question),
    answer: normalize(answer),
    category,
    source,
    status: '待审核',
    confidence: category === '其他' ? 0.72 : 0.9,
    updatedAt: new Date().toISOString(),
  };
}

function rowsToQa(rows: DataRow[], sourceName: string, mapping?: ColumnMapping) {
  const output: QaItem[] = [];

  rows.forEach((row, index) => {
    const questionKey = mapping?.question || findKey(row, questionHeaders);
    const answerKey = mapping?.answer || findKey(row, answerHeaders);
    const source = `${sourceName} · 第 ${index + 2} 行`;

    if (questionKey && answerKey && normalize(row[questionKey]) && normalize(row[answerKey])) {
      output.push(makeItem(normalize(row[questionKey]), normalize(row[answerKey]), source));
      return;
    }

    const nameKey = mapping?.name || findKey(row, nameHeaders);
    const firstValueKey = Object.keys(row).find((key) => normalize(row[key]));
    const resolvedNameKey = nameKey ?? firstValueKey;
    if (!resolvedNameKey) return;

    const name = normalize(row[resolvedNameKey]);
    const answer = rowSummary(row, [resolvedNameKey]);
    if (!name || !answer) return;

    const category = classifyKnowledge(`${name} ${answer}`);
    output.push(makeItem(inferQuestion(name, category), answer, source));

    const featureFields = Object.keys(row).filter((key) => /材质|尺寸|工艺|纹饰|铭文|年代|出土/.test(key) && normalize(row[key]));
    if (featureFields.length) {
      output.push(makeItem(`${name}有哪些基本特征？`, rowSummary(row, Object.keys(row).filter((key) => !featureFields.includes(key))), source));
    }

    const valueFields = Object.keys(row).filter((key) => /价值|意义|重要|特色|亮点/.test(key) && normalize(row[key]));
    if (valueFields.length) {
      output.push(makeItem(`${name}为什么重要？`, rowSummary(row, Object.keys(row).filter((key) => !valueFields.includes(key))), source));
    }
  });

  return deduplicate(output);
}

function textToQa(text: string, sourceName: string) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => normalize(paragraph))
    .filter((paragraph) => paragraph.length >= 20);

  return deduplicate(
    paragraphs.map((paragraph, index) => {
      const firstSentence = paragraph.split(/[。！？!?]/)[0].slice(0, 24).replace(/[：:，,].*$/, '');
      const category = classifyKnowledge(paragraph);
      return makeItem(inferQuestion(firstSentence || `资料第${index + 1}段`, category), paragraph, `${sourceName} · 第 ${index + 1} 段`);
    }),
  );
}

function deduplicate(items: QaItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.question.replace(/[？?\s]/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function processSourceFile(file: File): Promise<QaItem[]> {
  const parsed = await inspectSourceFile(file);
  if (parsed.error) throw new Error(parsed.error);
  return generateQaFromParsedSources([parsed]);
}

export async function inspectSourceFile(file: File): Promise<ParsedSourceFile> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const base = { id: createId(), fileName: file.name, size: file.size, extension };

  if (extension === 'txt') {
    const paragraphs = (await file.text())
      .split(/\n\s*\n/)
      .map((paragraph) => normalize(paragraph))
      .filter(Boolean);
    return {
      ...base,
      sheets: [{
        name: '正文',
        headers: ['正文'],
        rows: paragraphs.map((paragraph) => ({ 正文: paragraph })),
        selected: true,
        mapping: { question: '', answer: '', name: '' },
      }],
    };
  }

  if (!['xlsx', 'xls', 'csv'].includes(extension)) {
    return { ...base, sheets: [], error: '暂不支持此文件格式。当前支持 PDF、Excel、CSV 和 TXT。' };
  }

  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheets = workbook.SheetNames.map((sheetName) => {
      const rows = XLSX.utils.sheet_to_json<DataRow>(workbook.Sheets[sheetName], { defval: '' });
      const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
      return {
        name: sheetName,
        headers,
        rows,
        selected: rows.length > 0,
        mapping: detectMapping(headers),
      } satisfies ParsedSheet;
    });
    if (!sheets.some((sheet) => sheet.rows.length)) return { ...base, sheets, error: '文件中没有可识别的数据。' };
    return { ...base, sheets };
  } catch {
    return { ...base, sheets: [], error: '文件解析失败，请确认文件未损坏或加密。' };
  }
}

export function generateQaFromParsedSources(sources: ParsedSourceFile[]) {
  const items = sources.flatMap((source) => source.sheets
    .filter((sheet) => sheet.selected && sheet.rows.length)
    .flatMap((sheet) => {
      const sourceName = `${source.fileName} · ${sheet.name}`;
      if (source.extension === 'txt' || source.extension === 'pdf') {
        return textToQa(sheet.rows.map((row) => normalize(row['正文'])).join('\n\n'), sourceName);
      }
      return rowsToQa(sheet.rows, sourceName, sheet.mapping);
    }));
  return deduplicate(items);
}

export function exportQaAsExcel(items: QaItem[], museumName: string) {
  const rows = items.map((item) => ({
    问题: item.question,
    答案: item.answer,
    分类: item.category,
    来源: item.source,
    审核状态: item.status,
    可信度: item.confidence,
    更新时间: item.updatedAt,
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = [{ wch: 34 }, { wch: 90 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(workbook, sheet, 'qa_import_template');
  XLSX.writeFile(workbook, `${museumName || '博物馆'}_知识库QA.xlsx`);
}

export function exportQaAsJson(items: QaItem[], museumName: string) {
  const blob = new Blob([JSON.stringify({ museumName, exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${museumName || '博物馆'}_知识库QA.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export const demoQa: QaItem[] = [
  makeItem('湖南博物院的开放时间是几点到几点？', '每周二至周日开放，具体开放时段及停止入馆时间请以馆方当日公告为准。', '示例资料 · 馆务服务'),
  makeItem('白膏泥和木炭在马王堆汉墓中起什么作用？', '白膏泥用于隔绝空气和水，木炭用于防潮和干燥；它们与深埋、夯土共同形成稳定的密封保存环境。', '示例资料 · 文物档案'),
  makeItem('母婴室在哪里？', '请根据馆方楼层导览资料填写母婴室的具体位置和邻近地标。', '示例资料 · 服务设施'),
];
