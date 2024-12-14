// models/DeviceToken.js
const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema({
  device_id: { type: String, required: true, unique: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String },
  user_id: { type: String },
  company_id: { type: String },
  session_id: { type: String, required: true }, // session ID to track sessions
  last_active: { type: Date, default: Date.now }, // timestamp to track session activity
  status : { type: Boolean, default: true}
});

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
