'use client';

import type { ParsedSheet, ParsedSourceFile } from '@/lib/museum-workflow';

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function splitLongBlock(text: string, maxLength = 1400) {
  if (text.length <= maxLength) return [text];
  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]+|[^。！？!?；;]+$/g) ?? [text];
  const output: string[] = [];
  let buffer = '';
  sentences.forEach((sentence) => {
    if (buffer && buffer.length + sentence.length > maxLength) {
      output.push(buffer);
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  });
  if (buffer) output.push(buffer);
  return output;
}

function textToSemanticBlocks(text: string) {
  const lines = text
    .split(/\n+/)
    .map(normalize)
    .filter((line) => line && !/^[-—–]?\s*\d{1,3}\s*[-—–]?$/.test(line));
  if (!lines.length) return [];

  const entryStart = /^(?:\d{1,3}\s*)?(?:国保单位|省保单位|市保单位|县保单位|保护单位|文物名称|展品名称|建筑名称|遗址名称|项目名称|名称)\s*[：:]/;
  const sectionHeading = /^(?:第[一二三四五六七八九十百\d]+[章节单元部分]|[一二三四五六七八九十]+[、.．\s]+)\S.{0,28}$/;
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const merged = current.join('').replace(/\s+([，。；：！？、）])/g, '$1').trim();
    if (merged) blocks.push(...splitLongBlock(merged));
    current = [];
  };

  lines.forEach((line) => {
    if ((entryStart.test(line) || sectionHeading.test(line)) && current.length) flush();
    current.push(line);
  });
  flush();
  return blocks;
}

export async function inspectPdfFile(file: File): Promise<ParsedSourceFile> {
  const base = {
    id: createId(),
    fileName: file.name,
    size: file.size,
    extension: 'pdf',
  };

  if (typeof window === 'undefined') {
    return { ...base, sheets: [], error: 'PDF 解析器只能在浏览器中运行。' };
  }

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    const document = await loadingTask.promise;
    const pageCount = document.numPages;
    const sheets: ParsedSheet[] = [];
    let textPageCount = 0;

    try {
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let pageText = '';
        content.items.forEach((item) => {
          if (!('str' in item)) return;
          pageText += item.str;
          pageText += item.hasEOL ? '\n' : ' ';
        });

        const paragraphs = textToSemanticBlocks(pageText);
        const hasUsableText = paragraphs.join('').replace(/\s/g, '').length >= 20;
        if (hasUsableText) textPageCount += 1;
        sheets.push({
          name: `第 ${pageNumber} 页`,
          headers: ['正文'],
          rows: paragraphs.map((paragraph) => ({ 正文: paragraph })),
          selected: hasUsableText,
          mapping: { question: '', answer: '', name: '' },
          requiresOcr: !hasUsableText,
          warning: hasUsableText ? undefined : '本页未检测到足够的文本层，可能是扫描页，需要 OCR。',
        });
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }

    const emptyPageCount = pageCount - textPageCount;
    const requiresOcr = emptyPageCount > 0;
    const warnings = requiresOcr
      ? [`${emptyPageCount} / ${pageCount} 页没有可用文本层，已暂不选中；这些页面需要 OCR 后才能生成 QA。`]
      : undefined;
    return { ...base, sheets, requiresOcr, warnings };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知解析错误';
    const passwordProtected = /password/i.test(detail);
    return {
      ...base,
      sheets: [],
      error: passwordProtected
        ? '此 PDF 设置了密码，请先解除密码保护后重新上传。'
        : `PDF 解析失败：${detail}`,
    };
  }
}
