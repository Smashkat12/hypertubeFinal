const fs = require("fs");
const https = require("https");
const torrentStream = require("torrent-stream");
const path = require("path");
const request = require("request");
const yifysubtitles = require("yifysubtitles");
const Movie = require("../models/movie");
const User = require("../models/user");

// yts.mx is gone; the YTS API now lives at movies-api.accel.li (yts.bz redirects there too)
const sources = [
  process.env.YTS_API || "https://movies-api.accel.li/api/v2",
  "https://yts.bz/api/v2",
];
let selectedSource = sources[0];

// fall back to the next source if the current one is unreachable
const checkSource = () => {
  https
    .get(`${sources[0]}/list_movies.json?limit=1`, (res) => {
      selectedSource = res.statusCode === 200 ? sources[0] : sources[1];
      res.resume();
    })
    .on("error", () => {
      selectedSource = sources[1];
    });
};

//service to set movies info accordingly
const setMoviesInfo = (uid, body) => {
  const searchResults = body;
  if (
    searchResults.status === "ok" &&
    searchResults.data.movie_count !== 0 &&
    searchResults.data.movies
  ) {
    return Promise.all(
      searchResults.data.movies.map(async (movie) => {
        const responseMovie = await Movie.findOne({ _ytsId: movie.id }).exec();
        if (responseMovie) {
          if (responseMovie && responseMovie.ratings.length > 0) {
            let count = 0;
            let total = 0;
            responseMovie.ratings.forEach((el) => {
              total += el.rating;
              count++;
            });
            movie.ratingAverage = Math.floor((total / count) * 100) / 100;
            movie.ratingCount = count;
          }
        }

        const responseWatchPercent = await User.findOne(
          { _id: uid },
          { inProgress: { $elemMatch: { ytsId: movie.id } } }
        ).exec();
        if (responseWatchPercent) {
          if (responseWatchPercent.inProgress.length > 0)
            movie.watchPercent = responseWatchPercent.inProgress[0].percent;
        }

        movie.torrents.map((torrent) => {
          torrent.magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURI(
            movie.title
          )}&tr=http://track.one:1234/announce&tr=udp://track.two:80`;
          torrent.magnet2 = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURI(
            movie.title
          )}&tr=http://track.one:1234/announce&tr=udp://tracker.openbittorrent.com:80`;
          return torrent;
        });
        return movie;
      })
    );
  }
  return false;
};


// the magnets only carry placeholder trackers, so add real public ones
const trackers = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://explodie.org:6969/announce",
];
const mimeTypes = { ".mp4": "video/mp4", ".mkv": "video/webm", ".webm": "video/webm", ".avi": "video/x-msvideo" };

const PAGE_SIZE = 50;

const fetchJson = (url) =>
  new Promise((resolve, reject) => {
    request.get({ url, timeout: 20000 }, (err, results, body) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(body.replace(/^\ufeff/g, "")));
      } catch (e) {
        reject(e);
      }
    });
  });

// binary search for the first page (sorted by year) that reaches `year`
const startPageCache = {};
const findStartPage = async (base, year, desc) => {
  const key = `${base}|${year}|${desc}`;
  if (startPageCache[key]) return startPageCache[key];
  const first = await fetchJson(`${base}&page=1`);
  const count = (first.data && first.data.movie_count) || 0;
  let lo = 1;
  let hi = Math.max(1, Math.ceil(count / PAGE_SIZE));
  // a page "reaches" the range when its last movie is on the near side of `year`
  const reaches = async (p) => {
    const body = p === 1 ? first : await fetchJson(`${base}&page=${p}`);
    const movies = (body.data && body.data.movies) || [];
    if (!movies.length) return true;
    const lastYear = movies[movies.length - 1].year;
    return desc ? lastYear <= year : lastYear >= year;
  };
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await reaches(mid)) hi = mid;
    else lo = mid + 1;
  }
  startPageCache[key] = lo;
  return lo;
};

// one engine per torrent, shared by every range request the player makes
const engines = {};
const getEngine = (magnet, cb) => {
  const match = magnet.match(/btih:([a-zA-Z0-9]+)/);
  if (!match) return cb(new Error("bad magnet"));
  const hash = match[1].toLowerCase();
  let entry = engines[hash];
  if (!entry) {
    const engine = torrentStream(magnet, { path: "./server/torrents", trackers });
    entry = engines[hash] = { engine, file: null, waiting: [] };
    engine.on("ready", () => {
      const videos = engine.files.filter((f) => mimeTypes[path.extname(f.name)]);
      engine.files.forEach((f) => f.deselect());
      entry.file = videos.sort((a, b) => b.length - a.length)[0] || null;
      if (entry.file) entry.file.select();
      entry.waiting.forEach((fn) => fn(null, entry.file));
      entry.waiting = [];
    });
  }
  if (entry.file) cb(null, entry.file);
  else entry.waiting.push(cb);
};

