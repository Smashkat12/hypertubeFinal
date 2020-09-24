import React, { useState, useEffect, useContext, useRef } from "react";
import { withRouter } from "react-router-dom";
import Loading from "components/Loading";
import translations from "translations";
import { ReactComponent as CheckMark } from "icons/checkmark.svg";
import { UserConsumer } from "store";
import axios from "axios";



const Confirm = props => {
  const context = useContext(UserConsumer);

  const { key } = props.match.params;


  const [status, updateStatus] = useState("");

  const [_isLoaded, updateIsLoaded] = useState(false);
	const { language } = context;
	
  const isCanceled = useRef(false)

  /* HOOKS */
  useEffect(() => {
    //on componentWillUnmount
    return () => {
      isCanceled.current = true;
    };
  }, [])




  useEffect(() => {
    const fetchData = async () => {
		//Api call to backend --> confirms provider key
      const response = await axios.post(`http://localhost:5000/auth/confirm`, { key });
      if (!isCanceled.current && response.data.success) {
        updateStatus("ok");
        updateIsLoaded(true);
        setTimeout(() => {
			//move to login page
          window.location.href = "http://localhost:3000/login";
        }, 1000);
      } else if (!isCanceled.current) {
        updateStatus("not found");
        updateIsLoaded(true);
      }
    };

    fetchData();
  }, [key]);

  return _isLoaded ? (
    <div style={{ textAlign: "center" }}>
      {status === "ok" ? (
        <div>
          <CheckMark width="50" height="50" fill="#5CB85C" />
          <div>{translations[language].confirm.success}</div>
        </div>
      ) : (
        (window.location.href = "http://localhost:3000/")
      )}
    </div>
  ) : (
    <Loading />
  );
};

export default withRouter(Confirm);
