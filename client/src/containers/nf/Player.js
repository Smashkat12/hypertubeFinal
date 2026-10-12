import React, { useEffect, useRef, useState, useCallback } from "react";
import { withRouter } from "react-router-dom";
import api, { SERVER, getTitle, getSources, raceSources, recallPick, pickKey, prepareSources, streamInfo, streamStatus, streamSubs, findSubtitles, getSubtitle, libraryRecord, getMe, titlePath, watchPath } from "api";
import { SourceList } from "./TitlePage";
import * as I from "components/nf/Icons";
// HLS only for Apple's WebKit (Safari, every iOS browser), which can't play our endless MP4 stream.
// Recent Chrome (desktop, Android, Fire TV Silk) also says it plays HLS, but the MP4 stream works
// better there, so don't go by canPlayType alone.
const APPLE_WEBKIT =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    (/Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR|Android|Silk/.test(navigator.userAgent)));
const NATIVE_HLS = APPLE_WEBKIT && document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";


const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`;
};
const fmtSpeed = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round(b / 1024)} KB/s`);

// "00:01.550 --> 00:06.480" cues from ffmpeg's WebVTT output
const parseVtt = (text) => {
  const toSec = (t) => {
    const p = t.trim().split(":").map(parseFloat);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  const cues = [];
  text.split(/\r?\n\r?\n/).forEach((block) => {
    const lines = block.split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) return;
    const [a, b] = lines[i].split("-->");
    const body = lines
      .slice(i + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .trim();
    if (body) cues.push({ start: toSec(a), end: toSec(b.split(" ").filter(Boolean)[0]), text: body });
  });
  return cues;
};

const LANG = { jpn: "Japanese", eng: "English", und: "Unknown", fre: "French", fra: "French", spa: "Spanish", ger: "German", deu: "German", ita: "Italian", por: "Portuguese", rus: "Russian", ara: "Arabic", chi: "Chinese", zho: "Chinese", kor: "Korean" };
const trackName = (t) => `${LANG[t.language] || t.language.toUpperCase()}${t.title ? ` · ${t.title}` : ""}`;

const Player = ({ match, location, history }) => {
  const { kind, id } = match.params;
  const params = new URLSearchParams(location.search);
  const season = parseInt(params.get("s"), 10) || null;
  const episode = parseInt(params.get("e"), 10) || null;
  const forcedHash = params.get("hash");

  const video = useRef(null);
  const root = useRef(null);
  const sid = useRef(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const idleTimer = useRef(null);
  const saveTimer = useRef(0);

  const [item, setItem] = useState(null);
  const [doc, setDoc] = useState(null);
  const [sources, setSources] = useState(null);
  const [source, setSource] = useState(null);
  const [info, setInfo] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | ready | error
  const [status, setStatus] = useState("Finding the best source…");
  const [swarm, setSwarm] = useState(null);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [realStart, setRealStart] = useState(null);
  const [audio, setAudio] = useState(0);
  const [sub, setSub] = useState(-1);
  // per-title audio sync adjustment in ms (positive = audio later), for badly muxed releases
  const syncKey = `nf-sync:${kind}:${id}`;
  const [sync, setSyncState] = useState(() => parseInt(localStorage.getItem(`nf-sync:${kind}:${id}`) || "0", 10) || 0);
  const [cues, setCues] = useState([]);
  // downloaded subtitles (for files without built-in ones), their list and a timing nudge
  const [ext, setExt] = useState(null); // { id, cues }
  const [extList, setExtList] = useState(null); // null | "loading" | [] of { id, label, release }
  const [subDelay, setSubDelay] = useState(0); // seconds, positive = later
  const [now, setNow] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [idle, setIdle] = useState(false);
  const [panel, setPanel] = useState(null);
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem("nf-volume") || "1"));
  // data saver: 720p at ~2.5 Mbps (remembered per device, e.g. on for the phone)
  const [saver, setSaver] = useState(() => localStorage.getItem("nf-saver") === "1");
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hover, setHover] = useState(null);
  const [flash, setFlash] = useState(null);
  const startAt = useRef(0); // resume point (seconds), read at stream start
  const pendingSeek = useRef(null);
  const [nextCountdown, setNextCountdown] = useState(null);

  const transcoding = info && !info.direct;
  const duration = info ? (info.direct && video.current && isFinite(video.current.duration) ? video.current.duration : info.duration) : 0;
  // where the server's stream really starts (it snaps seeks to a keyframe to keep A/V in sync)
  const base = realStart !== null ? realStart : offset;
  const position = transcoding ? base + now : now;

  // ----- episode navigation -----
  const episodeList = (() => {
    if (!item) return [];
    if (kind === "anime") return (item.episodeList || []).map((e) => ({ ...e, season: null }));
    if (kind === "series") return (item.seasons || []).flatMap((s) => s.episodes.map((e) => ({ ...e, season: s.number })));
    return [];
  })();
  const epIndex = episodeList.findIndex((e) => e.number === episode && (kind !== "series" || e.season === season));
  const currentEp = epIndex >= 0 ? episodeList[epIndex] : null;
  const nextEp = epIndex >= 0 && episodeList[epIndex + 1] && episodeList[epIndex + 1].aired !== false ? episodeList[epIndex + 1] : null;

  // what's being watched, so the server can remember which torrent/file played it
  const pickParams = { key: pickKey(kind, id, season, episode) };

  // ----- load title, library record, resume point, sources -----
  useEffect(() => {
    let alive = true;
    setPhase("loading");
    setInfo(null);
    setSource(null);
    setSources(null);
    setCues([]);
    setError(null);
    setNextCountdown(null);
    setStatus("Finding the best source…");
    (async () => {
      try {
        const t = await getTitle(kind, id);
        if (!alive) return;
        if (!t.success) throw new Error(t.error || "Title not found");
        setItem(t.item);
        const [record, me] = await Promise.all([libraryRecord(t.item).catch(() => null), getMe().catch(() => null)]);
        if (!alive) return;
        setDoc(record);
        const prog = record && me && (me.inProgress || []).find((p) => p.id === record._id);
        const sameEp = prog && (kind === "movie" || (+prog.episode === episode && (kind !== "series" || +prog.season === season)));
        startAt.current = sameEp ? parseFloat(prog.timecode) || 0 : 0;
        const loadList = async () =>
          kind === "movie" ? t.item.sources || [] : (await getSources(kind, id, season, episode)).sources || [];
        // watched before and still on disk: play it straight away, no source search or swarm race
        if (!forcedHash) {
          const recalled = await recallPick(pickParams).catch(() => null);
          if (!alive) return;
          if (recalled && recalled.success) {
            setStatus("Playing from your library…");
            const d = await streamInfo(recalled.hash, { ...pickParams, file: recalled.index }).catch(() => null);
            if (!alive) return;
            if (d && d.success) {
              const s = { hash: recalled.hash, name: d.name, local: true };
              setSources([s]);
              setSource(s);
              start(d, s);
              // other sources stay pickable from the menu
              loadList()
                .then((more) => alive && setSources([s, ...more.filter((x) => x.hash !== s.hash)]))
                .catch(() => {});
              return;
            }
          }
        }
        const list = await loadList();
        if (!alive) return;
        if (!list.length) throw new Error("No torrents were found for this episode yet.");
        let ordered = list;
        if (forcedHash) ordered = [...list].sort((a, b) => (a.hash === forcedHash ? -1 : b.hash === forcedHash ? 1 : 0));
        else if (list.length > 1) {
          // listed seed counts are often stale: rank the top candidates by peers actually reachable
          setStatus("Checking which sources are alive…");
          const top = list.slice(0, 4);
          const stats = await raceSources(top.map((s) => s.hash), { season: kind === "series" ? season : undefined, episode: kind === "movie" ? undefined : episode }).catch(() => []);
          if (!alive) return;
          const stat = (h) => stats.find((x) => x.hash === h) || {};
          const peers = (h) => stat(h).peers || 0;
          // already downloaded first, then keep the quality ranking; only push nearly-dead swarms to the back
          const raced = top
            .map((s, i) => ({ s, i, disk: stat(s.hash).onDisk ? 1 : 0, alive: peers(s.hash) >= 3 ? 1 : 0 }))
            .sort((a, b) => b.disk - a.disk || b.alive - a.alive || a.i - b.i)
            .map((x) => ({ ...x.s, livePeers: peers(x.s.hash), local: !!x.disk }));
          ordered = [...raced, ...list.slice(4)];
        }
        setSources(ordered);
        trySources(ordered, 0, () => alive);
      } catch (e) {
        if (alive) {
          setError(e.message);
          setPhase("error");
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line
  }, [kind, id, season, episode]);

  const trySources = async (list, i, alive) => {
    for (let n = i; n < Math.min(list.length, i + 4); n++) {
      const s = list[n];
      if (!alive()) return;
      setSource(s);
      setStatus(n === i ? "Connecting to peers…" : `Trying another source (${n + 1}/${list.length})…`);
      try {
        const d = await streamInfo(s.hash, { ...pickParams, episode: s.fileEpisode || episode || undefined, season: s.fileSeason || undefined });
        if (!alive()) return;
        if (d.success) {
          start(d, s);
          return;
        }
      } catch (e) {}
    }
    if (alive()) {
      setError("None of the sources responded. Pick another one below or try again later.");
      setPhase("error");
    }
  };

  const start = (d, s) => {
    const a = d.audio.findIndex((t) => t.language === (kind === "anime" ? "jpn" : "eng"));
    const textSubs = d.subtitles.filter((t) => t.text);
    const eng = textSubs.find((t) => t.language === "eng" && !t.forced && !/sign|song/i.test(t.title)) || textSubs.find((t) => t.language === "eng");
    const forced = textSubs.find((t) => t.forced && t.language === "eng");
    const saved = localStorage.getItem("nf-subs");
    let subIndex = -1;
    if (kind === "anime" && saved !== "off") subIndex = eng ? eng.index : textSubs[0] ? textSubs[0].index : -1;
    else if (saved === "on" && eng) subIndex = eng.index;
    else if (forced) subIndex = forced.index;
    setAudio(a >= 0 ? a : 0);
    setSub(subIndex);
    // a sync adjustment needs the audio re-timed on the server, so skip direct play
    const direct = d.direct && !sync && !saver;
    setInfo({ ...d, direct, source: s });
    setOffset(direct ? 0 : startAt.current);
    setPhase("ready");
  };

  // ----- stream url -----
  const src = (() => {
    if (!info) return null;
    // media comes from a second hostname with a signed token (see streamRouter)
    const base = info.mediaBase || SERVER;
    const token = info.token ? `token=${encodeURIComponent(info.token)}` : "";
    if (info.direct) return `${base}/stream/raw/${info.hash}/${info.index}${token ? `?${token}` : ""}`;
    // iPhone/iPad/Safari can't play an endless MP4 stream, but play HLS natively
    if (NATIVE_HLS)
      return `${base}/stream/hls/${info.hash}/${info.index}/index.m3u8?t=${offset.toFixed(2)}&audio=${audio}&sub=${sub}&sid=${sid.current}&sync=${sync}&q=${saver ? "saver" : ""}&${token}`;
    return `${base}/stream/play/${info.hash}/${info.index}?t=${offset.toFixed(2)}&audio=${audio}&sub=${sub}&sid=${sid.current}&sync=${sync}&q=${saver ? "saver" : ""}&${token}`;
  })();

  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    setWaiting(true);
    setNow(0);
    setCues([]);
    setRealStart(null);
    v.src = src;
    v.volume = volume;
    // direct files resume once metadata is known (setting currentTime earlier is ignored)
    pendingSeek.current = info.direct && startAt.current ? startAt.current : null;
    v.play().catch(() => setPlaying(false));
    // eslint-disable-next-line
  }, [src]);

  // swarm stats while loading/buffering
  useEffect(() => {
    if (!source || (phase === "ready" && !waiting)) return;
    const poll = () => streamStatus(source.hash).then((s) => setSwarm(s)).catch(() => {});
    poll();
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  }, [source, phase, waiting]);

  // session info: the real start point, plus subtitles extracted by ffmpeg as it goes
  useEffect(() => {
    if (!transcoding) return;
    let alive = true;
    const poll = () =>
      streamSubs(sid.current)
        .then((d) => {
          if (!alive || Math.abs((d.requested || 0) - offset) > 0.05) return;
          setRealStart(d.offset);
          if (sub >= 0) setCues(parseVtt(d.vtt));
        })
        .catch(() => {});
    const t = setInterval(poll, 2000);
    poll();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [transcoding, sub, offset]);

  // ----- next episode prefetch -----
  // 30s into an episode, start downloading the next one in full so binge-watching never waits.
  // A season pack we're already playing from is tried first (it usually has the next episode).
  const prefetched = useRef(null);
  useEffect(() => {
    if (!nextEp || phase !== "ready" || position < 30) return;
    const nextKey = pickKey(kind, id, nextEp.season, nextEp.number);
    if (prefetched.current === nextKey) return;
    prefetched.current = nextKey;
    getSources(kind, id, nextEp.season, nextEp.number)
      .then((d) => {
        const list = (d && d.sources) || [];
        const pack = source && source.batch ? [{ hash: source.hash }] : [];
        return prepareSources(kind, id, nextEp.season, nextEp.number, [...pack, ...list.filter((x) => !pack.length || x.hash !== source.hash)], { full: true });
      })
      .catch(() => {});
  }, [nextEp, phase, position, kind, id, source]);

  // ----- progress -----
  const saveProgress = useCallback(
    (force) => {
      if (!doc || !duration || position < 5) return;
      if (!force && Date.now() - saveTimer.current < 20000) return;
      saveTimer.current = Date.now();
      const percent = Math.round((position / duration) * 100);
      if (percent >= 95) {
        if (nextEp) {
          api.post(`/movies/${doc._id}/inprogress`, { ytsId: `${kind}:${id}`, percent: 0, timecode: "0", season: nextEp.season, episode: nextEp.number });
        } else {
          api.post(`/movies/${doc._id}/recents`);
          api.delete(`/movies/${doc._id}/inprogress`);
        }
        return;
      }
      api.post(`/movies/${doc._id}/inprogress`, {
        ytsId: `${kind}:${id}`,
        percent,
        timecode: position.toFixed(1),
        season: season || undefined,
        episode: episode || undefined,
      });
    },
    [doc, duration, position, nextEp, kind, id, season, episode]
  );
  const saveRef = useRef(saveProgress);
  saveRef.current = saveProgress;
  useEffect(() => () => saveRef.current(true), []);
  useEffect(() => {
    const onHide = () => saveRef.current(true);
    const onVisibility = () => document.visibilityState === "hidden" && onHide();
    window.addEventListener("beforeunload", onHide);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ----- controls -----
  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    // one stable key per tap: the icon fades once even though the player re-renders while playing
    setFlash({ kind: v.paused ? "pause" : "play", n: Date.now() });
  };

  const seekTo = (t) => {
    t = Math.max(0, Math.min(duration - 1, t));
    const v = video.current;
    if (!v || !info) return;
    if (info.direct) {
      v.currentTime = t;
      return;
    }
    // inside what the browser already has? seek locally; otherwise restart ffmpeg there
    if (t >= base && v.buffered.length && t - base <= v.buffered.end(v.buffered.length - 1)) v.currentTime = t - base;
    else {
      setOffset(t);
      setCues([]);
    }
  };

  const setVol = (val) => {
    const v = video.current;
    setVolume(val);
    setMuted(val === 0);
    if (v) {
      v.volume = val;
      v.muted = val === 0;
    }
    localStorage.setItem("nf-volume", String(val));
  };

  // Desktop/Android/iPad fullscreen the whole player (custom controls stay). iPhone Safari can only
  // fullscreen the <video> itself in Apple's native player, which also follows device rotation.
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const toggleFullscreen = () => {
    const el = root.current;
    const v = video.current;
    if (fsElement()) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (el && el.requestFullscreen) {
      el.requestFullscreen()
        .then(() => window.screen.orientation && window.screen.orientation.lock && window.screen.orientation.lock("landscape").catch(() => {}))
        .catch(() => {});
    } else if (el && el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  };
  useEffect(() => {
    const f = () => setFullscreen(!!fsElement());
    document.addEventListener("fullscreenchange", f);
    document.addEventListener("webkitfullscreenchange", f);
    return () => {
      document.removeEventListener("fullscreenchange", f);
      document.removeEventListener("webkitfullscreenchange", f);
    };
  }, []);

  // ----- downloadable subtitles -----
  const searchExt = useCallback(() => {
    if (!item || !item.imdb || !info) return Promise.resolve([]);
    setExtList("loading");
    return findSubtitles({ imdb: item.imdb, season: kind === "series" ? season : undefined, episode: kind === "series" ? episode : undefined, name: info.name })
      .then((d) => {
        const l = (d && d.subtitles) || [];
        setExtList(l);
        return l;
      })
      .catch(() => {
        setExtList([]);
        return [];
      });
  }, [item, info, kind, season, episode]);
  const pickExt = (t) => {
    setSub(-1);
    setExt({ id: t.id, cues: [], loading: true });
    localStorage.setItem("nf-subs", "on");
    getSubtitle(t.id)
      .then((text) => setExt((cur) => (cur && cur.id === t.id ? { id: t.id, cues: parseVtt(text) } : cur)))
      .catch(() => setExt((cur) => (cur && cur.id === t.id ? null : cur)));
  };
  // opening the subtitles menu looks them up right away (one less click on the TV remote)
  useEffect(() => {
    if (panel === "tracks" && extList === null && item && item.imdb && kind !== "anime") searchExt();
    // eslint-disable-next-line
  }, [panel]);
  // subtitles turned on before and this file has none built in: fetch the best English match
  const autoExt = useRef(null);
  useEffect(() => {
    if (phase !== "ready" || !info || !item || !item.imdb || kind === "anime") return;
    const key = `${info.hash}:${info.index}`;
    if (autoExt.current === key) return;
    autoExt.current = key;
    setExt(null);
    setExtList(null);
    const hasEng = info.subtitles.some((t) => t.text && t.language === "eng" && !t.forced);
    if (localStorage.getItem("nf-subs") !== "on" || hasEng) return;
    searchExt().then((l) => {
      const best = l.filter((t) => t.lang === "eng").sort((a, b) => b.score - a.score)[0];
      if (best) pickExt(best);
    });
    // eslint-disable-next-line
  }, [phase, info, item]);

  // Apple's native fullscreen player can't see our subtitle overlay, so mirror the cues into a
  // real text track and show it only while that player is up.
  const nativeTrack = useRef(null);
  const [nativeFs, setNativeFs] = useState(false);
  useEffect(() => {
    const v = video.current;
    if (!v || !v.webkitEnterFullscreen) return;
    const on = () => setNativeFs(true);
    const off = () => setNativeFs(false);
    v.addEventListener("webkitbeginfullscreen", on);
    v.addEventListener("webkitendfullscreen", off);
    return () => {
      v.removeEventListener("webkitbeginfullscreen", on);
      v.removeEventListener("webkitendfullscreen", off);
    };
  }, []);
  useEffect(() => {
    const v = video.current;
    if (!v || !v.addTextTrack || typeof window.VTTCue === "undefined") return;
    if (!nativeTrack.current) nativeTrack.current = { track: v.addTextTrack("subtitles", "Subtitles", "en"), added: 0 };
    const nt = nativeTrack.current;
    // downloaded cues are in title time; the video element counts from where the stream began
    const shift = ext ? subDelay - (transcoding ? base : 0) : 0;
    const list = ext ? ext.cues : cues;
    const key = ext ? `${ext.id}:${shift}` : "built-in";
    // a new stream (seek, track change) resets the cue list
    if (list.length < nt.added || (sub < 0 && !ext) || nt.key !== key) {
      Array.from(nt.track.cues || []).forEach((c) => nt.track.removeCue(c));
      nt.added = 0;
      nt.key = key;
    }
    if (sub >= 0 || ext) {
      list.slice(nt.added).forEach((c) => c.end + shift > 0 && nt.track.addCue(new window.VTTCue(Math.max(0, c.start + shift), c.end + shift, c.text)));
      nt.added = list.length;
    }
    nt.track.mode = nativeFs && (sub >= 0 || ext) ? "showing" : "hidden";
  }, [cues, sub, ext, subDelay, base, transcoding, nativeFs]);

  // on touch screens a tap shows/hides the controls (play/pause is the on-screen button)
  const lastPointer = useRef("mouse");

  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 3200);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(idleTimer.current);
    // eslint-disable-next-line
  }, []);

  const goNext = () => nextEp && history.replace(watchPath(item, nextEp.season, nextEp.number));
  const leave = () => history.push(item ? titlePath(item) : "/");

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      // TV remotes: OK (Enter) pauses unless a control has focus; dedicated media keys too
      const onControl = document.activeElement && /^(BUTTON|A|INPUT)$/.test(document.activeElement.tagName);
      if (k === " " || k === "k" || k === "mediaplaypause" || (k === "enter" && !onControl)) {
        e.preventDefault();
        togglePlay();
      } else if (k === "mediaplay" && video.current && video.current.paused) togglePlay();
      else if (k === "mediapause" && video.current && !video.current.paused) togglePlay();
      else if (k === "arrowright" || k === "l" || k === "mediafastforward") seekTo(position + 10);
      else if (k === "arrowleft" || k === "j" || k === "mediarewind") seekTo(position - 10);
      else if (k === "arrowup") setVol(Math.min(1, volume + 0.1));
      else if (k === "arrowdown") setVol(Math.max(0, volume - 0.1));
      else if (k === "f") toggleFullscreen();
      else if (k === "m") setVol(muted ? volume || 1 : 0);
      else if (k === "n") goNext();
      else if (k === "escape" && !document.fullscreenElement) leave();
      wake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // next-episode prompt near the end
  useEffect(() => {
    if (!nextEp || !duration) return;
    if (duration - position < 45 && nextCountdown === null) setNextCountdown(10);
  }, [position, duration, nextEp, nextCountdown]);
  useEffect(() => {
    if (nextCountdown === null || nextCountdown === "off") return;
    if (nextCountdown <= 0) return goNext();
    const t = setTimeout(() => setNextCountdown((c) => (typeof c === "number" ? c - 1 : c)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [nextCountdown]);

  const cue = ext
    ? ext.cues.find((c) => position - subDelay >= c.start && position - subDelay < c.end)
    : sub >= 0 && cues.find((c) => now >= c.start && now < c.end);
  const heading = item ? item.title : "";
  const sub2 =
    currentEp && kind !== "movie"
      ? `${kind === "series" ? `S${season}:` : ""}E${episode}${currentEp.title && !/^Episode \d+$/.test(currentEp.title) ? ` “${currentEp.title}”` : ""}`
      : "";

  // restart the stream at the current spot with the new audio timing
  const changeSync = (value) => {
    const v = Math.max(-3000, Math.min(3000, value));
    setSyncState(v);
    if (v) localStorage.setItem(syncKey, String(v));
    else localStorage.removeItem(syncKey);
    if (info) {
      if (info.direct) setInfo({ ...info, direct: false });
      setOffset(position);
    }
  };

  // switch quality and restart the stream at the current spot
  const changeSaver = (on) => {
    if (on === saver) return;
    setSaver(on);
    localStorage.setItem("nf-saver", on ? "1" : "0");
    if (info) {
      if (info.direct && on) setInfo({ ...info, direct: false });
      setOffset(position);
    }
  };

  const scrubFrom = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };

  const pickSource = (s) => {
    setPanel(null);
    setPhase("loading");
    setInfo(null);
    setError(null);
    const i = sources.findIndex((x) => x.hash === s.hash);
    startAt.current = position;
    trySources(sources, i, () => true);
  };

  return (
    <div
      ref={root}
      className={`nf-player${idle && playing && !panel ? " idle" : ""}`}
      onMouseMove={wake}
      onTouchStart={wake}
      onPointerDown={(e) => (lastPointer.current = e.pointerType)}
      onClick={() => panel && setPanel(null)}
    >
      <video
        ref={video}
        playsInline
        onClick={(e) => {
          e.stopPropagation();
          if (panel) return setPanel(null);
          if (lastPointer.current === "touch") {
            if (idle) wake();
            else {
              clearTimeout(idleTimer.current);
              setIdle(true);
            }
            return;
          }
          togglePlay();
        }}
        onDoubleClick={toggleFullscreen}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setNow(v.currentTime);
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
          saveProgress(false);
        }}
        onLoadedMetadata={(e) => {
          if (pendingSeek.current) {
            e.currentTarget.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          saveProgress(true);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => {
          saveProgress(true);
          if (nextEp) goNext();
        }}
        onError={() => {
          if (phase === "ready" && info && info.direct) {
            // container the browser can't handle after all: fall back to transcoding
            setInfo({ ...info, direct: false });
          }
        }}
      />

      {cue && (
        <div className="nf-subtitle">
          <span>{cue.text}</span>
        </div>
      )}

      {(phase !== "ready" || waiting) && (
        <div className={`nf-player-center${phase === "error" ? " interactive" : ""}`}>
          {phase !== "ready" && item && <div className="nf-player-backdrop" style={{ backgroundImage: `url("${item.backdrop || item.poster}")` }} />}
          {phase === "error" ? (
            <div className="nf-loading-card" style={{ width: "min(720px, calc(92 * var(--vw, 1vw)))", maxWidth: "none" }}>
              <h2>Can't play this right now</h2>
              <p>{error}</p>
              {sources && sources.length > 0 && (
                <div style={{ textAlign: "left", marginTop: 20 }}>
                  <SourceList sources={sources} current={source && source.hash} onPick={pickSource} />
                </div>
              )}
              <button className="nf-btn secondary small" style={{ marginTop: 18 }} onClick={leave}>
                Back to title
              </button>
            </div>
          ) : (
            <div className="nf-loading-card">
              <div className="nf-spinner" style={{ margin: "0 auto 18px" }} />
              {phase !== "ready" && (
                <>
                  <h2>{heading}</h2>
                  {sub2 && <p style={{ color: "#fff", fontSize: 16 }}>{sub2}</p>}
                  <p>{status}</p>
                </>
              )}
              {swarm && swarm.ready && !swarm.local && (
                <p>
                  {swarm.peers} peers · {fmtSpeed(swarm.speed)}
                </p>
              )}
              {source && phase !== "ready" && (
                <p style={{ fontSize: 12, color: "#6e6e78" }}>
                  {source.name} · {source.local ? "on this device" : `${source.seeds} seeds`}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {flash && (
        <div className="nf-flash" key={flash.n} onAnimationEnd={() => setFlash(null)}>
          {flash.kind === "play" ? <I.Play size={38} /> : <I.Pause size={38} />}
        </div>
      )}

      <div className="nf-player-top" onClick={(e) => e.stopPropagation()}>
        <button className="nf-pbtn" onClick={leave} aria-label="Back">
          <I.ArrowLeft size={30} />
        </button>
        <div className="nf-player-heading">
          {heading}
          {sub2 && <span>{sub2}</span>}
        </div>
      </div>

      {nextEp && nextCountdown !== null && nextCountdown !== "off" && phase === "ready" && (
        <div className="nf-next-up" onClick={(e) => e.stopPropagation()}>
          <button className="nf-btn secondary small" onClick={() => setNextCountdown("off")}>
            Watch credits
          </button>
          <button className="nf-btn primary small" onClick={goNext}>
            <I.NextEp size={18} /> Next episode in {nextCountdown}
          </button>
        </div>
      )}

      {phase === "ready" && (
        <div className="nf-player-bottom" onClick={(e) => e.stopPropagation()}>
          <div
            className="nf-scrub"
            onClick={(e) => seekTo(scrubFrom(e))}
            onMouseMove={(e) => setHover({ x: e.nativeEvent.offsetX, t: scrubFrom(e) })}
            onMouseLeave={() => setHover(null)}
          >
            <div className="nf-scrub-rail">
              <div
                className="nf-scrub-buffer"
                style={{ width: `${duration ? Math.min(100, (((transcoding ? base : 0) + buffered) / duration) * 100) : 0}%` }}
              />
              <div className="nf-scrub-fill" style={{ width: `${duration ? (position / duration) * 100 : 0}%` }} />
              <div className="nf-scrub-knob" style={{ left: `${duration ? (position / duration) * 100 : 0}%` }} />
            </div>
            {hover && (
              <div className="nf-scrub-tip" style={{ left: hover.x }}>
                {fmt(hover.t)}
              </div>
            )}
          </div>
          <div className="nf-controls">
            <button className="nf-pbtn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <I.Pause size={32} /> : <I.Play size={32} />}
            </button>
            <button className="nf-pbtn" onClick={() => seekTo(position - 10)} aria-label="Back 10 seconds">
              <I.Back10 size={30} />
            </button>
            <button className="nf-pbtn" onClick={() => seekTo(position + 10)} aria-label="Forward 10 seconds">
              <I.Fwd10 size={30} />
            </button>
            <div className="nf-volume">
              <button className="nf-pbtn" onClick={() => setVol(muted || volume === 0 ? 1 : 0)} aria-label="Mute">
                {muted || volume === 0 ? <I.Mute size={28} /> : <I.Volume size={28} />}
              </button>
              <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(e) => setVol(parseFloat(e.target.value))} />
            </div>
            <span className="nf-time">
              {fmt(position)} / {fmt(duration)}
            </span>
            <div className="nf-controls-title">
              {heading}
              {sub2 && <span style={{ color: "#a3a3ad" }}> · {sub2}</span>}
            </div>
            {nextEp && (
              <button className="nf-pbtn" onClick={goNext} aria-label="Next episode" title="Next episode (N)">
                <I.NextEp size={28} />
              </button>
            )}
            {episodeList.length > 1 && (
              <button className="nf-pbtn" onClick={() => setPanel(panel === "episodes" ? null : "episodes")} aria-label="Episodes">
                <I.Episodes size={28} />
              </button>
            )}
            <button className="nf-pbtn" onClick={() => setPanel(panel === "tracks" ? null : "tracks")} aria-label="Audio & subtitles">
              <I.Subtitles size={28} />
            </button>
            <button className="nf-pbtn" onClick={() => setPanel(panel === "sources" ? null : "sources")} aria-label="Sources">
              <I.Layers size={26} />
            </button>
            <button className="nf-pbtn" onClick={toggleFullscreen} aria-label="Fullscreen">
              {fullscreen ? <I.ExitFullscreen size={28} /> : <I.Fullscreen size={28} />}
            </button>
          </div>
        </div>
      )}

      {panel === "tracks" && info && (
        <div className="nf-popover" onClick={(e) => e.stopPropagation()}>
          <h4>Subtitles</h4>
          <button
            className={sub < 0 && !ext ? "on" : ""}
            onClick={() => {
              setSub(-1);
              setExt(null);
              localStorage.setItem("nf-subs", "off");
            }}
          >
            Off
          </button>
          {info.subtitles
            .filter((t) => t.text)
            .map((t) => (
              <button
                key={t.index}
                className={sub === t.index ? "on" : ""}
                onClick={() => {
                  setExt(null);
                  if (sub === t.index) return;
                  setSub(t.index);
                  localStorage.setItem("nf-subs", "on");
                  if (info.direct) setInfo({ ...info, direct: false });
                  setOffset(position);
                }}
              >
                {trackName(t)}
                {t.forced ? " (signs)" : ""}
              </button>
            ))}
          {item && item.imdb && kind !== "anime" && (
            <>
              <h4>Online subtitles</h4>
              {extList === null && <button onClick={searchExt}>Search OpenSubtitles…</button>}
              {extList === "loading" && <button disabled>Searching…</button>}
              {Array.isArray(extList) && extList.length === 0 && <button disabled>None found</button>}
              {Array.isArray(extList) &&
                extList.slice(0, 6).map((t) => (
                  <button key={t.id} className={ext && ext.id === t.id ? "on" : ""} onClick={() => pickExt(t)} title={t.release}>
                    {t.label}
                    {ext && ext.id === t.id && ext.loading ? " (loading…)" : ""}
                    <small style={{ display: "block", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.release}</small>
                  </button>
                ))}
              {ext && (
                <>
                  <h4>Subtitle timing</h4>
                  <div className="nf-sync">
                    <button onClick={() => setSubDelay(+(subDelay - 0.5).toFixed(1))}>−0.5 s</button>
                    <span className={subDelay ? "on" : ""}>{subDelay > 0 ? `+${subDelay}` : subDelay} s</span>
                    <button onClick={() => setSubDelay(+(subDelay + 0.5).toFixed(1))}>+0.5 s</button>
                  </div>
                  <p className="nf-sync-hint">Text too early → press <b>+</b> · text late → press <b>−</b></p>
                </>
              )}
            </>
          )}
          {info.subtitles.length === 0 && !(item && item.imdb && kind !== "anime") && <button disabled>None in this file — try another source</button>}
          <h4>Quality</h4>
          <button className={!saver ? "on" : ""} onClick={() => changeSaver(false)}>
            Original{info.video && info.video.width ? ` (${info.video.width >= 3200 ? "4K" : info.video.width >= 1800 ? "1080p" : info.video.width >= 1200 ? "720p" : "SD"})` : ""}
          </button>
          <button className={saver ? "on" : ""} onClick={() => changeSaver(true)}>
            Data saver (720p · up to ~1 GB/hour)
          </button>
          <h4>Audio</h4>
          {info.audio.length === 0 && <button disabled>No audio tracks</button>}
          {info.audio.map((t) => (
            <button
              key={t.index}
              className={audio === t.index ? "on" : ""}
              disabled={info.direct}
              onClick={() => {
                if (audio === t.index) return;
                setAudio(t.index);
                if (!info.direct) setOffset(position);
              }}
            >
              {trackName(t)}
            </button>
          ))}
          <h4>Audio sync</h4>
          <div className="nf-sync">
            {[-100, -25].map((d) => (
              <button key={d} onClick={() => changeSync(sync + d)} title="Audio earlier">
                {d} ms
              </button>
            ))}
            <span className={sync ? "on" : ""}>{sync > 0 ? `+${sync}` : sync} ms</span>
            {[25, 100].map((d) => (
              <button key={d} onClick={() => changeSync(sync + d)} title="Audio later">
                +{d} ms
              </button>
            ))}
          </div>
          <p className="nf-sync-hint">
            Voice ahead of lips → press <b>+</b> · voice late → press <b>−</b>
            {sync !== 0 && (
              <button className="nf-link-btn" style={{ display: "inline", width: "auto", padding: 0, marginLeft: 8 }} onClick={() => changeSync(0)}>
                reset
              </button>
            )}
          </p>
        </div>
      )}

      {panel === "sources" && sources && (
        <div className="nf-popover" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
          <h4>Sources</h4>
          <div style={{ padding: "4px 12px" }}>
            <SourceList sources={sources} current={source && source.hash} onPick={pickSource} />
          </div>
        </div>
      )}

      {panel === "episodes" && (
        <div className="nf-popover" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
          <h4>Episodes</h4>
          {episodeList.map((e) => (
            <button
              key={`${e.season}-${e.number}`}
              className={e === currentEp ? "on" : ""}
              disabled={e.aired === false}
              onClick={() => history.replace(watchPath(item, e.season, e.number))}
            >
              {kind === "series" ? `S${e.season}:` : ""}E{e.number}
              <span className="src-meta" style={{ marginLeft: 8, textAlign: "left", flex: 1, whiteSpace: "normal" }}>
                {e.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default withRouter(Player);
