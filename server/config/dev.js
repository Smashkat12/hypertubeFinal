// Secrets come from the environment (start.sh loads them from .env at the repo root;
// see .env.example). Nothing secret belongs in this file.
const env = process.env;

module.exports = {
  MONGODB: {
    mongoURI: env.MONGO_URI || "mongodb://localhost:27017/Hypertube",
  },
  FACEBOOK: {
    clientID: env.FACEBOOK_CLIENT_ID,
    secret: env.FACEBOOK_CLIENT_SECRET,
  },
  GOOGLE: {
    clientID: env.GOOGLE_CLIENT_ID,
    secret: env.GOOGLE_CLIENT_SECRET,
  },
  GITHUB: {
    clientID: env.GITHUB_CLIENT_ID,
    secret: env.GITHUB_CLIENT_SECRET,
  },
  FORTY_TWO: {
    clientID: env.FORTY_TWO_CLIENT_ID,
    secret: env.FORTY_TWO_CLIENT_SECRET,
  },
  SESSION: {
    secret: env.SESSION_SECRET,
  },
  JWT: {
    secret: env.STREAM_TOKEN_SECRET,
  },
};
