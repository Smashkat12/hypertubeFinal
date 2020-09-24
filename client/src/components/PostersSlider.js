import React, { useState, useEffect, useContext } from "react";
import { withRouter } from "react-router-dom"
import translations from "translations"
import Poster from "./Poster";
import { ReactComponent as ArrowLeft } from "icons/arrow-point-to-left.svg";
import { ReactComponent as ArrowRight } from "icons/arrow-point-to-right.svg";
import { UserConsumer } from "store";

const valuePos = 300

const PostersSlider = props => {
  const { movies, history, number, username } = props;
  const [isDraging, updateIsDraging] = useState(false)
  const [currentPos, updateCurrentPos] = useState(0)
  const [pageWidth, setWindowSize] = useState(window.innerWidth)
  const context = useContext(UserConsumer);
  const { language } = context;

  useEffect(() => {
    const handleResize = () => {
      setWindowSize(getSize())
      newCurrentPos(currentPos)
    }
    window.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("resize", handleResize)
    }
    // eslint-disable-next-line
  }, [])

  const getSize = () => {
    return window.innerWidth
  }

  const mouseDown = (e) => {
    const startX = e.pageX
    let distanceTravelled = 0
    let isDrag = false
    const onMouseMove = (e) => {
      distanceTravelled = e.pageX - startX
      if (Math.abs(distanceTravelled) > 5) {
        if (!isDrag) {
          isDrag = true
          updateIsDraging(true)
        }
        newCurrentPos(currentPos + distanceTravelled)
      }
    }

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      if (!isDrag)
        return;
      updateIsDraging(false)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  const newCurrentPos = (pos) => {
    const maxPosterShowInPage = pageWidth / valuePos
    const index = -pos / valuePos
    const length = movies.length
    if (length * valuePos < pageWidth)
      return ;
    if (pos > 0) {
      updateCurrentPos(0)
    } else if ((length - index) <= maxPosterShowInPage) {
      updateCurrentPos((((length - maxPosterShowInPage) * -valuePos) - ((length + 1) * 20)) - (pageWidth - (maxPosterShowInPage * valuePos)))
    } else {
      updateCurrentPos(pos)
    }
  }

  return (
    <div className="posters-slider-container row" onMouseDown={ (e) => mouseDown(e) }>
      <span className="control-left no-selection">
        <ArrowLeft
          onClick={() => newCurrentPos(currentPos + valuePos)}
          fill="#fff"
          width="20"
          height="20"
          style={{
            marginTop: 200,
            marginLeft: 20,
            backgroundColor: "rgba(0, 0, 0, .7)",
            borderRadius: "50%",
            padding: 20
          }}
        />
      </span>
      {movies.length > 0 ? (
        <div
          className="posters-slider row center no-selection"
          style={{
            WebkitTransitionDuration: (isDraging) ? "" :  "0.3s",
            WebkitTransitionTimingFunction: (isDraging) ? "" : "ease-out",
            WebkitTransform: `translateX(${currentPos}px)`
          }}
        >
          {movies.map(movie => (
            <div
              key={`movie-${movie._id}-${number}`}
              onMouseUp={ () => (!isDraging) ? history.push(`/watch/${movie._id}`) : null }
            >
              <Poster movie={movie} language={language} username={username ? username : null} />
            </div>
          ))}
        </div>
      ) : (
        <div className="posters-slider row center no-selection blur-hover">
          <div style={{
            position: 'absolute',
            top: '50%',
            fontSize: 50
          }}>
            {translations[language].postersSlider.empty}
          </div>
          <div className="no-movie-poster"></div>
          <div className="no-movie-poster"></div>
          <div className="no-movie-poster"></div>
          <div className="no-movie-poster"></div>
          <div className="no-movie-poster"></div>
          <div className="no-movie-poster"></div>
          <div className="no-movie-poster"></div>
        </div>
      )}
      <span className="control-right">
        <ArrowRight
          onClick={() => newCurrentPos(currentPos - valuePos)}
          fill="#fff"
          width="20"
          height="20"
          style={{
            marginTop: 200,
            marginRight: 20,
            backgroundColor: "rgba(0, 0, 0, .7)",
            borderRadius: "50%",
            padding: 20
          }}
        />
      </span>
    </div>
  );
};

export default withRouter(PostersSlider)
