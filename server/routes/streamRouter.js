const express = require("express");
const path = require("path");
const streamer = require("../services/streamer");

const crypto = require("crypto");
const keys = require("../config/keys");

// Video is served from a second hostname (127.0.0.1 vs localhost) so long-lived streams get
// their own browser connection pool and don't starve API calls (6 connections per host).
// That origin has no session cookie, so the player gets a signed, expiring token instead.
const SECRET = keys.JWT && keys.JWT.secret;
const signToken = (uid, hash) => {
  const exp = Date.now() + 12 * 3600 * 1000;
  const sig = crypto.createHmac("sha256", SECRET).update(`${uid}:${hash}:${exp}`).digest("hex").slice(0, 32);
  return `${uid}.${exp}.${sig}`;
};
const tokenOk = (token, hash) => {
  const [uid, exp, sig] = String(token || "").split(".");
  if (!uid || !exp || !sig || +exp < Date.now()) return false;
  const want = crypto.createHmac("sha256", SECRET).update(`${uid}:${streamer.normHash(hash)}:${exp}`).digest("hex").slice(0, 32);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
};
const mediaBase = (req) => {
  const host = req.headers.host || "localhost:5000";
  const [name, port] = host.split(":");
  const alt = name === "localhost" ? "127.0.0.1" : name === "127.0.0.1" ? "localhost" : name;
  return `${req.protocol}://${alt}${port ? `:${port}` : ""}`;
};
const allowMedia = (req, res, next) => {
  if (req.user || tokenOk(req.query.token, req.params.hash)) return next();
  res.sendStatus(401);
};

// tailscale serve also connects from loopback, so a forwarded request is not "local"
const isLoopback = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) &&
  !req.headers["x-forwarded-for"];

// logged-in users, or ffmpeg/ffprobe calling back into the server from this machine
const allowRaw = (req, res, next) => {
  if (req.user || tokenOk(req.query.token, req.params.hash) || (isLoopback(req) && !req.headers.referer && !req.headers.origin))
    return next();
  res.sendStatus(401);
};
const requireAuth = (req, res, next) => (req.user ? next() : res.sendStatus(401));

