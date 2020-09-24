import React, { useState, useEffect, useContext, useRef } from "react";
import translations from "translations";
import Button from "components/Button";
import axios from "axios";
import Loading from "components/Loading";

import { UserConsumer } from "store";
import {
  checkUsername,
  checkName,
  checkEmail,
 
} from "utils/functions";

const Settings = () => {
  const context = useContext(UserConsumer);
  const [user, updateUser] = useState({});
  const [_isLoaded, updateIsLoaded] = useState(false);
  const [language, updateLanguage] = useState(context.language);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isDeleted, updateIsDeleted] = useState(false);

  const isCanceled = useRef(false);

  useEffect(() => {
    getDataUser();
    return () => {
      isCanceled.current = true;
    };
  }, []);

  useEffect(() => {
    if (isDeleted) {
      axios.get(`http://localhost:5000/auth/logout`);
      setTimeout(() => {
        window.location.href = "http://localhost:3000/login";
      }, 1000);
    }
  }, [isDeleted]);

  const handleDeleteAccount = async () => {
    const response = await axios.delete(
      `http://localhost:5000/users/id`
    ); /* API.users.byId.delete(user); */
    if (!isCanceled.current && response.data.success) updateIsDeleted(true);
  };

  const getDataUser = async () => {
    const responseAuth = await axios.get(`http://localhost:5000/auth/`);
    if (responseAuth) {
      const responseUser = await axios.get(`http://localhost:5000/users/id`);
      if (!isCanceled.current && responseUser) {
        updateUser(responseUser.data.user[0]);
        updateIsLoaded(true);
      }
    }
  };

  const onChange = (event, option) => {
    updateUser({ ...user, [option]: event.target.value });
  };

  const handleChangeLanguage = (event) => {
    context.updateLanguage(event.target.value);
    updateLanguage(event.target.value);
  };

  const handleSubmit = () => {
    if (!isCanceled.current) {
      setError(null);
      setSuccess(null);
    }

    setTimeout(async () => {
      if (user.firstname && !checkName(user.firstname))
        return setError(translations[language].settings.errors.firstname);
      if (user.lastname && !checkName(user.lastname))
        return setError(translations[language].settings.errors.lastname);
      if (user.username && !checkUsername(user.username))
        return setError(translations[language].settings.errors.username);
      if (user.email && !checkEmail(user.email))
        return setError(translations[language].settings.errors.email);
      
      
      

      const res = await axios.put(`http://localhost:5000/users/id`, user);
      if (!isCanceled.current && res.data.success)
        setSuccess(translations[language].settings.success);
      else if (!isCanceled.current)
        setError(translations[language].settings.errors.alreadyUse);
    }, 100);
  };

  const enterKeyDown = async (event) => {
    const key = event.which || event.keyCode;
    if (key === 13) handleSubmit();
  };

  return (
    <div>
      {_isLoaded ? (
        <div
          onKeyDown={(event) => enterKeyDown(event)}
          className="dark-card center text-center"
          style={{ width: "40%" }}
        >
          <h2>{translations[language].settings.title}</h2>
          {error ? (
            <div
              id="error"
              className="error"
              style={{ display: "block" }}
              onClick={() => {
                document.getElementById("error").style.display = "none";
                setError(null);
              }}
            >
              {error}
            </div>
          ) : null}
          {success ? (
            <div
              id="success"
              className="success"
              style={{ display: "block" }}
              onClick={() => {
                document.getElementById("success").style.display = "none";
                setSuccess(null);
              }}
            >
              {success}
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <input
              className="dark-input"
              type="text"
              value={user.firstname}
              placeholder={translations[language].settings.firstname}
              onChange={(event) => onChange(event, "firstname")}
              style={{ width: "32%", marginTop: 5, marginBottom: 5 }}
            />
            <input
              className="dark-input"
              type="text"
              value={user.lastname}
              placeholder={translations[language].settings.lastname}
              onChange={(event) => onChange(event, "lastname")}
              style={{ width: "32%", marginTop: 5, marginBottom: 5 }}
            />
            <input
              className="dark-input"
              type="text"
              value={user.username}
              placeholder={translations[language].settings.username}
              onChange={(event) => onChange(event, "username")}
              style={{ width: "32%", marginTop: 5, marginBottom: 5 }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <input
              className="dark-input"
              type="email"
              value={user.email}
              placeholder={translations[language].settings.email}
              onChange={(event) => onChange(event, "email")}
              style={{ width: "49%", marginTop: 5, marginBottom: 5 }}
            />
            
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 20,
            }}
          >
            
           
            <select
              className="dark-input"
              defaultValue={language}
              onChange={(e) => {
                onChange(e, "language");
                handleChangeLanguage(e);
              }}
              style={{ width: "26%", marginTop: 5 }}
            >
              <option value="fr">
                {translations[language].settings.languages.french}
              </option>
              <option value="en">
                {translations[language].settings.languages.english}
              </option>
            </select>
          </div>
          <div className="row" style={{ justifyContent: "space-around" }}>
            <Button
              action={() => handleSubmit()}
              content={translations[language].settings.submit}
            />
          </div>
          <div
            onClick={() =>
              window.confirm(`${translations[language].settings.confirm}`)
                ? handleDeleteAccount()
                : updateIsDeleted(false)
            }
            style={{
              color: "crimson",
              marginTop: 20,
              fontSize: 14,
            }}
            className="hover-pointer"
          >
            {translations[language].settings.delete}
          </div>
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
};

export default Settings;
