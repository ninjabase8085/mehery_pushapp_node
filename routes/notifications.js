const express = require("express");
const router = express.Router();
const DeviceToken = require("../models/DeviceToken");
const apn = require("apn");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const fs = require("fs");
const Company = require("../models/Company");
const multer = require("multer");


// Rich Push , Session handling, Huawei

// Configure Multer for file uploads (temporarily store in 'uploads/')
const upload = multer({ dest: "uploads/" });

router.post("/register-company", upload.fields([
  { name: "apn_key", maxCount: 1 },
  { name: "firebase_service", maxCount: 1 },
  { name: "huawei_service", maxCount: 1 } // Optional Huawei service file
]), async (req, res) => {
  const { company_name, app_id, key_id, team_id } = req.body;

  if (!company_name || !app_id || !req.files || !key_id || !team_id) {
    return res.status(400).json({ error: "Company name, App ID, files, key_id, and team_id are required." });
  }

  try {
    // Check if the combination of company_name and app_id already exists
    let existingCompany = await Company.findOne({ 
      company_name, 
      apps: { $elemMatch: { app_id } }
    });

    if (existingCompany) {
      return res.status(400).json({ error: "The combination of company name and app_id already exists." });
    }

    // Generate a unique company ID if the company does not already exist
    let savedCompany = await Company.findOne({ company_name });
    let companyId = savedCompany ? savedCompany.company_id : `${company_name}_${Date.now()}`;

    // Create the app folder structure
    const appFolder = path.join("docs", `${companyId}_${app_id}`);
    if (!fs.existsSync('docs')) {
      fs.mkdirSync('docs', { recursive: true });
    }

    if (!fs.existsSync(appFolder)) {
      fs.mkdirSync(appFolder, { recursive: true });
    }

    const files = {};
    if (req.files.apn_key) {
      const iosFilePath = path.join(appFolder, "ios.p8");
      fs.renameSync(req.files.apn_key[0].path, iosFilePath);
      files.ios_file_path = iosFilePath;
    }

    if (req.files.firebase_service) {
      const androidFilePath = path.join(appFolder, "android.json");
      fs.renameSync(req.files.firebase_service[0].path, androidFilePath);
      files.android_file_path = androidFilePath;
    }

    if (req.files.huawei_service) {
      const huaweiFilePath = path.join(appFolder, "huawei.json");
      fs.renameSync(req.files.huawei_service[0].path, huaweiFilePath);
      files.huawei_file_path = huaweiFilePath;
    }

    // Create or update the company
    let company = savedCompany || new Company({ company_name, company_id: companyId, apps: [] });

    // Add the new app data
    company.apps.push({
      app_id,
      key_id,
      team_id,
      ...files
    });

    await company.save();

    res.status(200).json({ success: true, company_id: company.company_id, app_id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to register company and app." });
  }
});


router.post("/organization/setup", upload.fields([
  { name: "apn_key", maxCount: 1 },
  { name: "firebase_service", maxCount: 1 },
  { name: "huawei_service", maxCount: 1 }
]), async (req, res) => {
  const { company_id, company_name, app_id, key_id, team_id } = req.body;

  try {
    // Step 1: Handle company registration
    if (!company_id) {
      if (!company_name) {
        return res.status(400).json({ error: "Company name is required for registration." });
      }

      // Check if the company already exists
      let existingCompany = await Company.findOne({ company_name });
      if (existingCompany) {
        return res.status(400).json({ error: "Company already exists. Use the existing company ID." });
      }

      // Create a new company
      const newCompanyId = `${company_name}_${Date.now()}`;
      const newCompany = new Company({ company_name, company_id: newCompanyId, apps: [] });
      await newCompany.save();

      return res.status(200).json({
        success: true,
        message: "Company registered successfully.",
        company_id: newCompanyId
      });
    }

    // Step 2: Find the company by ID
    const company = await Company.findOne({ company_id });
    if (!company) {
      return res.status(404).json({ error: "Company not found. Please provide a valid company ID." });
    }

    // Step 3: Handle app registration or platform-specific data
    if (app_id) {
      let app = company.apps.find(app => app.app_id === app_id);

      if (!app) {
        // App registration
        company.apps.push({ app_id });
        await company.save();

        return res.status(200).json({
          success: true,
          message: "App registered successfully.",
          company_id,
          app_id
        });
      }

      // Step 4: Add platform-specific data if provided
      const appFolder = path.join("docs", `${company_id}_${app_id}`);
      if (!fs.existsSync('docs')) {
        fs.mkdirSync('docs', { recursive: true });
      }
      if (!fs.existsSync(appFolder)) {
        fs.mkdirSync(appFolder, { recursive: true });
      }

      if (req.files.apn_key) {
        const iosFilePath = path.join(appFolder, "ios.p8");
        fs.renameSync(req.files.apn_key[0].path, iosFilePath);
        app.ios_file_path = iosFilePath;
      }

      if (req.files.firebase_service) {
        const androidFilePath = path.join(appFolder, "android.json");
        fs.renameSync(req.files.firebase_service[0].path, androidFilePath);
        app.android_file_path = androidFilePath;
      }

      if (req.files.huawei_service) {
        const huaweiFilePath = path.join(appFolder, "huawei.json");
        fs.renameSync(req.files.huawei_service[0].path, huaweiFilePath);
        app.huawei_file_path = huaweiFilePath;
      }

      if (key_id) app.key_id = key_id;
      if (team_id) app.team_id = team_id;

      await company.save();

      return res.status(200).json({
        success: true,
        message: "Platform-specific data added successfully.",
        company_id,
        app_id
      });
    }

    // If no app_id is provided, return an error
    return res.status(400).json({ error: "App ID is required for platform-specific data." });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred while processing the request." });
  }
});




router.post('/login', async (req, res) => {
  const { companyId } = req.body;

  // Verify companyId and fetch associated data (e.g., APNs or Firebase credentials)

  try {
    const companyInfo = await getCompanyInfo(companyId);  // Retrieve company data from DB
    if (companyInfo) {
      res.status(200).json({ success: true, companyInfo });
    } else {
      res.status(404).json({ error: "Company not found" });
    }
  } catch (error) {
    res.status(500).json({ error: "Login failed", details: error.message });
  }
});

async function getCompanyInfo(companyId) {
  try {
    const company = await Company.findOne({ company_id : companyId });
    return company;
  } catch (error) {
    throw new Error("Error fetching company info");
  }
}

// Endpoint to register a device token
router.post("/register", async (req, res) => {
  const { device_id, token, platform,company_id } = req.body;
  console.log(req.body);

  if (!device_id || !token || !platform || !company_id) {
    return res.status(400).json({ error: "Device ID, Company ID, token, and platform are required" });
  }

  try {
    // Check if device token already exists
    let deviceToken = await DeviceToken.findOne({ device_id });

    if (deviceToken) {
      // Update existing token and session timestamp
      deviceToken.token = token;
      deviceToken.last_active = Date.now();
    } else {
      // Create a new session ID for pre-login user
      const sessionId = crypto.randomBytes(16).toString("hex");

      // Save a new DeviceToken document with a unique session ID
      deviceToken = new DeviceToken({
        device_id,
        token,
        platform,
        company_id: company_id,
        session_id: sessionId
      });
    }

    await deviceToken.save();
    res.status(200).json({ success: true, session_id: deviceToken.session_id });
  } catch (error) {
    res.status(500).json({ error: "Failed to register device token", details: error.message });
  }
});

// Endpoint to register a device token
router.post("/register/user", async (req, res) => {
  const { device_id, user_id,company_id } = req.body;
  console.log(req.body);
  if (!device_id || !user_id) {
    return res.status(400).json({ error: "Device ID and user ID are required" });
  }

  try {
    // Find the device token by device ID
    const deviceToken = await DeviceToken.findOne({ device_id : device_id,company_id : company_id });

    if (deviceToken) {
      // Update the session to associate with the logged-in user
      deviceToken.user_id = user_id;
      deviceToken.status = true;
      deviceToken.last_active = Date.now();
      await deviceToken.save();

      res.status(200).json({ success: true, session_id: deviceToken.session_id });
    } else {
      res.status(400).json({ error: "Device ID not found. Please register the device token first." });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to update session", details: error.message });
  }
});


// Endpoint to register a device token
router.post("/logout", async (req, res) => {
  const { device_id, user_id,company_id } = req.body;
  console.log(req.body);
  if (!device_id || !user_id) {
    return res.status(400).json({ error: "Device ID and user ID are required" });
  }

  try {
    // Find the device token by device ID
    const deviceToken = await DeviceToken.findOne({ device_id : device_id,company_id : company_id });

    if (deviceToken) {
      // Update the session to associate with the logged-in user
      deviceToken.user_id = user_id;
      deviceToken.status = false;
      await deviceToken.save();

      res.status(200).json({ success: true, session_id: deviceToken.session_id });
    } else {
      res.status(400).json({ error: "Device ID not found. Please register the device token first." });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to update session", details: error.message });
  }
});
  

  router.post("/send-notification", async (req, res) => {
    const { token, title, message, platform, company_id, bundle_id, image_url, category } = req.body;

    if (!token || !message || !platform || !company_id) {
      return res.status(400).json({ error: "Token, message, platform, and company_id are required" });
    }

    try {
      const company = await Company.findOne({ company_id });
      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }

      // Find the platform configuration
      const platformConfig = company.platforms.find(p => p.platform_type === platform && p.bundle_id === bundle_id);
      if (!platformConfig) {
        return res.status(404).json({ error: "Platform configuration not found" });
      }

      // Get the platform-specific file path
      const platformDir = path.join(__dirname, '..', 'docs', company_id, platform);
      const fileName = `${platformConfig.platform_id}.${platform === 'ios' ? 'p8' : 'json'}`;
      const configFilePath = path.join(platformDir, fileName);

      if (platform === "ios") {
        const apnProvider = new apn.Provider({
          token: {
            key: configFilePath,
            keyId: platformConfig.key_id,
            teamId: platformConfig.team_id,
          },
          production: false,
        });

        const notification = new apn.Notification();
        notification.alert = message;
        notification.sound = "default";
        notification.topic = bundle_id;
        if (category) notification.category = category;
        if (image_url) {
          notification.mutableContent = 1;
          notification.payload = { "media-url": image_url };
        }

        const result = await apnProvider.send(notification, token);
        apnProvider.shutdown();
        return res.status(200).json({ success: true, result });

      } else if (platform === "android") {
        const firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(require(configFilePath)),
        }, `app_${company_id}_${Date.now()}`);

        const messageData = {
          token: token,
          notification: {
            title: title,
            body: message,
            image: image_url || undefined,
          },
        };

        const result = await firebaseApp.messaging().send(messageData);
        admin.app(`app_${company_id}_${Date.now()}`).delete();
        return res.status(200).json({ success: true, result });

      } else if (platform === "huawei") {
        const huaweiKeyFile = require(configFilePath);
        const result = await sendHuaweiNotification(huaweiKeyFile, token, title, message, image_url);
        return res.status(200).json({ success: true, result });
      }

      return res.status(400).json({ error: "Invalid platform" });

    } catch (error) {
      console.error(error);
      res.status(500).json({ 
        error: "Failed to send notification", 
        details: error.message 
      });
    }
  });





// Endpoint to send notification using user_id
router.post("/send-notification-by-user", async (req, res) => {
  const { user_id, title, message, bundle_id, image_url, company_id, category } = req.body;

  if (!user_id || !message || !company_id) {
    return res.status(400).json({ error: "User ID, message, and company_id are required" });
  }

  try {
    const company = await Company.findOne({ company_id });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Find all active device tokens for the user
    const deviceRecords = await DeviceToken.find({ 
      user_id, 
      company_id,
      status: true 
    });

    if (!deviceRecords || deviceRecords.length === 0) {
      return res.status(404).json({ error: "No active devices found for the user" });
    }

    const responses = [];

    // Send notifications to all devices
    for (const device of deviceRecords) {
      const { platform, token } = device;
      
      try {
        // Find the platform configuration
        const platformConfig = company.platforms.find(p => p.platform_type === platform);
        if (!platformConfig) {
          responses.push({ 
            platform, 
            token, 
            error: "Platform configuration not found",
            status: "failed" 
          });
          continue;
        }

        // Get the platform-specific file path
        const platformDir = path.join(__dirname, '..', 'docs', company_id, platform);
        const fileName = `${platformConfig.platform_id}.${platform === 'ios' ? 'p8' : 'json'}`;
        const configFilePath = path.join(platformDir, fileName);

        if (platform === "ios") {
          const apnProvider = new apn.Provider({
            token: {
              key: configFilePath,
              keyId: platformConfig.key_id,
              teamId: platformConfig.team_id,
            },
            production: false,
          });

          const notification = new apn.Notification();
          notification.alert = message;
          notification.sound = "default";
          notification.topic = platformConfig.bundle_id;
          if (category) notification.category = category;
          if (image_url) {
            notification.mutableContent = 1;
            notification.payload = { "media-url": image_url };
          }

          const result = await apnProvider.send(notification, token);
          responses.push({ platform: "ios", token, result });
          apnProvider.shutdown();

        } else if (platform === "android") {
          const firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(require(configFilePath)),
          }, `app_${company_id}_${token}`);

          const messageData = {
            token: token,
            notification: {
              title: title,
              body: message,
              image: image_url || undefined,
            },
          };

          const result = await firebaseApp.messaging().send(messageData);
          responses.push({ platform: "android", token, result });
          admin.app(`app_${company_id}_${token}`).delete();

        } else if (platform === "huawei") {
          const huaweiKeyFile = require(configFilePath);
          const result = await sendHuaweiNotification(huaweiKeyFile, token, title, message, image_url);
          responses.push({ platform: "huawei", token, result });
        }
      } catch (error) {
        responses.push({ 
          platform, 
          token, 
          error: error.message,
          status: "failed" 
        });
      }
    }

    // Check if any notifications were sent successfully
    const successfulNotifications = responses.filter(r => !r.error);
    if (successfulNotifications.length === 0) {
      return res.status(500).json({ 
        error: "Failed to send notifications to all devices",
        details: responses 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: `Notifications sent to ${successfulNotifications.length} devices`,
      failed: responses.length - successfulNotifications.length,
      responses 
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      error: "Failed to process notification request", 
      details: error.message 
    });
  }
});


