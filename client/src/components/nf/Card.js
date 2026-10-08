import React, { useState } from "react";
import { withRouter } from "react-router-dom";
import { titlePath, watchPath } from "api";
import { Play, Plus, Check, ChevronDown } from "./Icons";
import { useMyList } from "./myList";

const KIND_LABEL = { anime: "Anime", series: "Series", movie: "Movie" };

// IMDb + Rotten Tomatoes badges (titles from the JustWatch trending feed carry both)
export const Scores = ({ item, big }) => (
  <span className={`nf-scores${big ? " big" : ""}`}>
    {item.imdbScore ? (
      <span className="nf-imdb">
        <b>IMDb</b> {item.imdbScore.toFixed(1)}
      </span>
    ) : null}
    {item.tomato ? (
      <span className={`nf-tomato${item.tomato >= 60 ? " fresh" : ""}`}>
        {item.tomato >= 60 ? "🍅" : "🤢"} {item.tomato}%
      </span>
    ) : null}
  </span>
);

export const matchScore = (rating) => (rating ? Math.min(99, Math.round(rating * 10)) : null);

const Card = ({ item, history, progress, label, wide, hideKind }) => {
  const [broken, setBroken] = useState(false);
  const { has, toggle } = useMyList();
  const inList = has(item);
  const open = () => history.push(titlePath(item));
  const play = (e) => {
    e.stopPropagation();
    if (item.resume) history.push(item.resume);
    else if (item.kind === "movie") history.push(watchPath(item));
    else history.push(titlePath(item));
  };
  const score = matchScore(item.rating);
  const image = wide ? item.backdrop || item.poster : item.poster;
  return (
    <div
      className={`nf-card${wide ? " wide" : ""}`}
      onClick={open}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && open()}
      title={item.title}
    >
      {image && !broken ? (
        <img className="nf-card-img" src={image} alt={item.title} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <div className="nf-card-fallback">{item.title}</div>
      )}
      {!hideKind && <span className={`nf-card-kind ${item.kind}`}>{KIND_LABEL[item.kind]}</span>}
      {item.providers && item.providers[0] && <span className="nf-card-provider">{item.providers[0]}</span>}
      {item.year >= new Date().getFullYear() && !label && !(progress > 0) && <span className="nf-card-new">NEW</span>}
      {label && <div className="nf-card-label">{label}</div>}
      {progress > 0 && (
        <div className="nf-card-progress">
          <div style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
      <div className="nf-card-hover" onClick={(e) => e.stopPropagation()}>
        <div className="nf-card-actions">
          <button className="nf-icon-btn filled" onClick={play} aria-label="Play">
            <Play size={14} />
          </button>
          <button
            className="nf-icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              toggle(item);
            }}
            aria-label={inList ? "Remove from My List" : "Add to My List"}
          >
            {inList ? <Check size={16} /> : <Plus size={16} />}
          </button>
          <button className="nf-icon-btn" onClick={open} aria-label="More info">
            <ChevronDown size={16} />
          </button>
        </div>
        <div className="nf-card-title">{item.title}</div>
        <div className="nf-card-meta">
          {item.imdbScore ? <Scores item={item} /> : score && <span className="nf-match">{score}% Match</span>}
          {item.year && <span>{item.year}</span>}
          {item.episodes > 1 && <span className="nf-badge">{item.episodes} eps</span>}
          {item.format && item.format !== "TV" && <span className="nf-badge">{item.format.replace("_", " ")}</span>}
        </div>
        {item.genres && item.genres.length > 0 && (
          <div className="nf-card-genres">
            {item.genres.slice(0, 3).map((g) => (
              <span key={g}>{g}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default withRouter(Card);
