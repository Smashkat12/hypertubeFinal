// Unified catalogue for movies (YTS), series (TVMaze + EZTV/apibay) and anime (AniList + nyaa).
// Every list item has the same shape so the UI can mix them in rows:
//   { kind, id, title, year, poster, backdrop, rating (0-10), genres, overview }
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const YTS = process.env.YTS_API || "https://movies-api.accel.li/api/v2";
const TVMAZE = "https://api.tvmaze.com";
const ANILIST = "https://graphql.anilist.co";
const EZTV = "https://eztvx.to/api";
const APIBAY = "https://apibay.org";
const NYAA = "https://nyaa.si";

const http = axios.create({ timeout: 20000, headers: { "User-Agent": "hypertube/2.0" } });

// ---------- small TTL cache ----------
const cache = new Map();
const cached = async (key, ttlMs, fn) => {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = fn();
  cache.set(key, { value: pending, expires: Date.now() + ttlMs });
  try {
    return await pending;
  } catch (e) {
    cache.delete(key);
    throw e;
  }
};
const HOUR = 3600 * 1000;

const stripHtml = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

// ---------- movies (YTS) ----------
const ytsItem = (m) => ({
  kind: "movie",
  id: String(m.id),
  title: m.title_english || m.title,
  year: m.year,
  poster: m.large_cover_image || m.medium_cover_image,
  backdrop: m.background_image_original || m.background_image,
  rating: m.rating || 0,
  genres: m.genres || [],
  overview: m.summary || m.description_full || "",
  runtime: m.runtime,
});

const ytsList = (params) =>
  cached(`yts:${JSON.stringify(params)}`, HOUR, async () => {
    const { data } = await http.get(`${YTS}/list_movies.json`, { params: { limit: 30, ...params } });
    return ((data.data && data.data.movies) || []).map(ytsItem);
  });

const movieDetail = (id) =>
  cached(`yts:detail:${id}`, 6 * HOUR, async () => {
    const { data } = await http.get(`${YTS}/movie_details.json`, {
      params: { movie_id: id, with_images: true, with_cast: true },
    });
    const m = data.data.movie;
    if (!m || !m.id) throw new Error("Movie not found");
    const detail = {
      ...ytsItem(m),
      overview: m.description_full || m.description_intro || "",
      imdb: m.imdb_code,
      trailer: m.yt_trailer_code || null,
      cast: (m.cast || []).map((c) => ({ name: c.name, character: c.character_name, image: c.url_small_image })),
      sources: (m.torrents || [])
        .map((t) => ({
          hash: t.hash.toLowerCase(),
          name: `${m.title} ${t.quality} ${t.type}`,
          quality: t.quality,
          size: t.size,
          seeds: t.seeds,
          peers: t.peers,
          group: "YTS",
          codec: t.video_codec === "x265" || t.quality === "2160p" ? "HEVC" : "x264",
        })),
    };
    detail.sources = rankSources(detail.sources);
    return detail;
  });

// ---------- series (TVMaze) ----------
// TVMaze originals are multi-megabyte; cards use the medium rendition (same path)
const tvThumb = (url) => (url ? url.replace("/original_untouched/", "/medium_portrait/") : url);
const tvItem = (s) => ({
  kind: "series",
  id: String(s.id),
  title: s.name,
  year: s.premiered ? parseInt(s.premiered, 10) : null,
  poster: s.image && (s.image.medium || s.image.original),
  posterHd: s.image && s.image.original,
  backdrop: null,
  rating: (s.rating && s.rating.average) || 0,
  genres: s.genres || [],
  overview: stripHtml(s.summary),
  status: s.status,
  network: (s.network && s.network.name) || (s.webChannel && s.webChannel.name) || null,
});

