import React, { useEffect, useState, useContext, useRef } from "react";
import axios from "axios";
import translations from "translations";
import Button from "components/Button";
import PosterYTS from "components/MoviesPoster";
import Loading from "components/Loading";
import {withRouter } from "react-router-dom";
import { UserConsumer } from "store";
import { escapeSpecial } from "utils/functions"

const dropDownOptions = [
  { value: "", genre: "Genre:" },
  { value: "comedy", genre: "Comedy" },
  { value: "sci-fi", genre: "Sci-Fi" },
  { value: "horror", genre: "Horror" },
  { value: "romance", genre: "Romance" },
  { value: "action", genre: "Action" },
  { value: "thriller", genre: "Thriller" },
  { value: "drama", genre: "Drama" },
  { value: "mystery", genre: "Mystery" },
  { value: "crime", genre: "Crime" },
  { value: "animation", genre: "Animation" },
  { value: "adventure", genre: "Adventure" },
  { value: "fantasy", genre: "Fantasy" },
  { value: "superhero", genre: "Superhero" },
  { value: "documentary", genre: "Documentary" },
  { value: "music", genre: "Music" },
  { value: "family", genre: "Family" }
];

const Search = props => {
  const [page, setPage] = useState(1);
  const [loadMore, setLoadMore] = useState(false);
  const [moviesYTS, updateMoviesYTS] = useState([]);
  const [_isLoaded, updateIsLoaded] = useState(false);
  const [filter, updateFilter] = useState({
    genre: "",
    minYear: "1900",
    maxYear: new Date().getFullYear(),
    minRating: 0,
    maxRating: 5,
    sort: "year",
    order: "desc"
  });
  let inProgress = false;
  const isCanceled = useRef(false)
  const context = useContext(UserConsumer);
  const { language, search } = context;

  useEffect(() => {
    fetchMovies();
    return () => {
      isCanceled.current = true
    }
    // eslint-disable-next-line
  }, []);

  const fetchMovies = async () => {
    if (!isCanceled.current) {
      updateIsLoaded(false);
      setPage(1);
      const response = await axios.get(
        `http://localhost:5000/torrents/yts/search?search=${escapeSpecial(
          search
        )}${filter.genre !== "" ? "&genre=" + filter.genre : ""}${
          filter.minYear !== "" ? "&minyear=" + filter.minYear : ""
        }${filter.maxYear !== "" ? "&maxyear=" + filter.maxYear : ""}${
          filter.minRating !== "" ? "&minrating=" + filter.minRating : ""
        }${filter.maxRating !== "" ? "&maxrating=" + filter.maxRating : ""}${
          filter.sort !== "" ? "&sort=" + filter.sort : ""
        }${filter.order !== "" ? "&order=" + filter.order : ""}`
      );
      if (!isCanceled.current && response) {
        updateMoviesYTS(response.data.results);
        updateIsLoaded(true);
      }
    }
  };

  const loadMoreMovies = async () => {
    if (!isCanceled.current) {
      setPage(curr => curr + 1);
      setLoadMore(true);
      const resp = await axios.get(
        `http://localhost:5000/torrents/yts/search?search=${escapeSpecial(
          search
        )}${filter.genre !== "" ? "&genre=" + filter.genre : ""}${
          filter.minYear !== "" ? "&minyear=" + filter.minYear : ""
        }${filter.maxYear !== "" ? "&maxyear=" + filter.maxYear : ""}${
          filter.minRating !== "" ? "&minrating=" + filter.minRating : ""
        }${filter.maxRating !== "" ? "&maxrating=" + filter.maxRating : ""}${
          filter.sort !== "" ? "&sort=" + filter.sort : ""
        }${filter.order !== "" ? "&order=" + filter.order : ""}
        ${page ? "&page=" + (page + 1) : ""}`
      );
      if (!isCanceled.current && resp) {
        updateMoviesYTS(prevArray => [
          ...prevArray,
          ...resp.data.results
        ]);
        setLoadMore(false);
      }
    }
  };

  const setNewFilter = (e, option) => {
    updateFilter({ ...filter, [option]: e.target.value });
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
          author: "Someone"
        };
        const responseNewMovie = await axios.post(
          `http://localhost:5000/movies`,
          newMovie
        );
        if (!isCanceled.current && responseNewMovie.data.success)
          props.history.push(`/watch/${responseNewMovie.data.movie._id}`);
      } else inProgress = false;
    } else if (!isCanceled.current) props.history.push(`/watch/${responseMovies.data.movie._id}`);
  };

  return (
    <div>
      <div className="col">
        <div
          className="row wrap"
          style={{ justifyContent: "center", alignItems: 'center', marginBottom: 20 }}
        >
          <input
            min={1900}
            max={new Date().getFullYear()}
            onChange={e => setNewFilter(e, ["minYear"])}
            className="dark-input"
            type="number"
            placeholder={translations[language].search.minyear}
          />
          <input
            min={1900}
            max={new Date().getFullYear()}
            onChange={e => setNewFilter(e, ["maxYear"])}
            className="dark-input"
            type="number"
            placeholder={translations[language].search.maxyear}
            style={{ marginLeft: 10, marginRight: 30 }}
          />
          <select
            onChange={e => setNewFilter(e, ["genre"])}
            className="dark-input"
            style={{marginRight: 10}}
          >
            {dropDownOptions.map(option => (
              <option key={`option-${option.value}`} value={option.value}>
                {option.genre}
              </option>
            ))}
          </select>
          <select
            onChange={e => setNewFilter(e, ["sort"])}
            className="dark-input"
            style={{marginRight: 10}}
          >
            <option value="title">{translations[language].search.title}</option>
            <option value="year">{translations[language].search.year}</option>
          </select>
          <select
            onChange={e => setNewFilter(e, ["order"])}
            className="dark-input"
          >
            <option value="asc">{translations[language].search.asc}</option>
            <option value="desc">{translations[language].search.desc}</option>
          </select>
          <input
            min={0}
            max={5}
            onChange={e => setNewFilter(e, ["minRating"])}
            className="dark-input"
            type="number"
            placeholder={translations[language].search.minrating}
            style={{ marginLeft: 30 }}
          />
          <input
            min={0}
            max={5}
            onChange={e => setNewFilter(e, ["maxRating"])}
            className="dark-input"
            type="number"
            placeholder={translations[language].search.maxrating}
            style={{ marginLeft: 10 }}
          />
          <Button
            style={{ marginLeft: 20 }}
            action={() => fetchMovies()}
            content={translations[language].search.search}
          />
        </div>
        {_isLoaded ? (
          <div>
            <div className="posters-list row wrap">
              {moviesYTS.map((movie, index) => {
                if (!movie.large_cover_image)
                  movie.large_cover_image =
                    "http://story-one.com/wp-content/uploads/2016/02/Poster_Not_Available2.jpg";

                return (
                  <div
                    key={`movie-${index}`}
                    onClick={() => checkDatabase(movie.id)}
                  >
                    <PosterYTS movie={movie} language={language} />
                  </div>
                );
              })}
            </div>
            <Button
              content={loadMore ? translations[language].search.loading : translations[language].search.loadMore}
              action={() => loadMoreMovies()}
              style={{ margin: "0 auto" }}
            />
          </div>
        ) : (
          <Loading />
        )}
      </div>
    </div>
  );
};

export default withRouter(Search);
