const express = require("express");
const authHandler = require("../handlers/authHandler");


//authRouter
exports.router = (() => {
  const authRouter = express.Router();

  authRouter.get("/", authHandler.isAuthenticated);

  authRouter.get("/logout", authHandler.logout);

  authRouter.post("/login/:strategy", authHandler.strategy);

  authRouter.post("/confirm", authHandler.confirm);

  authRouter.post("/forgot", authHandler.forgotInitiate);

  authRouter.get("/forgot/:key", authHandler.forgotConfirmKey);

  authRouter.post("/forgot/:key", authHandler.forgotPasswordChange);
  
  return authRouter;
})();
