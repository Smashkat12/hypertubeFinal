// Torrent streaming + on-the-fly transcoding.
//
// A torrent is identified by its info hash. For each one we keep a single
// torrent-stream engine; files are read on demand so only the pieces around
// the play position are downloaded. Browsers can't play most anime/TV releases
// (MKV, HEVC/AV1, 10-bit, ASS subs), so those go through ffmpeg:
//   raw (byte ranges, loopback only) -> ffmpeg -> fragmented MP4 to the browser
// with subtitles extracted to WebVTT by the same ffmpeg process.
const fs = require("fs");
const path = require("path");
const { spawn, execFile, execFileSync } = require("child_process");
const torrentStream = require("torrent-stream");

const os = require("os");

// Prefer an ffmpeg build with NVIDIA NVENC/CUDA if one is installed (FFMPEG_DIR or ~/.local/ffmpeg-nvenc)
const FF_DIR = process.env.FFMPEG_DIR || path.join(os.homedir(), ".local", "ffmpeg-nvenc", "bin");
const FFMPEG = fs.existsSync(path.join(FF_DIR, "ffmpeg")) ? path.join(FF_DIR, "ffmpeg") : "ffmpeg";
const FFPROBE = fs.existsSync(path.join(FF_DIR, "ffprobe")) ? path.join(FF_DIR, "ffprobe") : "ffprobe";
let gpu = false;
execFile(
  FFMPEG,
  ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=256x144:rate=24", "-t", "0.2", "-c:v", "h264_nvenc", "-f", "null", "-"],
  { timeout: 15000 },
  (err) => {
    gpu = !err && process.env.HYPERTUBE_NO_GPU !== "1";
    console.log(`Transcoding with ${gpu ? "NVIDIA GPU (h264_nvenc)" : "CPU (libx264)"} via ${FFMPEG}`);
  }
);

// downloads live on the big USB drive when TORRENT_DIR is set (see start.sh)
const TORRENT_DIR = process.env.TORRENT_DIR || path.join(__dirname, "..", "torrents");
const CACHE_LIMIT = (parseInt(process.env.TORRENT_CACHE_GB) || 30) * 1024 ** 3;
const ENGINE_IDLE_MS = 30 * 60 * 1000;
const PORT = process.env.PORT || 5000;

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://open.dstud.io:6969/announce",
  "http://nyaa.tracker.wf:7777/announce",
];

const VIDEO_EXT = [".mp4", ".mkv", ".webm", ".avi", ".m4v", ".mov", ".ts"];
const MIME = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm" };

const engines = {}; // hash -> { engine, ready: Promise, lastUsed }

const normHash = (hash) => String(hash || "").toLowerCase().replace(/[^a-f0-9]/g, "");

// ---- local library ----
// Torrent metadata lives next to the downloads (not /tmp) so a torrent we've seen before opens
// without asking peers for it. library.json remembers each torrent's file list, which files are
// fully downloaded (those play straight from disk, no engine/peers/re-hashing), and which
// torrent + file played a given title/episode so a rewatch skips the source search entirely.
const META_DIR = path.join(TORRENT_DIR, ".meta");

// Torrent and file names come from strangers: resolve them strictly inside TORRENT_DIR (never
// TORRENT_DIR itself, .meta, or anything above it) before reading or deleting. null if unsafe.
const inTorrentDir = (rel) => {
  const root = path.resolve(TORRENT_DIR);
  const target = path.resolve(root, String(rel || ""));
  if (!target.startsWith(root + path.sep)) return null;
  if (path.relative(root, target).split(path.sep)[0] === ".meta") return null;
  return target;
};
const removePath = (rel, recursive = true) => {
  const target = inTorrentDir(rel);
  if (target) fs.rmSync(target, { recursive, force: true });
};
const LIBRARY_FILE = path.join(META_DIR, "library.json");
fs.mkdirSync(META_DIR, { recursive: true });
let library = { torrents: {}, picks: {} };
try {
  library = { torrents: {}, picks: {}, ...JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8")) };
} catch (e) {}
let saveTimer = null;
const saveLibrary = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(LIBRARY_FILE + ".tmp", JSON.stringify(library), (err) => {
      if (!err) fs.rename(LIBRARY_FILE + ".tmp", LIBRARY_FILE, () => {});
    });
  }, 1000);
};

