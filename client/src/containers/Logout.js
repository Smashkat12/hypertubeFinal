import React, { useState, useEffect, useContext } from "react";
import translations from "translations";
import Loading from "components/Loading";
import { ReactComponent as CheckMark } from "icons/checkmark.svg";
import { UserConsumer } from "store";
import axios from "axios";


const Logout = () => {
  const [disconnected, updateDisconnected] = useState(false);
  const context = useContext(UserConsumer);

  useEffect(() => {
    axios.get(`http://localhost:5000/auth/logout`);
    updateDisconnected(true);
    setTimeout(() => {
      window.location.href = "http://localhost:3000/login";
    }, 1000);
  }, []);

  return (
    <div className="text-center">
      {disconnected ? (
        <div>
          <CheckMark width="50" height="50" fill="#5CB85C" />
          <p>{translations[context.language].logout.title}</p>
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
};

export default Logout;
