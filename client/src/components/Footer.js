import React, { useContext } from "react";
import translations from "translations";
import { UserConsumer } from "store";

const Footer = () => {
  const context = useContext(UserConsumer);
  const { language } = context;

  return (
    <div className="App-footer">
      <div className="footer-text">{translations[language].footer.title}</div>
    </div>
  );
};

export default Footer;
