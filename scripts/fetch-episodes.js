#!/usr/bin/env node
// Download a run of episodes in full on the running server, e.g. a whole season ahead of time:
//   node scripts/fetch-episodes.js anime 110277 1 16        (AniList id, episodes 1-16)
//   node scripts/fetch-episodes.js series 92751 1 1 8 --season    (TVmaze id, season 1, episodes 1-8)
// Progress shows in ~/logs/hypertube.log ("Fetch: ...") and on the Downloads page.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, "..", ".env"), "utf8")
    .split("\n")
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const args = process.argv.slice(2).filter((a) => a !== "--season");
const [kind, id] = args;
const hasSeason = process.argv.includes("--season");
const season = hasSeason ? args[2] : "";
const [from, to] = hasSeason ? args.slice(3) : args.slice(2);
if (!kind || !id || !from) {
  console.log("usage: fetch-episodes.js <anime|series> <id> [<season> --season] <from> [to]");
  process.exit(1);
}
const exp = Date.now() + 60000;
const end = to || from;
const sig = crypto.createHmac("sha256", env.STREAM_TOKEN_SECRET).update(`fetch:${kind}:${id}:${season}:${from}:${end}:${exp}`).digest("hex");
const q = new URLSearchParams({ kind, id, season, from, to: end, exp, sig });
const req = http.request({ host: "127.0.0.1", port: 5000, method: "POST", path: `/stream/fetch?${q}` }, (res) => {
  console.log(res.statusCode === 200 ? `Started: ${kind} ${id} episodes ${from}-${end}` : `Refused (${res.statusCode})`);
});
req.on("error", (e) => console.log("Server not reachable:", e.message));
req.end();
