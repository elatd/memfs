export interface ExtractorInput {
  mimeType?: string;
  path: string;
  bytes?: Uint8Array;
  text?: string;
}

export interface ExtractedSection {
  id: string;
  title?: string;
  text: string;
  sourceLocation?: Record<string, unknown>;
  importanceHint?: number;
}

export interface ExtractedDocument {
  text: string;
  sections: ExtractedSection[];
  metadata: Record<string, unknown>;
}

export interface FileExtractor {
  name: string;
  version: string;
  supports(input: ExtractorInput): boolean;
  extract(input: ExtractorInput): Promise<ExtractedDocument>;
}

const textDecoder = new TextDecoder("utf-8", { fatal: false });
const textEncoder = new TextEncoder();

export const markdownExtractor: FileExtractor = {
  name: "markdown",
  version: "1.0.0",
  supports: (input) => extension(input.path, ["md", "markdown", "mdx"]) || input.mimeType === "text/markdown",
  async extract(input) {
    const text = inputText(input);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const sections: ExtractedSection[] = [];
    let current: string[] = [];
    let currentTitle: string | undefined;
    let currentStart = 1;
    const headingStack: string[] = [];

    const flush = (endLine: number) => {
      const body = current.join("\n").trim();
      if (!body) return;
      sections.push({
        id: `md-${sections.length + 1}`,
        title: currentTitle,
        text: body,
        sourceLocation: {
          type: "markdown",
          heading_path: headingStack.join(" > ") || null,
          start_line: currentStart,
          end_line: endLine
        }
      });
    };

    lines.forEach((line, index) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        flush(index);
        const level = heading[1]!.length;
        headingStack.splice(level - 1);
        headingStack[level - 1] = heading[2]!.trim();
        currentTitle = headingStack.join(" > ");
        current = [line];
        currentStart = index + 1;
      } else {
        if (current.length === 0) currentStart = index + 1;
        current.push(line);
      }
    });
    flush(lines.length);

    return {
      text,
      sections: sections.length ? sections : paragraphSections(text, "markdown"),
      metadata: { type: "markdown", section_count: sections.length }
    };
  }
};

export const textExtractor: FileExtractor = {
  name: "text",
  version: "1.0.0",
  supports: (input) => input.mimeType?.startsWith("text/plain") || extension(input.path, ["txt", "text"]),
  async extract(input) {
    const text = inputText(input);
    return {
      text,
      sections: paragraphSections(text, "text"),
      metadata: { type: "text" }
    };
  }
};

export const jsonExtractor: FileExtractor = {
  name: "json",
  version: "1.0.0",
  supports: (input) => input.mimeType === "application/json" || extension(input.path, ["json"]),
  async extract(input) {
    const text = inputText(input);
    try {
      const parsed = JSON.parse(text) as unknown;
      const sections = flattenJson(parsed).map((entry, index) => ({
        id: `json-${index + 1}`,
        title: entry.path,
        text: `${entry.path}: ${entry.value}`,
        sourceLocation: {
          type: "json",
          json_path: entry.path
        }
      }));
      return {
        text: JSON.stringify(parsed, null, 2),
        sections,
        metadata: { type: "json", valid: true, path_count: sections.length }
      };
    } catch (error) {
      return {
        text,
        sections: paragraphSections(text, "json"),
        metadata: { type: "json", valid: false, error: (error as Error).message }
      };
    }
  }
};

export const csvExtractor: FileExtractor = {
  name: "csv",
  version: "1.0.0",
  supports: (input) => input.mimeType === "text/csv" || extension(input.path, ["csv"]),
  async extract(input) {
    const text = inputText(input);
    const rows = parseCsv(text);
    const headers = rows[0] ?? [];
    const sections: ExtractedSection[] = [];
    if (headers.length > 0) {
      sections.push({
        id: "csv-header",
        title: "CSV header",
        text: `Columns: ${headers.join(", ")}`,
        sourceLocation: { type: "csv", row: 1, columns: headers }
      });
    }

    for (let index = 1; index < rows.length; index += 25) {
      const chunk = rows.slice(index, index + 25);
      const lines = chunk.map((row, rowIndex) => {
        const absoluteRow = index + rowIndex + 1;
        const values = headers.map((header, columnIndex) => `${header || `column_${columnIndex + 1}`}=${row[columnIndex] ?? ""}`);
        return `Row ${absoluteRow}: ${values.join("; ")}`;
      });
      sections.push({
        id: `csv-rows-${index + 1}-${index + chunk.length}`,
        title: `Rows ${index + 1}-${index + chunk.length}`,
        text: lines.join("\n"),
        sourceLocation: {
          type: "csv",
          row_start: index + 1,
          row_end: index + chunk.length,
          columns: headers
        }
      });
    }

    return {
      text,
      sections,
      metadata: { type: "csv", row_count: rows.length, columns: headers }
    };
  }
};

