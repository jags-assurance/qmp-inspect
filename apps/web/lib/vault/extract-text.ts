// Turns an uploaded vault document's bytes into plain text at upload time, so ITP/checklist AI
// generation (lib/itps/ai-draft-actions.ts) can read real requirement documents instead of a
// free-typed description. Called once, from uploadVaultDocumentAction — nothing else re-parses
// the file later; everything downstream reads back the stored extracted_text column.
//
// Deliberately narrow: only the file types a spec/standard/method-statement is realistically
// uploaded as (PDF, DOCX, plain text/markdown). Anything else — scanned images, .doc, .xlsx,
// photos — is 'unsupported' rather than attempted, so a bad parse never silently produces
// garbage text for the AI to reason over.

export type ExtractionOutcome =
  | { status: "done"; text: string }
  | { status: "empty" }
  | { status: "unsupported" }
  | { status: "failed"; error: string };

// A generous but bounded cap per document — keeps a single huge spec from blowing out the prompt
// budget when several documents are combined for one generation call (see ai-draft-actions.ts).
// Trimming here, once, at extraction time, is cheaper than re-truncating on every read.
const MAX_EXTRACTED_CHARS = 120_000;

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

function normalize(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  return trimmed.length > MAX_EXTRACTED_CHARS ? trimmed.slice(0, MAX_EXTRACTED_CHARS) : trimmed;
}

// pdf-parse (v2+) wraps pdfjs-dist, which references DOMMatrix — a browser Canvas API — even on the
// pure-text extraction path, to compose each page's coordinate-space transform. Node has no
// DOMMatrix at all, so every PDF failed extraction with "DOMMatrix is not defined" (real bug this
// session found live: any uploaded PDF's extraction_status was stuck at 'failed', silently making
// it ineligible as AI-draft source material with no indication why beyond that one error string).
// `dommatrix` is a small, pure-JS, spec-compliant 2D-matrix polyfill — no native/canvas build step,
// safe for a serverless runtime — good enough for pdfjs's transform math even though we never touch
// real rendering. Installed once, globally, before the first PDF parse.
let domMatrixPolyfilled = false;
async function ensureDomMatrixPolyfill(): Promise<void> {
  if (domMatrixPolyfilled || typeof globalThis.DOMMatrix !== "undefined") {
    domMatrixPolyfilled = true;
    return;
  }
  const { default: DOMMatrix } = await import("dommatrix");
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrix;
  domMatrixPolyfilled = true;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  await ensureDomMatrixPolyfill();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

export async function extractTextFromFile(bytes: ArrayBuffer, filename: string): Promise<ExtractionOutcome> {
  const ext = extensionOf(filename);
  const buffer = Buffer.from(bytes);

  try {
    let raw: string;
    if (ext === "pdf") {
      raw = await extractPdf(buffer);
    } else if (ext === "docx") {
      raw = await extractDocx(buffer);
    } else if (ext === "txt" || ext === "md") {
      raw = buffer.toString("utf-8");
    } else {
      return { status: "unsupported" };
    }

    const text = normalize(raw);
    return text ? { status: "done", text } : { status: "empty" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : "Unknown extraction error." };
  }
}
