import axios from "axios";
import config from "config";

axios.defaults.withCredentials = true;

export const SERVER = config.serverURL;

const api = axios.create({ baseURL: SERVER, withCredentials: true });

export const getHome = () => api.get("/catalog/home").then((r) => r.data);
export const browse = (kind, params) => api.get(`/catalog/${kind}`, { params }).then((r) => r.data);
export const getGenres = (kind) => api.get(`/catalog/${kind}/genres`).then((r) => r.data.genres || []);
export const search = (q) => api.get("/catalog/search", { params: { q } }).then((r) => r.data);
export const getTitle = (kind, id) => api.get(`/catalog/${kind}/${id}`).then((r) => r.data);
export const getSources = (kind, id, season, episode) =>
  api.get(`/catalog/${kind}/${id}/sources`, { params: { season, episode } }).then((r) => r.data);

// local record (comments, ratings, My List, progress) for any title
export const libraryRecord = (item) =>
  api
    .post(`/catalog/${item.kind}/${item.id}/library`, {
      title: item.title,
      poster: item.poster,
      backdrop: item.backdrop,
      year: item.year,
      genres: item.genres,
      rating: item.rating,
      overview: item.overview,
    })
    .then((r) => r.data.movie);

export const streamInfo = (hash, params) => api.get(`/stream/info/${hash}`, { params }).then((r) => r.data);
export const raceSources = (hashes, params) =>
  api.get("/stream/race", { params: { ...params, hashes: hashes.join(","), wait: 6000 } }).then((r) => r.data.stats || []);
// the torrent/file that played this title/episode before, if it's still on disk
export const recallPick = (params) => api.get("/stream/recall", { params }).then((r) => r.data);

// identifies a title/episode for the server's download library ("kind:id:season:episode")
export const pickKey = (kind, id, season, episode) =>
  [kind, id, kind === "movie" ? "" : (kind === "series" && season) || "", kind === "movie" ? "" : episode || ""].join(":");

// connect + probe the best candidate in the background (full: also download the whole file)
export const prepareSources = (kind, id, season, episode, sources, { full = false } = {}) => {
  const top = (sources || []).slice(0, 3);
  if (!top.length) return Promise.resolve();
  return api.get("/stream/prepare", {
    params: {
      key: pickKey(kind, id, season, episode),
      hashes: top.map((s) => s.hash).join(","),
      season: kind === "series" ? season : undefined,
      episode: kind === "movie" ? undefined : episode,
      fileEpisodes: top.map((s) => s.fileEpisode || "").join(","),
      fileSeasons: top.map((s) => s.fileSeason || "").join(","),
      full: full ? 1 : undefined,
    },
  });
};

export const getDownloads = () => api.get("/stream/downloads").then((r) => r.data);
export const deleteDownload = (params) => api.delete("/stream/downloads", { params }).then((r) => r.data);
export const cleanupDownloads = () => api.post("/stream/downloads/cleanup").then((r) => r.data);
export const streamStatus = (hash) => api.get(`/stream/status/${hash}`).then((r) => r.data);
export const streamSubs = (sid) => api.get(`/stream/subs/${sid}`).then((r) => r.data);

export const getMe = () => api.get("/users/id").then((r) => (r.data.success ? r.data.user[0] : null));
export const getMovieDoc = (docId) =>
  api.get(`/movies/${docId}`).then((r) => (r.data.success && r.data.movie ? r.data.movie[0] : null));

// a local Movie document -> the catalogue card it represents (older docs are plain YTS movies)
export const docToItem = (doc) => {
  if (!doc) return null;
  const d = doc.ytsData || {};
  if (d.kind) return { ...d, docId: doc._id };
  return {
    kind: "movie",
    id: String(doc._ytsId),
    title: doc.name,
    poster: doc.poster || d.large_cover_image,
    backdrop: d.background_image_original || d.background_image,
    year: d.year,
    genres: d.genres || [],
    rating: d.rating || 0,
    docId: doc._id,
  };
};

export const titlePath = (item) => `/title/${item.kind}/${item.id}`;
export const watchPath = (item, season, episode) => {
  const q = [];
  if (season) q.push(`s=${season}`);
  if (episode) q.push(`e=${episode}`);
  return `/watch/${item.kind}/${item.id}${q.length ? `?${q.join("&")}` : ""}`;
};

export default api;
