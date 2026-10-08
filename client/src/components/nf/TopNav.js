import React, { useEffect, useRef, useState, useContext } from "react";
import { NavLink, Link, withRouter } from "react-router-dom";
import api, { getMe } from "api";
import { UserConsumer } from "store";
import { Search, Close, User, Settings, LogOut, Menu } from "./Icons";
import { avatarSrc } from "../../config";

const TopNav = ({ history, location }) => {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const [burger, setBurger] = useState(false);
  const [me, setMe] = useState(null);
  const input = useRef(null);
  const menuRef = useRef(null);
  const { avatar, updateAvatar, language, updateLanguage } = useContext(UserConsumer);

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    getMe()
      .then((u) => {
        if (!u) return;
        setMe(u);
        updateAvatar(u.avatar);
        if (u.language) updateLanguage(u.language);
      })
      .catch(() => {});
    // eslint-disable-next-line
  }, []);

  // keep the box in sync with /search?q=
  useEffect(() => {
    if (location.pathname === "/search") {
      const v = new URLSearchParams(location.search).get("q") || "";
      setQ(v);
      setOpen(true);
    }
    setBurger(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const close = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // search as you type (debounced), like Netflix
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const current = new URLSearchParams(location.search).get("q") || "";
      if (q.trim() && (location.pathname !== "/search" || current !== q.trim()))
        history[location.pathname === "/search" ? "replace" : "push"](`/search?q=${encodeURIComponent(q.trim())}`);
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line
  }, [q]);

  const toggleSearch = () => {
    if (open && q) {
      setQ("");
      if (location.pathname === "/search") history.push("/");
    }
    setOpen(!open || !!q);
    setTimeout(() => input.current && input.current.focus(), 50);
  };

  const setLang = (lang) => {
    updateLanguage(lang);
    api.put("/users/id", { language: lang }).catch(() => {});
  };

  const logout = async () => {
    await api.get("/auth/logout").catch(() => {});
    window.location.href = "/login";
  };

  return (
    <nav className={`nf-nav${solid ? " solid" : ""}`}>
      <button className="nf-burger" onClick={() => setBurger(!burger)} aria-label="Menu">
        <Menu />
      </button>
      <Link to="/" className="nf-logo">
        Hyper<span>tube</span>
      </Link>
      <div className={`nf-nav-links${burger ? " open" : ""}`}>
        <NavLink exact to="/" activeClassName="active">
          {language === "fr" ? "Accueil" : "Home"}
        </NavLink>
        <NavLink to="/browse/anime" activeClassName="active">
          Anime
        </NavLink>
        <NavLink to="/browse/series" activeClassName="active">
          {language === "fr" ? "Séries" : "Series"}
        </NavLink>
        <NavLink to="/browse/movie" activeClassName="active">
          {language === "fr" ? "Films" : "Movies"}
        </NavLink>
        <NavLink to="/my-list" activeClassName="active">
          {language === "fr" ? "Ma liste" : "My List"}
        </NavLink>
        <NavLink to="/downloads" activeClassName="active">
          {language === "fr" ? "Téléchargements" : "Downloads"}
        </NavLink>
      </div>
      <div className="nf-nav-right">
        <div className={`nf-search${open ? " open" : ""}`}>
          <button onClick={toggleSearch} aria-label="Search">
            {open && q ? <Close size={20} /> : <Search size={20} />}
          </button>
          <input
            ref={input}
            value={q}
            placeholder={language === "fr" ? "Titres, genres…" : "Titles, anime, series…"}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => !q && setOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && (setQ(""), setOpen(false))}
          />
        </div>
        <div className="nf-menu" ref={menuRef}>
          <img
            className="nf-avatar"
            src={avatar || (me && avatarSrc(me.avatar)) || `${api.defaults.baseURL}/public/avatars/default_avatar.png`}
            alt="Account"
            onClick={() => setMenu(!menu)}
          />
          {menu && (
            <div className="nf-menu-panel">
              {me && (
                <Link to="/profile" onClick={() => setMenu(false)}>
                  <User size={18} /> {me.username}
                </Link>
              )}
              <Link to="/settings" onClick={() => setMenu(false)}>
                <Settings size={18} /> {language === "fr" ? "Paramètres" : "Account settings"}
              </Link>
              <div className="nf-lang">
                <b className={language === "en" ? "on" : ""} onClick={() => setLang("en")}>
                  EN
                </b>
                |
                <b className={language === "fr" ? "on" : ""} onClick={() => setLang("fr")}>
                  FR
                </b>
              </div>
              <hr />
              <button onClick={logout}>
                <LogOut size={18} /> {language === "fr" ? "Se déconnecter" : "Sign out of Hypertube"}
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default withRouter(TopNav);