const recordTorrent = (hash, engine) => {
  const t = library.torrents[hash] || { complete: [] };
  t.name = engine.torrent.name;
  t.files = engine.files.map((f) => ({ name: f.name, path: f.path, length: f.length }));
  library.torrents[hash] = t;
  saveLibrary();
};

// mark files whose pieces are all verified on disk
const checkComplete = (hash, engine) => {
  const t = library.torrents[hash];
  if (!t || !engine.torrent) return;
  const pl = engine.torrent.pieceLength;
  let changed = false;
  engine.files.forEach((f, i) => {
    if (t.complete.includes(i) || !f.length) return;
    const first = Math.floor(f.offset / pl);
    const last = Math.floor((f.offset + f.length - 1) / pl);
    for (let p = first; p <= last; p++) if (!engine.bitfield.get(p)) return;
    t.complete.push(i);
    changed = true;
    console.log(`Downloaded: ${f.name}`);
  });
  if (changed && t.want) t.want = t.want.filter((i) => !t.complete.includes(i));
  if (changed) saveLibrary();
};

// a fully downloaded file, readable without the torrent engine
const localFile = (rawHash, index) => {
  const t = library.torrents[normHash(rawHash)];
  if (!t || !t.files || !t.complete.includes(+index)) return null;
  const f = t.files[+index];
  const p = inTorrentDir(f.path);
  if (!p) return null;
  try {
    if (fs.statSync(p).size !== f.length) throw new Error("size mismatch");
  } catch (e) {
    t.complete = t.complete.filter((i) => i !== +index);
    saveLibrary();
    return null;
  }
  return { name: f.name, path: f.path, length: f.length, local: true, createReadStream: (o) => fs.createReadStream(p, o) };
};

// the file list, from the library when known (no engine needed) or from the engine
const listFiles = async (rawHash) => {
  const t = library.torrents[normHash(rawHash)];
  if (t && t.files) return { files: t.files };
  return getTorrent(rawHash);
};

// one file to read: from disk when complete, otherwise through the engine. `keep` (actual
// playback, not probing) also queues the whole file for download.
const openFile = async (rawHash, index, { keep = false } = {}) => {
  const local = localFile(rawHash, index);
  if (local) return local;
  const engine = await getTorrent(rawHash);
  const file = engine.files[+index];
  if (file && keep) want(normHash(rawHash), engine, +index);
  return file;
};

// Download the whole file in the background (reads still get priority for the pieces being
// played), so after a first watch the episode is on disk and later plays need no peers.
const want = (hash, engine, index) => {
  const t = library.torrents[hash];
  if (!t || t.complete.includes(index)) return;
  t.want = Array.from(new Set([...(t.want || []), index]));
  engine.files[index].select();
  saveLibrary();
};
const pendingWants = (hash) => {
  const t = library.torrents[hash];
  return t ? (t.want || []).filter((i) => !t.complete.includes(i)) : [];
};

// how much of a torrent we already have (for ranking sources)
const cachedState = (rawHash) => {
  const t = library.torrents[normHash(rawHash)];
  return t ? { cached: true, completeFiles: t.complete.length } : { cached: false, completeFiles: 0 };
};

