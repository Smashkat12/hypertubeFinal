import React, { useContext } from "react";
import translations from "translations";
import { UserConsumer } from "store";

const NotFound = () => {
  const context = useContext(UserConsumer);

  return (
    <div className="text-center">
      <h2>404</h2>
      {translations[context.language].notfound.title}
    </div>
  );
};

export default NotFound;
