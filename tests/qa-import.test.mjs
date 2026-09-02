import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import * as XLSX from 'xlsx';
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href : specifier, context);
} });
const { parseQaImportWorkbook, detectQaImportMapping, validateQaImport, createImportedQaItems } = await import('../lib/qa-import.ts');

function read(rows, bookType = 'xlsx', origin = 'A1') {
  const workbook = XLSX.utils.book_new();
  const sheet = {};
  XLSX.utils.sheet_add_aoa(sheet, rows, { origin });
  XLSX.utils.book_append_sheet(workbook, sheet, '问答');
  return parseQaImportWorkbook(XLSX.write(workbook, { type: 'array', bookType }))[0];
}

test('xlsx and xls imports preserve ready-made QA, including multiline text and duplicate questions', () => {
  for (const type of ['xlsx', 'xls']) {
    const sheet = read([['问题', '答案', '来源', '知识分类'], ['开放吗？', '拟于明年开放。\n以公告为准。', '服务手册', '参观政策'], ['开放吗？', '尚未开放。', '', '']], type);
    const items = createImportedQaItems('问答.' + type, sheet, detectQaImportMapping(sheet));
    assert.equal(items.length, 2);
    assert.equal(items[0].answer, '拟于明年开放。\n以公告为准。');
    assert.equal(items[0].category, '参观政策');
    assert.match(items[0].source, /服务手册.*第 2 行/);
    assert.ok(items.every(item => item.status === '待审核' && !item.machineReview));
    assert.equal(items[0].evidence[0].kind, 'provided-qa');
    assert.notEqual(items[0].id, items[1].id);
  }
});

test('missing columns, identical column mappings and missing values block the whole import', () => {
  const missing = read([['问题', '备注'], ['多高？', '无答案列']]);
  assert.match(validateQaImport(missing, detectQaImportMapping(missing)).errors.join(), /答案列/);
  assert.throws(() => createImportedQaItems('qa.xlsx', missing, { question: 0, answer: 0 }), /不同/);
  const incomplete = read([['问题', '答案'], ['高多少？', '20厘米'], ['在哪里？', '   '], ['', '馆内']]);
  const validation = validateQaImport(incomplete, detectQaImportMapping(incomplete));
  assert.deepEqual(validation.errors, ['第 3 行：答案不能为空。', '第 4 行：问题不能为空。']);
  assert.throws(() => createImportedQaItems('qa.xlsx', incomplete, detectQaImportMapping(incomplete)), /第 3 行/);
});

test('blank rows are ignored while true Excel row and column positions remain accurate', () => {
  const sheet = read([['问题', '答案'], [], ['在哪里？', ''], ['多高？', '20厘米']], 'xlsx', 'C4');
  assert.equal(sheet.columns[0].label, 'C · 问题');
  assert.equal(sheet.rows[0].rowNumber, 6);
  assert.deepEqual(validateQaImport(sheet, detectQaImportMapping(sheet)).errors, ['第 6 行：答案不能为空。']);
});

test('custom headers can be mapped; header-only files cannot import', () => {
  const custom = read([['提问内容', '回复内容'], ['多少钱？', 0]]);
  assert.equal(detectQaImportMapping(custom).question, -1);
  assert.equal(createImportedQaItems('qa.xlsx', custom, { question: 0, answer: 1 })[0].answer, '0');
  const empty = read([['问题', '答案']]);
  assert.throws(() => createImportedQaItems('qa.xlsx', empty, detectQaImportMapping(empty)), /只有表头/);
});

test('all worksheets are available and English QA headers are detected', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['说明'], ['请选择问答表']]), '说明');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[' Question ', 'ANSWER'], ['Height?', '20cm']]), 'QA');
  const sheets = parseQaImportWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  assert.deepEqual(sheets.map(sheet => sheet.name), ['说明', 'QA']);
  assert.deepEqual(detectQaImportMapping(sheets[1]), { question: 0, answer: 1 });
});
