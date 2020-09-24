import React from "react";

const ProgressBar = ({ progress }) => (
  <div>
    <div
      className="poster-progress-bar"
      style={{ width: `${(progress / 100) * 300}px` }}
    />
    <div className="poster-progress-bg" />
  </div>
);

export default ProgressBar;
