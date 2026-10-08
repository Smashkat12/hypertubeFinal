// "What's hot right now" from JustWatch (trending across Netflix, HBO Max, Apple TV+, …,
// with IMDb and Rotten Tomatoes scores), mapped by IMDb id onto titles we can actually
// stream: TVMaze shows for series, YTS for movies.
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const JW = "https://apis.justwatch.com/graphql";
const JW_IMG = "https://images.justwatch.com";
const YTS = process.env.YTS_API || "https://movies-api.accel.li/api/v2";
const TVMAZE = "https://api.tvmaze.com";
const MAP_FILE = path.join(__dirname, "..", "data", "imdb-map.json");
const HOUR = 3600 * 1000;

const http = axios.create({ timeout: 20000, headers: { "User-Agent": "Mozilla/5.0 hypertube/2.0" } });

const NETWORKS = [
  { key: "nfx", name: "Netflix" },
  { key: "mxx", name: "HBO Max" },
  { key: "atp", name: "Apple TV+" },
  { key: "dnp", name: "Disney+" },
  { key: "amp", name: "Prime Video" },
  { key: "hlu", name: "Hulu" },
];

// the services people recognise (JustWatch also lists add-on channels, fuboTV, etc.)
const PROVIDER_NAMES = {
  nfx: "Netflix", mxx: "HBO Max", atp: "Apple TV+", dnp: "Disney+", amp: "Prime Video", hlu: "Hulu",
  pct: "Peacock", pcp: "Peacock", pmp: "Paramount+", pmq: "Paramount+", cru: "Crunchyroll", stz: "Starz", amc: "AMC+",
};
const PROVIDER_ORDER = ["Netflix", "HBO Max", "Apple TV+", "Disney+", "Prime Video", "Hulu", "Paramount+", "Peacock", "Crunchyroll", "Starz", "AMC+"];

const GENRES = {
  act: "Action", ani: "Animation", cmy: "Comedy", crm: "Crime", doc: "Documentary", drm: "Drama", fnt: "Fantasy",
  hst: "History", hrr: "Horror", fml: "Family", msc: "Music", trl: "Thriller", rma: "Romance", scf: "Sci-Fi",
  spt: "Sport", war: "War", wsn: "Western", rly: "Reality", eur: "European",
};

const img = (url, profile) => (url ? `${JW_IMG}${url.replace("{profile}", profile).replace("{format}", "webp")}` : null);

const QUERY = `query ($country: Country!, $language: Language!, $first: Int!, $after: String, $filter: TitleFilter, $sortBy: PopularTitlesSorting!) {
  popularTitles(country: $country, first: $first, after: $after, filter: $filter, sortBy: $sortBy) {
    edges { node {
      objectType
      content(country: $country, language: $language) {
        title originalReleaseYear shortDescription posterUrl runtime
        backdrops { backdropUrl }
        externalIds { imdbId }
        scoring { imdbScore imdbVotes tomatoMeter }
        genres { shortName }
      }
      offers(country: $country, platform: WEB) { monetizationType package { shortName clearName } }
    } }
  }
}`;

// raw JustWatch list; cursor is a base64 offset
const jwList = async ({ types, minYear, packages, first = 40, offset = 0, sort = "TRENDING" }) => {
  const filter = { objectTypes: types };
  if (minYear) filter.releaseYear = { min: minYear };
  if (packages) filter.packages = packages;
  const { data } = await http.post(
    JW,
    {
      query: QUERY,
      variables: {
        country: "US",
        language: "en",
        first,
        after: offset ? Buffer.from(String(offset)).toString("base64") : null,
        filter,
        sortBy: sort,
      },
    },
    { headers: { "Content-Type": "application/json" } }
  );
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data.popularTitles.edges
    .map(({ node }) => {
      const c = node.content;
      const imdb = c.externalIds && c.externalIds.imdbId;
      if (!imdb) return null;
      const providers = [];
      (node.offers || [])
        .filter((o) => o.monetizationType === "FLATRATE" || o.monetizationType === "FREE" || o.monetizationType === "ADS")
        .map((o) => PROVIDER_NAMES[o.package.shortName])
        .filter(Boolean)
        .forEach((name) => !providers.includes(name) && providers.push(name));
      providers.sort((a, b) => PROVIDER_ORDER.indexOf(a) - PROVIDER_ORDER.indexOf(b));
      const s = c.scoring || {};
      return {
        type: node.objectType,
        imdb,
        title: c.title,
        year: c.originalReleaseYear,
        overview: c.shortDescription || "",
        poster: img(c.posterUrl, "s592"),
        backdrop: c.backdrops && c.backdrops[0] ? img(c.backdrops[0].backdropUrl, "s1920") : null,
        runtime: c.runtime,
        genres: (c.genres || []).map((g) => GENRES[g.shortName]).filter(Boolean),
        imdbScore: s.imdbScore || null,
        imdbVotes: s.imdbVotes || 0,
        tomato: s.tomatoMeter || null,
        providers: providers.slice(0, 3),
      };
    })
    .filter(Boolean);
};

// ---------- IMDb id -> playable title (persisted) ----------
let imdbMap = {};
try {
  imdbMap = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
} catch (e) {}
let saveTimer = null;
const saveMap = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(MAP_FILE, JSON.stringify(imdbMap), () => {}), 2000);
};

// run at most `n` lookups at a time, spaced out for TVMaze's 20 req / 10 s limit
const limiter = (n, spacing) => {
  let active = 0;
  let last = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    const wait = Math.max(0, last + spacing - Date.now());
    const job = queue.shift();
    active++;
    last = Date.now() + wait;
    setTimeout(() => job().finally(() => (active--, next())), wait);
    next();
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      next();
    });
};
const tvLimit = limiter(2, 550);
const ytsLimit = limiter(4, 150);

