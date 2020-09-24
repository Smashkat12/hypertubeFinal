import React from "react";

const Button = ({ content, action, style }) => (
  <div style={style} onClick={action} className="button">
    {content}
  </div>
);

export default Button;
