# Multimodal Ingestion

MemFS ingestion is raw-first. The uploaded file or written workspace file is stored as a SHA-256 blob and remains canonical. Extracted text is a derived representation used for memory extraction and search.

Supported clean-room extractors in this phase:

- Markdown: heading sections with heading paths and line ranges.
- Plain text: paragraph chunks with line ranges.
- JSON: flattened JSON paths.
- CSV: header summaries and row ranges.
- HTML: script/style stripping, title, headings, and links.
- Code: simple symbol chunks or line chunks with line ranges.
- Terminal logs: command sections, failure snippets, and log line ranges.

PDF, DOCX, and image files are recognized but marked unsupported in the MVP unless a practical extractor is added. Unsupported files produce an `extracted_sources` record with `metadata.unsupported=true` and create no memory nodes.

API workflow:

```bash
curl -X POST http://localhost:3131/workspaces/$WORKSPACE/files/upload \
  -H 'content-type: application/json' \
  -d '{"path":"/uploads/status.csv","content_base64":"c3RhdHVzLG5hbWUKb3BlbixhbHBoYQ==","mime_type":"text/csv","ingest":true}'
```

CLI workflow:

```bash
memfs upload ./status.csv --to /uploads/status.csv
memfs extracted /uploads/status.csv
memfs recall "status rows that matter"
```

Dashboard workflow:

- Upload a local file from the editor toolbar.
- Extract a selected file without creating raw recall output.
- Inspect extracted text and source metadata.
- Filter memory nodes by source path.
