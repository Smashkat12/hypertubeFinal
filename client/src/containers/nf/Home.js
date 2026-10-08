import React, { useEffect, useState } from "react";
import { getHome, getMe, getMovieDoc, docToItem } from "api";
import Hero from "components/nf/Hero";
import Row, { RowSkeleton } from "components/nf/Row";
import { useMyList } from "components/nf/myList";

// in-progress titles from the user's watch history, newest first
export const loadContinueWatching = async () => {
  const me = await getMe();
  const entries = ((me && me.inProgress) || []).slice().sort((a, b) => (b.time || 0) - (a.time || 0));
  const docs = await Promise.all(entries.map((e) => getMovieDoc(e.id).catch(() => null)));
  return docs
    .map((doc, i) => {
      const item = docToItem(doc);
      if (!item) return null;
      const e = entries[i];
      const ep = e.episode ? `${e.season ? `S${e.season}:` : ""}E${e.episode}` : null;
      const q = [];
      if (e.season) q.push(`s=${e.season}`);
      if (e.episode) q.push(`e=${e.episode}`);
      return {
        ...item,
        progress: parseFloat(e.percent) || 0,
        label: ep ? `${ep} · ${item.title}` : null,
        resume: `/watch/${item.kind}/${item.id}${q.length ? `?${q.join("&")}` : ""}`,
      };
    })
    .filter(Boolean);
};

const Home = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [continueItems, setContinue] = useState([]);
  const myList = useMyList();

  useEffect(() => {
    let alive = true;
    getHome()
      .then((d) => alive && (d.success ? setData(d) : setError(d.error)))
      .catch(() => alive && setError("Could not reach the server"));
    loadContinueWatching()
      .then((items) => alive && setContinue(items))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const browseLink = { anime: "/browse/anime", series: "/browse/series", movie: "/browse/movie" };

  return (
    <div>
      <Hero items={data && data.hero} />
      <div className="nf-rows">
        {error && <div className="nf-empty">{error}</div>}
        <Row title="Continue Watching" items={continueItems} />
        <Row title="My List" items={myList.items} link="/my-list" />
        {data
          ? data.rows.map((row) => <Row key={row.id} title={row.title} items={row.items} link={browseLink[row.kind]} hideKind={row.kind !== "mixed"} />)
          : !error && [0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}
      </div>
    </div>
  );
};

export default Home;
