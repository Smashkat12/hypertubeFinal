import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { getMe, getMovieDoc, docToItem, libraryRecord } from "api";

// "My List" is backed by the user's existing heartbeat list (movie document ids)
const MyListContext = createContext({ items: [], has: () => false, toggle: () => {}, loaded: false, reload: () => {} });

const keyOf = (item) => `${item.kind}:${item.id}`;

export const MyListProvider = ({ children, enabled }) => {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const me = await getMe();
      const ids = ((me && me.heartbeat) || []).slice().reverse();
      const docs = await Promise.all(ids.map((h) => getMovieDoc(h.id).catch(() => null)));
      setItems(docs.filter(Boolean).map(docToItem));
    } catch (e) {}
    setLoaded(true);
  }, [enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  const has = (item) => items.some((i) => keyOf(i) === keyOf(item));

  const toggle = async (item) => {
    const existing = items.find((i) => keyOf(i) === keyOf(item));
    if (existing) {
      setItems((list) => list.filter((i) => keyOf(i) !== keyOf(item)));
      await api.delete(`/movies/${existing.docId}/heartbeat`).catch(() => {});
    } else {
      const doc = await libraryRecord(item);
      setItems((list) => [{ ...item, docId: doc._id }, ...list]);
      await api.post(`/movies/${doc._id}/heartbeat`).catch(() => {});
    }
  };

  return <MyListContext.Provider value={{ items, has, toggle, loaded, reload }}>{children}</MyListContext.Provider>;
};

export const useMyList = () => useContext(MyListContext);
