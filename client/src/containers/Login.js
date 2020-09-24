import React, { useState, useContext, useRef, useEffect } from "react";
import axios from "axios";

import { Link } from "react-router-dom";
import { UserConsumer } from "store";
import Button from "components/Button";
//Oauth icons from svg
import { ReactComponent as GithubIcon } from "icons/github.svg";
import { ReactComponent as FourtyTwoIcon } from "icons/42.svg";
import { ReactComponent as GoogleIcon } from "icons/google.svg";

import translations from "translations";
axios.defaults.withCredentials = true;

const Login = () => {
  const context = useContext(UserConsumer);
  const { language } = context;
  const [username, updateUsername] = useState("");
  const [password, updatePassword] = useState("");
  const [email, updateEmail] = useState("");
  const [error, updateError] = useState("none");
  const [secondError, updateSecondError] = useState("none");
  const [forgot, updateForgot] = useState(false);
  const [link, updateLink] = useState(
    translations[language].login.inputs.forgotPassword
  );

  const isCanceled = useRef(false)

  useEffect(() => {
    return () => {
      isCanceled.current = true
    }
  }, [])

  

  const toggleForgot = () => {
    updateForgot(!forgot);
    updateLink(
      forgot
        ? translations[language].login.inputs.forgotPassword
        : translations[language].login.title
    );
  };

  const authenticate = async strategy => {
    document.getElementById("error").style.display = "none";
    if (strategy === "github") {
      window.location.href = `http://localhost:5000/oauth/github/`;
    } else if (strategy === "42") {
      window.location.href = `http://localhost:5000/oauth/42/`;
    } else if (strategy === "google") {
      window.location.href = `http://localhost:5000/oauth/google/`;
    } else {
      const body = { username, password };
      const response = await axios.post(
        `http://localhost:5000/auth/login/local`,
        body
      );
      if (!isCanceled.current && response.data.success) {
        window.location.href = `http://localhost:3000/`;
      } else if (!isCanceled.current) {
        updateError(response.data.status);
        document.getElementById("error").style.display = "block";
      }
    }
  };

  const sendResetLink = async () => {
    document.getElementById("error2").style.display = "none";
    const body = { email, origin: window.location.origin };
    const response = await axios.post(
      `http://localhost:5000/auth/forgot`,
      body
    );
    if (!isCanceled.current && !response.data.success) {
      updateSecondError(response.data.status);
      document.getElementById("error2").style.display = "block";
    } else if (!isCanceled.current) {
      document.getElementById("success").style.display = "block";
    }
  };

  const onEnter = event => {
    if (event.keyCode === 13) {
      forgot ? sendResetLink() : authenticate();
    }
  };

  return (
    <div
      onKeyDown={(event) => onEnter(event)}
      className="dark-card center text-center"
    >
      <h2>{translations[language].login.title}</h2>

      {forgot ? (
        <div>
          <div
            id="success"
            className="success"
            style={{ display: "none" }}
            onClick={() =>
              (document.getElementById("success").style.display = "none")
            }
          >
            Mail has been sent
          </div>
          <div
            id="error2"
            className="error"
            onClick={() =>
              (document.getElementById("error2").style.display = "none")
            }
          >
            {secondError}
          </div>
          <div id="forgot-form" style={{ width: 420 }}>
            <input
              value={email}
              onChange={(event) => updateEmail(event.target.value)}
              className="dark-input"
              type="email"
              placeholder="E-mail"
              style={{ width: "100%", marginBottom: 20 }}
            />
            <div className="row" style={{ justifyContent: "space-around" }}>
              <div style={{ display: "table" }} onClick={() => sendResetLink()}>
                <Button content="Send reset link" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div
            id="error"
            className="error"
            onClick={() =>
              (document.getElementById("error").style.display = "none")
            }
          >
            {error}
          </div>
          <div id="login-form">
            <div
              className="row"
              style={{ justifyContent: "space-between", marginBottom: 20 }}
            >
              <button
                onClick={() => authenticate("42")}
                className="oauth-btn oauth-btn-42"
                style={{ width: "30%" }}
              >
                <FourtyTwoIcon fill="#fff" width="25" height="25" />
              </button>
              <button
                onClick={() => authenticate("google")}
                className="oauth-btn oauth-btn-google"
                style={{ width: "30%" }}
              >
                <GoogleIcon fill="#fff" width="25" height="25" />
              </button>
              <button
                onClick={() => authenticate("github")}
                className="oauth-btn oauth-btn-42"
                style={{ width: "30%" }}
              >
                <GithubIcon fill="#fff" width="25" height="25" />
              </button>
            </div>
            <input
              value={username}
              onChange={(event) => updateUsername(event.target.value)}
              className="dark-input"
              type="text"
              placeholder={translations[language].login.inputs.username}
              style={{ width: "100%", marginTop: 5, marginBottom: 5 }}
            />
            <input
              value={password}
              onChange={(event) => updatePassword(event.target.value)}
              className="dark-input"
              type="password"
              placeholder={translations[language].login.inputs.password}
              style={{ width: "100%", marginTop: 5, marginBottom: 20 }}
            />
            <div className="row" style={{ justifyContent: "space-around" }}>
              <div style={{ display: "table" }} onClick={() => authenticate()}>
                <Button content={translations[language].login.inputs.submit} />
              </div>
            </div>
          </div>
        </div>
      )}
      <div
        className="row"
        style={{ marginTop: 20, fontSize: ".8em", opacity: 0.8 }}
      >
        <div
          className="link center"
          style={{ marginRight: 5 }}
          onClick={() => toggleForgot()}
        >
          {link}
        </div>
        /
        <div className="link center" style={{ marginLeft: 5 }}>
          <Link to="/register">
            {translations[language].login.inputs.register}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