// q.key identifies what's being watched ("kind:id:season:episode"), sent by the player
const rememberPick = (q, hash, index) => {
  if (!q.key) return;
  library.picks[String(q.key).slice(0, 200)] = { hash, index, at: Date.now() };
  saveLibrary();
};
// the torrent/file that played this title/episode before, if its file is still on disk
// the torrent/file that played (or was prefetched for) this title/episode: fully on disk, or
// still downloading in the background
const recalledPick = (q) => {
  const p = q.key && library.picks[String(q.key).slice(0, 200)];
  if (!p) return null;
  if (localFile(p.hash, p.index)) return { ...p, complete: true };
  // still downloading, or warmed up recently (engine connected, probe cached)
  return pendingWants(p.hash).includes(p.index) || engines[p.hash] ? { ...p, complete: false } : null;
};

const getTorrent = (rawHash) => {
  const hash = normHash(rawHash);
  if (hash.length !== 40) return Promise.reject(new Error("invalid info hash"));
  let entry = engines[hash];
  if (!entry) {
    pruneCache();
    const magnet = `magnet:?xt=urn:btih:${hash}`;
    const engine = torrentStream(magnet, { path: TORRENT_DIR, tmp: META_DIR, trackers: TRACKERS });
    entry = engines[hash] = { engine, lastUsed: Date.now() };
    entry.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no peers found for this torrent")), 90000);
      engine.on("ready", () => {
        clearTimeout(timer);
        engine.files.forEach((f) => f.deselect());
        recordTorrent(hash, engine);
        checkComplete(hash, engine);
        resolve(engine);
      });
    });
    entry.ready.catch(() => destroyEngine(hash));
    let pending = null;
    engine.on("download", () => {
      if (!pending) pending = setTimeout(() => ((pending = null), checkComplete(hash, engine)), 5000);
    });
  }
  entry.lastUsed = Date.now();
  return entry.ready;
};

const destroyEngine = (hash) => {
  const entry = engines[hash];
  if (!entry) return;
  delete engines[hash];
  try {
    checkComplete(hash, entry.engine);
    entry.engine.destroy();
  } catch (e) {}
};

setInterval(() => {
  const now = Date.now();
  Object.keys(engines).forEach((hash) => {
    const idle = now - engines[hash].lastUsed;
    if (idle > (pendingWants(hash).length ? 24 * 3600 * 1000 : ENGINE_IDLE_MS)) destroyEngine(hash);
  });
}, 60000).unref();