// Endpoint to send bulk notifications to all users
router.post("/send-notification-bulk", async (req, res) => {
  const { title, message, company_id, platform, bundle_id, image_url, category } = req.body;

  if (!message || !title || !company_id) {
    return res.status(400).json({ error: "Title, message, and company_id are required" });
  }

  try {
    const company = await Company.findOne({ company_id });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Find platform configuration if platform is specified
    let platformConfig;
    if (platform) {
      platformConfig = company.platforms.find(p => p.platform_type === platform);
      if (!platformConfig) {
        return res.status(404).json({ error: "Platform configuration not found" });
      }
    }

    // Get device tokens
    const query = { company_id, status: true };
    if (platform) query.platform = platform;
    const deviceTokens = await DeviceToken.find(query);

    if (deviceTokens.length === 0) {
      return res.status(404).json({ error: "No active devices found" });
    }

    const responses = [];

    for (const device of deviceTokens) {
      try {
        const devicePlatformConfig = platform ? 
          platformConfig : 
          company.platforms.find(p => p.platform_type === device.platform);

        if (!devicePlatformConfig) {
          responses.push({ 
            platform: device.platform, 
            token: device.token, 
            error: "Platform configuration not found",
            status: "failed" 
          });
          continue;
        }

        const platformDir = path.join(__dirname, '..', 'docs', company_id, device.platform);
        const fileName = `${devicePlatformConfig.platform_id}.${device.platform === 'ios' ? 'p8' : 'json'}`;
        const configFilePath = path.join(platformDir, fileName);

        if (device.platform === "ios") {
          const apnProvider = new apn.Provider({
            token: {
              key: configFilePath,
              keyId: devicePlatformConfig.key_id,
              teamId: devicePlatformConfig.team_id,
            },
            production: false,
          });

          const notification = new apn.Notification();
          notification.alert = message;
          notification.sound = "default";
          notification.topic = devicePlatformConfig.bundle_id;
          if (category) notification.category = category;
          if (image_url) {
            notification.mutableContent = 1;
            notification.payload = { "media-url": image_url };
          }

          const result = await apnProvider.send(notification, device.token);
          responses.push({ platform: "ios", token: device.token, result });
          apnProvider.shutdown();

        } else if (device.platform === "android") {
          const firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(require(configFilePath)),
          }, `app_${company_id}_${device.token}`);

          const messageData = {
            token: device.token,
            notification: {
              title: title,
              body: message,
              image: image_url || undefined,
            },
          };

          const result = await firebaseApp.messaging().send(messageData);
          responses.push({ platform: "android", token: device.token, result });
          admin.app(`app_${company_id}_${device.token}`).delete();

        } else if (device.platform === "huawei") {
          const huaweiKeyFile = require(configFilePath);
          const result = await sendHuaweiNotification(huaweiKeyFile, device.token, title, message, image_url);
          responses.push({ platform: "huawei", token: device.token, result });
        }
      } catch (error) {
        responses.push({ 
          platform: device.platform, 
          token: device.token, 
          error: error.message,
          status: "failed" 
        });
      }
    }
    console.log(responses);
    // Return results
    const successfulNotifications = responses.filter(r => !r.error);
    return res.status(200).json({ 
      success: true, 
      message: `Notifications sent to ${successfulNotifications.length} devices`,
      failed: responses.length - successfulNotifications.length,
      responses 
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      error: "Failed to send bulk notifications", 
      details: error.message 
    });
  }
});

