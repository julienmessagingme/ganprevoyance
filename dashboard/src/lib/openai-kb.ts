import OpenAI from "openai";
import { getSchoolVectorStoreId } from "@/lib/schools";

/**
 * Wrapper around OpenAI Files API + Vector Stores API for the Gan Prévoyance
 * knowledge base feature. One vector store per school is configured via env
 * vars (OPENAI_VS_<SLUG>) and selected at call time.
 *
 * Uses the official `openai` SDK for the Files API (well-typed) and native
 * fetch for the Vector Stores API (the SDK's typing for the v2 beta is
 * unstable in some versions and the wire format is straightforward enough).
 */

let _client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const VS_BASE = "https://api.openai.com/v1/vector_stores";
const BETA_HEADER = "assistants=v2";

function vsHeaders(): Record<string, string> {
  // Mirror getOpenAI()'s precondition : the SDK throws at instantiation
  // if the key is missing, but the fetch-based VS calls don't go through
  // it. Failing here gives a clear stack trace at the boundary instead
  // of a remote 401 mid-upload.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set");
  }
  return {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "OpenAI-Beta": BETA_HEADER,
  };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, init);
      // Retry only 5xx (transient). 4xx are deterministic — fail fast.
      if (r.status >= 500 && attempt < retries) {
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
        continue;
      }
      return r;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  throw new Error("fetchWithRetry: unreachable");
}

/**
 * Returns the OpenAI vector store id configured for a school. Throws
 * if the env var is missing — knowledge ops can't proceed without it.
 */
export function getVectorStoreId(schoolSlug: string): string {
  const id = getSchoolVectorStoreId(schoolSlug);
  if (!id) {
    throw new Error(
      `Vector store id not configured for school "${schoolSlug}". ` +
        `Set the OPENAI_VS_* env var.`
    );
  }
  return id;
}

export interface UploadResult {
  vectorStoreFileId: string;
  fileId: string;
  status: string;
}

/**
 * Uploads a file to the school's vector store. Two-step :
 *   1. POST /v1/files with purpose=assistants (returns file id)
 *   2. POST /v1/vector_stores/{vs_id}/files with the file id
 *      (kicks off indexation — takes a few seconds for small files)
 *
 * If `skipIndexation` is true, returns immediately after the second POST
 * with status='in_progress'. Otherwise polls for up to 60 s.
 */
export async function uploadToVectorStore(
  schoolSlug: string,
  fileBuffer: Buffer,
  fileName: string,
  options: { skipIndexation?: boolean } = {}
): Promise<UploadResult> {
  const vsId = getVectorStoreId(schoolSlug);

  // Step 1 : upload to Files API.
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const mime =
    ext === "txt"
      ? "text/plain"
      : ext === "pdf"
        ? "application/pdf"
        : "application/octet-stream";

  const file = await getOpenAI().files.create({
    file: new File([new Uint8Array(fileBuffer)], fileName, { type: mime }),
    purpose: "assistants",
  });

  // Step 2 : attach to the vector store.
  const r = await fetchWithRetry(`${VS_BASE}/${vsId}/files`, {
    method: "POST",
    headers: { ...vsHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: file.id }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`vector store attach failed: HTTP ${r.status} — ${body}`);
  }
  const vsFile = (await r.json()) as { id: string; status: string };

  // Step 3 : optionally wait for indexation to complete.
  let finalStatus = vsFile.status;
  if (!options.skipIndexation) {
    finalStatus = await waitForIndexation(schoolSlug, vsFile.id);
  }

  return {
    vectorStoreFileId: vsFile.id,
    fileId: file.id,
    status: finalStatus,
  };
}

/**
 * Polls the vector store file status until it leaves 'in_progress'. Returns
 * the final status (typically 'completed' or 'failed'). Bails after
 * maxAttempts seconds and returns 'in_progress' so the caller can treat
 * it as an indexation timeout (visible in UI as a warning badge).
 */
export async function waitForIndexation(
  schoolSlug: string,
  vectorStoreFileId: string,
  maxAttempts = 60
): Promise<string> {
  const vsId = getVectorStoreId(schoolSlug);
  let status = "in_progress";
  let attempts = 0;
  while (status === "in_progress" && attempts < maxAttempts) {
    await new Promise((res) => setTimeout(res, 1000));
    const r = await fetchWithRetry(
      `${VS_BASE}/${vsId}/files/${vectorStoreFileId}`,
      { headers: vsHeaders() }
    );
    if (!r.ok) {
      throw new Error(`waitForIndexation: HTTP ${r.status}`);
    }
    const j = (await r.json()) as { status: string };
    status = j.status;
    attempts++;
  }
  return status;
}

/**
 * Single-shot status check for a vector store file. Used by the items
 * listing route to reconcile statuses that got stuck at `in_progress`
 * because the original upload-time poll timed out before indexation
 * completed (typically a large or slow-to-process file). Returns the
 * current OpenAI-side status, or null if the file no longer exists in
 * the vector store (deleted externally — the caller can flip the row
 * to `failed` or hide it).
 */
export async function getVectorStoreFileStatus(
  schoolSlug: string,
  vectorStoreFileId: string
): Promise<string | null> {
  const vsId = getVectorStoreId(schoolSlug);
  const r = await fetchWithRetry(`${VS_BASE}/${vsId}/files/${vectorStoreFileId}`, {
    headers: vsHeaders(),
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    throw new Error(`getVectorStoreFileStatus: HTTP ${r.status}`);
  }
  const j = (await r.json()) as { status: string };
  return j.status;
}

/**
 * Removes a file from the vector store. Does NOT delete the underlying
 * file in Files API — call deleteOpenAIFile(fileId) for that.
 */
export async function deleteFromVectorStore(
  schoolSlug: string,
  vectorStoreFileId: string
): Promise<void> {
  const vsId = getVectorStoreId(schoolSlug);
  const r = await fetchWithRetry(`${VS_BASE}/${vsId}/files/${vectorStoreFileId}`, {
    method: "DELETE",
    headers: vsHeaders(),
  });
  if (!r.ok && r.status !== 404) {
    const body = await r.text().catch(() => "");
    throw new Error(`vector store delete failed: HTTP ${r.status} — ${body}`);
  }
}

/** Hard-deletes the underlying file from OpenAI's Files API. */
export async function deleteOpenAIFile(fileId: string): Promise<void> {
  try {
    await getOpenAI().files.delete(fileId);
  } catch (err) {
    // 404 means the file is already gone — fine.
    const e = err as { status?: number };
    if (e.status === 404) return;
    throw err;
  }
}
