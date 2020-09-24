import React, { useState, useEffect, useRef, useContext } from "react";
import axios from "axios"
import PostersSlider from "components/PostersSlider";
import translations from "translations";
import Loading from "components/Loading";
import { ReactComponent as VerifiedIcon } from "icons/verified.svg";
import { ReactComponent as PencilIcon } from "icons/pencil.svg";
import { ReactComponent as CinemaIcon } from "icons/cinema-icon.svg";
import { ReactComponent as JapanIcon } from "icons/japan-icon.svg";
import { ReactComponent as AnimalsIcon } from "icons/animals-icon.svg";
import { ReactComponent as FruitsIcon } from "icons/fruits-icon.svg";
import { UserConsumer } from "store";

import { checkAvatarFileExt, checkAvatarSize } from "utils/functions";


const covers = ["cinema", "japan", "animals", "fruits"];

const Profile = () => {
  const [cover, updateCover] = useState("cinema");
  const [user, updateUser] = useState({});
  const [heartbeat, updateHeartbeat] = useState([]);
  const [recents, updateRecents] = useState([]);
  const [inProgress, updateInProgress] = useState([]);
  const [_isLoaded, updateIsLoaded] = useState(false);
  const [toggleCoverMenu, updateToggleCoverMenu] = useState(false);
  const refMenu = useRef(null);
  const uploadAvatar = useRef(null);
  const context = useContext(UserConsumer);
  const { language, avatar, updateAvatar } = context;
  

  const isCanceled = useRef(false);

  useEffect(() => {
    fetchData();
    window.addEventListener("mousedown", closeCoverMenu);
    return () => {
      isCanceled.current = true;
      window.removeEventListener("mousedown", closeCoverMenu);
    };
    // eslint-disable-next-line
  }, []);

  const fetchData = async () => {
    const check = await axios.get(`http://localhost:5000/auth/`);
    if (!isCanceled.current && check.data.auth) {
      const res = await axios.get(`http://localhost:5000/users/id`);
      if (!isCanceled.current && res.data.success) {
        if (!isCanceled.current) updateUser(res.data.user[0]);
        const getHeartbeatList = await getMoviesList(
          res.data.user[0].heartbeat
        );
        if (!isCanceled.current) updateHeartbeat(getHeartbeatList);
        const getRecentsList = await getMoviesList(res.data.user[0].recents);
        if (!isCanceled.current) updateRecents(getRecentsList);
        const getInProgressList = await getMoviesList(
          res.data.user[0].inProgress
        );
        if (!isCanceled.current) {
          updateInProgress(getInProgressList);
          updateCoverBackground(res.data.user[0].cover);
          updateIsLoaded(true);
        }
      }
    }
  };

  const closeCoverMenu = (event) => {
    if (
      refMenu &&
      event &&
      refMenu.current &&
      refMenu.current.contains(event.target)
    )
      return;
    updateToggleCoverMenu(false);
  };

  const getMoviesList = (moviesListIds) => {
    return Promise.all(
      moviesListIds.reverse().map(async (movie) => {
        const res = await axios.get(`http://localhost:5000/movies/${movie.id}`);
        if (res.data.success && res.data.movie) {
          return res.data.movie[0];
        }
      })
    );
  };

  const copyProfileURL = () => {
    const profileURL = document.createElement("textarea");
    const tooltipText = document.getElementsByClassName("tooltip-text")[0];
    tooltipText.innerHTML = language === "FR" ? "Copié" : "Copied to clipboard";
    profileURL.value = `${window.location.origin}/user/${user.username}`;
    profileURL.setAttribute("readonly", "");
    profileURL.style = {
      display: "none",
      position: "absolute",
      left: "-9999px",
    };
    document.body.appendChild(profileURL);
    profileURL.select();
    document.execCommand("copy");
    document.body.removeChild(profileURL);
  };

  const resetTooltip = () => {
    const tooltipText = document.getElementsByClassName("tooltip-text")[0];
    tooltipText.innerHTML = translations[language].profile.tooltip.copy;
  };

  const updateCoverBackground = (cover) => {
    let body = {};
    if (covers.includes(cover)) {
      updateCover(cover);
      body.cover = cover;
    }
    axios.put(`http://localhost:5000/users/id`, body);
  };

  const onChangeAvatar = async (event) => {
    if (event.target.files[0]) {
      if (checkAvatarFileExt(event.target.files[0])) {
        if (checkAvatarSize(event.target.files[0])) {
          event.preventDefault();
          const data = new FormData();
          data.append("file", event.target.files[0]);
          data.append("filename", event.target.files[0].name);
          const response = await axios.post(
            `http://localhost:5000/users/avatar`,
            data
          );
          if (!isCanceled.current && response.data.success) {
            updateAvatar(
              `http://localhost:5000/${
                response.data.file
              }?${Date.now()}`
            );
            updateUser({
              ...user,
              avatar: `http://localhost:5000/${response.data.file}`,
            });
          }
        } else alert(translations[language].profile.errors.avatarSize);
      } else alert(translations[language].profile.errors.avatarType);
    }
  };

  return (
    <div>
      {_isLoaded ? (
        <div className="text-center">
          <div
            className="cover"
            style={{
              backgroundImage: `url('/covers/${cover}.svg')`,
              paddingTop: 40,
              paddingBottom: 50,
              marginTop: -20,
            }}
          >
            <div className="profile-avatar center">
              <div
                className="profile-avatar-overlay"
                onClick={() => uploadAvatar.current.click()}
              >
                {translations[language].profile.updateAvatar}
              </div>
              <input
                type="file"
                id="file"
                ref={uploadAvatar}
                onChange={(event) => onChangeAvatar(event)}
                style={{ display: "none" }}
              />
              <img src={avatar} alt={`Avatar ${user.username}`} />
            </div>
            <div style={{ marginTop: 20 }}>
              <div>
                {user.firstname} {user.lastname}{" "}
                <span style={{ fontStyle: "italic", fontSize: ".8em" }}>
                  {translations[language].profile.you}
                </span>
              </div>
              <div className="tooltip">
                <div
                  className="username"
                  onClick={() => copyProfileURL()}
                  onMouseLeave={() => resetTooltip()}
                >
                  @{user.username}{" "}
                  {user.verified ? (
                    <div className="verified" style={{ marginBottom: 2 }}>
                      <VerifiedIcon width="15" height="15" />
                    </div>
                  ) : null}
                </div>
                <span className="tooltip-text">
                  {translations[language].profile.tooltip.copy}
                </span>
              </div>
            </div>
            <div
              ref={refMenu}
              className="edit-cover-box tooltip-left"
              onClick={() => updateToggleCoverMenu(!toggleCoverMenu)}
            >
              <PencilIcon
                className="pencil-icon"
                fill="#fff"
                width="15"
                height="15"
                style={{ marginTop: 10 }}
              />
              <span className="tooltip-text-left">
                {translations[language].profile.editCover}
              </span>
              <div
                className="covers-menu"
                style={{
                  position: "absolute",
                  display: toggleCoverMenu ? "block" : "none",
                  backgroundColor: "#04050C",
                  borderRadius: 10,
                  width: 100,
                  marginBottom: 10,
                  bottom: 50,
                  right: 0,
                  zIndex: 9,
                }}
              >
                <div
                  className={`covers-menu-child ${
                    cover === "cinema" ? "cover-selected" : null
                  }`}
                  onClick={() => updateCoverBackground("cinema")}
                >
                  <CinemaIcon width="25" height="25" />
                </div>
                <div
                  className={`covers-menu-child ${
                    cover === "japan" ? "cover-selected" : null
                  }`}
                  onClick={() => updateCoverBackground("japan")}
                >
                  <JapanIcon width="25" height="25" />
                </div>
                <div
                  className={`covers-menu-child ${
                    cover === "animals" ? "cover-selected" : null
                  }`}
                  onClick={() => updateCoverBackground("animals")}
                >
                  <AnimalsIcon width="25" height="25" />
                </div>
                <div
                  className={`covers-menu-child ${
                    cover === "fruits" ? "cover-selected" : null
                  }`}
                  onClick={() => updateCoverBackground("fruits")}
                >
                  <FruitsIcon width="25" height="25" />
                </div>
              </div>
            </div>
          </div>
          <h2>{translations[language].profile.list.continue}</h2>
          <PostersSlider number={1} movies={inProgress} language={language} />
          <h2>{translations[language].profile.list.heartbeat}</h2>
          <PostersSlider number={2} movies={heartbeat} language={language} />
          <h2>{translations[language].profile.list.recents}</h2>
          <PostersSlider number={3} movies={recents} language={language} />
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
};

export default Profile;
