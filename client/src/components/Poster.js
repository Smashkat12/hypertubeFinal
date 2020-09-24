import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

import Rating from "react-rating";
import ProgressBar from "components/ProgressBar";
import { ReactComponent as StarFull } from "icons/star-full.svg";
import { ReactComponent as StarEmpty } from "icons/star-empty.svg";


const Poster = props => {
  const { movie, username } = props;
  const [ratingAverage, updateRatingAverage] = useState(0);
  const [ratingCount, updateRatingCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const isCanceled = useRef(false)

  useEffect(() => {
    return () => {
      isCanceled.current = true
    }
  }, [])

  useEffect(() => {
    const fetchMovieData = async () => {
      const response = await axios.get(`http://localhost:5000/movies/${movie._id}/ratings`);
      if (!isCanceled.current && response.data.success) {
        updateRatingAverage(response.data.ratingAverage);
        updateRatingCount(response.data.ratingCount);
      }
      if (!username) {
        const resp = await axios.get(
          `http://localhost:5000/movies/${movie._id}/progress`
        );
        if (!isCanceled.current && resp.data.success)
          setProgress(resp.data.watchPercent)
      } else {
        const resp = await axios.get(
          `http://localhost:5000/movies/${movie._id}/${username}/progress`
        );
        if (!isCanceled.current && resp.data.success)
          setProgress(resp.data.watchPercent)
      }
    };

    fetchMovieData();
  }, [movie._id, username]);

  return (
    <div className="poster-container">
      <img className="movie-poster" src={movie.poster} alt={movie.name} />
      <ProgressBar progress={progress} />
      <div className="poster-overlay">
        <div className="poster-content">
          <h3>{movie.name} ({movie.ytsData.year})</h3>
          <p>{movie.description}</p>
          <div className="row center">
            <span style={{ marginTop: 2.75 }}>
              <Rating
                readonly={true}
                initialRating={ratingAverage}
                emptySymbol={
                  <StarEmpty width="15" height="15" fill="#FFD700" />
                }
                fullSymbol={<StarFull width="15" height="15" fill="#FFD700" />}
                fractions={2}
              />
            </span>
            <span style={{ marginLeft: 5 }}>({ratingCount})</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Poster;
