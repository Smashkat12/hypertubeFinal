import React, { useState, useEffect } from "react";
import "./App.css";
import "./netflix.css";
import axios from "axios";
import { BrowserRouter as Router, Route, Switch, Redirect, Link, withRouter } from "react-router-dom";
import Login from "./containers/Login";
import Profile from "./containers/Profile";
import Forgot from "./containers/Forgot";
import Settings from "./containers/Settings";
import Register from "./containers/Register";
import User from "./containers/User";
import Logout from "./containers/Logout";
import Confirm from "./containers/Confirm";
import NotFound from "./containers/NotFound";
import TopNav from "./components/nf/TopNav";
import { MyListProvider } from "./components/nf/myList";
import Home from "./containers/nf/Home";
import Browse from "./containers/nf/Browse";
import SearchPage from "./containers/nf/SearchPage";
import TitlePage from "./containers/nf/TitlePage";
import Player from "./containers/nf/Player";
import MyList from "./containers/nf/MyList";
import Downloads from "./containers/nf/Downloads";
import { SERVER, getMovieDoc, docToItem, titlePath } from "./api";

// links from before the redesign pointed at /watch/<movie document id>
const LegacyWatch = withRouter(({ match, history }) => {
  useEffect(() => {
    getMovieDoc(match.params.id)
      .then((doc) => history.replace(doc ? titlePath(docToItem(doc)) : "/"))
      .catch(() => history.replace("/"));
  }, [match.params.id, history]);
  return (
    <div className="nf-center" style={{ minHeight: "100vh" }}>
      <div className="nf-spinner" />
    </div>
  );
});

// the player takes over the whole screen, so no chrome around it
const Chrome = withRouter(({ location, children }) => {
  const bare = location.pathname.startsWith("/watch/");
  return (
    <>
      {!bare && <TopNav />}
      {children}
      {!bare && (
        <footer className="nf-footer">
          Hypertube · streams anime, series and films from public torrents. Metadata from AniList, TVMaze and YTS.
        </footer>
      )}
    </>
  );
});

const App = () => {
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    document.body.classList.add("nf");
    axios
      .get(`${SERVER}/auth/`, { withCredentials: true })
      .then((r) => setAuth(!!r.data.auth))
      .catch(() => setAuth(false));
  }, []);

  if (auth === null)
    return (
      <div className="nf-app nf-center" style={{ minHeight: "100vh" }}>
        <div className="nf-spinner" />
      </div>
    );

  const guard = (Page) => (props) => (auth ? <Page {...props} /> : <Redirect to="/login" />);
  const guest = (Page) => (props) => (auth ? <Redirect to="/" /> : <Page {...props} />);

  return (
    <Router>
      <div className="nf-app">
        {auth ? (
          <MyListProvider enabled={auth}>
            <Chrome>
              <Switch>
                <Route exact path="/" render={guard(Home)} />
                <Route exact path="/browse/:kind(anime|series|movie)" render={guard(Browse)} />
                <Route exact path="/search" render={guard(SearchPage)} />
                <Route exact path="/my-list" render={guard(MyList)} />
                <Route exact path="/downloads" render={guard(Downloads)} />
                <Route exact path="/title/:kind(anime|series|movie)/:id" render={guard(TitlePage)} />
                <Route exact path="/watch/:kind(anime|series|movie)/:id" render={guard(Player)} />
                <Route exact path="/watch/:id" render={guard(LegacyWatch)} />
                <Route exact path="/user/:username" render={guard(() => <div className="nf-page legacy"><User /></div>)} />
                <Route exact path="/profile" render={guard(() => <div className="nf-page legacy"><Profile /></div>)} />
                <Route exact path="/settings" render={guard(() => <div className="nf-page legacy"><Settings /></div>)} />
                <Route exact path="/logout" render={guard(Logout)} />
                <Route exact path={["/login", "/register"]} render={() => <Redirect to="/" />} />
                <Route exact path="/confirm/:key" render={() => <Confirm />} />
                <Route render={() => <div className="nf-page legacy"><NotFound /></div>} />
              </Switch>
            </Chrome>
          </MyListProvider>
        ) : (
          <div className="legacy legacy-auth">
            <header className="nf-nav solid">
              <Link to="/login" className="nf-logo">
                Hyper<span>tube</span>
              </Link>
            </header>
            <Switch>
              <Route exact path="/login" render={guest(Login)} />
              <Route exact path="/register" render={guest(Register)} />
              <Route exact path="/confirm/:key" render={() => <Confirm />} />
              <Route exact path="/forgot/:key" render={() => <Forgot />} />
              <Route render={() => <Redirect to="/login" />} />
            </Switch>
          </div>
        )}
      </div>
    </Router>
  );
};

export default App;