// Register platform for a company
router.post("/register-platform", async (req, res) => {
  const { company_name, platform_type, bundle_id, key_id, team_id } = req.body;

  if (!company_name || !platform_type || !bundle_id) {
    return res.status(400).json({ 
      error: "Company name, platform type, and bundle ID are required" 
    });
  }

  if (platform_type === 'ios' && (!key_id || !team_id)) {
    return res.status(400).json({ 
      error: "Key ID and Team ID are required for iOS platform" 
    });
  }

  try {
    // Find or create company
    let company = await Company.findOne({ company_name });
    if (!company) {
      company = new Company({
        company_name,
        company_id: `${company_name}_${Date.now()}`,
        platforms: []
      });
    }

    // Set app_id if this is the first platform
    if (!company.app_id) {
      company.app_id = bundle_id;
    }

    // Generate platform_id
    const platform_id = `${company.company_id}_${platform_type}_${Date.now()}`;

    // Add platform
    company.platforms.push({
      platform_id,
      platform_type,
      bundle_id,
      key_id,
      team_id
    });

    await company.save();

    res.status(200).json({
      success: true,
      company_id: company.company_id,
      platform_id,
      app_id: company.app_id
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to register platform" });
  }
});

// Upload platform file
router.post("/upload-platform-file", upload.single('platform_file'), async (req, res) => {
  const { company_id, platform_id } = req.body;

  if (!company_id || !platform_id || !req.file) {
    return res.status(400).json({ 
      error: "Company ID, platform ID, and file are required" 
    });
  }

  try {
    const company = await Company.findOne({ company_id });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    const platform = company.platforms.find(p => p.platform_id === platform_id);
    if (!platform) {
      return res.status(404).json({ error: "Platform not found" });
    }

    // Create directory structure
    const platformDir = path.join("docs", company_id, platform.platform_type);
    if (!fs.existsSync(platformDir)) {
      fs.mkdirSync(platformDir, { recursive: true });
    }

    // Determine file extension based on platform
    const fileExtension = platform.platform_type === 'ios' ? 'p8' : 'json';
    const fileName = `${platform_id}.${fileExtension}`;
    const filePath = path.join(platformDir, fileName);

    // Move uploaded file
    fs.renameSync(req.file.path, filePath);

    // Update platform with file path
    platform.file_path = filePath;
    await company.save();

    res.status(200).json({
      success: true,
      file_path: filePath
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to upload platform file" });
  }
});

module.exports = router;
