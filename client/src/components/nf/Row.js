import React, { useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Card from "./Card";
import { ChevronLeft, ChevronRight } from "./Icons";

const Row = ({ title, items, link, wide, getProgress, hideKind }) => {
  const track = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  const update = () => {
    const el = track.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 10);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
  };
  useEffect(update, [items]);

  const page = (dir) => {
    const el = track.current;
    const by = dir * (el.clientWidth - 120);
    // older TV browsers lack scrollBy({...}); the track's CSS already scrolls smoothly
    if (el.scrollBy) {
      try {
        return el.scrollBy({ left: by, behavior: "smooth" });
      } catch (e) {}
    }
    el.scrollLeft += by;
  };

  if (!items || !items.length) return null;
  return (
    <section className="nf-row">
      <h2 className="nf-row-title">
        {title}
        {link && <Link to={link}>Explore all ›</Link>}
      </h2>
      {canLeft && (
        <button className="nf-row-arrow left" onClick={() => page(-1)} aria-label="Scroll left">
          <ChevronLeft size={34} />
        </button>
      )}
      <div className="nf-row-track" ref={track} onScroll={update}>
        {items.map((item) => (
          <Card
            key={`${item.kind}-${item.id}`}
            item={item}
            wide={wide}
            hideKind={hideKind}
            progress={getProgress ? getProgress(item) : item.progress}
            label={item.label}
          />
        ))}
      </div>
      {canRight && (
        <button className="nf-row-arrow right" onClick={() => page(1)} aria-label="Scroll right">
          <ChevronRight size={34} />
        </button>
      )}
    </section>
  );
};

export const RowSkeleton = ({ count = 8 }) => (
  <section className="nf-row">
    <div className="nf-row-title">
      <div className="nf-skel" style={{ width: 220, height: 22 }} />
    </div>
    <div className="nf-row-track" style={{ overflow: "hidden" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="nf-card nf-skel" />
      ))}
    </div>
  </section>
);

export default Row;
