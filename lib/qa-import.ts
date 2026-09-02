import * as XLSX from 'xlsx';
import { categories, classifyKnowledge, type QaItem } from '@/lib/museum-workflow';
import { createQaEvidence } from '@/lib/qa-evidence';

export interface QaImportSheet {
  name: string;
  columns: Array<{ index: number; label: string; name: string }>;
  rows: Array<{ rowNumber: number; cells: string[] }>;
}
export interface QaImportMapping { question: number; answer: number }
export interface QaImportRow { rowNumber: number; question: string; answer: string; source: string; category: string }
const aliases = {
  question: ['问题', '标准问题', 'question', 'q', '问'],
  answer: ['答案', '标准答案', 'answer', 'a', '答'],
  source: ['来源', 'source'],
  category: ['分类', '知识分类', 'category'],
};

function findColumn(sheet: QaImportSheet, field: keyof typeof aliases) {
  return sheet.columns.find(column => aliases[field].includes(column.name.trim().toLowerCase()))?.index ?? -1;
}

export function detectQaImportMapping(sheet: QaImportSheet): QaImportMapping {
  return { question: findColumn(sheet, 'question'), answer: findColumn(sheet, 'answer') };
}

export function parseQaImportWorkbook(data: ArrayBuffer): QaImportSheet[] {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(data, { type: 'array' }); }
  catch { throw new Error('Excel 解析失败，请确认文件未损坏或加密。'); }
  const sheets = workbook.SheetNames.flatMap(name => {
    const sheet = workbook.Sheets[name];
    if (!sheet['!ref']) return [];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    // Keep blank rows during parsing so validation points to the actual Excel row.
    const values = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
    const headerIndex = values.findIndex(row => row.some(cell => String(cell).trim()));
    if (headerIndex < 0) return [];
    const headers = values[headerIndex];
    return [{
      name,
      columns: headers.map((header, index) => ({ index, name: String(header).trim(), label: `${XLSX.utils.encode_col(range.s.c + index)} · ${String(header).trim() || '未命名列'}` }))
        .filter(column => column.name || values.slice(headerIndex + 1).some(row => String(row[column.index] ?? '').trim())),
      rows: values.slice(headerIndex + 1).map((cells, index) => ({
        rowNumber: range.s.r + headerIndex + index + 2,
        cells: cells.map(cell => String(cell ?? '').trim()),
      })).filter(row => row.cells.some(Boolean)),
    }];
  });
  if (!sheets.length) throw new Error('Excel 中没有可读取的工作表。');
  return sheets;
}

export function validateQaImport(sheet: QaImportSheet, mapping: QaImportMapping) {
  const errors: string[] = [];
  if (!sheet.columns.some(column => column.index === mapping.question)) errors.push('请选择问题列（必填）。');
  if (!sheet.columns.some(column => column.index === mapping.answer)) errors.push('请选择答案列（必填）。');
  if (mapping.question >= 0 && mapping.question === mapping.answer) errors.push('问题和答案必须选择不同的列。');
  if (errors.length) return { rows: [] as QaImportRow[], errors };
  const sourceIndex = findColumn(sheet, 'source');
  const categoryIndex = findColumn(sheet, 'category');
  const rows = sheet.rows.map(row => {
    const question = row.cells[mapping.question] ?? '';
    const answer = row.cells[mapping.answer] ?? '';
    const missing = [!question && '问题', !answer && '答案'].filter(Boolean);
    if (missing.length) errors.push(`第 ${row.rowNumber} 行：${missing.join('、')}不能为空。`);
    return { rowNumber: row.rowNumber, question, answer, source: row.cells[sourceIndex] ?? '', category: row.cells[categoryIndex] ?? '' };
  });
  if (!rows.length) errors.push('当前工作表只有表头，没有可导入的 QA。');
  return { rows, errors };
}

export function createImportedQaItems(fileName: string, sheet: QaImportSheet, mapping: QaImportMapping): QaItem[] {
  const { rows, errors } = validateQaImport(sheet, mapping);
  if (errors.length) throw new Error(errors[0]);
  return rows.map(row => {
    const origin = `${fileName} · ${sheet.name} · 第 ${row.rowNumber} 行`;
    return {
      id: crypto.randomUUID(), question: row.question, answer: row.answer,
      category: categories.includes(row.category as QaItem['category']) ? row.category as QaItem['category'] : classifyKnowledge(`${row.question} ${row.answer}`),
      source: row.source ? `${row.source} · ${origin}` : origin,
      status: '待审核', confidence: 1, updatedAt: new Date().toISOString(),
      evidence: [createQaEvidence(origin, `问题：${row.question}\n答案：${row.answer}`, 'provided-qa')],
    };
  });
}
