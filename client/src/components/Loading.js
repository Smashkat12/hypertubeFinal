import React from "react";

const Loading = () => (
  <div className="container" style={{ marginTop: 300 }}>
    <div className="load-text row center">
      <div style={{display: 'block', width: 30, height: 30, backgroundColor: '#6767fa', borderRadius: '50%', marginRight: 10}}></div>
      <div style={{display: 'block', width: 45, height: 45, backgroundColor: '#6767fa', borderRadius: '50%'}}></div>
    </div>
    <div className="flex" style={{ marginTop: 25 }}>
      <div className="loader"></div>
    </div>
  </div>
);

export default Loading;