const resolveShow = (imdb) =>
  tvLimit(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data } = await http.get(`${TVMAZE}/lookup/shows`, { params: { imdb } });
        return data && data.id ? { kind: "series", id: String(data.id) } : null;
      } catch (e) {
        if (e.response && e.response.status === 404) return null;
        if (e.response && e.response.status === 429) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        throw e;
      }
    }
    throw new Error("TVMaze busy");
  });

const resolveMovie = (imdb) =>
  ytsLimit(async () => {
    const { data } = await http.get(`${YTS}/list_movies.json`, { params: { query_term: imdb, limit: 1 } });
    const m = data.data && data.data.movies && data.data.movies[0];
    return m && m.imdb_code === imdb ? { kind: "movie", id: String(m.id) } : null;
  });

const resolve = async (t) => {
  const hit = imdbMap[t.imdb];
  // misses are retried after a while: new releases reach the torrent indexes later
  if (hit && (hit.ref || Date.now() - hit.at < 12 * HOUR)) return hit.ref;
  try {
    const ref = t.type === "SHOW" ? await resolveShow(t.imdb) : await resolveMovie(t.imdb);
    imdbMap[t.imdb] = { ref, at: Date.now() };
    saveMap();
    return ref;
  } catch (e) {
    return null;
  }
};

const toItem = (t, ref) => ({
  kind: ref.kind,
  id: ref.id,
  title: t.title,
  year: t.year,
  poster: t.poster,
  backdrop: t.backdrop,
  rating: t.imdbScore || 0,
  imdbScore: t.imdbScore,
  imdbVotes: t.imdbVotes,
  tomato: t.tomato,
  genres: t.genres,
  overview: t.overview,
  runtime: t.runtime,
  providers: t.providers,
  imdb: t.imdb,
});

// extra artwork/scores for detail pages, by IMDb id
const byImdb = new Map();

const resolveList = async (list) => {
  const refs = await Promise.all(list.map(resolve));
  const out = [];
  const seen = new Set();
  list.forEach((t, i) => {
    const ref = refs[i];
    if (!ref || seen.has(`${ref.kind}:${ref.id}`)) return;
    seen.add(`${ref.kind}:${ref.id}`);
    const item = toItem(t, ref);
    byImdb.set(t.imdb, item);
    out.push(item);
  });
  return out;
};

// ---------- rows, refreshed in the background ----------
let snapshot = { rows: [], hero: [], built: 0 };
let building = null;

const interleave = (a, b) => {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
};

const build = async () => {
  const year = new Date().getFullYear();
  const recent = year - 1;
  const [shows, movies, ...perNetwork] = await Promise.all([
    jwList({ types: ["SHOW"], minYear: recent, first: 60 }),
    jwList({ types: ["MOVIE"], minYear: recent, first: 80 }),
    ...NETWORKS.map((n) => jwList({ types: ["SHOW", "MOVIE"], minYear: recent, packages: [n.key], first: 30 }).catch(() => [])),
  ]);
  const [showItems, movieItems] = await Promise.all([resolveList(shows), resolveList(movies)]);
  const networkItems = [];
  for (const list of perNetwork) networkItems.push(await resolveList(list));

  const all = [...showItems, ...movieItems];
  const acclaimed = all
    .filter((t) => t.imdbVotes >= 2000 && ((t.tomato || 0) >= 85 || (t.imdbScore || 0) >= 7.8))
    .sort((a, b) => (b.tomato || b.imdbScore * 10 || 0) + (b.imdbScore || 0) * 5 - ((a.tomato || a.imdbScore * 10 || 0) + (a.imdbScore || 0) * 5));

  const rows = [
    { id: "trending-now", title: "Trending Now", kind: "mixed", items: interleave(showItems, movieItems).slice(0, 40) },
    { id: "new-series", title: "New & Popular Series", kind: "series", items: showItems },
    { id: "new-movies", title: "New Movies", kind: "movie", items: movieItems },
    { id: "acclaimed", title: "Critically Acclaimed New Releases", kind: "mixed", items: acclaimed.slice(0, 30) },
    ...NETWORKS.map((n, i) => ({ id: `net-${n.key}`, title: `New on ${n.name}`, kind: "mixed", items: networkItems[i] })),
  ].filter((r) => r.items.length >= 4);

  const hero = interleave(
    showItems.filter((t) => t.backdrop && (t.imdbScore || 0) >= 7),
    movieItems.filter((t) => t.backdrop && (t.imdbScore || 0) >= 6.5)
  ).slice(0, 8);

  snapshot = { rows, hero, built: Date.now() };
  console.log(`Trending rows built: ${rows.map((r) => `${r.id}=${r.items.length}`).join(", ")}`);
};

const refresh = () => {
  if (!building) building = build().catch((e) => console.log("Trending build failed:", e.message)).finally(() => (building = null));
  return building;
};
refresh();
setInterval(refresh, 3 * HOUR).unref();

// browse pages: trending titles of one kind, paginated
const browseTrending = async (kind, page = 1, genre) => {
  const year = new Date().getFullYear();
  const list = await jwList({
    types: [kind === "series" ? "SHOW" : "MOVIE"],
    minYear: year - 2,
    first: 40,
    offset: (page - 1) * 40,
  });
  const items = await resolveList(genre ? list.filter((t) => t.genres.some((g) => g.toLowerCase().startsWith(genre.toLowerCase().slice(0, 4)))) : list);
  return items;
};

module.exports = {
  snapshot: () => snapshot,
  ready: () => snapshot.built > 0,
  refresh,
  browseTrending,
  extraFor: (imdb) => (imdb ? byImdb.get(imdb) || null : null),
};