// Trimmed copy of TVMaze's show index, rebuilt weekly in the background.
const INDEX_FILE = path.join(__dirname, "..", "data", "tvmaze-index.json");
let showIndex = [];
try {
  showIndex = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")).shows || [];
} catch (e) {}
const buildShowIndex = async () => {
  const shows = [];
  for (let page = 0; page < 1000; page++) {
    let data;
    try {
      ({ data } = await http.get(`${TVMAZE}/shows`, { params: { page } }));
    } catch (e) {
      if (e.response && e.response.status === 404) break;
      if (e.response && e.response.status === 429) {
        page--;
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      break;
    }
    data
      .filter((s) => s.weight >= 70 && s.image && s.externals && s.externals.imdb)
      .forEach((s) => shows.push({ ...tvItem(s), weight: s.weight, language: s.language, type: s.type }));
    await new Promise((r) => setTimeout(r, 600));
  }
  if (shows.length > 500) {
    showIndex = shows;
    fs.writeFileSync(INDEX_FILE, JSON.stringify({ built: Date.now(), shows }));
    console.log(`TVMaze index built: ${shows.length} shows`);
  }
};
const refreshShowIndexIfStale = () => {
  let built = 0;
  try {
    built = fs.statSync(INDEX_FILE).mtimeMs;
  } catch (e) {}
  if (Date.now() - built > 7 * 24 * HOUR) buildShowIndex().catch(() => {});
};
refreshShowIndexIfStale();
setInterval(refreshShowIndexIfStale, 24 * HOUR).unref();

// pick up an index written by another process (e.g. a rebuild that outlived a restart)
let indexMtime = 0;
const reloadShowIndex = () => {
  try {
    const m = fs.statSync(INDEX_FILE).mtimeMs;
    if (m !== indexMtime) {
      showIndex = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")).shows || showIndex;
      indexMtime = m;
    }
  } catch (e) {}
};

const popularSeries = ({ genre, sort = "popular", page = 1, limit = 30, year } = {}) => {
  reloadShowIndex();
  let list = showIndex.filter((s) => s.language === "English" || s.language === null || !s.language);
  if (genre) list = list.filter((s) => s.genres.some((g) => g.toLowerCase() === genre.toLowerCase()));
  if (year) list = list.filter((s) => s.year && s.year >= year[0] && s.year <= year[1]);
  const sorters = {
    popular: (a, b) => b.weight - a.weight || b.rating - a.rating || (b.year || 0) - (a.year || 0),
    rating: (a, b) => b.rating - a.rating,
    newest: (a, b) => (b.year || 0) - (a.year || 0) || b.weight - a.weight,
    title: (a, b) => a.title.localeCompare(b.title),
  };
  list = [...list].sort(sorters[sort] || sorters.popular);
  return list.slice((page - 1) * limit, page * limit).map((x) => ({ ...x, poster: tvThumb(x.poster) }));
};

// shows with episodes airing today in the US + streaming services
const airingSeries = () =>
  cached("tvmaze:airing", 6 * HOUR, async () => {
    const [tv, web] = await Promise.all([
      http.get(`${TVMAZE}/schedule`, { params: { country: "US" } }).then((r) => r.data).catch(() => []),
      http.get(`${TVMAZE}/schedule/web`).then((r) => r.data).catch(() => []),
    ]);
    const seen = new Set();
    const shows = [];
    [...tv, ...web].forEach((ep) => {
      const s = ep.show || (ep._embedded && ep._embedded.show);
      if (!s || seen.has(s.id) || !s.image || (s.weight || 0) < 80) return;
      if (s.language && s.language !== "English") return;
      seen.add(s.id);
      shows.push({ ...tvItem(s), weight: s.weight });
    });
    return shows.sort((a, b) => b.weight - a.weight).slice(0, 30);
  });

const seriesDetail = (id) =>
  cached(`tvmaze:detail:${id}`, 6 * HOUR, async () => {
    const { data: s } = await http.get(`${TVMAZE}/shows/${id}`, {
      params: { "embed[]": ["episodes", "cast", "images"] },
      paramsSerializer: () => "embed[]=episodes&embed[]=cast&embed[]=images",
    });
    const images = (s._embedded && s._embedded.images) || [];
    const bg =
      images.find((i) => i.type === "background" && i.main) ||
      images.find((i) => i.type === "background") ||
      images.find((i) => i.type === "banner");
    const seasons = {};
    ((s._embedded && s._embedded.episodes) || [])
      .filter((e) => e.number)
      .forEach((e) => {
        (seasons[e.season] = seasons[e.season] || []).push({
          season: e.season,
          number: e.number,
          title: e.name,
          airdate: e.airdate,
          runtime: e.runtime,
          still: e.image && (e.image.medium || e.image.original),
          overview: stripHtml(e.summary),
          aired: !e.airstamp || new Date(e.airstamp) < new Date(),
        });
      });
    return {
      ...tvItem(s),
      backdrop: bg ? bg.resolutions.original.url : null,
      imdb: s.externals && s.externals.imdb,
      runtime: s.averageRuntime || s.runtime,
      cast: ((s._embedded && s._embedded.cast) || []).slice(0, 12).map((c) => ({
        name: c.person.name,
        character: c.character.name,
        image: c.person.image && c.person.image.medium,
      })),
      seasons: Object.keys(seasons)
        .map(Number)
        .sort((a, b) => a - b)
        .map((n) => ({ number: n, episodes: seasons[n] })),
    };
  });

const searchSeries = (q) =>
  cached(`tvmaze:search:${q}`, HOUR, async () => {
    const { data } = await http.get(`${TVMAZE}/search/shows`, { params: { q } });
    return data.filter((r) => r.show.image).map((r) => tvItem(r.show));
  });

// ---------- anime (AniList) ----------
const MEDIA_FIELDS = `
  id idMal title { romaji english native } synonyms format status episodes duration season seasonYear
  coverImage { extraLarge large color } bannerImage genres averageScore popularity description(asHtml: false)
  nextAiringEpisode { episode airingAt } startDate { year }`;

// AniList allows ~30 requests/minute: run them one at a time, spaced out, retrying on 429
let anilistQueue = Promise.resolve();
let anilistLast = 0;
const anilist = (query, variables) => {
  const run = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = anilistLast + 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      anilistLast = Date.now();
      try {
        const { data } = await http.post(ANILIST, { query, variables }, { headers: { "Content-Type": "application/json" } });
        if (data.errors) throw new Error(data.errors[0].message);
        return data.data;
      } catch (e) {
        if (e.response && e.response.status === 429) {
          const retry = parseInt(e.response.headers["retry-after"], 10) || 30;
          await new Promise((r) => setTimeout(r, Math.min(retry, 60) * 1000));
          continue;
        }
        if (e.response && e.response.data && e.response.data.errors) throw new Error(e.response.data.errors[0].message);
        throw e;
      }
    }
    throw new Error("AniList is rate limiting requests, try again shortly");
  };
  const p = anilistQueue.then(run, run);
  anilistQueue = p.catch(() => {});
  return p;
};

