const express = require("express");
const userHandler = require("../handlers/userHandler");


//userRouter
exports.router = (() => {
  const userRouter = express.Router();

  userRouter.get("/", userHandler.getUsers);

  userRouter.post("/", userHandler.postUser);

  userRouter.delete("/", userHandler.delUser);

  userRouter.get("/id", userHandler.getUserById);

  userRouter.delete("/id", userHandler.delUserById);

  userRouter.put("/id", userHandler.putUserById);

  userRouter.get("/n/:username", userHandler.getUserByUsername);

  userRouter.post("/avatar", userHandler.postAvatar);

  userRouter.get("/language", userHandler.getLanguage);

  userRouter.post("/ban/:username", userHandler.postBantime);

  userRouter.post("/unban/:username", userHandler.postUnban);

  
  return userRouter;
})();