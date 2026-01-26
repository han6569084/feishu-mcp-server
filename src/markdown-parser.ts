/**
 * Markdown to Feishu Docx Blocks Parser
 * 
 * 将 Markdown 格式的文本转换为飞书文档的结构化 Block 数组
 * 
 * 支持的 Block 类型:
 * - block_type 2: Text (普通文本)
 * - block_type 3: Heading1 (一级标题)
 * - block_type 4: Heading2 (二级标题)
 * - block_type 5: Heading3 (三级标题)
 * - block_type 6: Heading4 (四级标题)
 * - block_type 12: Bullet (无序列表)
 * - block_type 13: Ordered (有序列表)
 * - block_type 14: Code (代码块)
 * - block_type 15: Quote (引用)
 * - block_type 22: Divider (分割线)
 */

// 飞书 Block 类型常量
export const BLOCK_TYPES = {
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  HEADING4: 6,
  HEADING5: 7,
  HEADING6: 8,
  HEADING7: 9,
  HEADING8: 10,
  HEADING9: 11,
  BULLET: 12,
  ORDERED: 13,
  CODE: 14,
  QUOTE: 15,
  DIVIDER: 22,
} as const;

// 文本样式接口
interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  inline_code?: boolean;
  link?: { url: string };
}

// 文本元素接口
interface TextElement {
  text_run: {
    content: string;
    text_element_style?: TextStyle;
  };
}

// Block 接口
interface FeishuBlock {
  block_type: number;
  text?: {
    elements: TextElement[];
    style?: {
      align?: number;
      done?: boolean;
      folded?: boolean;
      language?: number;
    };
  };
  code?: {
    elements: TextElement[];
    style?: {
      language?: number;
      wrap?: boolean;
    };
  };
  divider?: Record<string, never>;
  [key: string]: any; // 允许动态字段名如 heading1, bullet, ordered 等
}

// 代码语言映射
const CODE_LANGUAGES: Record<string, number> = {
  'plaintext': 1,
  'abap': 2,
  'ada': 3,
  'apache': 4,
  'apex': 5,
  'bash': 22,
  'shell': 22,
  'sh': 22,
  'c': 7,
  'cpp': 8,
  'c++': 8,
  'csharp': 9,
  'c#': 9,
  'css': 10,
  'dart': 12,
  'go': 18,
  'golang': 18,
  'html': 21,
  'java': 25,
  'javascript': 26,
  'js': 26,
  'json': 27,
  'kotlin': 29,
  'lua': 31,
  'markdown': 33,
  'md': 33,
  'objective-c': 36,
  'objectivec': 36,
  'perl': 38,
  'php': 39,
  'python': 40,
  'py': 40,
  'ruby': 43,
  'rust': 44,
  'scala': 45,
  'sql': 47,
  'swift': 48,
  'typescript': 50,
  'ts': 50,
  'xml': 52,
  'yaml': 53,
  'yml': 53,
};

/**
 * 解析行内样式 (粗体、斜体、行内代码、链接等)
 */
