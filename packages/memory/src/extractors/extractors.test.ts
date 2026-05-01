import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  codeExtractor,
  csvExtractor,
  docxExtractor,
  extractDocument,
  htmlExtractor,
  jsonExtractor,
  markdownExtractor,
  pdfExtractor,
  terminalLogExtractor,
  textExtractor
} from "./index.js";

describe("file extractors", () => {
  it("splits markdown by headings and preserves heading source locations", async () => {
    const document = await markdownExtractor.extract({
      path: "/notes.md",
      text: "# Project\n\nDecision: Keep onboarding short.\n\n## Details\n\nConstraint: Keep the skip button."
    });

    expect(document.sections).toHaveLength(2);
    expect(document.sections[0]?.sourceLocation).toMatchObject({
      type: "markdown",
      heading_path: "Project",
      start_line: 1
    });
    expect(document.sections[1]?.sourceLocation).toMatchObject({
      heading_path: "Project > Details"
    });
  });

  it("extracts text paragraphs with line ranges", async () => {
    const document = await textExtractor.extract({
      path: "/notes.txt",
      text: "First paragraph.\nStill first.\n\nSecond paragraph."
    });

    expect(document.sections[0]?.sourceLocation).toMatchObject({ type: "text", start_line: 1, end_line: 2 });
    expect(document.sections[1]?.sourceLocation).toMatchObject({ type: "text", start_line: 4, end_line: 4 });
  });

  it("extracts JSON paths", async () => {
    const document = await jsonExtractor.extract({
      path: "/data.json",
      text: JSON.stringify({ user: { preference: "quiet UI" }, tasks: ["review"] })
    });

    expect(document.sections.some((section) => section.title === "$.user.preference")).toBe(true);
    expect(document.sections.find((section) => section.title === "$.user.preference")?.sourceLocation).toMatchObject({
      type: "json",
      json_path: "$.user.preference"
    });
  });

  it("extracts CSV row ranges", async () => {
    const document = await csvExtractor.extract({
      path: "/rows.csv",
      text: "status,name\nopen,alpha\nclosed,beta"
    });

    expect(document.sections[0]?.sourceLocation).toMatchObject({ type: "csv", row: 1 });
    expect(document.sections[1]?.sourceLocation).toMatchObject({ type: "csv", row_start: 2, row_end: 3 });
  });

  it("strips script and style content from HTML", async () => {
    const document = await htmlExtractor.extract({
      path: "/page.html",
      text: "<html><head><style>.x{}</style><script>alert(1)</script><title>Policy</title></head><body><h1>Cancellation</h1><p>Cancel anytime.</p></body></html>"
    });

    expect(document.text).toContain("Cancel anytime.");
    expect(document.text).not.toContain("alert");
    expect(document.text).not.toContain(".x");
    expect(document.metadata).toMatchObject({ title: "Policy" });
  });

  it("extracts code chunks with line numbers", async () => {
    const document = await codeExtractor.extract({
      path: "/src/app.ts",
      text: "const value = 1;\n\nfunction createUser() {\n  return value;\n}\n"
    });

    const section = document.sections.find((item) => item.title === "createUser");
    expect(section?.sourceLocation).toMatchObject({
      type: "code",
      start_line: 3,
      symbol: "createUser"
    });
  });

  it("detects failed terminal log commands", async () => {
    const document = await terminalLogExtractor.extract({
      path: "/runs/test.log",
      text: "$ pnpm test\nError: expected true to be false\nexit code 1"
    });

    expect(document.metadata.failure_count).toBe(2);
    expect(document.sections.some((section) => section.id.startsWith("terminal-failure"))).toBe(true);
  });

  it("extracts PDF text with page source locations", async () => {
    const document = await pdfExtractor.extract({
      path: "/report.pdf",
      mimeType: "application/pdf",
      bytes: await createPdfBuffer("Decision: PDF onboarding should preserve page references.")
    });

    expect(document.metadata).toMatchObject({ type: "pdf", page_count: 1 });
    expect(document.text).toContain("PDF onboarding");
    expect(document.sections[0]?.sourceLocation).toMatchObject({
      type: "pdf",
      page: 1
    });
  });

  it("extracts DOCX text with paragraph source locations", async () => {
    const document = await docxExtractor.extract({
      path: "/report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await createDocxBuffer("Decision: DOCX onboarding notes should be source grounded.")
    });

    expect(document.metadata).toMatchObject({ type: "docx" });
    expect(document.text).toContain("DOCX onboarding");
    expect(document.sections[0]?.sourceLocation).toMatchObject({
      type: "docx",
      paragraph_index: 1
    });
  });

  it("handles unsupported files honestly", async () => {
    const { document, extractor } = await extractDocument({
      path: "/archive.bin",
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([1, 2, 3])
    });

    expect(extractor.name).toBe("unsupported");
    expect(document.metadata.unsupported).toBe(true);
    expect(document.sections).toHaveLength(0);
  });
});

async function createPdfBuffer(text: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(text, {
    x: 72,
    y: 720,
    size: 18,
    font
  });
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

async function createDocxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