export const htmlExtractor: FileExtractor = {
  name: "html",
  version: "1.0.0",
  supports: (input) => input.mimeType === "text/html" || extension(input.path, ["html", "htm"]),
  async extract(input) {
    const html = inputText(input);
    const title = matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    const headings = [...withoutScripts.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) =>
      cleanHtml(match[2] ?? "")
    );
    const links = [...withoutScripts.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
      href: match[1],
      text: cleanHtml(match[2] ?? "")
    }));
    const text = cleanHtml(withoutScripts.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"));
    return {
      text,
      sections: paragraphSections(text, "html", title ?? headings[0]),
      metadata: { type: "html", title: title ?? null, headings, links }
    };
  }
};

export const codeExtractor: FileExtractor = {
  name: "code",
  version: "1.0.0",
  supports: (input) =>
    extension(input.path, [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "cs",
      "php",
      "css",
      "sql",
      "sh",
      "bash",
      "zsh",
      "yaml",
      "yml"
    ]),
  async extract(input) {
    const text = inputText(input);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const symbolMatches = lines
      .map((line, index) => ({ line, index }))
      .filter((entry) => /\b(function|class|const|let|async function|def|interface|type)\s+[A-Za-z0-9_$]+/.test(entry.line));
    const sections: ExtractedSection[] = [];

    if (symbolMatches.length > 0) {
      symbolMatches.forEach((entry, index) => {
        const next = symbolMatches[index + 1]?.index ?? Math.min(lines.length, entry.index + 40);
        const symbol = symbolName(entry.line);
        sections.push({
          id: `code-${index + 1}`,
          title: symbol,
          text: lines.slice(entry.index, next).join("\n"),
          sourceLocation: {
            type: "code",
            start_line: entry.index + 1,
            end_line: next,
            symbol
          }
        });
      });
    } else {
      for (let index = 0; index < lines.length; index += 80) {
        sections.push({
          id: `code-lines-${index + 1}-${Math.min(lines.length, index + 80)}`,
          title: `Lines ${index + 1}-${Math.min(lines.length, index + 80)}`,
          text: lines.slice(index, index + 80).join("\n"),
          sourceLocation: {
            type: "code",
            start_line: index + 1,
            end_line: Math.min(lines.length, index + 80)
          }
        });
      }
    }

    return { text, sections, metadata: { type: "code", language: languageFromPath(input.path) } };
  }
};

export const terminalLogExtractor: FileExtractor = {
  name: "terminal_log",
  version: "1.0.0",
  supports: (input) => extension(input.path, ["log", "terminal", "term"]) || /\n[$>]\s+\S/.test(input.text ?? ""),
  async extract(input) {
    const text = inputText(input);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const sections: ExtractedSection[] = [];
    let currentCommand: { command: string; start: number } | null = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const command = /^\s*(?:[$>]|❯)\s+(.+)$/.exec(line);
      if (command) {
        if (currentCommand) {
          sections.push(logSection(lines, currentCommand.command, currentCommand.start, index));
        }
        currentCommand = { command: command[1]!.trim(), start: index };
      }
    }

    if (currentCommand) {
      sections.push(logSection(lines, currentCommand.command, currentCommand.start, lines.length));
    }

    const failures = lines
      .map((line, index) => ({ line, index }))
      .filter((entry) => /\b(error|failed|fail|exception|traceback|exit code [1-9])\b/i.test(entry.line));
    for (const failure of failures.slice(0, 10)) {
      sections.push({
        id: `terminal-failure-${failure.index + 1}`,
        title: "Failure",
        text: lines.slice(Math.max(0, failure.index - 5), Math.min(lines.length, failure.index + 8)).join("\n"),
        sourceLocation: {
          type: "terminal_log",
          command: currentCommand?.command ?? null,
          line_start: Math.max(1, failure.index - 4),
          line_end: Math.min(lines.length, failure.index + 8)
        },
        importanceHint: 4
      });
    }

    return {
      text,
      sections: sections.length ? sections : paragraphSections(text, "terminal_log"),
      metadata: { type: "terminal_log", command_count: sections.length, failure_count: failures.length }
    };
  }
};

