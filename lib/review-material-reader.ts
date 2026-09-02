import { unzipSync, strFromU8 } from 'fflate';
import { createReviewPassages, type ReviewDocument } from '@/lib/review-materials';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 1_000_000;

export function extractDocxXml(data: Uint8Array) {
  const parts = unzipSync(data, { filter: entry => {
    if (entry.name !== 'word/document.xml') return false;
    if (entry.originalSize > MAX_FILE_BYTES) throw new Error('Word 正文过大，请拆分文件后上传。');
    return true;
  } });
  if (!parts['word/document.xml']) throw new Error('无法读取 Word 正文，请上传未加密的 .docx 文件。');
  return strFromU8(parts['word/document.xml']);
}

export function docxSections(xml: string, fileName: string) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Word 正文格式无效。');
  const wordNamespaces = new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main']);
  function textOf(node: Node): string {
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (wordNamespaces.has(element.namespaceURI ?? '')) {
      if (['del', 'moveFrom', 'instrText'].includes(element.localName)) return '';
      if (element.localName === 't') return element.textContent ?? '';
      if (element.localName === 'tab') return '\t';
      if (['br', 'cr'].includes(element.localName)) return '\n';
    }
    return Array.from(node.childNodes).map(textOf).join('');
  }
  const paragraphs = Array.from(document.getElementsByTagNameNS('*', 'p')).filter(element => {
    if (!wordNamespaces.has(element.namespaceURI ?? '')) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (wordNamespaces.has(parent.namespaceURI ?? '') && ['del', 'moveFrom', 'p'].includes(parent.localName)) return false;
    }
    return true;
  });
  const sections = paragraphs.map((paragraph, index) => ({ source: `${fileName} · 第 ${index + 1} 段`, text: textOf(paragraph).trim() })).filter(section => section.text);
  const incomplete = document.getElementsByTagNameNS('*', 'altChunk').length > 0;
  const hasImages = document.getElementsByTagNameNS('*', 'blip').length > 0;
  return { sections, incomplete, warnings: [
    ...(hasImages ? ['Word 中的图片未做 OCR，仅提取正文和表格文字。'] : []),
    ...(incomplete ? ['Word 含嵌入内容，部分内容未能提取。'] : []),
  ] };
}

export async function readReviewDocument(file: File): Promise<ReviewDocument> {
  const document: ReviewDocument = { id: crypto.randomUUID(), fileName: file.name, size: file.size, selected: true, passages: [], warnings: [], incomplete: false };
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('单个文件不能超过 20 MB，请拆分后上传。');
    const extension = file.name.split('.').pop()?.toLowerCase();
    let sections: Array<{ source: string; text: string }>;
    if (extension === 'pdf') {
      const { inspectPdfFile } = await import('@/lib/pdf-client');
      const parsed = await inspectPdfFile(file);
      if (parsed.error) throw new Error(parsed.error);
      sections = parsed.sheets.filter(sheet => sheet.selected).map(sheet => ({ source: `${file.name} · ${sheet.name}`, text: sheet.rows.map(row => String(row['正文'] ?? '')).join('\n') }));
      const skipped = parsed.sheets.filter(sheet => !sheet.selected).length;
      document.incomplete = skipped > 0;
      if (skipped) document.warnings.push(`${skipped} 页没有可用文本层，需要 OCR；本次仅使用已提取的页面。`);
    } else if (extension === 'docx') {
      const parsed = docxSections(extractDocxXml(new Uint8Array(await file.arrayBuffer())), file.name);
      sections = parsed.sections; document.warnings = parsed.warnings; document.incomplete = parsed.incomplete;
    } else if (extension === 'txt') {
      const bytes = await file.arrayBuffer();
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { text = new TextDecoder('gb18030').decode(bytes); }
      sections = text.split(/\r?\n\s*\r?\n/).map((text, index) => ({ source: `${file.name} · 第 ${index + 1} 段`, text }));
    } else throw new Error('支持 PDF、Word（.docx）和 TXT；旧版 .doc 请先另存为 .docx。');
    if (sections.reduce((sum, section) => sum + section.text.length, 0) > MAX_TEXT_CHARACTERS) throw new Error('文件正文超过 100 万字符，请拆分文件后上传。');
    document.passages = createReviewPassages(document.id, sections);
    if (!document.passages.length) throw new Error('没有提取到可用文字；扫描文件请先进行 OCR。');
  } catch (error) {
    document.error = error instanceof Error ? error.message : '文件读取失败，请重试。';
    document.selected = false;
  }
  return document;
}
