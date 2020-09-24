import React, { useState, useEffect, useContext, useRef } from "react";
import { withRouter } from "react-router-dom";
import Loading from "components/Loading";
import Button from "components/Button";

import translations from "translations";
import { checkpassword } from "utils/functions";
import { UserConsumer } from "store";
import axios from "axios";

const Forgot = (props) => {
  const context = useContext(UserConsumer);
  const { language } = context;
  const { key } = props.match.params;
  const [user, updateUser] = useState({});
  const [password, updatePassword] = useState("");
  const [confirmPassword, updateConfirmPassword] = useState("");
  const [status, updateStatus] = useState("");
  const [_isLoaded, updateIsLoaded] = useState(false);
  const isCanceled = useRef(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    return () => {
      isCanceled.current = true;
    };
  }, []);

  useEffect(() => {
    const fetchKey = async () => {
      const response = await axios.get(
        `http://localhost:5000/auth/forgot/${key}`
      );
      if (!isCanceled.current && response.data.success) {
        updateStatus("ok");
        updateUser(response.data.user[0]);
        updateIsLoaded(true);
      } else if (!isCanceled.current) {
        updateStatus("not found");
        updateIsLoaded(true);
      }
    };

    fetchKey();
  }, [key]);

  const validate = async () => {
    if (!isCanceled.current) {
      setSuccess(false);
      setError(null);
    }

    if (checkpassword(password, confirmPassword)) {
      const body = { passwd: password };
      const response = await axios.post(
        `http://localhost:5000/auth/forgot/${key}`,
        body
      );
      if (!isCanceled.current && response.data.success) {
        setSuccess(true);
      } else if (!isCanceled.current) {
        setError(translations[language].forgot.error);
      }
    } else {
      setError(translations[language].forgot.errorPassword);
    }
  };

  const onEnter = (e) => {
    if (e.keyCode === 13) validate();
  };

  return _isLoaded ? (
    <div style={{ textAlign: "center" }}>
      {status === "ok" ? (
        <div className="dark-card center text-center" style={{ width: "35%" }}>
          <div>
            <span style={{ fontWeight: "bold" }}>{user.username}</span>,{" "}
            {translations[language].forgot.instruction}
          </div>

          <div style={{ marginTop: 20 }}>
            {success ? (
              <div
                className="success"
                style={{ display: "block" }}
                onClick={() => setSuccess(false)}
              >
                {translations[language].forgot.success}
              </div>
            ) : null}

            {error ? (
              <div
                id="error"
                className="error"
                style={{ display: "block", width: "100%" }}
                onClick={() => {
                  document.getElementById("error").style.display = "none";
                  setError(null);
                }}
              >
                {error}
              </div>
            ) : null}
          </div>

          <input
            value={password}
            onChange={(event) => updatePassword(event.target.value)}
            className="dark-input"
            type="password"
            placeholder={translations[language].forgot.placeholders.newPassword}
            style={{ width: "100%", marginTop: 20, marginBottom: 5 }}
            onKeyDown={(e) => onEnter(e)}
          />
          <input
            value={confirmPassword}
            onChange={(event) => updateConfirmPassword(event.target.value)}
            className="dark-input"
            type="password"
            placeholder={
              translations[language].forgot.placeholders.confirmPassword
            }
            style={{ width: "100%", marginTop: 5, marginBottom: 20 }}
            onKeyDown={(e) => onEnter(e)}
          />
          <div className="row" style={{ justifyContent: "space-around" }}>
            <div style={{ display: "table" }} onClick={() => validate()}>
              <Button content={translations[language].forgot.submit} />
            </div>
          </div>
        </div>
      ) : (
        <div>{translations[language].forgot.errorKey}</div>
      )}
    </div>
  ) : (
    <Loading />
  );
};

export default withRouter(Forgot);