exports.router = (() => {
  const router = express.Router();

  router.get("/raw/:hash/:index", allowRaw, async (req, res) => {
    try {
      const file = await streamer.openFile(req.params.hash, req.params.index);
      if (!file) return res.sendStatus(404);
      streamer.sendRange(req, res, file);
    } catch (e) {
      res.sendStatus(404);
    }
  });

  // resolve which file to play and how (direct MP4 or transcode), with audio/subtitle tracks
  router.get("/info/:hash", requireAuth, async (req, res) => {
    try {
      const hash = streamer.normHash(req.params.hash);
      const torrent = await streamer.listFiles(hash);
      const picked = streamer.pickFile(torrent, req.query);
      if (!picked) return res.json({ success: false, error: "Episode not found in this torrent" });
      const info = await streamer.probe(hash, picked.index);
      streamer.rememberPick(req.query, hash, picked.index);
      streamer.touch(hash);
      res.json({
        success: true,
        hash,
        index: picked.index,
        name: path.basename(picked.f.name),
        size: picked.f.length,
        token: signToken(String(req.user._id), hash),
        mediaBase: mediaBase(req),
        local: !!streamer.localFile(hash, picked.index),
        ...streamer.describe(info, picked.f.name),
      });
    } catch (e) {
      res.json({ success: false, error: e.message || "Could not load torrent" });
    }
  });

  router.get("/play/:hash/:index", allowMedia, async (req, res) => {
    try {
      const hash = streamer.normHash(req.params.hash);
      const index = +req.params.index;
      const file = await streamer.openFile(hash, index, { keep: true });
      if (!file) return res.sendStatus(404);
      const info = await streamer.probe(hash, index);
      const d = streamer.describe(info, file.name);
      const sync = parseInt(req.query.sync, 10) || 0;
      if (d.direct && !sync && req.query.mode !== "transcode") return streamer.sendRange(req, res, file);
      await streamer.transcode(req, res, {
        hash,
        index,
        info,
        t: Math.max(0, parseFloat(req.query.t) || 0),
        audio: parseInt(req.query.audio, 10) || 0,
        sub: req.query.sub === undefined || req.query.sub === "" ? -1 : parseInt(req.query.sub, 10),
        sid: String(req.query.sid || req.sessionID || "default").slice(0, 64),
        sync,
      });
    } catch (e) {
      if (!res.headersSent) res.sendStatus(500);
    }
  });

  // WebVTT extracted so far for a transcoding session (the player polls this)
  router.get("/subs/:sid", requireAuth, (req, res) => {
    const s = streamer.sessions[req.params.sid];
    res.json({ vtt: s ? s.subs : "", offset: s ? s.offset : 0, requested: s ? s.requested : 0, done: s ? s.done : true });
  });

  // the torrent + file that played this title/episode before, if it's still fully on disk
  router.get("/recall", requireAuth, (req, res) => {
    const pick = streamer.recalledPick(req.query);
    res.json(pick ? { success: true, hash: pick.hash, index: pick.index, complete: pick.complete } : { success: false });
  });

  // ---- downloads page ----
  router.get("/downloads", requireAuth, (req, res) => res.json({ success: true, ...streamer.listDownloads() }));
  router.delete("/downloads", requireAuth, (req, res) =>
    res.json({
      success: req.query.key
        ? streamer.removeDownload(String(req.query.key))
        : streamer.removeTorrent({ hash: req.query.hash, name: req.query.name && String(req.query.name) }),
    })
  );
  router.post("/downloads/cleanup", requireAuth, (req, res) => res.json({ success: true, freed: streamer.cleanupLoose() }));

  // warm up (or, with full=1, fully download) the best of a few candidate torrents for an
  // episode the user is about to watch; answers immediately, the work continues in the background
  router.get("/prepare", requireAuth, (req, res) => {
    const hashes = String(req.query.hashes || "").split(",").map(streamer.normHash).filter((h) => h.length === 40);
    if (!hashes.length || !req.query.key) return res.json({ success: false });
    streamer.prepare(hashes, req.query, { full: req.query.full === "1" }).catch(() => {});
    res.json({ success: true });
  });

  // connect to several candidate torrents at once and rank them by live swarm health
  // (index sites' seed counts are often stale)
  router.get("/race", requireAuth, async (req, res) => {
    const hashes = String(req.query.hashes || "")
      .split(",")
      .map(streamer.normHash)
      .filter((h) => h.length === 40)
      .slice(0, 4);
    const wait = Math.min(parseInt(req.query.wait, 10) || 9000, 20000);
    // a candidate whose file for this episode is already fully on disk wins without waiting on the swarm
    const onDisk = async (h) => {
      if (!streamer.cachedState(h).cached) return false;
      const picked = streamer.pickFile(await streamer.listFiles(h), req.query);
      return !!(picked && streamer.localFile(h, picked.index));
    };
    const local = await Promise.all(hashes.map((h) => onDisk(h).catch(() => false)));
    if (local.some(Boolean))
      return res.json({ success: true, stats: hashes.map((hash, i) => ({ hash, ...streamer.engineStats(hash), onDisk: local[i] })) });
    hashes.forEach((h) => streamer.getTorrent(h).catch(() => {}));
    // stop early once the preferred candidate (or any) is clearly healthy
    const until = Date.now() + wait;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 500));
      const peers = hashes.map((h) => streamer.engineStats(h).peers);
      if (peers[0] >= 5) break;
    }
    const stats = hashes.map((hash) => {
      const e = streamer.engineStats(hash);
      return { hash, ...e, onDisk: false };
    });
    res.json({ success: true, stats });
  });

  // download progress for the loading screen
  router.get("/status/:hash", requireAuth, async (req, res) => {
    try {
      // playing from disk: don't spin up a torrent engine just to report swarm stats
      if (streamer.cachedState(req.params.hash).cached && !streamer.engineStats(req.params.hash).ready)
        return res.json({ ready: true, local: true, peers: 0, speed: 0, downloaded: 0 });
      const engine = await Promise.race([
        streamer.getTorrent(req.params.hash),
        new Promise((r) => setTimeout(() => r(null), 50)),
      ]);
      if (!engine) return res.json({ ready: false });
      const swarm = engine.swarm;
      res.json({
        ready: true,
        peers: swarm.wires.length,
        speed: swarm.downloadSpeed(),
        downloaded: swarm.downloaded,
      });
    } catch (e) {
      res.json({ ready: false, error: e.message });
    }
  });

  return router;
})();