// keep the download folder under CACHE_LIMIT by deleting the oldest unused torrents
const dirSize = (p) => {
  let total = 0;
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    fs.readdirSync(p).forEach((f) => (total += dirSize(path.join(p, f))));
  } catch (e) {}
  return total;
};
const pruneCache = () => {
  try {
    const active = new Set(
      Object.values(engines)
        .filter((e) => e.engine.torrent)
        .map((e) => e.engine.torrent.name)
    );
    const entries = fs
      .readdirSync(TORRENT_DIR)
      .filter((n) => !n.startsWith("."))
      .map((n) => {
        const p = path.join(TORRENT_DIR, n);
        return { n, p, size: dirSize(p), mtime: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);
    let total = entries.reduce((s, e) => s + e.size, 0);
    for (const e of entries) {
      if (total <= CACHE_LIMIT) break;
      if (active.has(e.n)) continue;
      if (Object.entries(library.torrents).some(([h, t]) => t.name === e.n && pendingWants(h).length)) continue;
      removePath(e.n);
      total -= e.size;
      Object.values(library.torrents).forEach((t) => {
        if (t.name === e.n) t.complete = [];
      });
      saveLibrary();
    }
  } catch (e) {}
};

// pick the video file: an explicit index, a file matching the episode number, or the largest video
const episodeRegexes = (ep) => {
  const n = parseInt(ep, 10);
  const p2 = String(n).padStart(2, "0");
  return [
    new RegExp(`[Ee](?:p(?:isode)?)?\\s?0*${n}(?!\\d)`),
    new RegExp(`\\s-\\s0*${n}(?:v\\d)?(?!\\d)`),
    new RegExp(`[\\s_\\[(.]${p2}(?:v\\d)?[\\s_\\])\\.]`),
  ];
};
const pickFile = (engine, { file, episode, season } = {}) => {
  const videos = engine.files
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => VIDEO_EXT.includes(path.extname(f.name).toLowerCase()))
    .filter(({ f }) => !/sample|trailer|\bNCOP|\bNCED|creditless/i.test(f.name));
  if (!videos.length) return null;
  if (file !== undefined && file !== "" && engine.files[file]) return { f: engine.files[file], index: +file };
  if (episode) {
    const n = parseInt(episode, 10);
    if (season) {
      const s = parseInt(season, 10);
      const se = new RegExp(`S0*${s}[ ._-]?E0*${n}(?!\\d)|\\b${s}x0*${n}(?!\\d)`, "i");
      const hit = videos.find(({ f }) => se.test(f.name));
      if (hit) return hit;
    }
    for (const re of episodeRegexes(n)) {
      const hits = videos.filter(({ f }) => re.test(f.name));
      if (hits.length) return hits.sort((a, b) => b.f.length - a.f.length)[0];
    }
    if (videos.length > 1) return null; // batch without that episode
  }
  return videos.sort((a, b) => b.f.length - a.f.length)[0];
};

// ---- raw byte-range stream (used by the browser for plain MP4, and by ffmpeg) ----
const sendRange = (req, res, file) => {
  const total = file.length;
  const type = MIME[path.extname(file.name).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  let start = 0;
  let end = total - 1;
  if (range) {
    const [s, e] = range.replace(/bytes=/, "").split("-");
    start = parseInt(s, 10) || 0;
    end = e ? Math.min(parseInt(e, 10), total - 1) : total - 1;
    if (start >= total) {
      res.writeHead(416, { "Content-Range": `bytes */${total}` });
      return res.end();
    }
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Type": type,
      "Content-Length": end - start + 1,
    });
  } else {
    res.writeHead(200, { "Accept-Ranges": "bytes", "Content-Type": type, "Content-Length": total });
  }
  if (req.method === "HEAD") return res.end();
  const stream = file.createReadStream({ start, end });
  stream.pipe(res);
  res.on("close", () => stream.destroy());
};

const rawUrl = (hash, index) => `http://127.0.0.1:${PORT}/stream/raw/${hash}/${index}`;

// ---- probing ----
const probes = {};
const probe = (hash, index) => {
  const key = `${hash}/${index}`;
  if (!probes[key]) {
    probes[key] = new Promise((resolve, reject) => {
      execFile(
        FFPROBE,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", rawUrl(hash, index)],
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout) => {
          if (err) return reject(err);
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(e);
          }
        }
      );
    });
    probes[key].catch(() => delete probes[key]);
  }
  return probes[key];
};

const TEXT_SUBS = ["ass", "ssa", "subrip", "srt", "webvtt", "mov_text", "text"];
const lang = (s) => ((s.tags && (s.tags.language || s.tags.LANGUAGE)) || "und").toLowerCase();
const title = (s) => (s.tags && (s.tags.title || s.tags.TITLE)) || "";

const describe = (info, fileName) => {
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === "video" && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.filter((s) => s.codec_type === "audio");
  const subs = streams.filter((s) => s.codec_type === "subtitle");
  const ext = path.extname(fileName).toLowerCase();
  const directVideo = video && video.codec_name === "h264" && (video.pix_fmt || "yuv420p") === "yuv420p";
  const directAudio = audio.length <= 1 && (!audio[0] || ["aac", "mp3"].includes(audio[0].codec_name));
  return {
    duration: parseFloat((info.format && info.format.duration) || 0),
    video: video ? { codec: video.codec_name, width: video.width, height: video.height, pix_fmt: video.pix_fmt } : null,
    // plain browser-friendly MP4s can be streamed as-is with native seeking
    direct: [".mp4", ".m4v"].includes(ext) && directVideo && directAudio,
    audio: audio.map((s, i) => ({ index: i, language: lang(s), title: title(s), codec: s.codec_name, channels: s.channels })),
    subtitles: subs.map((s, i) => ({
      index: i,
      language: lang(s),
      title: title(s),
      codec: s.codec_name,
      text: TEXT_SUBS.includes(s.codec_name),
      forced: !!(s.disposition && s.disposition.forced),
    })),
  };
};

