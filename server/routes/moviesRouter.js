const express = require("express");
const moviesHandler = require("../handlers/moviesHandler");

//authRouter
exports.router = (() => {
  const moviesRouter = express.Router();

  moviesRouter.get("/", moviesHandler.getMovies);

  moviesRouter.post("/", moviesHandler.postMovie);

  moviesRouter.put("/", moviesHandler.putMovie);

  moviesRouter.delete("/", moviesHandler.delMovies);

  moviesRouter.get("/filter", moviesHandler.filter);

  moviesRouter.get("/:id", moviesHandler.getMovieById);

  moviesRouter.put("/:id", moviesHandler.putMovieById);

  moviesRouter.delete("/:id", moviesHandler.delMovieById);

  moviesRouter.get("/yts/:id", moviesHandler.getYtsById);

  moviesRouter.get("/:id/hearbeat", moviesHandler.getHeartbeatById);

  moviesRouter.post("/:id/hearbeat", moviesHandler.postHeartbeatById);

  moviesRouter.delete("/:id/hearbeat", moviesHandler.delHeartbeatById);

  moviesRouter.get("/:id/recents", moviesHandler.getRecentsById);

  moviesRouter.post("/:id/recents", moviesHandler.postRecentsById);

  moviesRouter.delete("/:id/recents", moviesHandler.delRecentsById);

  moviesRouter.get("/:id/inprogress", moviesHandler.getInprogressById);

  moviesRouter.post("/:id/inprogress", moviesHandler.postInprogressById);

  moviesRouter.delete("/:id/inprogress", moviesHandler.delInprogressById);

  moviesRouter.post("/:id/comments", moviesHandler.postCommentsById);

  moviesRouter.post("/:id/comments/report", moviesHandler.reportComments);

  moviesRouter.get("/:id/ratings", moviesHandler.getRatings);

  moviesRouter.post("/:id/ratings", moviesHandler.postRatings);

  moviesRouter.get("/:id/user/ratings", moviesHandler.getUserRating);

  moviesRouter.get("/:id/progress", moviesHandler.getProgressById);

  moviesRouter.get("/:id/:username/progress", moviesHandler.getUserProgress);

  return moviesRouter;
})();
