import React, { useEffect, useMemo, useState } from "react";
import { withRouter } from "react-router-dom";
import api, { getTitle, getMe, libraryRecord, watchPath, getSources, prepareSources, getDownloads } from "api";
import { matchScore, Scores } from "components/nf/Card";
import Row from "components/nf/Row";
import { useMyList } from "components/nf/myList";
import { Play, Plus, Check, Star } from "components/nf/Icons";

const CHUNK = 50;

const fmtRuntime = (m) => (m ? (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`) : null);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

const Stars = ({ value, onRate }) => (
  <span className="nf-stars">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} className={n <= Math.round(value) ? "on" : ""} onClick={() => onRate && onRate(n)} aria-label={`${n} stars`}>
        <Star size={20} />
      </button>
    ))}
  </span>
);

// "Downloaded" / "Downloading 42%" next to an episode
export const DownloadBadge = ({ d }) => {
  if (!d) return null;
  if (d.complete) return <span className="nf-dl-badge done" title="Saved on the server — plays instantly">✓ Downloaded</span>;
  if (d.queued) return <span className="nf-dl-badge">↓ {Math.round((d.progress || 0) * 100)}%</span>;
  return null;
};

const TitlePage = ({ match, history, location }) => {
  const { kind, id } = match.params;
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [doc, setDoc] = useState(null);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState(kind === "movie" ? "details" : "episodes");
  const [season, setSeason] = useState(null);
  const [chunk, setChunk] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState([]);
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState({ average: 0, count: 0, mine: 0 });
  const [sources, setSources] = useState(null);
  const [downloads, setDownloads] = useState({}); // "season:episode" -> download state
  const { has, toggle } = useMyList();

  // which of this title's episodes are on disk / downloading (refreshed while any are in progress)
  useEffect(() => {
    let alive = true;
    let timer = null;
    const load = () =>
      getDownloads()
        .then((d) => {
          if (!alive) return;
          const mine = (d.items || []).filter((x) => x.kind === kind && String(x.id) === String(id));
          setDownloads(Object.fromEntries(mine.map((x) => [`${x.season || ""}:${x.episode || ""}`, x])));
          if (mine.some((x) => x.queued)) timer = setTimeout(load, 5000);
        })
        .catch(() => {});
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [kind, id]);
  const dlFor = (s, e) => downloads[`${kind === "series" ? s || "" : ""}:${kind === "movie" ? "" : e || ""}`];

  useEffect(() => {
    let alive = true;
    setItem(null);
    setError(null);
    setDoc(null);
    setSources(null);
    setTab(kind === "movie" ? "details" : "episodes");
    window.scrollTo(0, 0);
    getTitle(kind, id)
      .then(async (d) => {
        if (!alive) return;
        if (!d.success) return setError(d.error || "Title not found");
        setItem(d.item);
        const [record, user] = await Promise.all([libraryRecord(d.item).catch(() => null), getMe().catch(() => null)]);
        if (!alive) return;
        setDoc(record);
        setMe(user);
        if (record) {
          setComments(record.comments || []);
          api.get(`/movies/${record._id}/ratings`).then((r) =>
            setRating((x) => ({ ...x, average: r.data.ratingAverage || 0, count: r.data.ratingCount || 0 }))
          );
          api.get(`/movies/${record._id}/user/ratings`).then((r) => r.data.success && setRating((x) => ({ ...x, mine: r.data.rating })));
        }
      })
      .catch(() => alive && setError("Could not load this title"));
    return () => {
      alive = false;
    };
  }, [kind, id]);

  const progress = useMemo(() => {
    if (!me || !doc) return null;
    return (me.inProgress || []).find((p) => p.id === doc._id) || null;
  }, [me, doc]);

  // episode list normalised across anime / series
  const seasons = useMemo(() => {
    if (!item) return [];
    if (kind === "series") return item.seasons || [];
    if (kind === "anime") return [{ number: 1, episodes: item.episodeList || [] }];
    return [];
  }, [item, kind]);

  useEffect(() => {
    if (!seasons.length) return;
    const resumeSeason = progress && progress.season;
    const s = seasons.find((x) => x.number === resumeSeason) || seasons[0];
    setSeason(s.number);
    if (progress && progress.episode) setChunk(Math.floor((progress.episode - 1) / CHUNK));
  }, [seasons, progress]);

  const current = seasons.find((s) => s.number === season);
  const episodes = current ? current.episodes : [];
  const chunks = Math.ceil(episodes.length / CHUNK);
  const shown = episodes.slice(chunk * CHUNK, chunk * CHUNK + CHUNK);

  const resumeTarget = () => {
    if (kind === "movie") return watchPath(item);
    if (progress && progress.episode) return watchPath(item, kind === "series" ? progress.season || 1 : null, progress.episode);
    const first = seasons.find((s) => s.number > 0) || seasons[0];
    return watchPath(item, kind === "series" ? first && first.number : null, 1);
  };

  // warm up the episode Play would start: find sources, connect to the best one and pull its
  // first pieces in the background, so pressing Play starts in a second or two
  useEffect(() => {
    if (!item || !doc) return;
    if (kind === "movie") {
      prepareSources(kind, id, null, null, item.sources).catch(() => {});
      return;
    }
    if (!seasons.length) return;
    const ep = progress && progress.episode ? progress.episode : 1;
    const s = kind === "series" ? (progress && progress.season) || (seasons.find((x) => x.number > 0) || seasons[0]).number : undefined;
    if (dlFor(s, ep)) return; // already on disk or downloading
    getSources(kind, id, s, ep)
      .then((d) => prepareSources(kind, id, s, ep, d && d.sources))
      .catch(() => {});
    // eslint-disable-next-line
  }, [item, doc]);

  // Hero "Play" arrives with ?play=1
  useEffect(() => {
    if (item && doc && new URLSearchParams(location.search).get("play")) history.replace(resumeTarget());
    // eslint-disable-next-line
  }, [item, doc]);

  useEffect(() => {
    if (tab === "sources" && kind === "movie" && item && !sources) setSources(item.sources || []);
  }, [tab, kind, item, sources]);

  if (error) return <div className="nf-page nf-center">{error}</div>;
  if (!item)
    return (
      <div className="nf-center" style={{ minHeight: "calc(100 * var(--vh, 1vh))" }}>
        <div className="nf-spinner" />
      </div>
    );

  const inList = has(item);
  const score = matchScore(item.rating);
  const resumeLabel =
    progress && progress.episode
      ? `Resume ${kind === "series" ? `S${progress.season}:` : ""}E${progress.episode}`
      : progress
      ? "Resume"
      : kind === "movie"
      ? "Play"
      : `Play ${kind === "series" ? "S1:" : ""}E1`;

  const rate = async (n) => {
    if (!doc) return;
    setRating((r) => ({ ...r, mine: n }));
    await api.post(`/movies/${doc._id}/ratings`, { rating: n });
    const r = await api.get(`/movies/${doc._id}/ratings`);
    setRating((x) => ({ ...x, average: r.data.ratingAverage || 0, count: r.data.ratingCount || 0 }));
  };

  const postComment = async () => {
    const content = comment.trim();
    if (!content || !doc || !me) return;
    const c = { author: me.username, content };
    setComment("");
    setComments((list) => [...list, c]);
    await api.post(`/movies/${doc._id}/comments`, c);
  };

  const playEpisode = (ep, s) => {
    if (ep.aired === false) return;
    history.push(watchPath(item, kind === "series" ? s : null, ep.number));
  };

  const details = [
    ["Year", item.year],
    ["Status", item.status && item.status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())],
    ["Format", item.format && item.format.replace(/_/g, " ")],
    ["Episodes", kind === "anime" ? item.episodes : kind === "series" ? seasons.reduce((n, s) => n + s.episodes.length, 0) : null],
    ["Runtime", fmtRuntime(item.runtime || item.duration)],
    ["Studio", item.studio],
    ["Network", item.network],
    ["Next episode", item.nextAiring && `Ep ${item.nextAiring.episode} · ${fmtDate(item.nextAiring.airingAt * 1000)}`],
    ["Genres", (item.genres || []).join(", ")],
  ].filter(([, v]) => v);

  const tabs = [
    kind !== "movie" && ["episodes", "Episodes"],
    kind === "movie" && ["sources", "Versions"],
    ["details", "Details"],
    (item.recommendations || []).length || (item.relations || []).length ? ["more", "More Like This"] : null,
    ["comments", `Comments${comments.length ? ` (${comments.length})` : ""}`],
  ].filter(Boolean);

  return (
    <div>
      <div className="nf-title-hero">
        <div className="nf-hero-bg" style={{ backgroundImage: `url("${item.backdrop || item.poster}")` }} />
        <div className="nf-title-body">
          {item.poster && <img className="nf-title-poster" src={item.posterHd || item.poster} alt="" />}
          <div className="nf-title-info">
            <div className="nf-kind-tag">
              <i>H</i>
              {kind === "anime" ? "Anime" : kind === "series" ? "Series" : "Film"}
            </div>
            <h1>{item.title}</h1>
            {item.titleRomaji && item.titleRomaji !== item.title && <div className="nf-title-alt">{item.titleRomaji}</div>}
            <div className="nf-hero-meta">
              {item.imdbScore ? <Scores item={item} big /> : score && <span className="nf-match">{score}% Match</span>}
              {item.year && <span>{item.year}</span>}
              {item.providers && item.providers[0] && <span className="nf-badge">{item.providers.join(" · ")}</span>}
              {kind === "series" && seasons.length > 0 && (
                <span>
                  {seasons.length} Season{seasons.length > 1 ? "s" : ""}
                </span>
              )}
              {kind === "anime" && item.episodes && <span>{item.episodes} Episodes</span>}
              {fmtRuntime(item.runtime || (kind === "anime" && item.format === "MOVIE" && item.duration)) && (
                <span>{fmtRuntime(item.runtime || item.duration)}</span>
              )}
              {item.format && <span className="nf-badge">{item.format.replace(/_/g, " ")}</span>}
              <span className="nf-badge">HD</span>
            </div>
            <p className={`nf-title-overview${expanded ? "" : " clamp"}`}>{item.overview || "No synopsis available."}</p>
            {item.overview && item.overview.length > 320 && (
              <button className="nf-link-btn" onClick={() => setExpanded(!expanded)} style={{ marginTop: -12, marginBottom: 18 }}>
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
            <div className="nf-hero-actions">
              <button className="nf-btn primary" onClick={() => history.push(resumeTarget())}>
                <Play size={24} /> {resumeLabel}
              </button>
              <button className="nf-btn secondary" onClick={() => toggle(item)}>
                {inList ? <Check size={22} /> : <Plus size={22} />} My List
              </button>
              {kind === "movie" && <DownloadBadge d={dlFor(null, null)} />}
              {item.trailer && (
                <button className="nf-btn secondary" onClick={() => setTab("details")}>
                  Trailer
                </button>
              )}
            </div>
            {item.genres && item.genres.length > 0 && (
              <div className="nf-genres-line">
                <b>Genres: </b>
                {item.genres.join(", ")}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="nf-tabs">
        {tabs.map(([k, l]) => (
          <button key={k} className={`nf-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === "episodes" && (
        <div className="nf-tab-panel">
          <div className="nf-episodes-head">
            <h2>Episodes</h2>
            <div className="nf-filters">
              {seasons.length > 1 && (
                <select
                  className="nf-select"
                  value={season || ""}
                  onChange={(e) => {
                    setSeason(+e.target.value);
                    setChunk(0);
                  }}
                >
                  {seasons.map((s) => (
                    <option key={s.number} value={s.number}>
                      Season {s.number} ({s.episodes.length} episodes)
                    </option>
                  ))}
                </select>
              )}
              {chunks > 1 && (
                <select className="nf-select" value={chunk} onChange={(e) => setChunk(+e.target.value)}>
                  {Array.from({ length: chunks }).map((_, i) => (
                    <option key={i} value={i}>
                      Episodes {i * CHUNK + 1}–{Math.min(episodes.length, (i + 1) * CHUNK)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {!episodes.length && <div className="nf-empty">No episodes listed yet.</div>}
          {shown.map((ep) => {
            const isCurrent = progress && progress.episode === ep.number && (kind !== "series" || progress.season === season);
            return (
              <div
                key={ep.number}
                className={`nf-episode${isCurrent ? " current" : ""}${ep.aired === false ? " unaired" : ""}`}
                tabIndex={0}
                onClick={() => playEpisode(ep, season)}
              >
                <div className="nf-ep-num">{ep.number}</div>
                <div className="nf-ep-thumb">
                  {ep.still || item.backdrop || item.poster ? (
                    <img src={ep.still || item.backdrop || item.poster} alt="" loading="lazy" />
                  ) : null}
                  {ep.aired !== false && (
                    <div className="nf-play-overlay">
                      <span className="nf-icon-btn filled">
                        <Play size={16} />
                      </span>
                    </div>
                  )}
                  {isCurrent && (
                    <div className="nf-card-progress">
                      <div style={{ width: `${parseFloat(progress.percent) || 0}%` }} />
                    </div>
                  )}
                </div>
                <div>
                  <div className="nf-ep-title">
                    <span>{ep.title}</span>
                    <DownloadBadge d={dlFor(season, ep.number)} />
                  </div>
                  <div className="nf-ep-desc">
                    {ep.aired === false ? `Not aired yet${ep.airdate ? ` · ${fmtDate(ep.airdate)}` : ""}` : ep.overview || (ep.airdate ? fmtDate(ep.airdate) : "")}
                  </div>
                </div>
                <div className="nf-ep-side">{fmtRuntime(ep.runtime || item.duration || item.runtime)}</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "sources" && (
        <div className="nf-tab-panel">
          <p style={{ color: "#a3a3ad", marginTop: 0 }}>Choose a specific version. Play picks the best one automatically.</p>
          <SourceList sources={sources} onPick={(s) => history.push(`${watchPath(item)}?hash=${s.hash}`)} />
        </div>
      )}

      {tab === "details" && (
        <div className="nf-tab-panel">
          <dl className="nf-details-grid">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {item.cast && item.cast.length > 0 && (
            <>
              <h3>{kind === "anime" ? "Characters" : "Cast"}</h3>
              <div className="nf-cast" style={{ marginBottom: 36 }}>
                {item.cast.map((c, i) => (
                  <div className="nf-person" key={i}>
                    {c.image ? <img src={c.image} alt="" loading="lazy" /> : <div className="ph" />}
                    <div>
                      <b>{c.name}</b>
                      <span>{c.character}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {item.trailer && (
            <>
              <h3>Trailer</h3>
              <iframe
                className="nf-trailer"
                title="Trailer"
                src={`https://www.youtube.com/embed/${item.trailer}?rel=0`}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </>
          )}
        </div>
      )}

      {tab === "more" && (
        <div className="nf-tab-panel" style={{ padding: 0 }}>
          {(item.relations || []).length > 0 && (
            <Row title="Seasons & Related" items={item.relations.map((r) => ({ ...r, label: r.relation.replace(/_/g, " ").toLowerCase() }))} />
          )}
          {(item.recommendations || []).length > 0 && <Row title="Because you're viewing this" items={item.recommendations} />}
        </div>
      )}

      {tab === "comments" && (
        <div className="nf-tab-panel nf-comments">
          <div className="nf-rating-box">
            <span>Your rating</span>
            <Stars value={rating.mine} onRate={rate} />
            <span>
              {rating.count ? `${rating.average.toFixed(1)} / 5 from ${rating.count} rating${rating.count > 1 ? "s" : ""}` : "No ratings yet"}
            </span>
          </div>
          <div className="nf-comment-form">
            <textarea
              value={comment}
              placeholder="Share what you thought…"
              maxLength={1000}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), postComment())}
            />
            <button className="nf-btn red small" style={{ alignSelf: "flex-end" }} onClick={postComment} disabled={!comment.trim()}>
              Post
            </button>
          </div>
          {!comments.length && <div style={{ color: "#6e6e78" }}>No comments yet — be the first.</div>}
          {comments
            .slice()
            .reverse()
            .map((c, i) => (
              <div className="nf-comment" key={c._id || i}>
                <div className="nf-avatar" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                  {(c.author || "?")[0].toUpperCase()}
                </div>
                <div>
                  <b style={{ cursor: "pointer" }} onClick={() => history.push(`/user/${c.author}`)}>
                    {c.author}
                  </b>
                  <p>{c.content}</p>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export const SourceList = ({ sources, current, onPick }) => {
  if (!sources)
    return (
      <div className="nf-center" style={{ minHeight: 120 }}>
        <div className="nf-spinner" />
      </div>
    );
  if (!sources.length) return <div className="nf-empty">No torrents found for this one.</div>;
  return (
    <div className="nf-sources">
      {sources.map((s) => (
        <div key={s.hash} className={`nf-source${current === s.hash ? " on" : ""}`} onClick={() => onPick(s)}>
          <div className="nf-source-name" title={s.name}>
            {s.name}
          </div>
          <div className="nf-source-tags">
            {s.quality && <span className="nf-tag">{s.quality}</span>}
            <span className={`nf-tag${s.codec === "x264" ? " good" : ""}`}>{s.codec === "x264" ? "H.264" : s.codec}</span>
            {s.batch && <span className="nf-tag">Batch</span>}
            {s.dub && <span className="nf-tag hot">Dub</span>}
          </div>
          <span style={{ color: "#a3a3ad", whiteSpace: "nowrap" }}>{s.size}</span>
          <span className="nf-seeds">▲ {s.seeds}</span>
        </div>
      ))}
    </div>
  );
};

export default withRouter(TitlePage);
