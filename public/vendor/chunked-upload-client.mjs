// ============================================================================
// chunked-upload-kit — client (browser + Node, ESM, zero deps)
// ----------------------------------------------------------------------------
//   import { uploadChunked } from 'chunked-upload-kit/client'
//   const result = await uploadChunked(file, {
//     endpoint: '/api/upload/chunked',
//     headers: { Authorization: 'Bearer …' },   // or getHeaders: async () => ({...})
//     onProgress: ({ loaded, total, percent }) => …,
//   })
// Browser uses XHR for chunk PUTs (real upload progress); Node uses fetch.
// Throws UploadError { status, code, body, uploadId, resumable } — keep
// `uploadId` when `resumable` is true to continue later.
// ============================================================================

export class UploadError extends Error {
  constructor(message, { status = 0, code = 'upload_failed', body = null, uploadId = null, resumable = false, cause } = {}) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.uploadId = uploadId;
    this.resumable = resumable;
    if (cause) this.cause = cause;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
});

const abortError = () => new UploadError('Upload aborted', { code: 'aborted' });

// Retry network errors, 408/429, and 5xx; everything else is the caller's problem.
const isRetryable = (err) => err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;

function parseBody(text) {
  try { return text ? JSON.parse(text) : null; } catch (_) { return text; }
}

function errorFromResponse(status, text, uploadId) {
  const body = parseBody(text);
  const message = (body && typeof body === 'object' && body.error) || `Upload request failed (${status})`;
  const code = (body && typeof body === 'object' && body.code) || 'http_error';
  return new UploadError(message, { status, code, body, uploadId });
}

async function request(fetchImpl, method, url, { headers, body, signal, uploadId }) {
  let res;
  try {
    res = await fetchImpl(url, { method, headers, body, signal });
  } catch (err) {
    if (signal?.aborted) throw abortError();
    throw new UploadError(`Network error: ${err.message}`, { status: 0, code: 'network', uploadId, cause: err });
  }
  const text = await res.text();
  if (!res.ok) throw errorFromResponse(res.status, text, uploadId);
  return parseBody(text);
}

// Always send a JSON body on POSTs: proxies re-frame body-less requests in ways
// some servers reject (415 "content-type: undefined").
async function postJson(fetchImpl, url, payload, { headers, signal, uploadId, retries = 0, retryDelayMs = 500 }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(fetchImpl, 'POST', url, {
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
        signal,
        uploadId,
      });
    } catch (err) {
      if (err.code === 'aborted' || !isRetryable(err) || attempt >= retries) throw err;
      await sleep(retryDelayMs * 2 ** attempt, signal);
    }
  }
}

function putWithXhr(url, blob, { headers, signal, onProgress, uploadId, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (timeoutMs > 0) xhr.timeout = timeoutMs;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded); });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(parseBody(xhr.responseText));
      else reject(errorFromResponse(xhr.status, xhr.responseText, uploadId));
    });
    xhr.addEventListener('error', () => reject(new UploadError('Network error', { status: 0, code: 'network', uploadId })));
    xhr.addEventListener('timeout', () => reject(new UploadError('Timed out', { status: 0, code: 'timeout', uploadId })));
    xhr.addEventListener('abort', () => reject(abortError()));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/**
 * Upload `file` (Blob/File) in chunks. Resolves with the server's /complete JSON.
 */
