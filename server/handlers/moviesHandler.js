const Movie = require("../models/movie");
const User = require("../models/user");
const { genres } = require("../data/genres.json");

module.exports = {
  getMovies: (req, res) => {
    if (req.query.search) {
      Movie.find(
        { name: { $regex: `${req.query.search}`, opts: "i" } },
        (err, movies) => {
          if (err) res.json({ success: false });
          else res.json({ success: true, movies: movies });
        }
      );
    } else {
      Movie.find({}, (err, movies) => {
        if (err) res.json({ success: false });
        else res.json({ success: true, movies: movies });
      });
    }
  },

  postMovie: (req, res) => {
    const newMovie = Movie({
      _ytsId: req.body.ytsId,
      name: req.body.name,
      poster: req.body.poster,
      last_seen: Date.now(),
      ytsData: req.body.ytsData,
      description: req.body.description || "No description",
      author: req.body.author || "No author",
      rating: req.body.rating,
    });

    newMovie.save((err) => {
      if (err) {
        res.json({ success: false, error: err });
      } else {
        res.json({ success: true, movie: newMovie });
      }
    });
  },

  putMovie: (req, res) => {
    Movie.findOneAndUpdate(
      { _id: req.body.id },
      { $set: { last_seen: Date.now() } },
      (err) => {
        if (err) {
          res.json({ success: false });
        } else {
          res.json({ success: true });
        }
      }
    );
  },

  delMovies: (req, res) => {
    if (req.user && req.user.admin) {
      Movie.remove({}, (err) => {
        if (err) res.json({ success: false, error: err });
        else res.json({ success: true });
      });
    } else res.json({ success: false, status: "Unauthorized" });
  },

  filter: (req, res) => {
    if (req.query.minyear === "") req.query.minyear = 1900;
    if (req.query.maxyear === "") req.query.maxyear = new Date().getFullYear();

    if (req.query.genre !== "") {
      const genreName = genres.find((obj) => obj.id === req.query.genre).name;
      Movie.find(
        {
          "ytsData.genres": genreName,
          $and: [
            { "ytsData.year": { $gte: parseInt(req.query.minyear) } },
            { "ytsData.year": { $lte: parseInt(req.query.maxyear) } },
          ],
        },
        (err, movies) => {
          if (err) res.json({ success: false });
          else res.json({ success: true, movies: movies });
        }
      );
    } else {
      Movie.find(
        {
          "ytsData.year": {
            $gte: parseInt(req.query.minyear),
            $lt: parseInt(req.query.maxyear),
          },
        },
        (err, movies) => {
          if (err) res.json({ success: false });
          else res.json({ success: true, movies: movies });
        }
      );
    }
  },

  getMovieById: (req, res) => {
    if (req.params.id) {
      Movie.find({ _id: req.params.id }, (err, movie) => {
        if (err) res.json({ success: false });
        else if (movie.length !== 0) res.json({ success: true, movie: movie });
        else res.json({ success: false });
      });
    } else {
      res.json({ success: false });
    }
  },

  putMovieById: (req, res) => {
    const updateQuery = {};

    if (req.body.name) updateQuery.name = req.body.name;
    if (req.body.description) updateQuery.description = req.body.description;
    if (req.body.poster) updateQuery.poster = req.body.poster;
    if (req.body.author) updateQuery.author = req.body.author;
    if (req.body.rating) updateQuery.rating = req.body.rating;

    Movie.findOneAndUpdate(
      { _id: req.params.id },
      updateQuery,
      { upsert: true },
      (err, movie) => {
        if (err) return res.json({ success: false });
        else return res.json({ success: true, updated: movie });
      }
    );
  },

  delMovieById: (req, res) => {
    if (req.user && req.user.admin) {
      Movie.findOneAndRemove({ _id: req.params.id }, (err) => {
        if (err) res.json({ success: false });
        else res.json({ success: true });
      });
    } else res.json({ success: false, status: "Unauthorized" });
  },

  getYtsById: (req, res) => {
    Movie.findOne({ _ytsId: req.params.id }, (err, movie) => {
      if (err) res.json({ success: false, err: err });
      else if (movie && movie.length !== 0) {
        res.json({ success: true, movie: movie });
      } else {
        res.json({ success: false });
      }
    });
  },

  getHeartbeatById: (req, res) => {
    const movie = { id: req.params.id };
    User.findOne(
      { _id: req.user._id },
      { heartbeat: { $elemMatch: { id: movie.id } } },
      (err, result) => {
        if (err) {
          res.json({ success: false });
        } else {
          if (result) {
            res.json({ success: true, found: result.heartbeat.length });
          } else {
            res.json({ success: true, found: 0 });
          }
        }
      }
    );
  },

  postHeartbeatById: (req, res) => {
    if (req.user && req.user._id) {
      const movie = { id: req.params.id, time: Date.now() };
      User.findOne(
        { _id: req.user._id, "heartbeat.id": req.params.id },
        (err, result) => {
          if (err) {
            res.json({ success: false });
          } else if (!result) {
            User.findOneAndUpdate(
              { _id: req.user._id },
              { $push: { heartbeat: movie } },
              (err) => {
                if (err) {
                  res.json({ success: false });
                } else {
                  res.json({ success: true, movie: movie });
                }
              }
            );
          }
        }
      );
    } else {
      res.json({ success: false });
    }
  },

  delHeartbeatById: (req, res) => {
    const movie = { id: req.params.id };
    User.findOneAndUpdate(
      { _id: req.user._id },
      { $pull: { heartbeat: { id: movie.id } } },
      (err) => {
        if (err) {
          res.json({ success: false });
        } else {
          res.json({ success: true });
        }
      }
    );
  },

  getRecentsById: (req, res) => {
    const movie = { id: req.params.id };
    User.findOne(
      { _id: req.user._id },
      { recents: { $elemMatch: { id: movie.id } } },
      (err, result) => {
        if (err) {
          res.json({ success: false });
        } else {
          if (result) {
            res.json({ success: true, found: result.recents.length });
          } else {
            res.json({ success: true, found: 0 });
          }
        }
      }
    );
  },

  postRecentsById: (req, res) => {
    if (req.user && req.user._id) {
      const movie = { id: req.params.id, time: Date.now() };
      User.findOne(
        { _id: req.user._id, "recents.id": req.params.id },
        (err, result) => {
          if (err) {
            res.json({ success: false });
          } else if (!result) {
            User.findOneAndUpdate(
              { _id: req.user._id },
              { $push: { recents: movie } },
              (err) => {
                if (err) {
                  res.json({ success: false });
                } else {
                  res.json({ success: true, movie: movie });
                }
              }
            );
          }
        }
      );
    }
  },

  delRecentsById: (req, res) => {
    const movie = { id: req.params.id };
    User.findOneAndUpdate(
      { _id: req.user._id },
      { $pull: { recents: { id: movie.id } } },
      (err) => {
        if (err) {
          res.json({ success: false });
        } else {
          res.json({ success: true });
        }
      }
    );
  },

  getInprogressById: (req, res) => {
    const movie = { id: req.params.id };
    User.findOne(
      { _id: req.user._id },
      { inProgress: { $elemMatch: { id: movie.id } } },
      (err, result) => {
        if (err) {
          res.json({ success: false });
        } else {
          if (result) {
            res.json({
              success: true,
              list: result,
              found: result.inProgress.length,
            });
          } else {
            res.json({ success: true, found: 0 });
          }
        }
      }
    );
  },

  postInprogressById: (req, res) => {
    if (req.user && req.user._id) {
      const movie = {
        id: req.params.id,
        ytsId: req.body.ytsId,
        percent: req.body.percent,
        timecode: req.body.timecode,
        time: Date.now(),
      };
      User.findOne(
        { _id: req.user._id, "inProgress.id": req.params.id },
        (err, result) => {
          if (err) {
            res.json({ success: false });
          } else if (result) {
            User.updateOne(
              { _id: req.user._id, "inProgress.id": req.params.id },
              {
                $set: {
                  "inProgress.$.percent": req.body.percent,
                  "inProgress.$.timecode": req.body.timecode,
                },
              },
              (err) => {
                if (err) {
                  res.json({ success: false, error: err });
                } else {
                  res.json({ success: true });
                }
              }
            );
          } else {
            User.findOneAndUpdate(
              { _id: req.user._id },
              { $push: { inProgress: movie } },
              (err) => {
                if (err) {
                  res.json({ success: false, error: err });
                } else {
                  User.findOneAndUpdate(
                    { _id: req.user._id },
                    { new: true },
                    (err) => {
                      if (err) {
                        res.json({ success: false, error: err });
                      } else {
                        res.json({ success: true });
                      }
                    }
                  );
                }
              }
            );
          }
        }
      );
    }
  },

  delInprogressById: (req, res) => {
    const movie = { id: req.params.id };
    User.findOneAndUpdate(
      { _id: req.user._id },
      { $pull: { inProgress: { id: movie.id } } },
      (err) => {
        if (err) {
          res.json({ success: false });
        } else {
          res.json({ success: true });
        }
      }
    );
  },

  postCommentsById: (req, res) => {
    const newComment = { author: req.body.author, content: req.body.content };
    Movie.findOneAndUpdate(
      { _id: req.params.id },
      { $push: { comments: newComment } },
      (err) => {
        if (err) {
          res.json({ success: false });
        } else {
          res.json({ success: true, comment: newComment });
        }
      }
    );
  },

  reportComments: (req, res) => {
    Movie.updateOne(
      { _id: req.params.id, "comments._id": req.body.commId },
      {
        $inc: {
          "comments.$.report": 1,
        },
      },
      (err) => {
        if (err) {
          res.json({ success: false, error: err });
        } else {
          res.json({ success: true });
        }
      }
    );
  },

  getRatings: (req, res) => {
    Movie.findOne({ _id: req.params.id }, (err, result) => {
      if (result) {
        let count = 0;
        let total = 0;
        result.ratings.forEach((el) => {
          total += el.rating;
          count++;
        });
        res.json({
          success: true,
          ratingAverage: Math.floor((total / count) * 100) / 100,
          ratingCount: count,
        });
      } else {
        res.json({ success: false });
      }
    });
  },

  postRatings: (req, res) => {
    const newRating = { uid: req.user._id, rating: req.body.rating };

    Movie.findOne(
      { _id: req.params.id, "ratings.uid": req.user._id },
      (err, result) => {
        if (err) {
          console.log(err);
          res.json({ success: false });
        } else if (result) {
          Movie.updateOne(
            { _id: req.params.id, "ratings.uid": req.user._id },
            { $set: { "ratings.$.rating": req.body.rating } },
            (err) => {
              if (err) {
                console.log(err);
                res.json({ success: false });
              } else {
                res.json({ success: true });
              }
            }
          );
        } else {
          Movie.findOneAndUpdate(
            { _id: req.params.id },
            { $push: { ratings: newRating } },
            (err) => {
              if (err) {
                res.json({ success: false, error: err });
              } else {
                Movie.findOneAndUpdate(
                  { _id: req.params.id },
                  { new: true },
                  (err) => {
                    if (err) {
                      res.json({ success: false, error: err });
                    } else {
                      res.json({ success: true });
                    }
                  }
                );
              }
            }
          );
        }
      }
    );
  },

  getUserRating: (req, res) => {
    Movie.findOne(
      { _id: req.params.id, "ratings.uid": req.user._id },
      { "ratings.$": 1 },
      (err, result) => {
        if (err) res.json({ error: err });
        if (result) {
          res.json({ success: true, rating: result.ratings[0].rating });
        } else {
          res.json({ success: false });
        }
      }
    );
  },

  getProgressById: (req, res) => {
    User.findOne(
      { _id: req.user._id },
      { inProgress: { $elemMatch: { id: req.params.id } } },
      (err, result) => {
        if (err) res.json({ success: false });
        else
          res.json({
            success: true,
            watchPercent:
              result.inProgress.length > 0 ? result.inProgress[0].percent : 0,
          });
      }
    );
  },

  getUserProgress: (req, res) => {
    User.findOne(
      { username: req.params.username },
      { inProgress: { $elemMatch: { id: req.params.id } } },
      (err, result) => {
        if (err) res.json({ success: false });
        else
          res.json({
            success: true,
            watchPercent:
              result.inProgress.length > 0 ? result.inProgress[0].percent : 0,
          });
      }
    );
  },
};