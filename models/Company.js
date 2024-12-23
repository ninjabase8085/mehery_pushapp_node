const mongoose = require("mongoose");

const platformSchema = new mongoose.Schema({
    platform_id: { type: String, required: true, unique: true },
    platform_type: { type: String, required: true, enum: ['ios', 'android', 'huawei'] },
    bundle_id: { type: String, required: true },
    key_id: { type: String }, // Optional, only for iOS
    team_id: { type: String }, // Optional, only for iOS
    file_path: { type: String } // Path to platform-specific file
});

const companySchema = new mongoose.Schema({
    company_name: { type: String, required: true },
    company_id: { type: String, required: true, unique: true },
    app_id: { type: String }, // Will be set to first platform's bundle_id
    platforms: [platformSchema]
});

module.exports = mongoose.model("Company", companySchema);
