const express = require("express");
const path = require("path");
const streamer = require("../services/streamer");
const subtitles = require("../services/subtitles");

const crypto = require("crypto");
const fs = require("fs");
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
      const saver = req.query.q === "saver";
      if (d.direct && !sync && !saver && req.query.mode !== "transcode") return streamer.sendRange(req, res, file);
      await streamer.transcode(req, res, {
        hash,
        index,
        info,
        t: Math.max(0, parseFloat(req.query.t) || 0),
        audio: parseInt(req.query.audio, 10) || 0,
        sub: req.query.sub === undefined || req.query.sub === "" ? -1 : parseInt(req.query.sub, 10),
        sid: String(req.query.sid || req.sessionID || "default").slice(0, 64),
        sync,
        saver,
      });
    } catch (e) {
      if (!res.headersSent) res.sendStatus(500);
    }
  });

  // ---- HLS (iPhone/iPad/Safari): playlist starts or reuses a transcode session; chunks follow ----
  const hlsParams = (req) => ({
    t: Math.max(0, parseFloat(req.query.t) || 0),
    audio: parseInt(req.query.audio, 10) || 0,
    sub: req.query.sub === undefined || req.query.sub === "" ? -1 : parseInt(req.query.sub, 10),
    sync: parseInt(req.query.sync, 10) || 0,
    saver: req.query.q === "saver",
  });
  // The playlist lists every chunk up front as a finished video (VOD). An "event" playlist that
  // grew as chunks were made let iOS treat it as live and jump to the newest chunk whenever it
  // re-read it, skipping minutes at a time. Chunks are exactly HLS_SEG seconds (forced keyframes).
  const SEG = streamer.HLS_SEG;
  const segPath = (session, n) => path.join(session.hls.dir, `seg${String(n).padStart(5, "0")}.ts`);
  router.get("/hls/:hash/:index/index.m3u8", allowMedia, async (req, res) => {
    try {
      const hash = streamer.normHash(req.params.hash);
      const index = +req.params.index;
      const sid = streamer.safeSid(req.query.sid);
      const p = hlsParams(req);
      const key = JSON.stringify([hash, index, p]);
      let session = streamer.sessions[sid];
      if (!session || !session.hls || session.hls.key !== key) {
        const file = await streamer.openFile(hash, index, { keep: true });
        if (!file) return res.sendStatus(404);
        const info = await streamer.probe(hash, index);
        const duration = parseFloat((info.format && info.format.duration) || 0);
        if (!duration) return res.sendStatus(500);
        const dir = path.join(streamer.HLS_ROOT, sid);
        const hls = { dir, key, start: 0, base: p.t, duration, args: { hash, index, info, ...p, sid } };
        session = await streamer.transcode(req, res, { ...hls.args, hls });
      }
      session.touched = Date.now();
      // answer once the first chunk exists, so playback can start right away
      for (let i = 0; i < 120 && !fs.existsSync(segPath(session, session.hls.start)) && !session.done; i++)
        await new Promise((r) => setTimeout(r, 250));
      const qs = `sid=${sid}&token=${encodeURIComponent(req.query.token || "")}`;
      const total = Math.max(0.1, session.hls.duration - session.hls.base);
      const count = Math.ceil(total / SEG);
      const lines = ["#EXTM3U", "#EXT-X-VERSION:6", `#EXT-X-TARGETDURATION:${SEG}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS"];
      for (let n = 0; n < count; n++) {
        lines.push(`#EXTINF:${Math.min(SEG, total - n * SEG).toFixed(3)},`, `seg${String(n).padStart(5, "0")}.ts?${qs}`);
      }
      lines.push("#EXT-X-ENDLIST", "");
      res.set({ "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store", "X-Stream-Offset": session.hls.base.toFixed(3) });
      res.send(lines.join("\n"));
    } catch (e) {
      if (!res.headersSent) res.sendStatus(500);
    }
  });
  // newest chunk the current encoder run has finished
  const newestChunk = (session) => {
    let newest = session.hls.start - 1;
    try {
      fs.readdirSync(session.hls.dir).forEach((f) => {
        const m = /^seg(\d{5})\.ts$/.exec(f);
        if (m && +m[1] >= session.hls.start && +m[1] > newest) newest = +m[1];
      });
    } catch (e) {}
    return newest;
  };
  router.get("/hls/:hash/:index/:seg", allowMedia, async (req, res) => {
    const sid = streamer.safeSid(req.query.sid);
    let session = streamer.sessions[sid];
    const m = /^seg(\d{5})\.ts$/.exec(req.params.seg);
    if (!session || !session.hls || !m) return res.sendStatus(404);
    const n = +m[1];
    const file = () => segPath(streamer.sessions[sid] || session, n);
    session.touched = Date.now();
    if (!fs.existsSync(file())) {
      // a jump outside what the encoder will reach soon: restart it at that chunk
      const newest = newestChunk(session);
      if (n < session.hls.start || n > newest + 8 || (session.done && n > newest)) {
        if (n * SEG >= session.hls.duration - session.hls.base) return res.sendStatus(404);
        const hls = { ...session.hls, start: n };
        session = await streamer.transcode(req, res, { ...hls.args, t: hls.base + n * SEG, hls });
      }
      for (let i = 0; i < 160 && !fs.existsSync(file()); i++) {
        const s = streamer.sessions[sid];
        if (!s || (s.done && !fs.existsSync(file()))) break;
        s.touched = Date.now();
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!fs.existsSync(file())) return res.sendStatus(404);
    }
    res.set({ "Content-Type": "video/mp2t", "Cache-Control": "no-store" });
    res.sendFile(file(), (err) => err && !res.headersSent && res.sendStatus(404));
  });

  // WebVTT extracted so far for a transcoding session (the player polls this)
  router.get("/subs/:sid", requireAuth, (req, res) => {
    const s = streamer.sessions[req.params.sid];
    res.json({ vtt: s ? s.subs : "", offset: s ? s.offset : 0, requested: s ? s.requested : 0, done: s ? s.done : true });
  });

  // downloadable subtitles (OpenSubtitles) for files without built-in ones
  router.get("/extsubs", requireAuth, async (req, res) => {
    try {
      const { imdb, season, episode, name } = req.query;
      res.json({ success: true, subtitles: await subtitles.list({ imdb, season, episode, name }) });
    } catch (e) {
      res.json({ success: false, subtitles: [], error: e.message });
    }
  });
  router.get("/extsub/:id", requireAuth, async (req, res) => {
    try {
      res.type("text/vtt").send(await subtitles.get(req.params.id));
    } catch (e) {
      res.sendStatus(404);
    }
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
  // check followed shows for new episodes now (it also runs every few hours by itself)
  router.post("/downloads/check", requireAuth, async (req, res) => {
    const started = await require("../services/autoDownload").run();
    res.json({ success: true, started: started || 0 });
  });
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
