const express = require("express");
const passport = require("passport");


//oauthRouter
exports.router = (() => {
  const oauthRouter = express.Router();

  /* 42 */
  oauthRouter.get("/42", passport.authenticate("42"));
  oauthRouter.get(
    "/42/redirect",
    passport.authenticate("42", {
      failureRedirect: `http://localhost:3000/login`,
    }),
    (req, res) => {
      req.login(req.user, (err) => {
        if (err) {
          res.redirect(`http://localhost:3000/login`);
        } else if (req.user) {
          res.redirect(`http://localhost:3000/`);
        } else {
          res.redirect(`http://localhost:3000/login`);
        }
      });
    }
  );

  /* GOOGLE */
  oauthRouter.get(
    "/google",
    passport.authenticate("google", { scope: ["profile"] })
  );
  oauthRouter.get(
    "/google/redirect",
    passport.authenticate("google", {
      failureRedirect: `http://localhost:3000/login`,
    }),
    (req, res) => {
      req.login(req.user, (err) => {
        if (err) {
          res.redirect(`http://localhost:3000/login`);
        } else if (req.user) {
          res.redirect(`http://localhost:3000/`);
        } else {
          res.redirect(`http://localhost:3000/login`);
        }
      });
    }
  );

  /* Github */
  oauthRouter.get(
    "/github",
    passport.authenticate("github", { scope: ["profile"] })
  );

  oauthRouter.get(
    "/github/redirect",
    passport.authenticate("github", {
      failureRedirect: `http://localhost:3000/login`,
    }),
    (req, res) => {
      req.login(req.user, (err) => {
        if (err) {
          res.redirect(`http://localhost:3000/login`);
        } else if (req.user) {
          res.redirect(`http://localhost:3000/`);
        } else {
          res.redirect(`http://localhost:3000/login`);
        }
      });
    }
  );

  return oauthRouter;
})();
