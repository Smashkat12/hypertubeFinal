

import React, { useState, useEffect, useRef, useContext } from "react";
import { withRouter } from "react-router-dom";
import axios from "axios";

import translations from "translations";
import { UserConsumer } from "store";



import Button from "components/Button";
import Loading from "components/Loading";
import Rating from "react-rating";

// SVGs
import { ReactComponent as StarFull } from "icons/star-full.svg";
import { ReactComponent as StarEmpty } from "icons/star-empty.svg";
import { ReactComponent as ReportFlag } from "icons/report-flag.svg";
import { ReactComponent as Close } from "icons/close.svg";
import { ReactComponent as AddFav } from "icons/add_heart.svg";
import { ReactComponent as RemoveFav } from "icons/remove_heart.svg";

const Movie = (props) => {
  const { match } = props;
  const context = useContext(UserConsumer);
  const { language } = context;
  const { id } = match.params;
  const [movie, updateMovie] = useState({});
  const [user, updateUser] = useState({});
  const [comment, updateComment] = useState("");
  const [commentsLimit, setCommentsLimit] = useState(5);
  const [heartbeat, updateHeartbeat] = useState(false);
  const [rating, updateRating] = useState(0);
  const [ratingAverage, updateRatingAverage] = useState(0);
  const [ratingCount, updateRatingCount] = useState(0);
  const [loaded, updateLoaded] = useState(false);
  const [togglePlayer, updateTogglePlayer] = useState(false);
  // eslint-disable-next-line
  const [subtitles, updateSubtitles] = useState({});
  const player = useRef(null);
  const isCanceled = useRef(false);

  useEffect(() => {
    return () => {
      isCanceled.current = true;
      document.removeEventListener("scroll", handleScroll, false);
      document.removeEventListener("keydown", onEscape, false);

      const videoPlayer = document.getElementsByClassName("video-player")[0];
      if (videoPlayer && videoPlayer.currentTime > 5) {
        const watchPercent = (
          (videoPlayer.currentTime / videoPlayer.duration) *
          100
        ).toFixed(0);
        if (watchPercent >= 95) {
          axios.post(`http://localhost:5000/movies/${id}/recents`, null);
          axios.delete(`http://localhost:5000/movies/${id}/inprogress`);
        } else {
          axios.get(`http://localhost:5000/movies/${id}`).then((res) => {
            axios.post(`http://localhost:5000/movies/${id}/inprogress`, {
              ytsId: res.data.movie[0]._ytsId,
              percent: watchPercent,
              timecode: videoPlayer.currentTime.toString(),
            });
          });
        }
      }
    };
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    fetchMovie();
    // eslint-disable-next-line
  }, [id]);

  const fetchMovie = async () => {
    const resp = await axios.get(`http://localhost:5000/movies/${id}`);
    if (!isCanceled.current && resp) {
      if (resp.data.movie && resp.data.movie[0]) {
        let torrentMaxSeeds = resp.data.movie[0].ytsData.torrents[0];
        resp.data.movie[0].ytsData.torrents.forEach((torrent) => {
          if (torrentMaxSeeds.seeds < torrent.seeds) torrentMaxSeeds = torrent;
        });
        console.log(
          `Seeds: ${torrentMaxSeeds.seeds}`,
          `Peers: ${torrentMaxSeeds.peers}`,
          `Ratio (peers for seeds): ${(
            (torrentMaxSeeds.peers / torrentMaxSeeds.seeds) *
            100
          ).toFixed()}%`
        );
        resp.data.movie[0].ytsData.torrents[0] = torrentMaxSeeds;
        updateMovie(resp.data.movie[0]);

        axios.put(`http://localhost:5000/movies`, { id });

        updateLoaded(true);

        document.addEventListener("scroll", handleScroll, false);
        document.addEventListener("keydown", onEscape, false);

        const res = await axios.get(
          `http://localhost:5000/movies/${id}/inprogress`
        );
        if (!isCanceled.current && res.data.success && res.data.found > 0) {
          const videoPlayer = document.getElementsByClassName(
            "video-player"
          )[0];
          videoPlayer.currentTime = res.data.list.inProgress[0].timecode;
        }

        /* const resSubtitles = await axios.get(
          `http://localhost:5000/torrents/subtitles/${resp.data.movie[0].ytsData.imdb_code}`
        );
        if (
          !isCanceled.current &&
          resSubtitles &&
          resSubtitles.data.subtitles
        ) {
          updateSubtitles(resSubtitles.data.subtitles);
        } */
      }
    }
    const responseUser = await axios.get(`http://localhost:5000/auth/`);
    if (!isCanceled.current && responseUser) {
      updateUser(responseUser.data.user);

      const responseHeartbeat = await axios.get(
        `http://localhost:5000/movies/${id}/heartbeat`
      );
      if (
        !isCanceled.current &&
        responseHeartbeat.data.success &&
        responseHeartbeat.data.found > 0
      )
        updateHeartbeat(true);

      const responseRating = await axios.get(
        `http://localhost:5000/movies/${id}/user/ratings`
      );
      if (!isCanceled.current && responseRating.data.rating)
        updateRating(responseRating.data.rating);

      const responseRatingCount = await axios.get(
        `http://localhost:5000/movies/${id}/ratings`
      );
      if (!isCanceled.current && responseRatingCount.data.success) {
        updateRatingAverage(responseRatingCount.data.ratingAverage);
        updateRatingCount(responseRatingCount.data.ratingCount);
      }
    }
  };

  const handleScroll = () => {
    const moviePoster = document.getElementById("movie-page-poster-fullsize");
    const movieInfos = document.getElementById("movie-infos-fullsize");

    if (moviePoster && movieInfos) {
      const top = window.pageYOffset;

      const maxBottom = movieInfos.offsetHeight + movieInfos.offsetTop;
      const posterHeight = moviePoster.offsetHeight + movieInfos.offsetTop;

      if (top + posterHeight <= maxBottom)
        moviePoster.style.marginTop = `${top}px`;
    }
  };

  const onEnter = (e) => {
    if (e.keyCode === 13) addComment();
  };

  const onEscape = (e) => {
    if (e.keyCode === 27) hidePlayer();
  };

  const addComment = async () => {
    const newComment = {
      author: user.username,
      content: comment,
    };

    if (!isCanceled.current) {
      if (newComment.content.trim() !== "") {
        axios.post(`http://localhost:5000/movies/${id}/comments`, newComment);
        updateMovie({ ...movie, comments: [...movie.comments, newComment] });
      }
      updateComment("");
    }
  };

  const updatingRating = async (value) => {
    const newRating = {
      rating: value,
    };
    const response = await axios.post(
      `http://localhost:5000/movies/${id}/ratings`,
      newRating
    );
    if (!isCanceled.current && response) {
      updateRating(value);
      const responseRating = await axios.get(
        `http://localhost:5000/movies/${id}/ratings`
      );
      if (!isCanceled.current && responseRating.data.success) {
        updateRatingAverage(responseRating.data.ratingAverage);
        updateRatingCount(responseRating.data.ratingCount);
      }
    }
  };

  const showPlayer = () => {
    if (player) {
      updateTogglePlayer(true);
      const playPromise = player.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Automatic playback started
            // Show playing UI
          })
          .catch((error) => {
            // Autotplay vas prevent
            console.log(error);
          });
      }
    }
  };

  const hidePlayer = () => {
    if (player) {
      updateTogglePlayer(false);
      player.current.pause();
    }
  };

  const toggleHeartbeat = async () => {
    if (!heartbeat)
      axios.post(`http://localhost:5000/movies/${id}/heartbeat`, null);
    else axios.delete(`http://localhost:5000/movies/${id}/heartbeat`);

    updateHeartbeat(!heartbeat);
  };

  const reportComment = (id) => {
    axios.post(`http://localhost:5000/movies/${movie._id}/comments/report`, {
      commId: id,
    });
  };

  return (
    <div>
      {movie && loaded ? (
        <div>
          <div className="movie-page">
            <div className="row wrap">
              <img
                id="movie-page-poster-fullsize"
                className="movie-page-poster center"
                src={movie.poster}
                alt="Movie poster"
              />
              <div
                id="movie-infos-fullsize"
                className="col center"
                style={{
                  width: "45%",
                  padding: 50,
                  backgroundColor: "#16162e",
                  wordBreak: "break-word",
                  borderRadius: 20,
                }}
              >
                <div className="movie-infos" style={{ marginBottom: 20 }}>
                  <div
                    className="row"
                    style={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    <h1>{movie.name}</h1>
                    <span style={{ marginTop: 10, marginLeft: 10 }}>
                      ({movie.ytsData.year})
                    </span>
                    <div
                      className="tooltip toggle-heartbeat"
                      onClick={() => toggleHeartbeat()}
                    >
                      {heartbeat ? (
                        <RemoveFav width="25" height="25" fill="crimson" />
                      ) : (
                        <AddFav width="25" height="25" fill="crimson" />
                      )}
                      <span className="tooltip-text">
                        {heartbeat
                          ? translations[language].movie.tooltip.heartbeatRemove
                          : translations[language].movie.tooltip.heartbeatAdd}
                      </span>
                    </div>
                  </div>
                  <div className="hr"></div>
                  <div className="container-ytb" style={{ marginBottom: 20 }}>
                    <iframe
                      title="trailer-high-size"
                      src={`//www.youtube.com/embed/${movie.ytsData.yt_trailer_code}?autoplay=1`}
                      allow="autoplay"
                      frameBorder="0"
                      allowFullScreen
                      className="video-ytb"
                    ></iframe>
                  </div>
                  {movie.ytsData.genres ? (
                    <div
                      className="genres row wrap"
                      style={{ marginBottom: 20 }}
                    >
                      {movie.ytsData.genres.map((genre, index) => (
                        <div key={index} className="genre">
                          {genre}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p>{movie.description}</p>
                  <div
                    className="wrap"
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    {movie.ytsData.cast ? (
                      <div className="cast row" style={{ marginBottom: 20 }}>
                        {movie.ytsData.cast.map((person, index) => (
                          <a
                            className="pointer"
                            href={`https://www.imdb.com/name/nm${person.imdb_code}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            key={`${person.name}-${index}`}
                          >
                            <img
                              style={{
                                width: 75,
                                height: 75,
                                objectFit: "cover",
                                borderRadius: "50%",
                                marginRight: -20,
                              }}
                              src={
                                person.url_small_image
                                  ? person.url_small_image
                                  : `http://localhost:5000/public/avatars/default_avatar.png`
                              }
                              alt={person.name}
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    <div>
                      <Rating
                        onChange={(value) => updatingRating(value)}
                        initialRating={rating}
                        emptySymbol={
                          <StarEmpty width="30" height="30" fill="#FFD700" />
                        }
                        fullSymbol={
                          <StarFull width="30" height="30" fill="#FFD700" />
                        }
                        fractions={2}
                      />
                      <br />
                      <span>
                        {translations[language].movie.rating} - {ratingAverage}{" "}
                        ({ratingCount})
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  action={() => showPlayer()}
                  content={translations[language].movie.watch}
                />
                <div>
                  <h2>{translations[language].movie.comments}</h2>
                  <div className="hr"></div>
                  <div className="comments col">
                    {movie.comments.length > 0 ? (
                      <div>
                        {movie.comments.reverse().map((comment, index) => {
                          if (index < commentsLimit) {
                            return (
                              <div className="comment" key={`comment-${index}`}>
                                <div
                                  onClick={() =>
                                    reportComment(`${comment._id}`)
                                  }
                                  className="report-flag"
                                >
                                  <ReportFlag width="20" height="20" />
                                </div>
                                <div className="comment-name">
                                  <a
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    href={`http://localhost:3000/user/${comment.author}`}
                                  >
                                    @{comment.author}
                                  </a>
                                </div>
                                {comment.content}
                              </div>
                            );
                          }
                          return null;
                        })}
                        {movie.comments.length > 5 &&
                        movie.comments.length > commentsLimit ? (
                          <span
                            className="more-comments"
                            onClick={() => setCommentsLimit((old) => old + 10)}
                          >
                            {translations[language].movie.more}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        className="no-comments center"
                        style={{ marginTop: 50, marginBottom: 50 }}
                      >
                        {translations[language].movie.noComments}
                      </div>
                    )}
                  </div>
                  <input
                    className="dark-input comment-input"
                    onKeyDown={onEnter}
                    placeholder={translations[language].movie.reviewPlaceholder}
                    style={{ width: "100%", marginBottom: 20 }}
                    value={comment}
                    onChange={(e) => updateComment(e.target.value)}
                  />
                  <Button
                    content={translations[language].movie.reviewSubmit}
                    style={{ float: "right" }}
                    action={() => addComment()}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="movie-page-lowres">
            <div className="movie-infos" style={{ marginBottom: 20 }}>
              <img
                className="movie-page-poster-lowres"
                src={movie.poster}
                style={{ width: "100%" }}
                alt="poster"
              />
              <div className="row" style={{ alignItems: "center" }}>
                <h1>{movie.name}</h1>
                <span style={{ marginTop: 10, marginLeft: 10 }}>
                  ({movie.ytsData.year})
                </span>
                <div
                  className="toggle-heartbeat"
                  onClick={() => toggleHeartbeat()}
                >
                  {heartbeat ? (
                    <RemoveFav width="25" height="25" fill="crimson" />
                  ) : (
                    <AddFav width="25" height="25" fill="crimson" />
                  )}
                </div>
              </div>
              <div className="hr"></div>
              <div className="container-ytb" style={{ marginBottom: 20 }}>
                <iframe
                  title="trailer-low-size"
                  src={`//www.youtube.com/embed/${movie.ytsData.yt_trailer_code}?autoplay=1`}
                  allow="autoplay"
                  frameBorder="0"
                  allowFullScreen
                  className="video-ytb"
                ></iframe>
              </div>
              {movie.ytsData.genres ? (
                <div className="genres row wrap" style={{ marginBottom: 20 }}>
                  {movie.ytsData.genres.map((genre, index) => (
                    <div key={index} className="genre">
                      {genre}
                    </div>
                  ))}
                </div>
              ) : null}
              <p>{movie.description}</p>
              <div
                className="wrap"
                style={{ display: "flex", justifyContent: "space-between" }}
              >
                {movie.ytsData.cast ? (
                  <div className="cast row" style={{ marginBottom: 20 }}>
                    {movie.ytsData.cast.map((person, index) => (
                      <a
                        className="pointer"
                        href={`https://www.imdb.com/name/nm${person.imdb_code}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        key={`${person.name}-${index}`}
                      >
                        <img
                          style={{
                            width: 75,
                            height: 75,
                            objectFit: "cover",
                            borderRadius: "50%",
                            marginRight: -20,
                          }}
                          src={
                            person.url_small_image
                              ? person.url_small_image
                              : `http://localhost:5000/public/avatars/default_avatar.png`
                          }
                          alt={person.name}
                        />
                      </a>
                    ))}
                  </div>
                ) : null}
                <div>
                  <Rating
                    onChange={(value) => updatingRating(value)}
                    initialRating={rating}
                    emptySymbol={
                      <StarEmpty width="30" height="30" fill="#FFD700" />
                    }
                    fullSymbol={
                      <StarFull width="30" height="30" fill="#FFD700" />
                    }
                    fractions={2}
                  />
                  <br />
                  <span>
                    {translations[language].movie.rating} - {ratingAverage} (
                    {ratingCount})
                  </span>
                </div>
              </div>
            </div>
            <Button
              action={() => showPlayer()}
              content={translations[language].movie.watch}
            />
            <div>
              <h2>{translations[language].movie.comments}</h2>
              <div className="hr"></div>
              <div className="comments col">
                {movie.comments.length > 0 ? (
                  <div>
                    {movie.comments.reverse().map((comment, index) => {
                      if (index < commentsLimit) {
                        return (
                          <div className="comment" key={`comment-${index}`}>
                            <div
                              onClick={() => reportComment(`${comment._id}`)}
                              className="report-flag"
                            >
                              <ReportFlag width="20" height="20" />
                            </div>
                            <div className="comment-name">{comment.author}</div>
                            {comment.content}
                          </div>
                        );
                      }
                      return null;
                    })}
                    {movie.comments.length > 5 &&
                    movie.comments.length > commentsLimit ? (
                      <span
                        className="more-comments"
                        onClick={() => setCommentsLimit((old) => old + 10)}
                      >
                        {translations[language].movie.more}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div
                    className="no-comments center"
                    style={{ marginTop: 50, marginBottom: 50 }}
                  >
                    {translations[language].movie.noComments}
                  </div>
                )}
              </div>
              <input
                className="dark-input comment-input"
                placeholder={translations[language].movie.reviewPlaceholder}
                style={{ width: "100%", marginBottom: 20 }}
                onChange={(e) => updateComment(e.target.value)}
              />
              <Button
                content={translations[language].movie.reviewSubmit}
                style={{ float: "right" }}
                action={() => addComment()}
              />
            </div>
          </div>

          {/* Player */}
          <div
            className="player-container"
            style={{
              display: togglePlayer ? "block" : "none",
              position: "absolute",
              top: 100,
              width: "100%",
              backgroundColor: "black",
              height: "93vh",
            }}
          >
            <div
              style={{ position: "relative", width: "100%", height: "100%" }}
            >
              <span
                className="close-icon"
                onClick={() => hidePlayer()}
                style={{ position: "absolute", top: 25, right: 25 }}
              >
                <Close width="15" height="15" fill="#fff" />
              </span>
              <video
                ref={player}
                className="video-player"
                width="100%"
                controls
                preload="metadata"
                controlsList="nodownload"
              >
                <source
                  src={
                    !isCanceled.current
                      ? `http://localhost:5000/torrents/stream/${encodeURIComponent(
                          movie.ytsData.torrents[0].magnet
                        )}`
                      : ""
                  }
                />
                {/* <source src="https://file-examples.com/wp-content/uploads/2017/04/file_example_MP4_1280_10MG.mp4" /> */}
                {Object.entries(subtitles).map((entry) => (
                  <track
                    label={translations[language].movie.subtitles[entry[0]]}
                    key={`language-${entry[0]}`}
                    kind="subtitles"
                    srcLang={entry[0]}
                    src={`data:text/vtt;base64, ${entry[1]}`}
                    default={entry[0] === language ? true : false}
                  />
                ))}
              </video>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {!movie ? (
            <div style={{ color: "white", textAlign: "center" }}>
              {translations[language].movie.noResults}
            </div>
          ) : (
            <Loading />
          )}
        </div>
      )}
    </div>
  );
};

export default withRouter(Movie);
