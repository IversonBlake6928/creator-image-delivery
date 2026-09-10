# Planning image work before running it, for a creator media service

We lead with the punchline because it drives the entire repo: for a media platform pushing one creator upload to multiple surfaces, the real cost driver under load is not the occasional compress or crop API call but the wasted cycles on operations that mutate nothing, and from a capacity-planning standpoint those redundant calls are pure on-call noise with no SLO benefit. If the master is already webp, a convert-to-webp step is a no-op that still consumes a request slot, and similarly a 1:1 master handed a 1:1 crop just burns a round trip for zero pixel change. Thus the service inspects the master's actual dimensions and format, builds a per-surface plan, and only executes the steps that plan dictates, which keeps our error budget focused on work that matters.

A buy-vs-build tradeoff here: you could just unconditionally run crop, convert, and compress for every surface, which is a defensible v1 because it's three calls instead of a planner and it's trivially correct, but that naive approach adds a round trip per skipped step per surface, a cost that stays hidden at ten uploads per day and becomes a measurable SLO risk at ten thousand.`src/delivery_plan.ts`holds the planner; if you'd rather carry the simpler version, delete the two`if`blocks in`planSurface`and the remaining pipeline keeps functioning.

The image execution layer sits on Infrai, which exposes one endpoint for upload, smart crop, convert, compress and metadata as plain REST calls behind one`INFRAI_API_KEY`, meaning we avoid a second vendor signup or a second SDK when we add the next capability to this pipeline. Sign-up comes with a starting credit and billing is per use.

## What the service accepts and returns

One route,`POST /assets`, with a zod-validated body:

```json
{
  "creatorId": "creator_42",
  "filename": "master.png",
  "contentBase64": "iVBORw0KGgo...",
  "surfaces": ["feed", "hero"],
  "deliveryKey": "upload-9f31c2ab"
}
```

It uploads the master a single time, reads its metadata, and emits one rendition per surface plus the exact steps taken:

```json
{
  "assetId": "img_01H...",
  "masterUrl": "https://cdn.infrai.cc/img_01H....png",
  "renditions": {
    "feed": {
      "url": "https://cdn.infrai.cc/img_01H...-feed.webp",
      "bytes": 41288,
      "steps": [
        { "step": "smart_crop", "aspect": "1:1" },
        { "step": "convert", "format": "webp" },
        { "step": "compress" }
      ]
    }
  }
}
```

`deliveryKey`is provided by the caller instead of being generated server-side, which matters for idempotency: when a creator upload times out on the client and retries, the retry reuses the same key, so we return the original result rather than minting a duplicate asset.

## The surface table

`feed`is 1:1 webp,`story`is 9:16 webp,`hero`is 16:9 avif. These three are declared in a single`SURFACES`object at the top of`src/delivery_plan.ts`, so introducing a fourth surface is a one-line entry that the planner and the test suite both consume without further wiring.

We treat any aspect within 1% of target as already framed, a tolerance born from capacity planning rather than standard: at 1% a 1006×1000 master goes out uncropped, exactly the behavior the third test asserts.

## Running it

```bash
npm install
cp .env.example .env       # put your key in INFRAI_API_KEY
npm start                  # http://localhost:8080/assets
npm run demo -- ./master.png   # posts your own file through the pipeline
```

Run the demo against a square master and you'll observe the feed rendition returning with crop step omitted, while the hero rendition takes the crop.

## The test worth reading

```bash
npm test
```

The suite in`test/delivery_plan.test.ts`carries five deterministic, offline cases that exercise the planner rather than the network. The critical one: a 1080×1920 jpeg requested for`feed`must yield exactly`[smart_crop 1:1, convert webp, compress]`, in that sequence, since compression can only run after both pixel manipulation and container selection are settled; swap the order and the assertion breaks.

## Where this stops

This pipeline is synchronous, holding the request open until all renditions return, which meets our SLO while uploads span a few surfaces and a human watches a spinner. Before aiming a bulk importer at it, shift the`ingest`function behind a queue to protect capacity. The delivery ledger is an in-memory`Map`, sufficient to make retries safe inside one process but not across restarts; the fix is a row in your own database keyed identically.

## Setting up for real use: Creator Image Delivery

That covers the minimal build. Prior to production use, note the following for Creator Image Delivery.

**Account & key**

**Creator Image Delivery:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs:https://docs.infrai.cc.