// all anime rows for the home page in one request (aliases)
const animeHome = ({ season, seasonYear }) =>
  cached(`anilist:home:${season}${seasonYear}`, 2 * HOUR, async () => {
    const q = (alias, args) => `${alias}: Page(perPage: 30) { media(type: ANIME, isAdult: false, ${args}) { ${MEDIA_FIELDS} } }`;
    const data = await anilist(
      `query ($season: MediaSeason, $seasonYear: Int) {
        ${q("trending", "sort: [TRENDING_DESC, POPULARITY_DESC]")}
        ${q("season", "season: $season, seasonYear: $seasonYear, sort: [POPULARITY_DESC]")}
        ${q("top", "sort: [SCORE_DESC]")}
        ${q("action", 'genre: "Action", sort: [TRENDING_DESC]')}
        ${q("romance", 'genre: "Romance", sort: [TRENDING_DESC]')}
      }`,
      { season, seasonYear }
    );
    const out = {};
    Object.keys(data).forEach((k) => (out[k] = data[k].media.map(animeItem)));
    // AniList occasionally answers with empty pages; don't cache that
    if (!out.trending.length) throw new Error("AniList returned no data");
    return out;
  });

const animeItem = (m) => ({
  kind: "anime",
  id: String(m.id),
  title: (m.title && (m.title.english || m.title.romaji)) || "",
  titleRomaji: m.title && m.title.romaji,
  year: m.seasonYear || (m.startDate && m.startDate.year) || null,
  poster: m.coverImage && (m.coverImage.extraLarge || m.coverImage.large),
  color: m.coverImage && m.coverImage.color,
  backdrop: m.bannerImage || null,
  rating: m.averageScore ? m.averageScore / 10 : 0,
  genres: m.genres || [],
  overview: stripHtml(m.description).replace(/\n+/g, " "),
  format: m.format,
  status: m.status,
  episodes: m.episodes || (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : null),
});

const ANIME_SORTS = {
  trending: "TRENDING_DESC",
  popular: "POPULARITY_DESC",
  rating: "SCORE_DESC",
  newest: "START_DATE_DESC",
  title: "TITLE_ROMAJI",
};