export const pdfExtractor: FileExtractor = {
  name: "pdf",
  version: "1.0.0",
  supports: (input) => input.mimeType === "application/pdf" || extension(input.path, ["pdf"]),
  async extract(input) {
    try {
      const pdfParse = await loadPdfParse();
      let pageNumber = 0;
      const parsed = await pdfParse(inputBytes(input), {
        pagerender: async (pageData: {
          getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
        }) => {
          pageNumber += 1;
          const content = await pageData.getTextContent();
          const text = content.items
            .map((item) => item.str ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          return `\n\n[[MEMFS_PDF_PAGE:${pageNumber}]]\n${text}`;
        }
      });
      const parsedText = String(parsed.text ?? "");
      const sections = pdfPageSections(parsedText);
      const text = stripPdfMarkers(parsedText).trim();
      return {
        text,
        sections: sections.length ? sections : paragraphSections(text, "pdf"),
        metadata: {
          type: "pdf",
          page_count: Number(parsed.numpages ?? sections.length ?? 0),
          info: parsed.info ?? null
        }
      };
    } catch (error) {
      return failedDocument(input, "pdf", `PDF extraction failed: ${(error as Error).message}`);
    }
  }
};

export const docxExtractor: FileExtractor = {
  name: "docx",
  version: "1.0.0",
  supports: (input) =>
    input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension(input.path, ["docx"]),
  async extract(input) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: inputBytes(input) });
      const text = result.value.trim();
      return {
        text,
        sections: docxParagraphSections(text),
        metadata: {
          type: "docx",
          messages: result.messages.map((message) => ({
            type: message.type,
            message: message.message
          }))
        }
      };
    } catch (error) {
      return failedDocument(input, "docx", `DOCX extraction failed: ${(error as Error).message}`);
    }
  }
};
export const imageExtractor: FileExtractor = {
  name: "image",
  version: "1.0.0",
  supports: (input) => input.mimeType?.startsWith("image/") || extension(input.path, ["png", "jpg", "jpeg", "gif", "webp", "tiff"]),
  async extract(input) {
    return unsupportedDocument(input, "image", "Image OCR/caption extraction is not enabled in this clean-room MVP.");
  }
};

export const defaultExtractors: FileExtractor[] = [
  markdownExtractor,
  jsonExtractor,
  csvExtractor,
  htmlExtractor,
  terminalLogExtractor,
  codeExtractor,
  textExtractor,
  pdfExtractor,
  docxExtractor,
  imageExtractor
];

export async function extractDocument(input: ExtractorInput, extractors = defaultExtractors): Promise<{
  document: ExtractedDocument;
  extractor: FileExtractor;
}> {
  const extractor = extractors.find((candidate) => candidate.supports(input));
  if (!extractor) {
    return {
      extractor: unsupportedExtractor("unsupported", [], undefined),
      document: unsupportedDocument(input, "unsupported", "No extractor supports this file type.")
    };
  }

  return {
    extractor,
    document: await extractor.extract(input)
  };
}

function inputText(input: ExtractorInput): string {
  if (input.text !== undefined) return input.text;
  if (input.bytes) return textDecoder.decode(input.bytes);
  return "";
}

function inputBytes(input: ExtractorInput): Buffer {
  if (input.bytes) return Buffer.from(input.bytes);
  return Buffer.from(textEncoder.encode(input.text ?? ""));
}

function extension(path: string, extensions: string[]): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return Boolean(ext && extensions.includes(ext));
}

