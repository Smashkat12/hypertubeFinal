import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDownloads, deleteDownload, cleanupDownloads, getTitle, titlePath } from "api";
import { Play } from "components/nf/Icons";

const fmtBytes = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, Math.round(b / 1024 ** 2))} MB`);
const fmtSpeed = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : `${Math.round(b / 1e3)} KB/s`);
const epLabel = (d) => (d.episode ? `${d.season ? `S${d.season} ` : ""}E${d.episode}` : "Movie");
const watchLink = (d) => {
  const q = [];
  if (d.season) q.push(`s=${d.season}`);
  if (d.episode) q.push(`e=${d.episode}`);
  return `/watch/${d.kind}/${d.id}${q.length ? `?${q.join("&")}` : ""}`;
};

// a delete button that asks once inline (the page can't use confirm())
const DeleteButton = ({ onDelete, label = "Delete" }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={`nf-btn small ${armed ? "red" : "secondary"}`} onClick={() => (armed ? onDelete() : setArmed(true))}>
      {armed ? "Tap again to delete" : label}
    </button>
  );
};

const Downloads = () => {
  const [data, setData] = useState(null);
  const [titles, setTitles] = useState({}); // "kind:id" -> catalog item
  const [error, setError] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [freed, setFreed] = useState(null);

  const load = useCallback(
    () =>
      getDownloads()
        .then((d) => (d.success ? setData(d) : setError("Could not load downloads")))
        .catch(() => setError("Could not reach the server")),
    []
  );

  // refresh while anything is downloading
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 3000);
    return () => clearInterval(t);
  }, [load]);

  // titles and posters for each show/movie
  useEffect(() => {
    if (!data) return;
    const want = [...new Set(data.items.map((d) => `${d.kind}:${d.id}`))].filter((k) => !(k in titles));
    want.forEach((k) => {
      const [kind, id] = k.split(":");
      setTitles((t) => ({ ...t, [k]: null }));
      getTitle(kind, id)
        .then((r) => r.success && setTitles((t) => ({ ...t, [k]: r.item })))
        .catch(() => {});
    });
    // eslint-disable-next-line
  }, [data]);

  if (error) return <div className="nf-page nf-center">{error}</div>;
  if (!data)
    return (
      <div className="nf-page nf-center">
        <div className="nf-spinner" />
      </div>
    );

  // group episodes by title, most recently watched first
  const groups = {};
  data.items.forEach((d) => {
    const k = `${d.kind}:${d.id}`;
    (groups[k] = groups[k] || []).push(d);
  });
  const ordered = Object.entries(groups)
    .map(([k, eps]) => [k, eps.sort((a, b) => (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0))])
    .sort((a, b) => Math.max(...b[1].map((x) => x.at || 0)) - Math.max(...a[1].map((x) => x.at || 0)));
  const partial = data.loose.filter((x) => !x.keep);
  const partialBytes = partial.reduce((s, x) => s + x.bytes, 0);
  const others = data.loose.filter((x) => x.keep);
  const usedPct = Math.min(100, (data.total / data.limit) * 100);

  const remove = (params) => deleteDownload(params).then(load);
  const cleanup = () => {
    setCleaning(true);
    cleanupDownloads()
      .then((r) => setFreed(r.freed || 0))
      .finally(() => {
        setCleaning(false);
        load();
      });
  };

  return (
    <div className="nf-page nf-downloads">
      <div className="nf-browse-head">
        <h1>Downloads</h1>
      </div>

      <div className="nf-dl-summary">
        <div>
          <strong>{fmtBytes(data.total)}</strong> of {fmtBytes(data.limit)} used
          <div className="nf-dl-bar">
            <div style={{ width: `${usedPct}%` }} />
          </div>
          <small>When it's full, the oldest downloads are removed first.</small>
        </div>
        {partial.length > 0 && (
          <div className="nf-dl-cleanup">
            <span>
              {partial.length} unfinished leftover{partial.length > 1 ? "s" : ""} · {fmtBytes(partialBytes)}
            </span>
            <button className="nf-btn small secondary" disabled={cleaning} onClick={cleanup}>
              {cleaning ? "Cleaning…" : "Clean up"}
            </button>
          </div>
        )}
        {freed !== null && <div className="nf-dl-freed">Freed {fmtBytes(freed)}.</div>}
      </div>

      {!ordered.length && (
        <div className="nf-empty">
          Nothing downloaded yet.
          <br />
          Anything you play is saved here automatically, so it starts instantly next time.
        </div>
      )}

      {ordered.map(([k, eps]) => {
        const item = titles[k];
        const [kind] = k.split(":");
        return (
          <section key={k} className="nf-dl-title">
            <Link to={item ? titlePath(item) : "#"} className="nf-dl-poster">
              {item && item.poster ? <img src={item.poster} alt="" loading="lazy" /> : <div />}
            </Link>
            <div className="nf-dl-body">
              <h2>
                {item ? <Link to={titlePath(item)}>{item.title}</Link> : "…"}
                <span className="nf-tag">{kind === "movie" ? "Movie" : kind === "anime" ? "Anime" : "Series"}</span>
              </h2>
              {eps.map((d) => (
                <div key={d.key} className="nf-dl-row">
                  <Link to={watchLink(d)} className="nf-icon-btn filled" aria-label="Play">
                    <Play size={14} />
                  </Link>
                  <div className="nf-dl-info">
                    <div className="nf-dl-line">
                      <strong>{epLabel(d)}</strong>
                      <span className="nf-dl-file" title={d.name}>
                        {d.name}
                      </span>
                    </div>
                    {d.complete ? (
                      <div className="nf-dl-meta">
                        <span className="nf-dl-badge done">✓ Downloaded</span> {fmtBytes(d.size)}
                      </div>
                    ) : (
                      <div className="nf-dl-meta">
                        <div className="nf-dl-bar small">
                          <div style={{ width: `${(d.progress || 0) * 100}%` }} />
                        </div>
                        {Math.round((d.progress || 0) * 100)}% of {fmtBytes(d.size)}
                        {d.downloading ? ` · ${fmtSpeed(d.speed || 0)}` : d.queued ? " · waiting for peers" : " · paused"}
                      </div>
                    )}
                  </div>
                  <DeleteButton onDelete={() => remove({ key: d.key })} />
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {others.length > 0 && (
        <section className="nf-dl-others">
          <h2>Other files</h2>
          {others.map((x) => (
            <div key={x.name} className="nf-dl-row">
              <div className="nf-dl-info">
                <span className="nf-dl-file" title={x.name}>
                  {x.name}
                </span>
                <div className="nf-dl-meta">{fmtBytes(x.bytes)}</div>
              </div>
              <DeleteButton onDelete={() => remove(x.hash ? { hash: x.hash } : { name: x.name })} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
};

export default Downloads;