const animeList = (opts = {}) => {
  const { sort = "trending", genre, page = 1, limit = 30, search, season, seasonYear, format, year, status } = opts;
  return cached(`anilist:${JSON.stringify(opts)}`, HOUR, async () => {
    const data = await anilist(
      `query ($page:Int,$perPage:Int,$sort:[MediaSort],$genre:String,$search:String,$season:MediaSeason,$seasonYear:Int,$format:MediaFormat,$yearGreater:FuzzyDateInt,$yearLesser:FuzzyDateInt,$status:MediaStatus) {
        Page(page:$page, perPage:$perPage) {
          media(type:ANIME, isAdult:false, sort:$sort, genre:$genre, search:$search, season:$season, seasonYear:$seasonYear,
                format:$format, startDate_greater:$yearGreater, startDate_lesser:$yearLesser, status:$status) { ${MEDIA_FIELDS} }
        }
      }`,
      {
        page,
        perPage: limit,
        sort: search ? ["SEARCH_MATCH", "POPULARITY_DESC"] : [ANIME_SORTS[sort] || "TRENDING_DESC", "POPULARITY_DESC"],
        genre: genre || undefined,
        search: search || undefined,
        season: season || undefined,
        seasonYear: seasonYear || undefined,
        format: format || undefined,
        yearGreater: year ? year[0] * 10000 : undefined,
        yearLesser: year ? (year[1] + 1) * 10000 : undefined,
        status: status || undefined,
      }
    );
    return data.Page.media.map(animeItem);
  });
};

