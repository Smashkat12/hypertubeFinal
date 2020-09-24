const mongoose = require('mongoose');
const bcrypt = require("bcryptjs");
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  _googleID: String,
  _fourtytwoID: String,
  _githubID: String,
  firstname: { type: String },
  lastname: { type: String },
  username: { type: String, required: true, unique: true },
  password: { type: String },
  heartbeat: [
    {
      id: { type: String, required: true },
      time: { type: Number, required: true },
    },
  ],
  recents: [
    {
      id: { type: String, required: true },
      time: { type: Number, required: true },
    },
  ],
  inProgress: [
    {
      id: { type: String, required: true },
      ytsId: { type: String, required: true },
      percent: { type: String, required: true },
      timecode: { type: String, required: true },
      time: { type: Number, required: true },
    },
  ],
  avatar: String,
  cover: String,
  birthdate: String,
  age: String,
  gender: String,
  language: String,
  email: { type: String, unique: true },
  confirmKey: String,
  forgotKey: String,
  admin: { type: Boolean, default: false },
  bantime: { type: Number, default: 0 },
  created_at: Date,
  updated_at: Date,
});

UserSchema.pre('save', function(next) {
	const currentDate = new Date();
	this.updated_at = currentDate;
	if (!this.created_at)
		this.created_at = currentDate;
	next();
});

UserSchema.methods.validPassword = function(password) {
   return (bcrypt.compareSync(password, this.password));
};

UserSchema.methods.isMailConfirmed = function() {
  return (this.confirmKey === 'confirmed');
};

const User = mongoose.model('User', UserSchema);

module.exports = User;
