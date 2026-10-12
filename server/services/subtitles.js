// Downloadable subtitles for files that have none built in, from OpenSubtitles via Stremio's
// public, keyless addon. The player gets ids only; the download URLs stay on the server.
const axios = require("axios");

const ADDON = "https://opensubtitles-v3.strem.io/subtitles";
const http = axios.create({ timeout: 15000, headers: { "User-Agent": "hypertube/2.0" } });
const LANGS = { eng: "English", spa: "Spanish", fre: "French", por: "Portuguese", pob: "Portuguese (BR)", ger: "German", ita: "Italian", dut: "Dutch" };

const known = new Map(); // id -> download url, for lists we've handed out
const files = new Map(); // id -> converted text (small LRU)

const words = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
// how much a subtitle's release name looks like the file we're playing (same group/source = same timing)
const likeness = (a, b) => {
  const x = words(a);
  let n = 0;
  words(b).forEach((w) => x.has(w) && n++);
  return n;
};

const list = async ({ imdb, season, episode, name }) => {
  if (!/^tt\d{5,10}$/.test(String(imdb))) throw new Error("No IMDb id for this title");
  const path = season && episode ? `series/${imdb}:${+season}:${+episode}` : `movie/${imdb}`;
  const { data } = await http.get(`${ADDON}/${path}.json`);
  const subs = ((data && data.subtitles) || []).filter((s) => LANGS[s.lang] && /^https:\/\/[a-z0-9.-]+\.strem\.io\//.test(s.url));
  subs.forEach((s) => known.set(String(s.id), s.url));
  const order = Object.keys(LANGS);
  return subs
    .map((s) => ({
      id: String(s.id),
      lang: s.lang,
      label: LANGS[s.lang],
      release: s.movieReleaseName || s.subtitleFileName || "",
      score: likeness(name, `${s.movieReleaseName || ""} ${s.subtitleFileName || ""}`),
    }))
    .sort((a, b) => order.indexOf(a.lang) - order.indexOf(b.lang) || b.score - a.score);
};

// SRT -> the "start --> end" blocks the player already parses (dots for decimals)
const toVtt = (srt) =>
  "WEBVTT\n\n" +
  String(srt)
    .replace(/^﻿/, "")
    .replace(/\r/g, "")
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, "$1.$2")
    .trim();

const get = async (id) => {
  id = String(id);
  if (files.has(id)) return files.get(id);
  const url = known.get(id);
  if (!url) throw new Error("Unknown subtitle");
  const { data } = await http.get(url, { responseType: "text", maxContentLength: 5 * 1024 * 1024 });
  const vtt = toVtt(data);
  files.set(id, vtt);
  if (files.size > 50) files.delete(files.keys().next().value);
  return vtt;
};

module.exports = { list, get };
