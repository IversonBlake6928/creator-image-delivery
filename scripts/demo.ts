/**
 * Sends one small master image through the running service and prints the
 * rendition each surface got back.
 *
 * Usage:  npm start                              (in one shell)
 *         npm run demo -- ./my-master.png
 */

import { readFileSync } from "node:fs";

const PORT = process.env.PORT ?? "8080";
const source = process.argv[2];
if (!source) {
  console.error("usage: npm run demo -- <path-to-image>");
  process.exit(1);
}

const body = {
  creatorId: "creator_42",
  filename: source.split("/").pop() ?? "master.png",
  contentBase64: readFileSync(source).toString("base64"),
  surfaces: ["feed", "hero"],
  deliveryKey: `demo-${source.replace(/\W+/g, "-")}`,
};

const res = await fetch(`http://localhost:${PORT}/assets`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

console.log(res.status, JSON.stringify(await res.json(), null, 2));
