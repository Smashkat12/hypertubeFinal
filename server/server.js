const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo")(session);
const morgan = require("morgan");
const chalk = require("chalk");
const fileUpload = require("express-fileupload");
const cron = require("./services/cronjob");
const app = express();
// behind tailscale serve: honour X-Forwarded-Proto so secure cookies + OAuth callbacks use https
app.set("trust proxy", "loopback");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
/* const cookieParser = require("cookie-parser"); */
const cors = require("cors");
const passport = require("passport");
const contimeout = require("connect-timeout");
const { v4: uuidv4 } = require("uuid");
const keys = require("./config/keys");
// secrets come from .env via start.sh (see .env.example)
const missing = ["SESSION_SECRET", "STREAM_TOKEN_SECRET"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")}: copy .env.example to .env and fill it in`);
  process.exit(1);
}
const authRouter = require("./routes/authRouter");
const moviesRouter = require("./routes/moviesRouter");
const userRouter = require("./routes/usersRouter");
const torrentRouter = require("./routes/torrentsRouter");
const oauthRouter = require("./routes/oauthRouter");
const streamRouter = require("./routes/streamRouter");
const catalogRouter = require("./routes/catalogRouter");
const path = require("path")

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
    secret: keys.SESSION.secret,
    cookie: {
      secure: "auto",
      maxAge: 1000 * 60 * 60 * 24 * 7, // expires in a week
    },
    resave: false,
    saveUninitialized: false,
    // persist sessions so a server restart doesn't log everyone out
    store: new MongoStore({ mongooseConnection: mongoose.connection }),
  })
); //

/* app.use(cookieParser()); */
app.use(
  cors({
    origin: true, // reflect caller origin so LAN devices can reach the API
    credentials: true,
  })
); //
app.use(morgan("dev")); //
// note each device's browser once, so we can tell what a TV or phone identifies itself as
const seenClients = new Set();
app.use((req, res, next) => {
  // control characters stripped so a crafted header can't forge log lines or send terminal escapes
  const ua = (req.headers["user-agent"] || "").replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 300);
  const id = `${req.ip} ${ua}`;
  if (ua && !seenClients.has(id) && seenClients.size < 500) {
    seenClients.add(id);
    console.log(`Client ${req.ip}: ${ua}`);
  }
  next();
});
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

// reject logged-out requests before handlers touch req.user._id (was crashing the server)
const requireAuth = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ success: false, status: "Unauthorized" });
};

//Routes
app.use("/movies", requireAuth);
app.use("/torrents/yts", requireAuth);
app.use(["/users/id", "/users/avatar"], requireAuth);
app.use("/oauth", oauthRouter.router);
app.use("/auth", authRouter.router);
app.use("/users", userRouter.router);
app.use("/movies", moviesRouter.router);
app.use("/torrents", torrentRouter.router);
app.use("/stream", streamRouter.router);
app.use("/catalog", requireAuth, catalogRouter.router);

app.post("/register/avatar", (req, res) => {
  let avatarFile = req.files.file;
  let uniqueId = uuidv4();
  let timestamp = Date.now();
  console.log(avatarFile);
  avatarFile.mv(`${__basedir}/public/avatars/tmp/${uniqueId}_${timestamp}.jpg`, (err) => {
    if (err) {
      console.log(err);
      res.json({ success: false });
    } else res.json({ success: true, file: `${uniqueId}_${timestamp}.jpg` });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../client/build', 'index.html'));
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

// download new episodes of followed shows in the background
require("./services/autoDownload").start();

// Production: serve the built web app (client/build) on WEB_PORT too, so the same addresses keep
// working (LAN :3001, tailscale serve 443 -> :3001). Hashed assets cache for a year; index.html never.
if (process.env.WEB_PORT) {
  const web = express();
  web.use(require("compression")());
  const BUILD = path.resolve(__dirname, "../client/build");
  web.use(
    express.static(BUILD, {
      index: false,
      setHeaders: (res, file) =>
        res.setHeader("Cache-Control", /[\\/]static[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache"),
    })
  );
  web.get("*", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(BUILD, "index.html"));
  });
  web.listen(process.env.WEB_PORT, () => console.log(`Web app at ${process.env.WEB_PORT}`));
}

/* ****************************************************END OF SERVER SETUP **************************************************** */
