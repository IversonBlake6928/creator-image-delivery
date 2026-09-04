import { strict as assert } from "node:assert";
import test from "node:test";
import { IngestRequest, planSurface, planDelivery } from "../src/delivery_plan.ts";

test("a square webp master skips both crop and convert for the feed", () => {
  const steps = planSurface({ width: 1200, height: 1200, format: "webp" }, "feed");
  assert.deepEqual(steps, [{ step: "compress" }]);
});

test("a tall jpeg master is cropped and converted before compression", () => {
  const steps = planSurface({ width: 1080, height: 1920, format: "jpeg" }, "feed");
  assert.deepEqual(steps, [
    { step: "smart_crop", aspect: "1:1" },
    { step: "convert", format: "webp" },
    { step: "compress" },
  ]);
});

test("a 0.5% aspect drift is treated as already framed", () => {
  const steps = planSurface({ width: 1006, height: 1000, format: "webp" }, "feed");
  assert.deepEqual(steps, [{ step: "compress" }]);
});

test("hero wants avif, so a webp master still converts", () => {
  const plan = planDelivery({ width: 1920, height: 1080, format: "webp" }, ["hero", "story"]);
  assert.deepEqual(plan.hero, [{ step: "convert", format: "avif" }, { step: "compress" }]);
  assert.deepEqual(plan.story, [
    { step: "smart_crop", aspect: "9:16" },
    { step: "compress" },
  ]);
});

test("a delivery key shorter than eight characters is rejected at the boundary", () => {
  const parsed = IngestRequest.safeParse({
    creatorId: "c_1",
    filename: "master.jpg",
    contentBase64: "AAAA",
    surfaces: ["feed"],
    deliveryKey: "short",
  });
  assert.equal(parsed.success, false);
});
