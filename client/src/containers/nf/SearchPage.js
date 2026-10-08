import React, { useEffect, useState } from "react";
import { withRouter } from "react-router-dom";
import { search } from "api";
import Card from "components/nf/Card";

const SECTIONS = [
  ["anime", "Anime"],
  ["series", "Series"],
  ["movies", "Movies"],
];

const SearchPage = ({ location }) => {
  const q = new URLSearchParams(location.search).get("q") || "";
  const [results, setResults] = useState(null);

  useEffect(() => {
    let alive = true;
    setResults(null);
    if (!q.trim()) return;
    search(q)
      .then((d) => alive && setResults(d))
      .catch(() => alive && setResults({ anime: [], series: [], movies: [] }));
    return () => {
      alive = false;
    };
  }, [q]);

  const total = results ? SECTIONS.reduce((n, [k]) => n + (results[k] || []).length, 0) : 0;

  return (
    <div className="nf-page">
      <div className="nf-browse-head">
        <h1 style={{ fontSize: 22, color: "#a3a3ad", fontWeight: 500 }}>
          Results for <span style={{ color: "#fff", fontWeight: 800 }}>“{q}”</span>
        </h1>
      </div>
      {!results && (
        <div className="nf-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="nf-card nf-skel" />
          ))}
        </div>
      )}
      {results && total === 0 && (
        <div className="nf-empty">
          Your search for “{q}” did not have any matches.
          <br />
          Try a different title, or the original Japanese title for anime.
        </div>
      )}
      {results &&
        SECTIONS.map(([key, label]) =>
          (results[key] || []).length ? (
            <div key={key}>
              <h2 className="nf-section-title">{label}</h2>
              <div className="nf-grid">
                {results[key].map((item) => (
                  <Card key={`${item.kind}-${item.id}`} item={item} hideKind />
                ))}
              </div>
            </div>
          ) : null
        )}
    </div>
  );
};

export default withRouter(SearchPage);