export async function uploadChunked(file, opts = {}) {
  const {
    endpoint,
    headers = {},
    getHeaders,
    chunkSize,
    concurrency = 3,
    retries = 3,
    retryDelayMs = 500,
    chunkTimeoutMs = 120_000,
    onProgress,
    signal,
    meta,
    completeBody,
    sha256,
    filename,
    mime,
    uploadId: resumeId,
    fetch: fetchImpl = globalThis.fetch,
    useXhr = typeof XMLHttpRequest !== 'undefined',
  } = opts;

  if (!endpoint) throw new UploadError('`endpoint` is required', { code: 'bad_options' });
  if (!file || typeof file.slice !== 'function' || typeof file.size !== 'number') {
    throw new UploadError('`file` must be a Blob/File', { code: 'bad_options' });
  }
  if (typeof fetchImpl !== 'function') throw new UploadError('fetch is not available; pass opts.fetch', { code: 'bad_options' });
  if (signal?.aborted) throw abortError();

  const base = endpoint.replace(/\/$/, '');
  const hdrs = async () => ({ ...(typeof getHeaders === 'function' ? await getHeaders() : headers) });
  const name = filename || file.name || 'upload.bin';

  // ── 1. init or resume ──
  let session;
  if (resumeId) {
    session = await request(fetchImpl, 'GET', `${base}/${encodeURIComponent(resumeId)}`, { headers: await hdrs(), signal, uploadId: resumeId });
    if (session.size !== file.size || (session.filename && session.filename !== name)) {
      throw new UploadError('Resume target does not match this file', { code: 'resume_mismatch', uploadId: resumeId });
    }
  } else {
    session = await postJson(fetchImpl, `${base}/init`, {
      filename: name,
      size: file.size,
      mime: mime || file.type || 'application/octet-stream',
      chunkSize,
      sha256,
      meta,
    }, { headers: await hdrs(), signal, retries, retryDelayMs });
  }

  const { uploadId, totalChunks } = session;
  const size = session.chunkSize;
  const done = new Set(session.received || []);
  const withId = (err) => {
    if (!err.uploadId) err.uploadId = uploadId;
    // the session only survives transient failures; 4xx from the server means it is gone or refused
    err.resumable = err.code !== 'aborted' ? isRetryable(err) : true;
    return err;
  };

  // ── 2. progress accounting ──
  const chunkLength = (i) => (i < totalChunks - 1 ? size : file.size - size * (totalChunks - 1));
  const loadedByChunk = new Map();
  for (const i of done) loadedByChunk.set(i, chunkLength(i));
  let lastLoaded = -1;
  function emit() {
    if (typeof onProgress !== 'function') return;
    let loaded = 0;
    for (const v of loadedByChunk.values()) loaded += v;
    if (loaded === lastLoaded) return;
    lastLoaded = loaded;
    onProgress({ loaded, total: file.size, percent: file.size ? Math.floor((loaded / file.size) * 100) : 100, uploadId });
  }
  emit();

  // ── 3. chunk workers ──
  const queue = [];
  for (let i = 0; i < totalChunks; i++) if (!done.has(i)) queue.push(i);
  let failure = null;

  async function putChunk(i) {
    const blob = file.slice(i * size, Math.min((i + 1) * size, file.size));
    const url = `${base}/${encodeURIComponent(uploadId)}/${i}`;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      const h = { ...(await hdrs()), 'content-type': 'application/octet-stream' };
      try {
        const onChunkProgress = (n) => { loadedByChunk.set(i, n); emit(); };
        if (useXhr) await putWithXhr(url, blob, { headers: h, signal, onProgress: onChunkProgress, uploadId, timeoutMs: chunkTimeoutMs });
        else await request(fetchImpl, 'PUT', url, { headers: h, body: blob, signal, uploadId });
        loadedByChunk.set(i, blob.size);
        emit();
        return;
      } catch (err) {
        loadedByChunk.set(i, 0);
        emit();
        if (err.code === 'aborted' || !isRetryable(err) || attempt >= retries) throw withId(err);
        await sleep(retryDelayMs * 2 ** attempt, signal);
      }
    }
  }

  async function worker() {
    while (queue.length && !failure) {
      const i = queue.shift();
      try {
        await putChunk(i);
      } catch (err) {
        failure = failure || err;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, worker));
  if (failure) throw withId(failure);

  // ── 4. complete (retried: the server makes it single-flight/idempotent) ──
  try {
    return await postJson(fetchImpl, `${base}/${encodeURIComponent(uploadId)}/complete`, completeBody, {
      headers: await hdrs(), signal, uploadId, retries, retryDelayMs,
    });
  } catch (err) {
    throw withId(err);
  }
}

/** Best-effort server-side cleanup of an unfinished upload. Never throws. */
export async function abortUpload(uploadId, { endpoint, headers = {}, getHeaders, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!uploadId || !endpoint) return false;
  try {
    const h = typeof getHeaders === 'function' ? await getHeaders() : headers;
    const res = await fetchImpl(`${endpoint.replace(/\/$/, '')}/${encodeURIComponent(uploadId)}`, { method: 'DELETE', headers: h });
    return res.ok;
  } catch (_) {
    return false;
  }
}
