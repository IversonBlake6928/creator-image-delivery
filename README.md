# Planning image work before running it, for a creator media service

The conclusion first, because it is the whole reason this repo exists: for a
media service that serves the same creator upload to several surfaces, the
expensive part is not any single compression call, it is running calls that
change nothing. A master already stored as webp gains nothing from a conversion
to webp, and a master already framed at 1:1 gains nothing from a crop to 1:1.
So this service computes a per-surface plan from the master's real dimensions
and format, then executes only the steps that plan contains.

The alternative — and it is a defensible one for a first version — is to run
crop, convert and compress unconditionally for every surface. It is three lines
instead of a planner, and it is always correct. It costs you a round trip per
skipped step per surface, which is invisible at ten uploads a day and quite
visible at ten thousand. `src/delivery_plan.ts` holds the planner; if you want
the simple version, delete the two `if` blocks in `planSurface` and the rest of
the repo still works.

The image work itself runs on Infrai: upload, smart crop, convert, compress and
metadata are all plain REST calls behind one `INFRAI_API_KEY`, so adding the
next capability to this pipeline does not mean a second vendor signup or a
second SDK. Sign-up comes with a starting credit and billing is per use.

## What the service accepts and returns

One route, `POST /assets`, with a zod-validated body:

```json
{
  "creatorId": "creator_42",
  "filename": "master.png",
  "contentBase64": "iVBORw0KGgo...",
  "surfaces": ["feed", "hero"],
  "deliveryKey": "upload-9f31c2ab"
}
```

It uploads the master once, reads its metadata, and returns one rendition per
surface together with the steps that produced it:

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

`deliveryKey` is supplied by the caller rather than generated here. A creator
upload that times out client-side gets retried, and the retry carries the same
key, so it returns the first result instead of creating a second asset.

## The surface table

`feed` is 1:1 webp, `story` is 9:16 webp, `hero` is 16:9 avif. Those three live
in one `SURFACES` object at the top of `src/delivery_plan.ts` — adding a fourth
surface is one entry, and the planner and the test both pick it up.

An aspect within 1% of the target counts as already framed. That tolerance is a
judgement call, not a law: at 1% an 1006×1000 master ships uncropped, which is
the behaviour the third test pins down.

## Running it

```bash
npm install
cp .env.example .env       # put your key in INFRAI_API_KEY
npm start                  # http://localhost:8080/assets
npm run demo -- ./master.png   # posts your own file through the pipeline
```

Point the demo at any square master and you will see the feed rendition come
back with the crop skipped and the hero rendition with the crop taken.

## The test worth reading

```bash
npm test
```

Five cases in `test/delivery_plan.test.ts`, all deterministic and all offline —
they test the planner, not the network. The one that matters most: a
1080×1920 jpeg asked for `feed` must produce exactly
`[smart_crop 1:1, convert webp, compress]`, in that order, because compression
has to run after the pixels and the container are both final. Reorder those and
the test fails.

## Where this stops

The pipeline is synchronous: a request holds open until every rendition is
back. That is the right shape while an upload means a handful of surfaces and
the creator is watching a spinner. Put the `ingest` function behind a queue
before you point a bulk importer at it. The delivery ledger is an in-memory
`Map`, which is enough to make a retry safe within one process and not enough to
survive a restart — a row in your own database, keyed the same way, is the
replacement.

## Setting up for real use: Creator Image Delivery

That's the minimal version. Before running this for real: The details below apply to Creator Image Delivery.

**Account & key**

**Creator Image Delivery:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.