// ---- transcoding sessions ----
const sessions = {}; // sid -> { proc, subs, startedAt, offset, done }
const killSession = (sid) => {
  const s = sessions[sid];
  if (s && s.proc && !s.done) {
    try {
      s.proc.kill("SIGKILL");
    } catch (e) {}
  }
  if (s && s.hls) fs.rm(s.hls.dir, { recursive: true, force: true }, () => {});
};
setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach((sid) => {
    if (now - sessions[sid].touched > (sessions[sid].hls ? 2 * 60 * 1000 : 60 * 60 * 1000)) {
      killSession(sid);
      delete sessions[sid];
    }
  });
}, 60000).unref();

// the keyframe a seek to t actually lands on (the demuxer seeks backwards to one)
const keyframeAt = (hash, index, t) =>
  new Promise((resolve) => {
    execFile(
      FFPROBE,
      ["-v", "error", "-read_intervals", `${t}%+#1`, "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", rawUrl(hash, index)],
      { timeout: 20000 },
      (err, stdout) => {
        const k = parseFloat(String(stdout || "").trim().split("\n")[0]);
        resolve(!err && isFinite(k) && k <= t + 0.5 && k >= t - 30 ? k : t);
      }
    );
  });

const HLS_ROOT = path.join(os.tmpdir(), "hypertube-hls");
const safeSid = (sid) => String(sid || "").replace(/[^a-z0-9]/gi, "").slice(0, 64) || "default";

