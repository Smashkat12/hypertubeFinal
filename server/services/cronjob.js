const cron = require("node-cron");
const Movie = require("../models/movie");



////runs on the first day on month
cron.schedule("* * * 1 * *", () => {
  Movie.find({}, (err, movies) => {
    if (!err) {
      movies.forEach(movie => {
        if (movie.last_seen + 2629800000 < Date.now()) {
          Movie.deleteOne({ _id: movie._id }, (err) => {
            if (!err) console.log(movie._id + ' deleted')
          });
        }
      })
    }
  });
});