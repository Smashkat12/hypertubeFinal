import React, { useEffect, useState } from "react";
import { withRouter } from "react-router-dom";
import { titlePath, watchPath } from "api";
import { Play, Info } from "./Icons";
import { matchScore, Scores } from "./Card";

const KIND = { anime: "A N I M E", series: "S E R I E S", movie: "F I L M" };

const Hero = ({ items, history }) => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!items || items.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), 12000);
    return () => clearInterval(timer);
  }, [items, index]);

  if (!items || !items.length) return <div className="nf-hero nf-skel" style={{ borderRadius: 0 }} />;
  const item = items[index % items.length];
  const score = matchScore(item.rating);
  const play = () => (item.kind === "movie" ? history.push(watchPath(item)) : history.push(`${titlePath(item)}?play=1`));

  return (
    <div className="nf-hero">
      <div key={item.id} className="nf-hero-bg" style={{ backgroundImage: `url("${item.backdrop || item.poster}")` }} />
      <div className="nf-hero-content" key={`c-${item.id}`}>
        <div className="nf-kind-tag">
          <i>H</i>
          {KIND[item.kind]}
        </div>
        <h1 className="nf-hero-title" style={item.title.length > 28 ? { fontSize: "clamp(28px, 3.2vw, 54px)" } : null}>
          {item.title}
        </h1>
        <div className="nf-hero-meta">
          {item.imdbScore ? <Scores item={item} big /> : score && <span className="nf-match">{score}% Match</span>}
          {item.year && <span>{item.year}</span>}
          {item.providers && item.providers[0] && <span className="nf-badge">{item.providers[0]}</span>}
          {item.episodes > 1 && <span className="nf-badge">{item.episodes} Episodes</span>}
          {item.genres && <span>{item.genres.slice(0, 3).join(" • ")}</span>}
        </div>
        <p className="nf-hero-overview">{item.overview}</p>
        <div className="nf-hero-actions">
          <button className="nf-btn primary" onClick={play}>
            <Play size={24} /> Play
          </button>
          <button className="nf-btn secondary" onClick={() => history.push(titlePath(item))}>
            <Info size={24} /> More Info
          </button>
        </div>
      </div>
      {items.length > 1 && (
        <div className="nf-hero-dots">
          {items.map((it, i) => (
            <button key={it.id} className={i === index % items.length ? "on" : ""} onClick={() => setIndex(i)} aria-label={it.title} />
          ))}
        </div>
      )}
    </div>
  );
};

export default withRouter(Hero);
