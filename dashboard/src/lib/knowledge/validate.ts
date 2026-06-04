/**
 * Magic-byte validators for files uploaded to the knowledge base.
 * Extension checks alone are bypassable ; we sniff the first few bytes
 * to assert the content actually matches.
 */

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/** A file is a valid PDF iff its first 5 bytes are `%PDF-`. */
export function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).equals(PDF_MAGIC);
}

/**
 * A file is "plausibly text" if no NUL byte appears in the first KB. We don't
 * try to detect the encoding — UTF-8/Latin-1/etc are all fine for OpenAI.
 * The NUL check rules out PDFs/images/zips that someone renamed `.txt`.
 */
export function isPlausiblyText(buf: Buffer): boolean {
  const slice = buf.subarray(0, Math.min(buf.length, 1024));
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) return false;
  }
  return true;
}

/**
 * Returns null if the file looks valid for the given extension, or an error
 * message describing the mismatch.
 */
export function validateUpload(
  ext: string,
  buf: Buffer
): string | null {
  if (ext === "pdf") {
    return isPdf(buf) ? null : "Le fichier ne ressemble pas à un PDF valide.";
  }
  if (ext === "txt") {
    return isPlausiblyText(buf)
      ? null
      : "Le fichier contient des octets binaires — un .txt est attendu.";
  }
  return `Extension "${ext}" non supportée.`;
}

export const ACCEPTED_FILE_EXTS = ["pdf", "txt"] as const;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
