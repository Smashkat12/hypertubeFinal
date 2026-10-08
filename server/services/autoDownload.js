// Auto-download for followed shows: every few hours, for each series/anime in someone's
// My List or Continue Watching, download (in full, in the background) episodes released in the
// last couple of weeks plus the next couple after where they stopped watching, so they play
// instantly. Uses the same source ranking + prepare path as next-episode prefetch.
const User = require("../models/user");
const Movie = require("../models/movie");
const catalog = require("./catalog");
const streamer = require("./streamer");

const RECENT_DAYS = 14;
const AHEAD = 2; // episodes after the viewer's current one
const PER_SHOW = 3;
const PER_RUN = 6;
const EVERY_MS = 3 * 3600 * 1000;
const DAY = 24 * 3600 * 1000;

const keyFor = (kind, id, season, episode) => [kind, id, kind === "series" ? season : "", episode].join(":");

// "kind:id" -> furthest { season, episode } anyone has reached (null = only in My List)
const followedTitles = async () => {
  const users = await User.find({}, { heartbeat: 1, inProgress: 1 }).lean();
  const docIds = new Set();
  users.forEach((u) => (u.heartbeat || []).forEach((h) => docIds.add(String(h.id))));
  const docs = await Movie.find({ _id: { $in: [...docIds] } }, { _ytsId: 1 }).lean();
  const titles = {};
  docs.forEach((d) => {
    if (/^(series|anime):/.test(d._ytsId || "")) titles[d._ytsId] = titles[d._ytsId] || null;
  });
  users.forEach((u) =>
    (u.inProgress || []).forEach((p) => {
      if (!/^(series|anime):/.test(p.ytsId || "") || !p.episode) return;
      const at = { season: p.season || 1, episode: p.episode };
      const cur = titles[p.ytsId];
      if (!cur || at.season > cur.season || (at.season === cur.season && at.episode > cur.episode)) titles[p.ytsId] = at;
    })
  );
  return titles;
};

// aired episodes worth having on disk for one title
const wantedEpisodes = async (kind, id, at) => {
  const now = Date.now();
  const picks = [];
  if (kind === "series") {
    const d = await catalog.seriesDetail(id);
    const eps = (d.seasons || []).flatMap((s) => s.episodes).filter((e) => e.aired);
    if (at) {
      const i = eps.findIndex((e) => e.season === at.season && e.number === at.episode);
      if (i >= 0) picks.push(...eps.slice(i + 1, i + 1 + AHEAD));
    }
    picks.push(...eps.filter((e) => e.airdate && now - new Date(e.airdate).getTime() < RECENT_DAYS * DAY).reverse());
    return picks.map((e) => ({ season: e.season, episode: e.number }));
  }
  const d = await catalog.animeDetail(id);
  const aired = (d.episodeList || []).filter((e) => e.aired).map((e) => e.number);
  if (at) picks.push(...aired.filter((n) => n > at.episode).slice(0, AHEAD));
  // airing weekly: the latest episodes came out roughly a week apart before the next one
  if (d.nextAiring && d.nextAiring.airingAt) {
    const next = d.nextAiring.episode;
    for (let n = next - 1, k = 1; n >= 1 && d.nextAiring.airingAt * 1000 - k * 7 * DAY > now - RECENT_DAYS * DAY; n--, k++) picks.push(n);
  }
  return picks.map((n) => ({ season: null, episode: n }));
};

const sourcesFor = async (kind, id, ep) =>
  kind === "series" ? catalog.seriesSources(id, ep.season, ep.episode) : catalog.animeSources(id, ep.episode);

let running = false;
const run = async () => {
  if (running) return;
  running = true;
  let started = 0;
  try {
    const titles = await followedTitles();
    for (const [title, at] of Object.entries(titles)) {
      if (started >= PER_RUN) break;
      const [kind, id] = title.split(":");
      const eps = await wantedEpisodes(kind, id, at).catch(() => []);
      const seen = new Set();
      let forShow = 0;
      for (const ep of eps) {
        if (started >= PER_RUN || forShow >= PER_SHOW) break;
        const key = keyFor(kind, id, ep.season, ep.episode);
        if (seen.has(key)) continue;
        seen.add(key);
        if (streamer.recalledPick({ key })) continue; // already on disk or downloading
        const sources = (await sourcesFor(kind, id, ep).catch(() => [])).slice(0, 3);
        if (!sources.length) continue;
        const q = {
          key,
          season: kind === "series" ? ep.season : undefined,
          episode: ep.episode,
          fileEpisodes: sources.map((s) => s.fileEpisode || "").join(","),
          fileSeasons: sources.map((s) => s.fileSeason || "").join(","),
        };
        const got = await streamer.prepare(sources.map((s) => s.hash), q, { full: true }).catch(() => null);
        if (got) {
          started++;
          forShow++;
          console.log(`Auto-download: ${key} -> ${got.hash.slice(0, 8)}`);
        }
      }
    }
  } catch (e) {
    console.log("Auto-download failed:", e.message);
  } finally {
    running = false;
  }
  return started;
};

const start = () => {
  setTimeout(run, 3 * 60 * 1000).unref();
  setInterval(run, EVERY_MS).unref();
};

module.exports = { start, run, followedTitles, wantedEpisodes };
