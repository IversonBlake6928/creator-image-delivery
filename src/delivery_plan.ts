/**
 * The decision this service exists to make: given one uploaded master image and
 * the surfaces a creator wants it on, which processing steps are actually worth
 * running?
 *
 * Two approaches were on the table. The straightforward one is to run crop →
 * convert → compress for every surface unconditionally; it is three lines and it
 * always produces a correct file. The one implemented here plans first and skips
 * steps whose output would be identical to their input — a master already in
 * webp does not need converting, and a master already at the surface's aspect
 * does not need cropping. That planning step is what the unit test pins down.
 */

import { z } from "zod";

export const SURFACES = {
  feed: { aspect: "1:1", format: "webp" },
  story: { aspect: "9:16", format: "webp" },
  hero: { aspect: "16:9", format: "avif" },
} as const;

export type SurfaceName = keyof typeof SURFACES;

export const IngestRequest = z.object({
  creatorId: z.string().min(1),
  filename: z.string().min(1),
  /** Base64 master image bytes, as a creator upload widget would send them. */
  contentBase64: z.string().min(1),
  surfaces: z.array(z.enum(["feed", "story", "hero"])).min(1),
  /** Client-supplied so a retried upload lands on the same asset. */
  deliveryKey: z.string().min(8),
});

export type IngestRequest = z.infer<typeof IngestRequest>;

export type PlanStep =
  | { step: "smart_crop"; aspect: string }
  | { step: "convert"; format: string }
  | { step: "compress" };

export interface SourceShape {
  width: number;
  height: number;
  format: string;
}

function aspectRatio(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
}

/**
 * Ratios within 1% are treated as already framed; below that the crop would
 * shave a pixel row and cost a round trip for no visible change.
 */
const ASPECT_TOLERANCE = 0.01;

export function planSurface(source: SourceShape, surface: SurfaceName): PlanStep[] {
  const target = SURFACES[surface];
  const steps: PlanStep[] = [];

  const have = source.width / source.height;
  const want = aspectRatio(target.aspect);
  if (Math.abs(have - want) / want > ASPECT_TOLERANCE) {
    steps.push({ step: "smart_crop", aspect: target.aspect });
  }

  if (source.format.toLowerCase() !== target.format) {
    steps.push({ step: "convert", format: target.format });
  }

  // Compression is the point of the pipeline, so it always runs last, after the
  // pixels and the container are both final.
  steps.push({ step: "compress" });
  return steps;
}

export function planDelivery(source: SourceShape, surfaces: readonly SurfaceName[]): Record<string, PlanStep[]> {
  const plan: Record<string, PlanStep[]> = {};
  for (const surface of surfaces) plan[surface] = planSurface(source, surface);
  return plan;
}
