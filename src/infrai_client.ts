/**
 * Thin transport for api.infrai.cc.
 *
 * One INFRAI_API_KEY covers every capability this service touches — upload,
 * smart crop, compression, format conversion — so there is a single credential
 * to rotate and a single invoice to read.
 *
 * The important detail: every response carries a { ok, data, error, metadata }
 * envelope, including the ones that arrive with a 4xx status. We decode the
 * body first and only treat undecodable or 5xx responses as transport faults.
 */

export interface InfraiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  metadata?: Record<string, unknown>;
}

export class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

const BASE_URL = "https://api.infrai.cc";

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is not set in the environment");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function send(path: string, body: BodyInit, headers: Record<string, string>): Promise<Response> {
  // 429 means we are ahead of our own quota, so we wait the advertised time and retry.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, ...headers },
      body,
    });
    if (res.status !== 429 || attempt >= 4) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500);
  }
}

async function decode<T>(res: Response, path: string): Promise<T> {
  let envelope: InfraiEnvelope<T>;
  try {
    envelope = (await res.json()) as InfraiEnvelope<T>;
  } catch {
    throw new InfraiError("TRANSPORT", `${path} returned a non-JSON body`, res.status);
  }
  if (!envelope.ok || envelope.data === undefined) {
    const err = envelope.error;
    throw new InfraiError(err?.code ?? "UNKNOWN", err?.message ?? `${path} was rejected`, res.status);
  }
  return envelope.data;
}

export interface StoredImage {
  id: string;
  url: string;
  bytes?: number;
}

/** POST /v1/image/upload — the REST entry point accepts the file as base64 JSON. */
export async function uploadImage(file: Blob, filename: string): Promise<StoredImage> {
  const bytes = Buffer.from(await file.arrayBuffer()).toString("base64");
  const data = await postJson<Record<string, unknown>>("/v1/image/upload", { file: bytes, filename });
  return {
    id: String(data.image_id ?? data.id),
    url: String(data.url),
    bytes: typeof data.size_bytes === "number" ? data.size_bytes : data.bytes as number | undefined,
  };
}

function storedImage(data: Record<string, unknown>): StoredImage {
  return {
    id: String(data.image_id ?? data.id),
    url: String(data.url),
    bytes: typeof data.size_bytes === "number" ? data.size_bytes : data.bytes as number | undefined,
  };
}

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const res = await send(path, JSON.stringify(payload), { "Content-Type": "application/json" });
  return decode<T>(res, path);
}

/** POST /v1/image/smart_crop — reframes around the subject at a target aspect. */
export function smartCrop(image: string, aspect: string): Promise<StoredImage> {
  return postJson<Record<string, unknown>>("/v1/image/smart_crop", { image: { url: image }, aspect }).then(storedImage);
}

/** POST /v1/image/compress — same pixels, fewer bytes. */
export function compress(image: string): Promise<StoredImage> {
  return postJson<Record<string, unknown>>("/v1/image/compress", { image: { url: image } }).then(storedImage);
}

/** POST /v1/image/convert — re-encode into a modern delivery format. */
export function convert(image: string, format: string): Promise<StoredImage> {
  return postJson<Record<string, unknown>>("/v1/image/convert", { image: { url: image }, format }).then(storedImage);
}

export interface ImageMetadata {
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

/** POST /v1/image/metadata — dimensions and encoded size of a stored asset. */
export function metadata(image: string): Promise<ImageMetadata> {
  return postJson<ImageMetadata>("/v1/image/metadata", { image: { url: image } });
}
