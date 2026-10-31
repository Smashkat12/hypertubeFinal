const express = require("express");
const catalog = require("../services/catalog");
const trending = require("../services/trending");
const Movie = require("../models/movie");

const KINDS = ["movie", "series", "anime"];

const GENRES = {
  movie: ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Thriller"],
  series: ["Action", "Adventure", "Comedy", "Crime", "Drama", "Family", "Fantasy", "Horror", "Mystery", "Romance", "Science-Fiction", "Thriller", "Supernatural", "War"],
  anime: ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"],
};

const currentSeason = () => {
  const d = new Date();
  const m = d.getMonth();
  return { season: ["WINTER", "WINTER", "WINTER", "SPRING", "SPRING", "SPRING", "SUMMER", "SUMMER", "SUMMER", "FALL", "FALL", "FALL"][m], seasonYear: d.getFullYear() };
};

const safe = (p) => p.catch(() => []);
const handle = (fn) => async (req, res) => {
  try {
    res.json({ success: true, ...(await fn(req, res)) });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
};

const yearRange = (q) => {
  const from = parseInt(q.yearFrom, 10);
  const to = parseInt(q.yearTo, 10);
  if (!from && !to) return null;
  return [from || 1900, to || new Date().getFullYear() + 1];
};

// list/browse for one kind
const browse = async (kind, q) => {
  const page = parseInt(q.page, 10) || 1;
  const sort = q.sort || "popular";
  const genre = q.genre || undefined;
  const year = yearRange(q);
  if (kind === "anime") {
    return catalog.animeList({ sort, genre, page, limit: 30, year, format: q.format || undefined });
  }
  if (kind !== "anime" && sort === "trending" && !year) return trending.browseTrending(kind, page, genre);
  if (kind === "series") return catalog.popularSeries({ sort: sort === "trending" ? "newest" : sort, genre, page, limit: 30, year });
  const ytsSort = { popular: "download_count", rating: "rating", newest: "year", title: "title", latest: "date_added" }[sort] || "download_count";
  let items = await catalog.ytsList({
    sort_by: ytsSort,
    order_by: sort === "title" ? "asc" : "desc",
    genre: genre ? genre.toLowerCase() : undefined,
    page,
    limit: 30,
    minimum_rating: sort === "rating" ? 7 : undefined,
  });
  if (year) items = items.filter((m) => m.year >= year[0] && m.year <= year[1]);
  return items;
};

let homeCache = null;
let homeBuilding = null;
let buildHome = null; // assigned below, once the route handlers exist
const refreshHome = () => {
  if (!homeBuilding)
    homeBuilding = buildHome()
      .then((value) => {
        if (value.rows.length) homeCache = { value, at: Date.now() };
        return value;
      })
      .finally(() => (homeBuilding = null));
  return homeBuilding;
};

exports.router = (() => {
  const router = express.Router();

  router.get(
    "/home",
    handle(async () => {
      // serve the last build instantly; rebuild in the background when it's older than 15 min
      if (homeCache && homeCache.value.rows.length) {
        if (Date.now() - homeCache.at > 15 * 60 * 1000) refreshHome();
        return homeCache.value;
      }
      return refreshHome();
    })
  );

  buildHome = async () => {
      const { season, seasonYear } = currentSeason();
      const [anime, airing, popularSeries, topSeries, crimeSeries, trendingMovies, latestMovies, topMovies] =
        await Promise.all([
          catalog.animeHome({ season, seasonYear }).catch(() => ({})),
          safe(catalog.airingSeries()),
          Promise.resolve(catalog.popularSeries({ limit: 30 })),
          Promise.resolve(catalog.popularSeries({ sort: "rating", limit: 30 })),
          Promise.resolve(catalog.popularSeries({ genre: "Crime", limit: 30 })),
          safe(catalog.ytsList({ sort_by: "download_count", limit: 30 })),
          safe(catalog.ytsList({ sort_by: "date_added", limit: 30 })),
          safe(catalog.ytsList({ sort_by: "rating", minimum_rating: 8, limit: 30 })),
        ]);
      const { trending: trendingAnime = [], season: seasonAnime = [], top: topAnime = [], action: actionAnime = [], romance: romanceAnime = [] } = anime;
      // billboard: what's new and hot across the networks, with a couple of trending anime mixed in
      const fresh = trending.snapshot();
      const animeHero = trendingAnime.filter((a) => a.backdrop).slice(0, 3);
      let hero;
      if (fresh.hero.length) {
        hero = [...fresh.hero.slice(0, 6)];
        hero.splice(2, 0, animeHero[0]);
        hero.splice(5, 0, animeHero[1]);
        hero = hero.filter(Boolean);
      } else {
        hero = [...animeHero, ...trendingMovies.filter((m) => m.backdrop).slice(0, 3)];
      }
      const newRows = fresh.rows;
      const rows = [
        ...newRows.slice(0, 4),
        { id: "trending-anime", title: "Trending Anime", kind: "anime", items: trendingAnime },
        ...newRows.slice(4),
        { id: "season-anime", title: `${season[0]}${season.slice(1).toLowerCase()} ${seasonYear} Anime`, kind: "anime", items: seasonAnime },
        { id: "airing-series", title: "New Episodes Today", kind: "series", items: airing },
        { id: "popular-series", title: "All-Time Popular Series", kind: "series", items: popularSeries },
        { id: "trending-movies", title: "Most Downloaded Movies", kind: "movie", items: trendingMovies },
        { id: "top-anime", title: "Top Rated Anime", kind: "anime", items: topAnime },
        { id: "action-anime", title: "Action Anime", kind: "anime", items: actionAnime },
        { id: "top-series", title: "Critically Acclaimed Series", kind: "series", items: topSeries },
        { id: "latest-movies", title: "Recently Added Movies", kind: "movie", items: latestMovies },
        { id: "romance-anime", title: "Romance Anime", kind: "anime", items: romanceAnime },
        { id: "crime-series", title: "Crime Series", kind: "series", items: crimeSeries },
        { id: "top-movies", title: "Top Rated Movies", kind: "movie", items: topMovies },
      ].filter((r) => r.items && r.items.length);
      return { hero: hero.slice(0, 9), rows };
  };
  // warm up after start so the first visitor doesn't wait on a dozen upstream APIs
  setTimeout(() => refreshHome().catch(() => {}), 15000);

  router.get(
    "/search",
    handle(async (req) => {
      const q = String(req.query.q || "").trim();
      if (!q) return { anime: [], series: [], movies: [] };
      return catalog.searchAll(q);
    })
  );

  router.get("/:kind/genres", (req, res) => res.json({ success: true, genres: GENRES[req.params.kind] || [] }));

  router.get(
    "/:kind",
    handle(async (req) => {
      if (!KINDS.includes(req.params.kind)) throw new Error("Unknown category");
      return { items: await browse(req.params.kind, req.query) };
    })
  );

  router.get(
    "/:kind/:id",
    handle(async (req) => {
      const { kind, id } = req.params;
      let item =
        kind === "anime" ? await catalog.animeDetail(id) : kind === "series" ? await catalog.seriesDetail(id) : await catalog.movieDetail(id);
      if (kind === "anime") item = { ...item, seasonChain: await catalog.animeSeasons(id).catch(() => []) };
      const extra = trending.extraFor(item.imdb);
      if (extra) {
        return {
          item: {
            ...item,
            backdrop: item.backdrop || extra.backdrop,
            imdbScore: extra.imdbScore,
            tomato: extra.tomato,
            providers: extra.providers,
          },
        };
      }
      return { item };
    })
  );

  router.get(
    "/:kind/:id/sources",
    handle(async (req) => {
      const { kind, id } = req.params;
      if (kind === "anime") return { sources: await catalog.animeSources(id, req.query.episode || 1) };
      if (kind === "series") return { sources: await catalog.seriesSources(id, req.query.season || 1, req.query.episode || 1) };
      return { sources: (await catalog.movieDetail(id)).sources };
    })
  );

  // local record used for comments, ratings, My List and watch progress
  router.post(
    "/:kind/:id/library",
    handle(async (req) => {
      const { kind, id } = req.params;
      if (!KINDS.includes(kind)) throw new Error("Unknown category");
      const key = kind === "movie" ? String(id) : `${kind}:${id}`;
      let doc = await Movie.findOne({ _ytsId: key }).exec();
      const b = req.body || {};
      const card = { kind, id: String(id), title: b.title, poster: b.poster, backdrop: b.backdrop, year: b.year, genres: b.genres, rating: b.rating };
      if (!doc) {
        doc = await new Movie({
          _ytsId: key,
          kind,
          name: b.title || "Untitled",
          poster: b.poster,
          description: b.overview || "No description",
          ytsData: card,
          last_seen: Date.now(),
        }).save();
      } else if (!doc.kind || !doc.ytsData || !doc.ytsData.kind) {
        doc.kind = kind;
        doc.ytsData = { ...(doc.ytsData || {}), ...card };
        await doc.save();
      }
      return { movie: doc };
    })
  );

  return router;
})();
