import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Helpers to materialise free-form text and structured Q&R into the binary
 * formats accepted by OpenAI's file uploads (.pdf or .txt). Vector stores
 * happily index both ; we use .txt for Q&R (plain UTF-8 is more robust
 * than PDF text extraction) and .pdf for the "saisie texte libre" flow.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const FONT_SIZE = 11;
const TITLE_SIZE = 18;
const LINE_HEIGHT = FONT_SIZE * 1.4;
const MAX_LINE_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * Basic word-wrapping at a target width, in pixels. Splits long words by
 * char if a single word doesn't fit on a line — prevents infinite loops
 * on pathological input.
 */
function wrapText(
  text: string,
  font: import("pdf-lib").PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const w = font.widthOfTextAtSize(candidate, fontSize);
      if (w <= maxWidth) {
        current = candidate;
        continue;
      }
      // Candidate is too wide. Push current line if any.
      if (current) {
        lines.push(current);
        current = "";
      }
      // If the single word itself is too wide, hard-break by char.
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Generates a multi-page PDF from a text and an optional title. Title goes
 * in bold at the top of the first page ; body wraps at the page width.
 */
export async function createPdfFromText(
  text: string,
  title: string
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  if (title.trim().length > 0) {
    page.drawText(title, {
      x: MARGIN,
      y: y - TITLE_SIZE,
      size: TITLE_SIZE,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    y -= TITLE_SIZE * 2;
  }

  const lines = wrapText(text, font, FONT_SIZE, MAX_LINE_WIDTH);
  for (const line of lines) {
    if (y - LINE_HEIGHT < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
    page.drawText(line, {
      x: MARGIN,
      y: y - FONT_SIZE,
      size: FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
    y -= LINE_HEIGHT;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

/**
 * Generates a UTF-8 .txt buffer for a Q&R item. Format chosen to be
 * trivially parsable by GPT during retrieval ; theme/subtheme are surfaced
 * up front so the retrieval can spot them.
 */
export function createTxtFromQA(
  question: string,
  answer: string,
  theme?: string | null,
  subtheme?: string | null
): Buffer {
  const lines: string[] = [];
  if (theme) lines.push(`THÈME: ${theme}`);
  if (subtheme) lines.push(`SOUS-THÈME: ${subtheme}`);
  if (lines.length > 0) lines.push("");
  lines.push("QUESTION:", question.trim(), "", "RÉPONSE:", answer.trim());
  return Buffer.from(lines.join("\n"), "utf8");
}

/**
 * Sanitises a candidate file name :
 *   - replaces anything that isn't [A-Za-z0-9_.-] with '_'
 *   - caps length at 200 chars
 *   - guarantees the result is non-empty (falls back to 'file')
 *
 * Defends against path traversal (no slashes possible) and weird input
 * being interpreted upstream by OpenAI's uploads.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/_+/g, "_") // collapse consecutive underscores for tidier names
    .replace(/^_|_$/g, "") // trim leading / trailing underscores
    .substring(0, 200);
  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * Builds a descriptive Q&R file name : QA_<theme>_<subtheme>_<preview>.txt
 * with each part sanitized and length-capped. Falls back gracefully to
 * QA_<preview>.txt when there's no theme.
 */
export function buildQaFileName(
  question: string,
  theme?: string | null,
  subtheme?: string | null
): string {
  const preview = sanitizeFileName(question.substring(0, 30));
  const themePart = theme ? sanitizeFileName(theme.substring(0, 20)) : "";
  const subPart = subtheme ? sanitizeFileName(subtheme.substring(0, 20)) : "";
  const prefix = [themePart, subPart].filter(Boolean).join("_");
  return prefix ? `QA_${prefix}_${preview}.txt` : `QA_${preview}.txt`;
}
