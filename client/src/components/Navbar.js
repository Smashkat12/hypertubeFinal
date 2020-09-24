import React, { useState, useEffect, useContext, useRef } from "react";
import axios from "axios";

import translations from "translations";
import { ReactComponent as SearchIcon } from "icons/search.svg";
import { Link } from "react-router-dom";
import { UserConsumer } from "store";
import { escapeSpecial } from "utils/functions";

axios.defaults.withCredentials = true;

const Header = props => {
  const { extended } = props;
  const [searchMovie, updateBarSearchMovie] = useState("");
  const [movies, updateMovies] = useState([]);
  const [_isAuth, updateIsAuth] = useState(false);
  const [searchInProgress, updateSearchInProgress] = useState(false);
  const [toggleSearchBarCollapse, updateToggleSearchBarCollapse] = useState(false);
  const [toggleAvatarDropdown, updateToggleAvatarDropdown] = useState(false);
  const context = useContext(UserConsumer);
  const { language, updateSearch, avatar, updateAvatar } = context;
  const refSearchBar = useRef(null);
  const refSearchBarLow = useRef(null);
  const refAvatar = useRef(null);
  const isCanceled = useRef(false)
  let inProgress = false;

  useEffect(() => {
    return () => {
      isCanceled.current = true
    }
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      const responseAuth = await axios.get(`http://localhost:5000/auth/`);
      if (!isCanceled.current && responseAuth.data.auth) {
        updateIsAuth(true);
        window.addEventListener("mousedown", closeMenu);
        const responseUser = await  axios.get(`http://localhost:5000/users/id`);
        if (!isCanceled.current && responseUser.data.success) {
          updateAvatar(responseUser.data.user[0].avatar);
          if (searchMovie.trim() !== '') {
            const responseMovies = await axios.get(`http://localhost:5000/torrents/yts/search?search=${escapeSpecial(searchMovie)}&minyear=1900&maxyear=${new Date().getFullYear()}&minrating=0&maxrating=5`);
            if (!isCanceled.current && responseMovies.data.success)
              updateMovies(responseMovies.data.results);
          }
        }
      }
    };

    fetchData();
    return () => {
      window.removeEventListener("mousedown", closeMenu);
    };
  }, [updateAvatar, searchMovie]);

  useEffect(() => {
    const closeSearchBar = event => {
      if (refSearchBar.current.contains(event.target) || refSearchBarLow.current.contains(event.target)) {
        if (searchMovie.trim() !== "")
          updateSearchInProgress(true);
        return ;
      }
      updateSearchInProgress(false);
      updateToggleSearchBarCollapse(false);
    };

    if (_isAuth) {
      window.addEventListener("mousedown", closeSearchBar);
      return () => {
        window.removeEventListener("mousedown", closeSearchBar);
      };
    }
  }, [searchInProgress, _isAuth, searchMovie]);


  const closeMenu = event => {
    if (refAvatar.current && refAvatar.current.contains(event.target))
      return ;
    updateToggleAvatarDropdown(false);
  };

  const resetSearchBar = () => {
    updateBarSearchMovie("");
    updateSearchInProgress(false);
    updateSearch("");
  };

  const handleSearch = event => {
    if (extended) {
      if (event.target.value.trim() !== "")
        updateSearchInProgress(true);
      else
        updateSearchInProgress(false);
    }
    
    const searchValue = escapeSpecial(event.target.value);
    updateBarSearchMovie(searchValue);
    context.updateSearch(searchValue);
  };

  const checkDatabase = async ytsID => {
    if (inProgress) return;
    const responseMovies = await axios.get(
      `http://localhost:5000/movies/yts/${ytsID}`
    );
    if (!isCanceled.current && !responseMovies.data.success) {
      inProgress = true;
      const responseYts = await axios.get(
        `http://localhost:5000/torrents/yts/${ytsID}`
      );
      if (!isCanceled.current && responseYts) {
        const movie = responseYts.data.result.data.movie;
        movie.torrents.forEach(torrent => {
          torrent.magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURI(movie.title)}&tr=http://track.one:1234/announce&tr=udp://track.two:80`;
          torrent.magnet2 = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURI(movie.title)}&tr=http://track.one:1234/announce&tr=udp://tracker.openbittorrent.com:80`;
        });
        const newMovie = {
          ytsId: movie.id,
          name: movie.title,
          poster: movie.large_cover_image,
          ytsData: movie,
          description: movie.description_full,
          author: "Piraters of the web"
        };
        const responseNewMovie = await axios.post(
          `http://localhost:5000/movies`,
          newMovie
        );
        if (!isCanceled.current && responseNewMovie.data.success)
          window.location.href = `http://localhost:3000/watch/${responseNewMovie.data.movie._id}`;
      } else inProgress = false;
    } else if (!isCanceled.current) window.location.href = `http://localhost:3000/watch/${responseMovies.data.movie._id}`;
  };

  return (
    <header style={{ marginBottom: 20 }}>
      {_isAuth ? (
        <div>
          <div className="App-header align-center">
            <Link to="/">
              <img
                className="logo"
                src={process.env.PUBLIC_URL + "/logo.png"}
                alt="Logo"
              />
            </Link>
            <div
              ref={refSearchBar}
              style={{
                borderRadius: searchInProgress
                  ? "20px 20px 0px 0px"
                  : "20px 20px 20px 20px"
              }}
              className="search-bar"
            >
              <div className="row align-center">
                <input
                  className="input-search-bar"
                  type="text"
                  placeholder={translations[language].header.searchPlaceholder}
                  spellCheck="false"
                  value={searchMovie}
                  onChange={handleSearch}
                />
                <SearchIcon
                  className="submit-search-bar"
                  style={{ fill: "#fff", width: 20, height: 20 }}
                />
              </div>
              {extended ? (
                <div
                  className="search-bar-extended"
                  style={{ display: searchInProgress ? "block" : "none" }}
                >
                  {movies.map(movie => {
                    return (
                      <div
                        key={`movie-${movie.id}`}
                        className="search-bar-extended-result"
                        onClick={() => {
                          resetSearchBar();
                          checkDatabase(movie.id);
                        }}
                      >
                        <img
                          src={
                            movie.large_cover_image.includes("https://yts.lt/")
                              ? movie.large_cover_image
                              : `https://yst.am${movie.large_cover_image}`
                          }
                          width="20"
                          height="20"
                          alt={`movie-${movie.id}`}
                          style={{ marginRight: 10 }}
                        />
                        {movie.title}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <SearchIcon
              onClick={() =>
                updateToggleSearchBarCollapse(!toggleSearchBarCollapse)
              }
              className="show-search-bar"
              style={{ fill: "#fff", width: 20, height: 20 }}
            />
            <div ref={refAvatar} style={{ position: "relative" }}>
              <img
                onClick={() =>
                  updateToggleAvatarDropdown(!toggleAvatarDropdown)
                }
                className="avatar"
                src={avatar}
                alt="Avatar"
                width="50"
                height="50"
              />
              <div
                className="avatar-dropdown"
                style={{ display: toggleAvatarDropdown ? "block" : "none" }}
              >
                <Link
                  to="/profile"
                  onClick={() =>
                    updateToggleAvatarDropdown(!toggleAvatarDropdown)
                  }
                >
                  <div className="avatar-dropdown-item">
                    {translations[language].header.avatarMenu.profile}
                  </div>
                </Link>
                <Link
                  to="/settings"
                  onClick={() =>
                    updateToggleAvatarDropdown(!toggleAvatarDropdown)
                  }
                >
                  <div className="avatar-dropdown-item">
                    {translations[language].header.avatarMenu.settings}
                  </div>
                </Link>
                <Link
                  to="/logout"
                  onClick={() =>
                    updateToggleAvatarDropdown(!toggleAvatarDropdown)
                  }
                >
                  <div className="avatar-dropdown-item">
                    {translations[language].header.avatarMenu.logout}
                  </div>
                </Link>
              </div>
            </div>
          </div>
          <div
            ref={refSearchBarLow}
            className="search-bar-collapse"
            style={{
              display: toggleSearchBarCollapse ? "block" : "none",
              borderRadius: searchInProgress
                ? "0px 0px 20px 20px"
                : "0px 0px 0px 0px"
            }}
          >
            <div className="row align-center">
              <input
                className="input-search-bar-collapse"
                type="text"
                placeholder={translations[language].header.searchPlaceholder}
                spellCheck="false"
                value={searchMovie}
                onChange={handleSearch}
              />
              <SearchIcon
                className="submit-search-bar-collapse"
                style={{ fill: "#fff", width: 20, height: 20 }}
              />
            </div>
            {extended ? (
              <div
                className="search-bar-extended"
                style={{ display: searchInProgress ? "block" : "none" }}
              >
                {movies.map(movie => {
                  return (
                    <div
                      key={`movie-${movie.id}-2`}
                      className="search-bar-extended-result"
                      onClick={() => {
                        resetSearchBar();
                        checkDatabase(movie.id);
                      }}
                    >
                      <img
                        src={movie.large_cover_image}
                        width="20"
                        height="20"
                        alt={`movie-${movie.id}`}
                        style={{ marginRight: 10 }}
                      />
                      {movie.title}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="App-header align-center">
          <img
            className="logo"
            src={process.env.PUBLIC_URL + "/logo.png"}
            alt="Logo"
          />
          <div className="row" style={{margin: '10px 0px'}}>
            <span
              className="hover-pointer"
              style={{ fontWeight: (language === 'fr') ? 'bold' : 'normal' }}
              onClick={() => context.updateLanguage("fr")}
            >
              FR
            </span>
            <span style={{ margin: '0px 5px' }}>|</span>
            <span
              className="hover-pointer"
              style={{ fontWeight: (language === 'en') ? 'bold' : 'normal' }}
              onClick={() => context.updateLanguage("en")}
            >
              EN
            </span>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
