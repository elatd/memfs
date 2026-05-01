import { describe, expect, it } from "vitest";
import {
  codeExtractor,
  csvExtractor,
  extractDocument,
  htmlExtractor,
  jsonExtractor,
  markdownExtractor,
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

  it("handles unsupported files honestly", async () => {
    const { document, extractor } = await extractDocument({
      path: "/report.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3])
    });

    expect(extractor.name).toBe("pdf");
    expect(document.metadata.unsupported).toBe(true);
    expect(document.sections).toHaveLength(0);
  });
});
