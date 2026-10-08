const express = require("express");
const passport = require("passport");


// Send the user back to the frontend on whichever host they came in on:
// HTTPS (tailscale serve) -> app on :443, plain HTTP -> React dev server on :3001
const frontend = (req) =>
  req.protocol === "https" ? `https://${req.hostname}` : `http://${req.hostname}:3001`;

//oauthRouter
exports.router = (() => {
  const oauthRouter = express.Router();

  /* 42 */
  oauthRouter.get("/42", passport.authenticate("42"));
  oauthRouter.get(
    "/42/redirect",
    (req, res, next) =>
      passport.authenticate("42", {
        failureRedirect: `${frontend(req)}/login`,
      })(req, res, next),
    (req, res) => {
      req.login(req.user, (err) => {
        if (err) {
          res.redirect(`${frontend(req)}/login`);
        } else if (req.user) {
          res.redirect(`${frontend(req)}/`);
        } else {
          res.redirect(`${frontend(req)}/login`);
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
    (req, res, next) =>
      passport.authenticate("google", {
        failureRedirect: `${frontend(req)}/login`,
      })(req, res, next),
    (req, res) => {
      req.login(req.user, (err) => {
        if (err) {
          res.redirect(`${frontend(req)}/login`);
        } else if (req.user) {
          res.redirect(`${frontend(req)}/`);
        } else {
          res.redirect(`${frontend(req)}/login`);
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
    (req, res, next) =>
      passport.authenticate("github", {
        failureRedirect: `${frontend(req)}/login`,
      })(req, res, next),
    (req, res) => {
      req.login(req.user, (err) => {
        if (err) {
          res.redirect(`${frontend(req)}/login`);
        } else if (req.user) {
          res.redirect(`${frontend(req)}/`);
        } else {
          res.redirect(`${frontend(req)}/login`);
        }
      });
    }
  );

  return oauthRouter;
})();
