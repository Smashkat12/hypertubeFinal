import React, { useEffect, useRef, useState, useCallback } from "react";
import { withRouter } from "react-router-dom";
import { browse, getGenres } from "api";
import Card from "components/nf/Card";

const TITLES = { anime: "Anime", series: "Series", movie: "Movies" };
const SORTS = {
  anime: [
    ["trending", "Trending"],
    ["popular", "Most popular"],
    ["rating", "Top rated"],
    ["newest", "Newest"],
    ["title", "A–Z"],
  ],
  series: [
    ["trending", "Trending now"],
    ["popular", "All-time popular"],
    ["rating", "Top rated"],
    ["newest", "Newest"],
    ["title", "A–Z"],
  ],
  movie: [
    ["trending", "Trending now"],
    ["popular", "Most downloaded"],
    ["latest", "Recently added"],
    ["rating", "Top rated"],
    ["newest", "Release year"],
    ["title", "A–Z"],
  ],
};
const FORMATS = [
  ["", "All formats"],
  ["TV", "TV series"],
  ["MOVIE", "Movies"],
  ["OVA", "OVA"],
  ["ONA", "ONA"],
  ["SPECIAL", "Specials"],
];

const Browse = ({ match }) => {
  const kind = match.params.kind;
  const [genres, setGenres] = useState([]);
  const [filters, setFilters] = useState({ genre: "", sort: SORTS[kind][0][0], yearFrom: "", yearTo: "", format: "" });
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const sentinel = useRef(null);
  const request = useRef(0);

  useEffect(() => {
    setFilters({ genre: "", sort: SORTS[kind][0][0], yearFrom: "", yearTo: "", format: "" });
    getGenres(kind).then(setGenres).catch(() => {});
    window.scrollTo(0, 0);
  }, [kind]);

  const load = useCallback(
    async (p, reset) => {
      const id = ++request.current;
      setLoading(true);
      try {
        const d = await browse(kind, { ...filters, page: p });
        if (id !== request.current) return;
        const list = d.items || [];
        setItems((prev) => {
          const merged = reset ? list : [...prev, ...list];
          const seen = new Set();
          return merged.filter((i) => !seen.has(i.id) && seen.add(i.id));
        });
        setDone(list.length === 0);
        setPage(p);
      } catch (e) {
        if (id === request.current) setDone(true);
      }
      if (id === request.current) setLoading(false);
    },
    [kind, filters]
  );

  // debounce filter changes (year fields are typed)
  useEffect(() => {
    setItems([]);
    setDone(false);
    const t = setTimeout(() => load(1, true), 300);
    return () => clearTimeout(t);
  }, [load]);

  // infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && !done && items.length) load(page + 1);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, done, page, items.length, load]);

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="nf-page">
      <div className="nf-browse-head">
        <h1>{TITLES[kind]}</h1>
        <div className="nf-filters">
          <select className="nf-select" value={filters.sort} onChange={(e) => set("sort", e.target.value)}>
            {SORTS[kind].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {kind === "anime" && (
            <select className="nf-select" value={filters.format} onChange={(e) => set("format", e.target.value)}>
              {FORMATS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}
          <input
            className="nf-input year"
            type="number"
            placeholder="From"
            min="1900"
            max="2100"
            value={filters.yearFrom}
            onChange={(e) => set("yearFrom", e.target.value)}
          />
          <input
            className="nf-input year"
            type="number"
            placeholder="To"
            min="1900"
            max="2100"
            value={filters.yearTo}
            onChange={(e) => set("yearTo", e.target.value)}
          />
        </div>
      </div>
      <div className="nf-chips">
        <button className={`nf-chip${!filters.genre ? " on" : ""}`} onClick={() => set("genre", "")}>
          All genres
        </button>
        {genres.map((g) => (
          <button key={g} className={`nf-chip${filters.genre === g ? " on" : ""}`} onClick={() => set("genre", g)}>
            {g}
          </button>
        ))}
      </div>
      <div className="nf-grid">
        {items.map((item) => (
          <Card key={item.id} item={item} hideKind />
        ))}
        {loading && Array.from({ length: items.length ? 6 : 18 }).map((_, i) => <div key={`s${i}`} className="nf-card nf-skel" />)}
      </div>
      {!loading && done && !items.length && <div className="nf-empty">Nothing matches these filters.</div>}
      <div ref={sentinel} style={{ height: 1 }} />
    </div>
  );
};

export default withRouter(Browse);
