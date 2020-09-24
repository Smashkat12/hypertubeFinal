const express = require("express");

const torrentHandler = require("../handlers/torrentsHandler");

//torrentRouter
exports.router = (() => {
  const torrentRouter = express.Router();

  torrentRouter.get("/yts/search", torrentHandler.search);

  torrentRouter.get("/yts/:id", torrentHandler.getMovieDetails);

  torrentRouter.get("/stream/:magnet", torrentHandler.stream);

  torrentRouter.get("/subtitles/:imdbid", torrentHandler.getSubtitles);

  return torrentRouter;
})();
