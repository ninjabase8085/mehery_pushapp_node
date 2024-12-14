// models/Event.js
const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  event_name: { type: String, required: true },
  attributes: { type: Map, of: String }, // Stores attributes as a key-value map
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Event", eventSchema);
