// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require('cors');
const notifications = require("./routes/notifications"); // Import the notifications routes

const app = express();
app.use(cors());
app.use(express.json()); // Middleware to parse JSON request bodies
// Serve the 'uploads' folder as static
app.use('/uploads', express.static('uploads'));

// Connect to MongoDB
mongoose.connect("mongodb+srv://pranjal7163:sSNRPZeFD6dOx72B@cluster0.vagxu.mongodb.net/pushapp?retryWrites=true&w=majority", {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("Connected to MongoDB"))
  .catch((error) => console.error("Failed to connect to MongoDB", error));

// Set up routes
app.use("/api", notifications); // Use the notifications routes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