// `hls`: write 4s MPEG-TS chunks + an event playlist to a per-session folder instead of one
// fragmented-MP4 response. iOS Safari can't play an endless MP4 without byte ranges, but plays
// HLS natively (and it copes better with mobile networks).
const transcode = async (req, res, { hash, index, info, t, audio, sub, sid, sync = 0, hls = null }) => {
  const d = describe(info, "x.mkv");
  const v = d.video || {};
  const copyVideo = v.codec === "h264" && (v.pix_fmt || "yuv420p") === "yuv420p" && (v.height || 0) <= 1080;
  // When video is stream-copied it can only start on a keyframe, while re-encoded audio would
  // start exactly at t, leaving them out of sync. Start both at that keyframe instead and
  // report the real start so the player's clock and subtitles line up.
  const requested = t;
  if (t > 0 && copyVideo) t = await keyframeAt(hash, index, t);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  // GPU decode where the card supports the codec (falls back to software decode otherwise)
  if (gpu && !copyVideo) args.push("-hwaccel", "cuda");
  if (t > 0) args.push("-ss", t.toFixed(3));
  args.push("-i", rawUrl(hash, index), "-map", "0:v:0");
  if (d.audio.length) args.push("-map", `0:a:${Math.min(audio, d.audio.length - 1)}`);
  if (copyVideo) args.push("-c:v", "copy");
  else {
    const vf = ["format=yuv420p"];
    if ((v.height || 0) > 1080) vf.unshift("scale=-2:1080");
    args.push("-vf", vf.join(","));
    // no B-frames: otherwise the muxer starts video a couple of frames after the audio
    if (gpu) args.push("-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "23", "-b:v", "0", "-maxrate", "10M", "-bufsize", "20M");
    else args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "21");
    args.push("-g", "48", "-bf", "0");
  }
  // A copied H.264 stream with B-frames starts presenting `has_b_frames` frames after its
  // decode start, and the MP4 muxer shifts video (not audio) by that much. Delay the audio
  // by the same amount so lips and voices line up.
  //
  // The AAC encoder adds 1024 priming samples (21.3 ms at 48 kHz) that browsers play because a
  // fragmented stream carries no edit list, so take that back off. Measured by cross-correlating
  // output audio with the source. Plus the viewer's own adjustment (`sync`, ms, positive =
  // audio later) for releases that were muxed out of sync to begin with.
  let delayMs = -21 + Math.max(-3000, Math.min(3000, Math.round(sync) || 0));
  if (copyVideo) {
    const vs = (info.streams || []).find((x) => x.codec_type === "video" && !(x.disposition && x.disposition.attached_pic)) || {};
    const [num, den] = String(vs.avg_frame_rate || vs.r_frame_rate || "24/1").split("/").map(Number);
    const fps = num && den ? num / den : 24;
    const reorder = Math.round(((vs.has_b_frames || 0) / fps) * 1000);
    if (reorder > 0 && reorder < 500) delayMs += reorder;
  }
  // (no aresample=async here: it silently stretches the audio back and undoes the delay)
  const audioFilter =
    delayMs > 0 ? `adelay=${delayMs}:all=1` : delayMs < 0 ? `atrim=start=${(-delayMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS` : "anull";
  args.push("-c:a", "aac", "-ac", "2", "-b:a", "192k", "-af", audioFilter);
  args.push("-avoid_negative_ts", "make_zero", "-muxdelay", "0");
  if (hls) {
    fs.rmSync(hls.dir, { recursive: true, force: true });
    fs.mkdirSync(hls.dir, { recursive: true });
    args.push("-f", "hls", "-hls_time", "4", "-hls_list_size", "0", "-hls_playlist_type", "event");
    args.push("-hls_flags", "independent_segments+temp_file", "-hls_segment_filename", path.join(hls.dir, "seg%05d.ts"));
    args.push(path.join(hls.dir, "index.m3u8"));
  } else {
    args.push("-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "2000000", "pipe:1");
  }
  const subStream = sub >= 0 ? d.subtitles[sub] : null;
  if (subStream && subStream.text) {
    args.push("-map", `0:s:${sub}`, "-c:s", "webvtt", "-f", "webvtt", "-flush_packets", "1", "pipe:3");
  }

  killSession(sid);
  const proc = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe", "pipe"] });
  const session = (sessions[sid] = { proc, subs: "", offset: t, requested, touched: Date.now(), done: false, hls });
  proc.stdio[3].on("data", (chunk) => (session.subs += chunk.toString()));
  let errText = "";
  proc.stderr.on("data", (c) => (errText = (errText + c.toString()).slice(-2000)));
  proc.on("close", (code) => {
    session.done = true;
    if (code && code !== 255 && errText) console.log(`ffmpeg[${sid}] exited ${code}: ${errText.trim()}`);
  });

  if (hls) return session;
  if (res.destroyed) return killSession(sid);
  res.writeHead(200, { "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Stream-Offset": t.toFixed(3) });
  proc.stdout.pipe(res);
  res.on("close", () => {
    // keep the process briefly so a quick reconnect doesn't lose subtitles already extracted
    proc.stdout.unpipe(res);
    killSession(sid);
  });
};

const engineStats = (rawHash) => {
  const entry = engines[normHash(rawHash)];
  if (!entry) return { ready: false, peers: 0, speed: 0 };
  const e = entry.engine;
  return {
    ready: !!e.torrent,
    peers: e.swarm ? e.swarm.wires.length : 0,
    speed: e.swarm ? e.swarm.downloadSpeed() : 0,
  };
};

// Get a torrent ready to play before the user presses Play: connect, choose the file, pull the
// first pieces and probe it (cached), so /info answers instantly. With full=true the whole file
// downloads too (next-episode prefetch). Candidates are tried in order; the first whose metadata
// arrives and contains the episode wins. Remembered under q.key so the player recalls it.
const preparing = {};
const prepare = (hashes, q, { full = false } = {}) => {
  const id = `${q.key || hashes.join(",")}:${full}`;
  if (preparing[id]) return preparing[id];
  const run = (async () => {
    const known = recalledPick(q);
    if (known) return known;
    // per-candidate file numbering (packs/absolute-numbered releases), aligned with hashes
    const fe = String(q.fileEpisodes || "").split(",");
    const fs_ = String(q.fileSeasons || "").split(",");
    for (const [i, raw] of hashes.slice(0, 3).entries()) {
      const hash = normHash(raw);
      const fq = { ...q, episode: fe[i] || q.episode, season: fs_[i] || q.season };
      try {
        const torrent = await Promise.race([
          listFiles(hash),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 45000)),
        ]);
        const picked = pickFile(torrent, fq);
        if (!picked) continue;
        await probe(hash, picked.index);
        rememberPick(q, hash, picked.index);
        if (full) {
          const engine = await getTorrent(hash);
          want(hash, engine, picked.index);
        }
        return { hash, index: picked.index };
      } catch (e) {}
    }
    return null;
  })();
  preparing[id] = run;
  run.finally(() => setTimeout(() => delete preparing[id], 60000));
  return run;
};