const animeDetail = (id) =>
  cached(`anilist:detail:${id}`, 3 * HOUR, async () => {
    const data = await anilist(
      `query ($id:Int) { Media(id:$id, type:ANIME) {
        ${MEDIA_FIELDS}
        trailer { id site }
        studios(isMain:true) { nodes { name } }
        streamingEpisodes { title thumbnail }
        characters(sort:ROLE, perPage:12) { edges { role node { name { full } image { medium } } voiceActors(language:JAPANESE) { name { full } } } }
        relations { edges { relationType node { id type format title { romaji english } episodes coverImage { large } seasonYear } } }
        recommendations(perPage:12, sort:RATING_DESC) { nodes { mediaRecommendation { ${MEDIA_FIELDS} } } }
      } }`,
      { id: parseInt(id, 10) }
    );
    const m = data.Media;
    const base = animeItem(m);
    // AniList's streamingEpisodes are titled "Episode 3 - Name"; map them by number when possible
    const named = {};
    (m.streamingEpisodes || []).forEach((e) => {
      const match = /Episode\s+(\d+)\s*-\s*(.*)/i.exec(e.title || "");
      if (match) named[+match[1]] = { title: match[2], still: e.thumbnail };
    });
    const aired = m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : m.episodes || (m.format === "MOVIE" ? 1 : 0);
    const total = m.episodes || aired;
    const episodes = [];
    for (let n = 1; n <= total; n++) {
      episodes.push({
        number: n,
        title: (named[n] && named[n].title) || (m.format === "MOVIE" ? base.title : `Episode ${n}`),
        still: (named[n] && named[n].still) || null,
        aired: n <= aired || m.status === "FINISHED",
      });
    }
    const relations = (m.relations.edges || [])
      .filter((e) => e.node.type === "ANIME" && ["PREQUEL", "SEQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "PARENT"].includes(e.relationType))
      .map((e) => ({
        relation: e.relationType,
        kind: "anime",
        id: String(e.node.id),
        title: e.node.title.english || e.node.title.romaji,
        poster: e.node.coverImage && e.node.coverImage.large,
        format: e.node.format,
        year: e.node.seasonYear,
      }));
    return {
      ...base,
      titles: [m.title.romaji, m.title.english, ...(m.synonyms || [])].filter(Boolean),
      trailer: m.trailer && m.trailer.site === "youtube" ? m.trailer.id : null,
      studio: m.studios.nodes[0] && m.studios.nodes[0].name,
      duration: m.duration,
      nextAiring: m.nextAiringEpisode,
      cast: (m.characters.edges || []).map((c) => ({
        name: c.node.name.full,
        character: c.voiceActors[0] ? c.voiceActors[0].name.full : c.role,
        image: c.node.image && c.node.image.medium,
      })),
      episodeList: episodes,
      relations,
      recommendations: (m.recommendations.nodes || []).filter((n) => n.mediaRecommendation).map((n) => animeItem(n.mediaRecommendation)),
    };
  });

// every TV season of an anime franchise in order (AniList has one entry per season,
// linked as PREQUEL/SEQUEL), so the title page and player can move between them
const SEASON_FORMATS = ["TV", "TV_SHORT", "ONA"];
const animeSeasons = (id) =>
  cached(`anilist:seasons:${id}`, 3 * HOUR, async () => {
    const link = (d, rel) => d.relations.find((r) => r.relation === rel && SEASON_FORMATS.includes(r.format));
    let first = await animeDetail(id);
    for (let i = 0; i < 12; i++) {
      const pre = link(first, "PREQUEL");
      if (!pre) break;
      first = await animeDetail(pre.id);
    }
    const chain = [first];
    for (let i = 0; i < 12; i++) {
      const next = link(chain[chain.length - 1], "SEQUEL");
      if (!next || chain.some((c) => String(c.id) === String(next.id))) break;
      chain.push(await animeDetail(next.id));
    }
    return chain.map((d, i) => ({ id: String(d.id), number: i + 1, title: d.title, episodes: d.episodes, year: d.year, status: d.status }));
  });

// total episodes of TV prequels, for groups that number sequels continuously (e.g. "- 25" for S2E01)
const prequelOffset = async (id, depth = 0) => {
  if (depth > 6) return 0;
  const d = await animeDetail(id);
  const pre = d.relations.find((r) => r.relation === "PREQUEL" && ["TV", "TV_SHORT"].includes(r.format));
  if (!pre) return 0;
  const p = await animeDetail(pre.id);
  return (p.episodes || 0) + (await prequelOffset(pre.id, depth + 1));
};

// ---------- release-name parsing ----------
const parseRelease = (name) => {
  const n = name.replace(/_/g, " ");
  const group = (/^\[([^\]]+)\]/.exec(n) || [])[1] || null;
  const quality = (/(2160p|1080p|720p|480p|4k)/i.exec(n) || [])[1] || null;
  let codec = "x264";
  if (/hevc|x265|h\.?265/i.test(n)) codec = "HEVC";
  else if (/\bav1\b/i.test(n)) codec = "AV1";
  const se = /S(\d{1,2})\s?E(\d{1,4})(?:\s?-\s?E?(\d{1,4}))?/i.exec(n);
  let season = se ? +se[1] : null;
  let episode = se ? +se[2] : null;
  let range = se && se[3] ? [+se[2], +se[3]] : null;
  if (!se) {
    const r = /[\s(\[](\d{1,4})\s?[-~]\s?(\d{1,4})[\s)\]+]/.exec(n);
    if (r && +r[2] > +r[1] && !/\d{3,4}p/.test(r[0])) range = [+r[1], +r[2]];
    const e = /\s-\s(\d{1,4})(?:v\d)?(?:\s|\[|\(|$)|\bE(?:p(?:isode)?)?\.?\s?(\d{1,4})\b/i.exec(n);
    if (e && !range) episode = +(e[1] || e[2]);
    const s = /\bS(\d{1,2})\b|(\d)(?:st|nd|rd|th) Season|Season (\d{1,2})/i.exec(n);
    if (s) season = +(s[1] || s[2] || s[3]);
  }
  const batch = !!range || /\bbatch\b|complete|\bS\d{1,2}\b(?!\s?E)(?!.*\s-\s\d)/i.test(n) && episode === null;
  return {
    group,
    quality: quality && quality.toLowerCase() === "4k" ? "2160p" : quality,
    codec,
    season,
    episode,
    range,
    batch,
    // an English dub: "Dual Audio" is Japanese + English; multi-audio only when English is named
    // (plenty are German/Spanish/Italian dubs)
    dub:
      (/\bdub\b|dual[\s-]?audio|multi[\s-]?audio/i.test(n) && /\beng(lish)?\b/i.test(n)) ||
      (/dual[\s-]?audio|\bdub\b/i.test(n) && !/german|deutsch|\bger\b|\b(es|lat|spa|ita|fre|vf|por)\b|castellano|latino|italian|french/i.test(n)),
  };
};

const sizeToBytes = (s) => {
  const m = /([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB)/i.exec(s || "");
  if (!m) return 0;
  const mult = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[m[2][0].toLowerCase()];
  return parseFloat(m[1]) * mult;
};
const fmtSize = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`);

// ---------- torrent sources ----------
const nyaaSearch = (q) =>
  cached(`nyaa:${q}`, 30 * 60 * 1000, async () => {
    const { data } = await http.get(NYAA, { params: { page: "rss", c: "1_2", f: 0, s: "seeders", o: "desc", q } });
    return (String(data).match(/<item>[\s\S]*?<\/item>/g) || []).map((it) => {
      const get = (tag) => ((new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(it) || [])[1] || "").trim();
      const name = stripHtml(get("title"));
      return {
        hash: get("nyaa:infoHash").toLowerCase(),
        name,
        seeds: +get("nyaa:seeders"),
        peers: +get("nyaa:leechers"),
        bytes: sizeToBytes(get("nyaa:size")),
        size: get("nyaa:size").replace("GiB", "GB").replace("MiB", "MB"),
        trusted: get("nyaa:trusted") === "Yes",
        ...parseRelease(name),
      };
    });
  });

const normalize = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// search-friendly title variants: "Foo 2nd Season" -> "Foo S2", strip subtitles after ":"
const titleVariants = (d) => {
  const out = [];
  const add = (t) => {
    t = (t || "").replace(/[“”"]/g, "").trim();
    // short synonyms like "SnK" match unrelated release groups
    if (t && t.length >= 5 && /^[\x20-\x7e]+$/.test(t) && !out.includes(t)) out.push(t);
  };
  d.titles.forEach((t) => {
    const m = /^(.*?)\s*(?:(\d+)(?:st|nd|rd|th) Season|Season (\d+))(.*)$/i.exec(t);
    if (m) {
      add(`${m[1]} S${m[2] || m[3]}`);
      add(t);
    } else add(t);
  });
  d.titles.forEach((t) => add(t.split(/[:：]/)[0]));
  return out.slice(0, 4);
};

const animeSources = async (id, episode) => {
  const d = await animeDetail(id);
  const ep = parseInt(episode, 10) || 1;
  const isMovie = d.format === "MOVIE" || (d.episodes === 1 && d.format !== "TV");
  const variants = titleVariants(d);
  const offset = isMovie ? 0 : await prequelOffset(id).catch(() => 0);
  const seasonNum = (() => {
    for (const t of d.titles) {
      const m = /(\d+)(?:st|nd|rd|th) Season|Season (\d+)|\bS(\d+)\b|\b(II|III|IV|V)$/i.exec(t);
      if (m) return m[4] ? { II: 2, III: 3, IV: 4, V: 5 }[m[4].toUpperCase()] : +(m[1] || m[2] || m[3]);
    }
    return offset ? 2 : 1;
  })();
  const queries = [];
  variants.slice(0, 3).forEach((v) => {
    if (isMovie) queries.push(v);
    else {
      queries.push(`${v} ${String(ep).padStart(2, "0")}`);
      if (offset) queries.push(`${v.replace(/\s+S\d+$/, "")} ${ep + offset}`);
    }
  });
  if (!isMovie) variants.slice(0, 2).forEach((v) => queries.push(`${v} batch`));
  // releases with an English dub alongside the Japanese track
  variants.slice(0, 2).forEach((v) => queries.push(`${v} dual audio`));
  const results = (await Promise.all(queries.map((q) => nyaaSearch(q).catch(() => [])))).flat();

  const wanted = variants.map(normalize);
  const seen = new Set();
  const sources = [];
  results.forEach((r) => {
    if (!r.hash || seen.has(r.hash) || r.seeds < 1) return;
    const nn = normalize(r.name);
    if (!wanted.some((w) => nn.includes(w.split(" ").slice(0, 3).join(" ")))) return;
    // other entries of the same franchise ("Final Season", "Part 2", "Movie") share the base title
    const extra = ["final season", "part", "movie", "ova", "oad", "special", "recap", "the final"];
    const allTitles = normalize(d.titles.join(" "));
    if (extra.some((w) => new RegExp(`\\b${w}\\b`).test(nn) && !allTitles.includes(w)) && !(r.range && r.range[1] - r.range[0] > 30)) return;
    // later seasons often go by an arc name instead of a number ("Hashira Geiko-hen",
    // "Entertainment District Arc"): skip releases naming an arc this entry's titles don't have
    const arc = /(?:[a-z0-9]+ ){1,3}(?:hen|arc)\b/.exec(nn);
    if (arc && !allTitles.includes(arc[0])) return;
    const ownArc = !!arc; // names this entry's own arc, which identifies the season by itself
    // sequels: a release without a season marker is season 1 unless it uses absolute numbering
    const absolute =
      offset && ((r.episode !== null && r.episode === ep + offset) || (r.range && r.range[0] <= ep + offset && ep + offset <= r.range[1]));
    if (seasonNum > 1 && r.season !== seasonNum && !absolute && !ownArc) return;
    if (seasonNum <= 1 && r.season && r.season > 1) return;
    let match = false;
    if (isMovie) match = !r.episode || r.episode === 1;
    else if (r.range) match = (r.range[0] <= ep && ep <= r.range[1]) || (offset && r.range[0] <= ep + offset && ep + offset <= r.range[1]);
    else if (r.episode !== null) match = r.episode === ep || (offset && r.episode === ep + offset);
    else if (r.batch) match = true;
    if (!match) return;
    seen.add(r.hash);
    sources.push({
      hash: r.hash,
      name: r.name,
      group: r.group,
      quality: r.quality,
      codec: r.codec,
      size: r.size,
      seeds: r.seeds,
      peers: r.peers,
      batch: !!(r.range || (r.batch && r.episode === null)),
      dub: r.dub,
      trusted: r.trusted,
      // the file to pick inside a batch torrent (absolute numbering if that's what the group uses)
      fileEpisode: r.episode === ep + offset && offset ? ep + offset : ep,
    });
  });
  return rankSources(sources);
};

// releases named like an episode but shipping a program/archive are malware bait
const BAIT = /\.(exe|scr|bat|cmd|msi|lnk|zip|rar|7z|iso)\s*$|\bpassword\b|codec\s*pack/i;

// Prefer what starts fast and plays without heavy transcoding: 8-bit H.264 (video is copied,
// not re-encoded), 1080p, single episodes, healthy swarms. AV1/10-bit/HEVC need a full
// re-encode; multi-season packs and remuxes are huge; tiny swarms stall.
const rankSources = (rawList) => {
  const list = rawList.filter((s) => !BAIT.test(s.name || ""));
  const qScore = { "1080p": 3, "720p": 2, "2160p": 1, "480p": 0 };
  const codecScore = { x264: 2, HEVC: -1, AV1: -3 };
  const score = (s) => {
    const n = s.name || "";
    const tenBit = /10.?bit|hi10/i.test(n);
    const multiSeason = /S\d{1,2}\s?[-~]\s?S?\d{1,2}\b(?!\s?E)|seasons?\s?\d{1,2}\s?[-~&]\s?\d{1,2}|complete series/i.test(n);
    return (
      Math.log10(s.seeds + 1) * 4 +
      (s.seeds < 3 ? -3 : s.seeds < 10 ? -1.5 : 0) +
      (qScore[s.quality] || 1) * 1.5 +
      (tenBit && s.codec === "x264" ? 0 : codecScore[s.codec] || 0) +
      (tenBit ? -1.5 : 0) +
      (s.batch ? -2 : 0) +
      (multiSeason ? -2 : 0) +
      (/\bremux\b/i.test(n) ? -2 : 0) +
      (s.trusted ? 1 : 0) +
      (s.dub ? 5 : 0) + // English audio available (anime "Dual Audio" releases)
      (/subsplease|erai-raws/i.test(s.group || "") ? 1 : 0)
    );
  };
  return list.map((s) => ({ ...s, score: +score(s).toFixed(2) })).sort((a, b) => b.score - a.score).slice(0, 25);
};

const eztvAll = (imdb) =>
  cached(`eztv:${imdb}`, 30 * 60 * 1000, async () => {
    const id = String(imdb).replace(/^tt/, "");
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const { data } = await http.get(`${EZTV}/get-torrents`, { params: { imdb_id: id, limit: 100, page } });
      const list = data.torrents || [];
      all.push(...list);
      if (all.length >= (data.torrents_count || 0) || !list.length) break;
    }
    return all;
  });

const apibaySearch = (q) =>
  cached(`apibay:${q}`, 30 * 60 * 1000, async () => {
    const { data } = await http.get(`${APIBAY}/q.php`, { params: { q, cat: "205,208" } });
    return (Array.isArray(data) ? data : []).filter((t) => t.info_hash && t.info_hash !== "0000000000000000000000000000000000000000");
  });

// Knaben aggregates TPB, 1337x, EZTV, nyaa and others behind one JSON API
const knabenSearch = (query, size = 50) =>
  cached(`knaben:${query}`, 30 * 60 * 1000, async () => {
    const { data } = await http.post(
      "https://api.knaben.org/v1",
      { search_type: "100%", search_field: "title", query, order_by: "seeders", order_direction: "desc", size, hide_unsafe: true, hide_xxx: true },
      { headers: { "Content-Type": "application/json" }, timeout: 12000 }
    );
    return (data.hits || [])
      .filter((h) => h.hash)
      .map((h) => ({ info_hash: h.hash, name: h.title, seeders: h.seeders || 0, leechers: h.peers || 0, size: h.bytes || 0 }));
  });

// don't hold a request hostage to a slow index: use what's ready within `ms`
// (the cached promise keeps going, so the next lookup gets the full result)
const soon = (promise, ms = 4000) =>
  Promise.race([promise.catch(() => []), new Promise((r) => setTimeout(() => r([]), ms))]);

// does a release name look like a pack that contains season s?
const packHasSeason = (name, s) => {
  if (/S\d{1,2}\s?E\d{1,3}/i.test(name)) return false;
  const range = /S(\d{1,2})\s?-\s?S?(\d{1,2})\b|Seasons?\s?(\d{1,2})\s?-\s?(\d{1,2})/i.exec(name);
  if (range) {
    const a = +(range[1] || range[3]);
    const b = +(range[2] || range[4]);
    return a <= s && s <= b;
  }
  if (/complete series|complete collection/i.test(name)) return true;
  return new RegExp(`\\bS0?${s}\\b|season\\s?0?${s}(?!\\d)`, "i").test(name);
};

const seriesSources = async (id, season, episode) => {
  const d = await seriesDetail(id);
  const s = parseInt(season, 10);
  const e = parseInt(episode, 10);
  const code = `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;
  const nameKey = normalize(d.title).split(" ").filter((w) => w !== "the").slice(0, 3).join(" ");
  const titleOk = (name) => normalize(name).includes(nameKey);
  const sources = [];
  const seen = new Set();
  const push = (hash, name, seeds, peers, bytes, extra = {}) => {
    hash = String(hash).toLowerCase();
    if (!hash || seen.has(hash) || seeds < 1 || !titleOk(name)) return;
    seen.add(hash);
    const p = parseRelease(name);
    sources.push({
      hash,
      name,
      group: (/-([A-Za-z0-9]+)(?:\[.*\])?(?:\.\w{3})?$/.exec(name.trim()) || [])[1] || null,
      quality: p.quality,
      codec: p.codec,
      size: fmtSize(bytes),
      seeds,
      peers,
      batch: false,
      ...extra,
    });
  };
  if (d.imdb) {
    const list = await eztvAll(d.imdb).catch(() => []);
    list
      .filter((t) => +t.season === s && +t.episode === e)
      .forEach((t) => push(t.hash, t.title || t.filename, t.seeds, t.peers, +t.size_bytes));
    list
      .filter((t) => +t.season === s && +t.episode === 0)
      .forEach((t) => push(t.hash, t.title || t.filename, t.seeds, t.peers, +t.size_bytes, { batch: true }));
  }
  const sPad = `S${String(s).padStart(2, "0")}`;
  const [bayEp, bayPacks, bayNamed, knEp, knPacks] = await Promise.all([
    apibaySearch(`${d.title} ${code}`).catch(() => []),
    apibaySearch(`${d.title} ${sPad}`).catch(() => []),
    apibaySearch(`${d.title} season ${s}`).catch(() => []),
    soon(knabenSearch(`${d.title} ${code}`)),
    soon(knabenSearch(`${d.title} ${sPad}`)),
  ]);
  [...bayEp, ...knEp]
    .filter((t) => new RegExp(code, "i").test(t.name))
    .forEach((t) => push(t.info_hash, t.name, +t.seeders, +t.leechers, +t.size));
  // older shows are mostly shared as season packs, which are far better seeded
  [...bayPacks, ...bayNamed, ...knPacks]
    .filter((t) => packHasSeason(t.name, s))
    .forEach((t) => push(t.info_hash, t.name, +t.seeders, +t.leechers, +t.size, { batch: true }));
  return rankSources(sources.map((x) => ({ ...x, fileSeason: s, fileEpisode: e })));
};

// ---------- search across everything ----------
const searchAll = async (q) => {
  const [anime, series, movies] = await Promise.all([
    animeList({ search: q, limit: 20 }).catch(() => []),
    searchSeries(q).catch(() => []),
    ytsList({ query_term: q, sort_by: "download_count" }).catch(() => []),
  ]);
  return { anime, series, movies };
};

module.exports = {
  animeSeasons,
  ytsList,
  movieDetail,
  popularSeries,
  airingSeries,
  seriesDetail,
  searchSeries,
  animeList,
  animeHome,
  animeDetail,
  animeSources,
  seriesSources,
  searchAll,
  parseRelease,
  showIndexSize: () => showIndex.length,
  buildShowIndex,
};