type PdfParse = (
  dataBuffer: Buffer,
  options?: Record<string, unknown>
) => Promise<{
  text?: string;
  numpages?: number;
  info?: unknown;
}>;

async function loadPdfParse(): Promise<PdfParse> {
  const mod = await import("pdf-parse");
  return (mod.default ?? mod) as unknown as PdfParse;
}

function pdfPageSections(text: string): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  const markerPattern = /\[\[MEMFS_PDF_PAGE:(\d+)]]\n([\s\S]*?)(?=\n+\[\[MEMFS_PDF_PAGE:|$)/g;
  for (const match of text.matchAll(markerPattern)) {
    const page = Number(match[1]);
    const body = (match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!body) continue;
    sections.push({
      id: `pdf-page-${page}`,
      title: `Page ${page}`,
      text: body,
      sourceLocation: {
        type: "pdf",
        page,
        bbox: null
      }
    });
  }
  return sections;
}

function stripPdfMarkers(text: string): string {
  return text.replace(/\[\[MEMFS_PDF_PAGE:\d+]]\n/g, "").replace(/[ \t]+\n/g, "\n");
}

function docxParagraphSections(text: string): ExtractedSection[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => ({
      id: `docx-paragraph-${index + 1}`,
      title: index === 0 ? "Document start" : undefined,
      text: paragraph,
      sourceLocation: {
        type: "docx",
        paragraph_index: index + 1
      }
    }));
}

function paragraphSections(text: string, type: string, title?: string): ExtractedSection[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: ExtractedSection[] = [];
  let start = 1;
  let current: string[] = [];

  const flush = (endLine: number) => {
    const body = current.join("\n").trim();
    if (!body) return;
    sections.push({
      id: `${type}-${sections.length + 1}`,
      title,
      text: body,
      sourceLocation: {
        type,
        start_line: start,
        end_line: endLine
      }
    });
  };

  lines.forEach((line, index) => {
    if (!line.trim() && current.length > 0) {
      flush(index);
      current = [];
      start = index + 2;
    } else {
      if (current.length === 0) start = index + 1;
      current.push(line);
    }
  });
  flush(lines.length);
  return sections;
}

function flattenJson(value: unknown, prefix = "$"): Array<{ path: string; value: string }> {
  if (value === null || typeof value !== "object") {
    return [{ path: prefix, value: String(value) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenJson(child, `${prefix}.${key}`)
  );
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cellValue) => cellValue.trim()));
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function matchFirst(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text);
  return match?.[1] ? cleanHtml(match[1]) : undefined;
}

function symbolName(line: string): string {
  const patterns = [
    /\b(?:function|class|interface|type|def)\s+([A-Za-z0-9_$]+)/,
    /\b(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match?.[1]) return match[1];
  }
  return line.trim().slice(0, 80);
}

function languageFromPath(path: string): string | null {
  return path.split(".").pop()?.toLowerCase() ?? null;
}

function logSection(lines: string[], command: string, start: number, end: number): ExtractedSection {
  return {
    id: `terminal-command-${start + 1}`,
    title: command,
    text: lines.slice(start, end).join("\n"),
    sourceLocation: {
      type: "terminal_log",
      command,
      line_start: start + 1,
      line_end: end
    }
  };
}

function unsupportedExtractor(name: string, extensions: string[], mimeType?: string): FileExtractor {
  return {
    name,
    version: "1.0.0",
    supports: (input) => (mimeType ? input.mimeType === mimeType : false) || extension(input.path, extensions),
    async extract(input) {
      return unsupportedDocument(input, name, `${name.toUpperCase()} extraction is not enabled in this MVP.`);
    }
  };
}

function unsupportedDocument(input: ExtractorInput, type: string, reason: string): ExtractedDocument {
  return {
    text: "",
    sections: [],
    metadata: {
      type,
      unsupported: true,
      reason,
      path: input.path,
      mime_type: input.mimeType ?? null
    }
  };
}

function failedDocument(input: ExtractorInput, type: string, reason: string): ExtractedDocument {
  return {
    text: "",
    sections: [],
    metadata: {
      type,
      unsupported: true,
      extraction_failed: true,
      reason,
      path: input.path,
      mime_type: input.mimeType ?? null
    }
  };
}