// ---- downloads management ----
const fileProgress = (hash, index) => {
  const t = library.torrents[hash];
  if (!t) return 0;
  if (t.complete.includes(index)) return 1;
  const entry = engines[hash];
  const e = entry && entry.engine;
  if (!e || !e.torrent) return (t.progress && t.progress[index]) || 0;
  const f = e.files[index];
  const pl = e.torrent.pieceLength;
  const first = Math.floor(f.offset / pl);
  const last = Math.floor((f.offset + f.length - 1) / pl);
  let have = 0;
  for (let p = first; p <= last; p++) if (e.bitfield.get(p)) have++;
  const pct = have / (last - first + 1);
  t.progress = { ...(t.progress || {}), [index]: pct };
  return pct;
};

// real (not sparse) bytes on disk; cached briefly since `du` blocks and the page polls
const duCache = {};
const onDiskBytes = (name) => {
  const hit = duCache[name];
  if (hit && Date.now() - hit.at < 30000) return hit.bytes;
  let bytes = 0;
  try {
    const target = name === "." ? TORRENT_DIR : inTorrentDir(name);
    if (target) bytes = parseInt(execFileSync("du", ["-sk", "--", target]).toString(), 10) * 1024 || 0;
  } catch (e) {}
  duCache[name] = { bytes, at: Date.now() };
  return bytes;
};

// everything the user has played/prefetched, plus loose torrents nothing points at
const listDownloads = () => {
  // warm-ups (first few MB fetched for a quick start) aren't downloads: list finished or queued files only
  const listed = Object.entries(library.picks).filter(([, p]) => {
    const t = library.torrents[p.hash];
    return t && (t.complete.includes(p.index) || pendingWants(p.hash).includes(p.index));
  });
  const items = listed.map(([key, p]) => {
    const t = library.torrents[p.hash] || {};
    const f = (t.files || [])[p.index] || {};
    const [kind, id, season, episode] = key.split(":");
    const pending = pendingWants(p.hash).includes(p.index);
    return {
      key, kind, id,
      season: season ? +season : null,
      episode: episode ? +episode : null,
      hash: p.hash, index: p.index,
      name: path.basename(f.name || t.name || ""),
      size: f.length || 0,
      progress: fileProgress(p.hash, p.index),
      complete: (t.complete || []).includes(p.index),
      downloading: pending && !!engines[p.hash],
      queued: pending,
      speed: pending && engines[p.hash] && engines[p.hash].engine.swarm ? engines[p.hash].engine.swarm.downloadSpeed() : 0,
      at: p.at,
    };
  });
  const used = new Set(listed.map(([, p]) => library.torrents[p.hash] && library.torrents[p.hash].name));
  let loose = [];
  try {
    loose = fs
      .readdirSync(TORRENT_DIR)
      .filter((n) => !n.startsWith(".") && !used.has(n))
      .map((n) => {
        const h = hashForName(n);
        const t = h && library.torrents[h];
        // finished files or a running download are worth keeping; the rest is leftover partial data
        const keep = !!(t && (t.complete.length || pendingWants(h).length));
        return { name: n, hash: h || null, bytes: onDiskBytes(n), keep };
      });
  } catch (e) {}
  return { items, loose, total: onDiskBytes("."), limit: CACHE_LIMIT };
};