function parseInlineStyles(text: string): TextElement[] {
  const elements: TextElement[] = [];
  
  // 正则匹配各种行内样式
  // 顺序：链接 > 粗体+斜体 > 粗体 > 斜体 > 行内代码 > 删除线
  const patterns = [
    // 链接 [text](url)
    { regex: /\[([^\]]+)\]\(([^)]+)\)/g, handler: (match: RegExpExecArray): TextElement => ({
      text_run: {
        content: match[1],
        text_element_style: { link: { url: match[2] } }
      }
    })},
    // 粗体+斜体 ***text*** 或 ___text___
    { regex: /(\*\*\*|___)([^*_]+)\1/g, handler: (match: RegExpExecArray): TextElement => ({
      text_run: {
        content: match[2],
        text_element_style: { bold: true, italic: true }
      }
    })},
    // 粗体 **text** 或 __text__
    { regex: /(\*\*|__)([^*_]+)\1/g, handler: (match: RegExpExecArray): TextElement => ({
      text_run: {
        content: match[2],
        text_element_style: { bold: true }
      }
    })},
    // 斜体 *text* 或 _text_
    { regex: /(\*|_)([^*_]+)\1/g, handler: (match: RegExpExecArray): TextElement => ({
      text_run: {
        content: match[2],
        text_element_style: { italic: true }
      }
    })},
    // 行内代码 `code`
    { regex: /`([^`]+)`/g, handler: (match: RegExpExecArray): TextElement => ({
      text_run: {
        content: match[1],
        text_element_style: { inline_code: true }
      }
    })},
    // 删除线 ~~text~~
    { regex: /~~([^~]+)~~/g, handler: (match: RegExpExecArray): TextElement => ({
      text_run: {
        content: match[1],
        text_element_style: { strikethrough: true }
      }
    })},
  ];

  // 简化处理：如果没有特殊格式，直接返回纯文本
  const hasSpecialFormat = patterns.some(p => p.regex.test(text));
  
  if (!hasSpecialFormat) {
    if (text.length > 0) {
      elements.push({
        text_run: { content: text }
      });
    }
    return elements;
  }

  // 复杂情况：逐段解析
  let remaining = text;
  let lastIndex = 0;

  // 合并所有匹配项并按位置排序
  interface MatchItem {
    index: number;
    length: number;
    element: TextElement;
  }
  const allMatches: MatchItem[] = [];

  for (const { regex, handler } of patterns) {
    regex.lastIndex = 0; // 重置正则
    let match;
    while ((match = regex.exec(text)) !== null) {
      allMatches.push({
        index: match.index,
        length: match[0].length,
        element: handler(match)
      });
    }
  }

  // 按位置排序
  allMatches.sort((a, b) => a.index - b.index);

  // 过滤重叠的匹配（保留先出现的）
  const filteredMatches: MatchItem[] = [];
  let currentEnd = 0;
  for (const m of allMatches) {
    if (m.index >= currentEnd) {
      filteredMatches.push(m);
      currentEnd = m.index + m.length;
    }
  }

  // 构建元素数组
  let pos = 0;
  for (const m of filteredMatches) {
    // 添加匹配前的普通文本
    if (m.index > pos) {
      const plainText = text.substring(pos, m.index);
      if (plainText.length > 0) {
        elements.push({ text_run: { content: plainText } });
      }
    }
    // 添加匹配的样式文本
    elements.push(m.element);
    pos = m.index + m.length;
  }

  // 添加剩余的普通文本
  if (pos < text.length) {
    const plainText = text.substring(pos);
    if (plainText.length > 0) {
      elements.push({ text_run: { content: plainText } });
    }
  }

  return elements.length > 0 ? elements : [{ text_run: { content: text } }];
}

// 映射 block_type 到正确的字段名
const BLOCK_FIELD_NAMES: { [key: number]: string } = {
  2: 'text',       // 普通文本
  3: 'heading1',   // 一级标题
  4: 'heading2',   // 二级标题
  5: 'heading3',   // 三级标题
  6: 'heading4',   // 四级标题
  7: 'heading5',   // 五级标题
  8: 'heading6',   // 六级标题
  9: 'heading7',   // 七级标题
  10: 'heading8',  // 八级标题
  11: 'heading9',  // 九级标题
  12: 'bullet',    // 无序列表
  13: 'ordered',   // 有序列表
  15: 'quote',     // 引用
};

/**
 * 创建文本 Block（根据 blockType 使用正确的字段名）
 */
function createTextBlock(content: string, blockType: number = BLOCK_TYPES.TEXT): FeishuBlock {
  const fieldName = BLOCK_FIELD_NAMES[blockType] || 'text';
  const block: FeishuBlock = {
    block_type: blockType,
  };
  (block as any)[fieldName] = {
    elements: parseInlineStyles(content),
    style: {}
  };
  return block;
}

/**
 * 创建代码 Block
 */
function createCodeBlock(content: string, language: string = 'plaintext'): FeishuBlock {
  const langCode = CODE_LANGUAGES[language.toLowerCase()] || CODE_LANGUAGES['plaintext'];
  return {
    block_type: BLOCK_TYPES.CODE,
    code: {
      elements: [{ text_run: { content } }],
      style: {
        language: langCode,
        wrap: false
      }
    }
  };
}

/**
 * 创建分割线 Block
 */
function createDividerBlock(): FeishuBlock {
  return {
    block_type: BLOCK_TYPES.DIVIDER,
    divider: {}
  };
}

/**
 * 主解析函数：将 Markdown 转换为飞书 Blocks
 */
export function parseMarkdownToBlocks(markdown: string): FeishuBlock[] {
  const blocks: FeishuBlock[] = [];
  const lines = markdown.split('\n');
  
  let i = 0;
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let codeLanguage = 'plaintext';

  while (i < lines.length) {
    const line = lines[i];

    // 处理代码块
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        // 开始代码块
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim() || 'plaintext';
        codeContent = [];
      } else {
        // 结束代码块
        inCodeBlock = false;
        blocks.push(createCodeBlock(codeContent.join('\n'), codeLanguage));
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      i++;
      continue;
    }

    // 空行 - 跳过但保持段落分隔
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 分割线 --- 或 *** 或 ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(createDividerBlock());
      i++;
      continue;
    }

    // 标题 # ## ### ####
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2].trim();
      const blockType = BLOCK_TYPES.HEADING1 + level - 1; // Heading1=3, Heading2=4, etc.
      blocks.push(createTextBlock(content, Math.min(blockType, BLOCK_TYPES.HEADING6)));
      i++;
      continue;
    }

    // 引用 >
    if (line.startsWith('>')) {
      const content = line.slice(1).trim();
      blocks.push(createTextBlock(content, BLOCK_TYPES.QUOTE));
      i++;
      continue;
    }

    // 无序列表 - * +
    const bulletMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      const content = bulletMatch[1].trim();
      blocks.push(createTextBlock(content, BLOCK_TYPES.BULLET));
      i++;
      continue;
    }

    // 有序列表 1. 2. 3.
    const orderedMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (orderedMatch) {
      const content = orderedMatch[1].trim();
      blocks.push(createTextBlock(content, BLOCK_TYPES.ORDERED));
      i++;
      continue;
    }

    // 表格处理 (简化：转为代码块显示)
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      // 将表格作为代码块渲染（飞书原生表格需要更复杂的处理）
      blocks.push(createCodeBlock(tableLines.join('\n'), 'plaintext'));
      continue;
    }

    // 普通文本段落
    blocks.push(createTextBlock(line.trim(), BLOCK_TYPES.TEXT));
    i++;
  }

  // 如果代码块未正确关闭
  if (inCodeBlock && codeContent.length > 0) {
    blocks.push(createCodeBlock(codeContent.join('\n'), codeLanguage));
  }

  return blocks;
}

/**
 * 将解析后的 Blocks 转换为飞书 API 格式
 * 
 * 飞书 API 要求的格式：
 * {
 *   children: [
 *     { block_type: 2, text: { elements: [...] } },
 *     ...
 *   ]
 * }
 */
export function blocksToFeishuFormat(blocks: FeishuBlock[]): { children: FeishuBlock[] } {
  return { children: blocks };
}

/**
 * 便捷函数：直接将 Markdown 转换为飞书 API 请求体
 */
export function markdownToFeishuRequestBody(markdown: string): { children: FeishuBlock[] } {
  const blocks = parseMarkdownToBlocks(markdown);
  return blocksToFeishuFormat(blocks);
}

// 导出默认解析函数
export default parseMarkdownToBlocks;
