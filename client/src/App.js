import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import axios from "axios";
import Search from './containers/Search'
import Login from "./containers/Login";
import Movie from './containers/Movie'
import Profile from './containers/Profile'
import Forgot from "./containers/Forgot";
import Settings from './containers/Settings'
import Register from './containers/Register'
import User from "./containers/User";
import Logout from './containers/Logout'
import Confirm from './containers/Confirm'
import Loading from "./components/Loading";
import NotFound from './containers/NotFound'




import { BrowserRouter as Router, Route, Switch, Redirect } from "react-router-dom";

const App = () => {
  
  const [_isAuth, updateIsAuth] = useState(false)
  const [_isLoaded, updateIsLoaded] = useState(false)

  const isCanceled = useRef(false)

  useEffect(() => {
    fetchDataUser()
    return () => {
      isCanceled.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchDataUser = async() => {
    const response = await axios.get(`http://localhost:5000/auth/`);
    if (!isCanceled.current && response.data.auth) {
      
      updateIsAuth(true)
    }
    updateIsLoaded(true)
  }

  return (
    <Router>
      <div className="App">
        <div className="App-wrapper">
          <Navbar extended={true} />
          {
            _isLoaded ? (
              <Switch>
                <Route exact path='/' component={() => (
                  _isAuth ? <Search /> : <Redirect to="/login" />
                )}/>
                <Route exact path='/watch/:id' component={() => (
                  _isAuth ? <Movie /> : <Redirect to="/login" />
                )}/>
                <Route exact path='/user/:username' component={() => (
                  _isAuth ? <User /> : <Redirect to="/login" />
                )}/>
                <Route exact path='/profile' component={() => (
                  _isAuth ? <Profile /> : <Redirect to="/login" />
                )}/>
                <Route exact path='/settings' component={() => (
                  _isAuth ? <Settings /> : <Redirect to="/login" />
                )}/>
                <Route exact path='/logout' component={() => (
                  _isAuth ? <Logout /> : <Redirect to="/login" />
                )}/>
                <Route exact path='/register' component={() => (
                  _isAuth ? <Redirect to ="/" /> : <Register />
                )}/>
                <Route exact path='/login' component={() => (
                  _isAuth ? <Redirect to ="/" /> : <Login />
                )}/>

                <Route exact path='/confirm/:key' component={() => <Confirm />} />
                <Route exact path='/forgot/:key' component={() => <Forgot />} />
                <Route component={() => <NotFound />} />
              </Switch>
            ) : (
              <Loading />
            )
          }
        </div>

        <Footer />
      </div>
    </Router>
  );
}

export default App