const hashForName = (name) => Object.keys(library.torrents).find((h) => library.torrents[h].name === name);

// remove one downloaded file (and its torrent folder once nothing else in it is kept)
const removeDownload = (key) => {
  Object.keys(duCache).forEach((k) => delete duCache[k]);
  const p = library.picks[key];
  if (!p) return false;
  delete library.picks[key];
  const t = library.torrents[p.hash];
  // another title/episode key still points at this exact file: only forget this key
  if (Object.values(library.picks).some((x) => x.hash === p.hash && x.index === p.index)) {
    saveLibrary();
    return true;
  }
  if (t) {
    t.want = (t.want || []).filter((i) => i !== p.index);
    t.complete = t.complete.filter((i) => i !== p.index);
    const stillUsed = Object.values(library.picks).some((x) => x.hash === p.hash);
    if (!stillUsed) {
      destroyEngine(p.hash);
      if (t.name) removePath(t.name);
      delete library.torrents[p.hash];
    } else if (t.files && t.files[p.index]) {
      removePath(t.files[p.index].path, false);
    }
  }
  saveLibrary();
  return true;
};

// remove a whole torrent (by hash or folder name): engine, data, library entry and its picks
const removeTorrent = ({ hash, name }) => {
  Object.keys(duCache).forEach((k) => delete duCache[k]);
  const h = hash ? normHash(hash) : hashForName(name);
  const t = h && library.torrents[h];
  const folder = (t && t.name) || name;
  if (h) {
    destroyEngine(h);
    delete library.torrents[h];
    Object.keys(library.picks).forEach((k) => library.picks[k].hash === h && delete library.picks[k]);
  }
  if (folder) removePath(folder);
  saveLibrary();
  return !!(h || folder);
};

// delete every torrent folder no download points at (abandoned candidates, partial copies)
const cleanupLoose = () => {
  Object.keys(duCache).forEach((k) => delete duCache[k]);
  const { loose } = listDownloads();
  let freed = 0;
  loose.forEach(({ name, bytes, keep }) => {
    if (keep) return;
    const h = hashForName(name);
    if (h && engines[h] && Date.now() - engines[h].lastUsed < 5 * 60000) return; // in use right now
    if (h) {
      destroyEngine(h);
      delete library.torrents[h];
    }
    removePath(name);
    freed += bytes;
  });
  saveLibrary();
  return freed;
};

// after a restart, resume background downloads that hadn't finished
setTimeout(() => {
  Object.keys(library.torrents).forEach((hash, n) => {
    if (!pendingWants(hash).length) return;
    setTimeout(() => {
      getTorrent(hash)
        .then((engine) => pendingWants(hash).forEach((i) => engine.files[i] && engine.files[i].select()))
        .catch(() => {});
    }, n * 2000);
  });
}, 10000).unref();

// bump a torrent's folder so cache pruning (oldest first) keeps what's being watched
const touch = (rawHash) => {
  const t = library.torrents[normHash(rawHash)];
  if (!t || !t.name) return;
  const now = new Date();
  const target = inTorrentDir(t.name);
  if (target) fs.utimes(target, now, now, () => {});
};

module.exports = {
  localFile,
  listFiles,
  openFile,
  cachedState,
  rememberPick,
  recalledPick,
  prepare,
  listDownloads,
  removeDownload,
  removeTorrent,
  cleanupLoose,
  touch,
  engineStats,
  normHash,
  getTorrent,
  pickFile,
  sendRange,
  probe,
  describe,
  transcode,
  sessions,
  HLS_ROOT,
  safeSid,
  TORRENT_DIR,
};