const getSubtitles = async (imdbid, langs) => {
  const results = await yifysubtitles(imdbid, {
    ssl:true,
    langs: langs,
  });
  return Promise.all(
    results.map((sub, index) => {
		cl(chalk.bold.greenBright(sub.path));
		
      return new Promise((resolve, reject) => {
        fs.readFile(sub.path, "utf8", (err, content) => {
          if (!err) {
            const buffer = Buffer.from(content);
            resolve({
              key: sub.langShort,
              value: buffer.toString("base64"),
            });
          } else {
            reject(err);
          }
        });
      });
    })
  );
};


//handlers for torrents
module.exports = {
  search: async (req, res) => {
    checkSource();
    const { minrating, maxrating, genre, sort, order } = req.query;
    const minyear = parseInt(req.query.minyear) || 1900;
    const maxyear = parseInt(req.query.maxyear) || new Date().getFullYear();
    const page = parseInt(req.query.page) || 1;
    const base = `${selectedSource}/list_movies.json?limit=${PAGE_SIZE}&query_term=${encodeURIComponent(
      req.query.search || ""
    )}${genre ? "&genre=" + encodeURIComponent(genre) : ""}${
      sort ? "&sort_by=" + encodeURIComponent(sort.trim()) : ""
    }${order ? "&order_by=" + encodeURIComponent(order.trim()) : ""}`;

    try {
      // YTS can't filter by year, but when sorted by year we can jump to where the range starts
      let ytsPage = page;
      if (sort && sort.trim() === "year") {
        const desc = !order || order.trim() !== "asc";
        const start = await findStartPage(base, desc ? maxyear : minyear, desc);
        ytsPage = start + page - 1;
      }
      const body = await fetchJson(`${base}&page=${ytsPage}`);
      let searchResults = await setMoviesInfo(req.user._id, body);
      if (!searchResults) return res.json({ success: true, count: 0, results: [] });
      searchResults = searchResults.filter((movie) => {
        if (!movie.ratingAverage) movie.ratingAverage = 0;
        return (
          movie.ratingAverage >= (parseFloat(minrating) || 0) &&
          movie.ratingAverage <= (maxrating === undefined || maxrating === "" ? 5 : parseFloat(maxrating)) &&
          movie.year >= minyear &&
          movie.year <= maxyear
        );
      });
      res.json({ success: true, count: searchResults.length, results: searchResults });
    } catch (err) {
      res.json({ success: false });
    }
  },
  getMovieDetails: (req, res) => {
    checkSource();

    request.get(
      {
        url: `${selectedSource}/movie_details.json?movie_id=${req.params.id}&with_images=true&with_cast=true`,
      },
      (err, results, body) => {
        if (err) {
          res.json({ success: false });
        } else {
          const movieInfos = JSON.parse(body);
          res.json({ success: true, result: movieInfos });
        }
      }
    );
  },

  stream: (req, res) => {
    getEngine(req.params.magnet, (err, file) => {
      if (err || !file) return res.sendStatus(404);
      const total = file.length;
      const type = mimeTypes[path.extname(file.name)] || "video/mp4";
      const range = req.headers.range;
      if (!range) {
        res.writeHead(200, { "Content-Length": total, "Content-Type": type, "Accept-Ranges": "bytes" });
        return file.createReadStream().pipe(res);
      }
      const [s, e] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(s, 10);
      const end = e ? Math.min(parseInt(e, 10), total - 1) : total - 1;
      if (isNaN(start) || start >= total) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        return res.end();
      }
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Type": type,
        "Content-Length": end - start + 1,
      });
      const fileStream = file.createReadStream({ start, end });
      fileStream.pipe(res);
      res.on("close", () => fileStream.destroy());
    });
  },
  getSubtitles: async (req, res) => {
    const { imdbid } = req.params;
    const langs = ["fr", "en"];
    try {
      const response = await getSubtitles(imdbid, langs);
      let subtitles = {};
      if (response) {
        response.forEach((subtitle) => {
          subtitles = {
            ...subtitles,
            [subtitle.key]: subtitle.value,
          };
        });
      }
      res.json({ subtitles });
    } catch (error) {
      res.json({ error });
    }
  },
};


