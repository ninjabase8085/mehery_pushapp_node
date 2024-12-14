const mongoose = require("mongoose");

const appSchema = new mongoose.Schema({
    app_id: { type: String, required: true, unique: true },
    android_file_path: { type: String }, // Path to the Android JSON file
    ios_file_path: { type: String },    // Path to the iOS APNs key file
    huawei_file_path: { type: String },
    key_id: { type: String },
    team_id: { type: String }  // Path to the Huawei JSON file
});

const companySchema = new mongoose.Schema({
    company_name: { type: String, required: true },
    company_id: { type: String, required: true, unique: true },
    apps: [appSchema] // Array of apps
});

module.exports = mongoose.model("Company", companySchema);
