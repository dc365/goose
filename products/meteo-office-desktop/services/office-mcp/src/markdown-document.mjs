export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENT_BLOCKS = 500;
export const MAX_TABLE_ROWS = 1_000;
export const MAX_TABLE_COLUMNS = 100;
export const MAX_DOCUMENT_TABLE_CELLS = 10_000;

function cleanInlineMarkdown(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}

function tableCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = trimmed.split('|').map((cell) => cleanInlineMarkdown(cell));
  if (cells.length > MAX_TABLE_COLUMNS) {
    throw new Error(`Markdown 表格不能超过 ${MAX_TABLE_COLUMNS} 列`);
  }
  return cells;
}

function isTableSeparator(line) {
  const cells = tableCells(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function markdownToDocumentBlocks(markdown, { title = '' } = {}) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let tableCellCount = 0;
  const addBlock = (block) => {
    if (blocks.length >= MAX_DOCUMENT_BLOCKS) {
      throw new Error(`Markdown 正文不能生成超过 ${MAX_DOCUMENT_BLOCKS} 个内容块`);
    }
    blocks.push(block);
  };

  const flushParagraph = () => {
    const text = cleanInlineMarkdown(paragraph.join(' '));
    if (text) addBlock({ type: 'paragraph', text });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      continue;
    }

    if (line === '<!-- pagebreak -->') {
      flushParagraph();
      addBlock({ type: 'page_break' });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const text = cleanInlineMarkdown(heading[2]);
      if (blocks.length === 0 && text === String(title).trim()) continue;
      addBlock({ type: 'heading', level: heading[1].length, text });
      continue;
    }

    const nextLine = lines[index + 1]?.trim() || '';
    if (line.includes('|') && isTableSeparator(nextLine)) {
      flushParagraph();
      const rows = [tableCells(line)];
      index += 2;
      while (index < lines.length && lines[index].trim().includes('|')) {
        if (rows.length >= MAX_TABLE_ROWS) {
          throw new Error(`Markdown 表格不能超过 ${MAX_TABLE_ROWS} 行`);
        }
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      tableCellCount += rows.length * Math.max(...rows.map((row) => row.length));
      if (tableCellCount > MAX_DOCUMENT_TABLE_CELLS) {
        throw new Error(`Markdown 表格总单元格不能超过 ${MAX_DOCUMENT_TABLE_CELLS} 个`);
      }
      addBlock({ type: 'table', rows });
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      addBlock({ type: 'paragraph', text: `• ${cleanInlineMarkdown(bullet[1])}` });
      continue;
    }

    const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      addBlock({
        type: 'paragraph',
        text: `${numbered[1]}. ${cleanInlineMarkdown(numbered[2])}`,
      });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

export function markdownDocumentInput(input) {
  const content = input.contentLines.join('\n');
  if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) {
    throw new Error(`Markdown 正文不能超过 ${MAX_MARKDOWN_BYTES} 字节`);
  }
  return {
    schemaVersion: input.schemaVersion,
    workspaceId: input.workspaceId,
    outputPath: input.outputPath,
    spec: {
      title: input.title,
      ...(input.header ? { header: input.header } : {}),
      ...(input.footer ? { footer: input.footer } : {}),
      defaultFont: 'Noto Sans CJK SC',
      defaultFontSize: 11,
      blocks: markdownToDocumentBlocks(content, { title: input.title }),
    },
  };
}
