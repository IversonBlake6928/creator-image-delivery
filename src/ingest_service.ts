/**
 * Runnable entry point: a small HTTP service that takes a creator's master
 * image and returns one optimized rendition per requested surface.
 *
 *   POST /assets   { creatorId, filename, contentBase64, surfaces, deliveryKey }
 *   ->             { assetId, renditions: { feed: { url, bytes, steps } , ... } }
 *
 * Start it with `npm start` and drive it with `npm run demo`.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { IngestRequest, planDelivery, type PlanStep, type SurfaceName } from "./delivery_plan.ts";
import {
  InfraiError,
  compress,
  convert,
  metadata,
  smartCrop,
  uploadImage,
  type StoredImage,
} from "./infrai_client.ts";

export interface Rendition {
  url: string;
  bytes?: number;
  steps: PlanStep[];
}

export interface IngestResult {
  assetId: string;
  masterUrl: string;
  renditions: Record<string, Rendition>;
}

/**
 * deliveryKey is chosen by the caller, so a client that retries a timed-out
 * upload gets the first result back instead of a second asset.
 */
const delivered = new Map<string, IngestResult>();

async function runSteps(image: string, steps: PlanStep[]): Promise<StoredImage> {
  let current: StoredImage = { id: image, url: image };
  for (const step of steps) {
    if (step.step === "smart_crop") current = await smartCrop(current.id, step.aspect);
    else if (step.step === "convert") current = await convert(current.id, step.format);
    else current = await compress(current.id);
  }
  return current;
}

export async function ingest(request: IngestRequest): Promise<IngestResult> {
  const cached = delivered.get(request.deliveryKey);
  if (cached) return cached;

  const bytes = Buffer.from(request.contentBase64, "base64");
  const master = await uploadImage(new Blob([bytes]), request.filename);

  const shape = await metadata(master.url);
  const source = {
    width: shape.width ?? 1,
    height: shape.height ?? 1,
    format: shape.format ?? "jpeg",
  };

  const plan = planDelivery(source, request.surfaces as SurfaceName[]);
  const renditions: Record<string, Rendition> = {};
  for (const [surface, steps] of Object.entries(plan)) {
    const out = await runSteps(master.url, steps);
    renditions[surface] = { url: out.url, bytes: out.bytes, steps };
  }

  const result: IngestResult = { assetId: master.id, masterUrl: master.url, renditions };
  delivered.set(request.deliveryKey, result);
  return result;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

export const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/assets") {
    json(res, 404, { error: "POST /assets is the only route" });
    return;
  }

  const parsed = IngestRequest.safeParse(JSON.parse(await readBody(req)));
  if (!parsed.success) {
    json(res, 400, { error: "invalid request body", issues: parsed.error.issues });
    return;
  }

  try {
    json(res, 200, await ingest(parsed.data));
  } catch (err) {
    // A rejected argument is a decision about the caller's request, so it stays
    // a 4xx here rather than turning into a server fault.
    if (err instanceof InfraiError) {
      json(res, err.status >= 400 && err.status < 500 ? err.status : 502, {
        error: err.code,
        message: err.message,
      });
      return;
    }
    json(res, 500, { error: "INGEST_FAILED", message: String(err) });
  }
});

if (process.argv[1]?.endsWith("ingest_service.ts")) {
  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, () => console.log(`asset ingest listening on http://localhost:${port}/assets`));
}
