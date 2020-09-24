const express = require("express");
const session = require("express-session");
const morgan = require("morgan");
const chalk = require("chalk");
const fileUpload = require("express-fileupload");
const cron = require("./services/cronjob");
const app = express();
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
/* const cookieParser = require("cookie-parser"); */
const cors = require("cors");
const passport = require("passport");
const contimeout = require("connect-timeout");
const { v4: uuidv4 } = require("uuid");
const keys = require("./config/keys");
const authRouter = require("./routes/authRouter");
const moviesRouter = require("./routes/moviesRouter");
const userRouter = require("./routes/usersRouter");
const torrentRouter = require("./routes/torrentsRouter");
const oauthRouter = require("./routes/oauthRouter");

global.__basedir = __dirname;

console.log(__dirname);

/* ***************************************************END OF IMPORTS ********************************************************** */

//DB Connection
mongoose.connect(keys.MONGODB.mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
  useFindAndModify: false,
});

var cl = console.log; //short hand for cleaner code

mongoose.connection.on("connected", () => {
  cl(chalk.bold.greenBright("The db has connected successfully!"));
});
mongoose.connection.on("error", (err) => {
  cl(
    chalk.bold.yellowBright(
      `An error: ${err} occured when trying to connect to db`
    )
  );
});
mongoose.connection.on("disconnected", () => {
  cl(chalk.bold.redBright("The db has disconnected!"));
});

/* ****************************************************END OF DB CONNECTION **************************************************** */
/* Middleware */

app.use(
  session({
    genid: () => {
      return uuidv4();
    },
    secret: "SecretSource",
    cookie: {
      secure: "auto",
      maxAge: 1000 * 60 * 60 * 24 * 7, // expires in a week
    },
    resave: false,
    saveUninitialized: false,
  })
); //

/* app.use(cookieParser()); */
app.use(
  cors({
    origin: [`http://localhost:3000`],
    credentials: true,
  })
); //
app.use(morgan("dev")); //
app.use(bodyParser.json({ limit: "15mb" })); //
app.use(bodyParser.urlencoded({ extended: true, limit: "15mb" })); //
app.use(fileUpload()); //
app.use("/public", express.static(__dirname + "/public"));
app.use("/torrents", express.static(__dirname + "/torrents"));
//set response headers
/* app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "X-Requested-With, Content-Type, Origin, Accept"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "DELETE,GET,PUT,POST,OPTIONS"
  );
  
  next();
}); */



require("./services/passport-service")(passport); //pass same instance of passport to be used in config.
app.use(passport.initialize()); //
app.use(passport.session()); //
app.use(contimeout("6000s"));
/* ****************************************************END OF MIDDLEWARE **************************************************** */

//Routes
app.use("/oauth", oauthRouter.router);
app.use("/auth", authRouter.router);
app.use("/users", userRouter.router);
app.use("/movies", moviesRouter.router);
app.use("/torrents", torrentRouter.router);

app.post("/register/avatar", (req, res) => {
  let avatarFile = req.files.file;
  let uniqueId = uuidv4();
  let timestamp = Date.now();
  console.log(avatarFile);
  avatarFile.mv(`server/public/avatars/tmp/${uniqueId}_${timestamp}.jpg`, (err) => {
    if (err) {
      console.log(err);
      res.json({ success: false });
    } else res.json({ success: true, file: `${uniqueId}_${timestamp}.jpg` });
  });
});

/* ****************************************************END OF ROUTES **************************************************** */

/* Start Services */

//create cron job here to delete movies that havent been watched in a month

/* ****************************************************END OF SERVICES **************************************************** */

/* Server Setup */

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server Running at ${port}`);
});

/* ****************************************************END OF SERVER SETUP **************************************************** */
