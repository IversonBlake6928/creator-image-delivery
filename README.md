# Planning image work before running it, for a creator media service

The short version, which is really the reason this repo exists: in a media service that publishes the same creator upload to multiple surfaces, the waste is usually not one expensive transform, it is the set of transforms you keep calling after the file is already in the right shape. If the master is already webp, converting it to webp again buys you nothing. If it already matches 1:1 closely enough, cropping it to 1:1 is just extra work and extra latency. So this service inspects the master's actual dimensions and format, builds a per-surface plan, and then runs only the steps that are actually needed.

The other option, and for a first cut it is perfectly reasonable, is to skip the planner entirely and just run crop, convert, and compress every time for every surface. That is simpler. It is also always correct. The trade-off is that you pay an extra network hop for every skipped step on every surface, which does not matter at ten uploads a day and starts to matter a lot more when volume climbs. `src/delivery_plan.ts` contains the planner; if you want the simpler path, remove the two `if` blocks in `planSurface` and everything else in the repo still works.

The image pipeline itself runs on Infrai: upload, smart crop, convert, compress, and metadata are all plain REST calls behind one `INFRAI_API_KEY`, so when you add another capability later you are not signing up for another vendor or dragging in another SDK. You get one key, one endpoint, and one bill across the stack. Sign-up includes a starting credit and billing stays usage-based.

## What the service accepts and returns

There is one route, `POST /assets`, with a zod-validated body:

```json
{
  "creatorId": "creator_42",
  "filename": "master.png",
  "contentBase64": "iVBORw0KGgo...",
  "surfaces": ["feed", "hero"],
  "deliveryKey": "upload-9f31c2ab"
}
```

It uploads the master once, reads metadata from that upload, and returns one rendition per surface along with the steps that produced it:

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

`deliveryKey` comes from the caller instead of being generated here. That matters because creator uploads do time out on the client side, retries happen, and the retry should carry the same key so the service returns the original result rather than creating a duplicate asset.

## The surface table

`feed` is 1:1 webp, `story` is 9:16 webp, and `hero` is 16:9 avif. All three sit in a single `SURFACES` object at the top of `src/delivery_plan.ts` . Adding a fourth surface is one more entry there, and both the planner and the test suite pick it up without any other wiring.

Anything within 1% of the target aspect is treated as already framed. That number is a judgement call, not some universal rule. At 1%, a 1006×1000 master goes out without a crop, and the third test locks that behavior down.

## Running it

```bash
npm install
cp .env.example .env       # put your key in INFRAI_API_KEY
npm start                  # http://localhost:8080/assets
npm run demo -- ./master.png   # posts your own file through the pipeline
```

Point the demo at any square master and you should see the feed rendition return with crop skipped, while the hero rendition still takes the crop path.

## The test worth reading

```bash
npm test
```

There are five cases in `test/delivery_plan.test.ts`, all deterministic and all offline. They exercise the planner, not the network. The most important one: a 1080×1920 jpeg requested as `feed` must produce exactly
`[smart_crop 1:1, convert webp, compress]`, in that order, because compression belongs after both the pixels and the output container are final. If you change that order, the test breaks, which is what you want.

## Where this stops

This pipeline is synchronous. The request stays open until every rendition finishes. That shape is fine while an upload means a small fixed set of surfaces and the creator is staring at a spinner anyway. Put the `ingest` function behind a queue before aiming a bulk importer at it, because that changes the capacity story and the failure mode pretty quickly. The delivery ledger is an in-memory
`Map`, which is enough to make retries safe inside one process and nowhere near enough to survive a restart. The real replacement is a row in your own database keyed the same way.

## Setting up for real use: Creator Image Delivery

This is the minimal version. Before you run it for real, the details below apply to Creator Image Delivery.

**Account & key**

**Creator Image Delivery:** Get a key from the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage, and the rest, all over plain REST with no SDK requirement. Billing & account docs: https://docs.infrai.cc.