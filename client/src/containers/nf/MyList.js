import React from "react";
import Card from "components/nf/Card";
import { useMyList } from "components/nf/myList";

const MyList = () => {
  const { items, loaded } = useMyList();
  return (
    <div className="nf-page">
      <div className="nf-browse-head">
        <h1>My List</h1>
      </div>
      {!loaded && <div className="nf-center"><div className="nf-spinner" /></div>}
      {loaded && !items.length && (
        <div className="nf-empty">
          You haven't added anything yet.
          <br />
          Hover a title and press + to save it here.
        </div>
      )}
      <div className="nf-grid">
        {items.map((item) => (
          <Card key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </div>
    </div>
  );
};

export default MyList;
