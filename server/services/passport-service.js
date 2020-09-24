const User = require("../models/user");
const LocalStrategy = require("passport-local").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const FortyTwoStrategy = require("passport-42").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const keys = require("../config/keys");
const utils = require("../utils/utils");

module.exports = function (passport) {
  /* Local Strategy */
  passport.use(
    new LocalStrategy((username, password, done) => {
      User.findOne({ username: username }, function (err, user) {
        if (err) {
          return done(err);
        }
        if (!user) {
          return done(null, false, {
            message: "Incorrect username or password.",
          });
        }
        if (!user.validPassword(password)) {
          return done(null, false, {
            message: "Incorrect username or password.",
          });
        }
        if (!user.isMailConfirmed()) {
          return done(null, false, {
            message: "Please confirm your email address",
          });
        }
        return done(null, user);
      });
    })
  );

  /* Google Strategy */
  passport.use(
    new GoogleStrategy(
      {
        clientID: keys.GOOGLE.clientID,
        clientSecret: keys.GOOGLE.secret,
        callbackURL: "http://localhost:5000/oauth/google/redirect",
      },
      (accessToken, refreshToken, profile, done) => {
        User.findOne({ _googleID: profile.id }, function (err, user) {
          if (err) {
            return done(err);
          } else if (!user) {
            const newUser = User({
              _googleID: profile.id,
              firstname: profile.name.givenName,
              lastname: profile.name.familyName,
              language: "en",
              username: profile.name.givenName,
              email: `${profile.username}@gmail.com`,
              cover: "cinema",
              avatar: profile.photos[0].value,
            });

            newUser.save((err) => {
              if (err) {
                return done(null, false, { error: err });
              } else {
                return done(null, newUser);
              }
            });
          } else if (user.bantime < Date.now()) {
            return done(null, user);
          } else {
            return done(null, false);
          }
        });
      }
    )
  );

  /* Github Strategy */
  passport.use(
    new GitHubStrategy(
      {
        clientID: "bfd8d38aa22fcf52f39d",
        clientSecret: "06e13f97116ce6a7ffd2ee70cc3d8e359f9f4131",
        callbackURL: "http://localhost:5000/oauth/github/redirect",
      },
      (accessToken, refreshToken, profile, done) => {
        User.findOne({ _githubID: profile._json.id }, function (err, user) {
          if (err) {
            return done(err);
          } else if (!user) {
            const newUser = User({
              _githubID: profile._json.id,
              language: "en",
              username: profile._json.login,
              cover: "cinema",
              email: profile._json.email,
              avatar: profile._json.avatar_url,
            });

            newUser.save((err) => {
              if (err) {
                return done(null, false, { error: err });
              } else {
                return done(null, newUser);
              }
            });
          } else if (user.bantime < Date.now()) {
            return done(null, user);
          } else {
            return done(null, false);
          }
        });
      }
    )
  );






  /* 42 Strategy */
  passport.use(
    new FortyTwoStrategy(
      {
        clientID: keys.FORTY_TWO.clientID,
        clientSecret: keys.FORTY_TWO.secret,
        callbackURL: "http://localhost:5000/oauth/42/redirect",
      },
      (accessToken, refreshToken, profile, done) => {
        User.findOne({ facebook_id: profile._json.id }).then((user) => {
          if (user) {
            done(null, user);
          } else {
            User.findOneAndUpdate(
              { email: profile._json.email },
              { $set: { fortytwo_id: profile._json.id } },
              { new: true }
            ).then((user) => {
              if (user) done(null, user);
              else {
                let newUser = {
                  firstname: profile._json.first_name.replace(" ", ""),
                  lastname: profile._json.last_name.replace(" ", ""),
                  username: `${profile._json.first_name}${
                    profile._json.last_name
                  }${utils.generateRandomNumber()}`,
                  email: profile._json.email.replace(" ", ""),
                  image: profile._json.image_url,
                  fortytwo_id: profile._json.id,
                  provider: "42",
                };
                new User(newUser).save().then((user) => done(null, user));
              }
            });
          }
        });
      }
    )
  );

  /* set session cookie */
  passport.serializeUser((user, done) => {
    done(null, user);
  });

  /* takes session cookie and gets user */
  passport.deserializeUser((user, done) => {
    done(null, user);
  });
};
