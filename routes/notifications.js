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
    const { token, title, message, platform, company_id, app_id, bundle_id, image_url, category } = req.body;

    // Check if required fields are present
    if (!token || !message || !platform || !company_id || !app_id) {
        return res.status(400).json({ error: "Token, message, platform, company_id, and app_id are required" });
    }

    try {
        // Retrieve company credentials from the database
        const company = await Company.findOne({ company_id });
        if (!company) {
            return res.status(404).json({ error: "Company not found" });
        }
        console.log(company);
        // Find the app within the company
        const app = company.apps.find(app => app.app_id === app_id);
        if (!app) {
            return res.status(404).json({ error: "App not found" });
        }

        // Define the file paths for the app from the 'docs' folder
        const appFolderPath = path.join(__dirname, '..', 'docs', `${company_id}_${app_id}`);
        console.log("App folder path:", appFolderPath); // Debugging path

        const apnKeyFilePath = path.resolve(appFolderPath, 'ios.p8');
        const firebaseKeyFilePath = path.resolve(appFolderPath, 'android.json');
        const huaweiKeyFilePath = path.resolve(appFolderPath, 'huawei.json');

        // Log the full paths for debugging
        console.log("APN Key File Path:", apnKeyFilePath);
        console.log("Firebase Key File Path:", firebaseKeyFilePath);
        console.log("Huawei Key File Path:", huaweiKeyFilePath);
        console.log(app.key_id);

        // Handling APNs notifications for iOS
        if (platform === "ios") {
            const apnProvider = new apn.Provider({
                token: {
                    key: apnKeyFilePath, // Reference the .p8 file
                    keyId: app.key_id, // Use app-specific keyId
                    teamId: app.team_id, // Use app-specific teamId
                },
                production: false, // Set to `true` for production
            });

            const notification = new apn.Notification();
            notification.alert = message;
            notification.sound = "default";
            notification.topic = bundle_id; // Your app's bundle ID
            if (category) {
                notification.category = category;
            }
            if (image_url) {
                notification.mutableContent = 1; // Required for rich media
                notification.payload = { "media-url": image_url };
            }

            const result = await apnProvider.send(notification, token);
            apnProvider.shutdown(); // Close the APNs provider

            return res.status(200).json({ success: true, result });

        } else if (platform === "android") {
            // Handling Firebase notifications for Android
            const firebaseApp = admin.initializeApp({
                credential: admin.credential.cert(require(firebaseKeyFilePath)), // Reference Firebase JSON file
            }, `app_${company_id}`);

            const messageData = {
                token: token,
                notification: {
                    title: title,
                    body: message,
                    image: image_url || undefined, // Include image if provided
                },
            };

            const response = await firebaseApp.messaging().send(messageData);

            // Clean up
            admin.app(`app_${company_id}`).delete(); // Delete Firebase app instance

            return res.status(200).json({ success: true, response });

        } else if (platform === "huawei") {
            // Handling Huawei notifications
            const huaweiKeyFile = require(huaweiKeyFilePath); // Reference Huawei JSON file

            // Use Huawei's push service to send the notification (assumed similar to Firebase)
            const response = await sendHuaweiNotification(huaweiKeyFile, token, title, message, image_url);

            return res.status(200).json({ success: true, response });

        } else {
            return res.status(400).json({ error: "Invalid platform" });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to send notification", details: error.message });
    }
});





// Endpoint to send notification using user_id
router.post("/send-notification-by-user", async (req, res) => {
  const { user_id, title, message, bundle_id, image_url,app_id,company_id,platform,category } = req.body;

  if (!user_id || !message) {
      return res.status(400).json({ error: "User ID and message are required" });
  }

  try {
      const company = await Company.findOne({ company_id });
      if (!company) {
          return res.status(404).json({ error: "Company not found" });
      }
      console.log(company);
      // Find the app within the company
      const app = company.apps.find(app => app.app_id === app_id);
      if (!app) {
          return res.status(404).json({ error: "App not found" });
      }

      // Define the file paths for the app from the 'docs' folder
      const appFolderPath = path.join(__dirname, '..', 'docs', `${company_id}_${app_id}`);
      console.log("App folder path:", appFolderPath); // Debugging path

      const apnKeyFilePath = path.resolve(appFolderPath, 'ios.p8');
      const firebaseKeyFilePath = path.resolve(appFolderPath, 'android.json');
      const huaweiKeyFilePath = path.resolve(appFolderPath, 'huawei.json');

      // Log the full paths for debugging
      console.log("APN Key File Path:", apnKeyFilePath);
      console.log("Firebase Key File Path:", firebaseKeyFilePath);
      console.log("Huawei Key File Path:", huaweiKeyFilePath);
      console.log(app.key_id);
      // Find the device token and platform by user_id
      const deviceRecord = await DeviceToken.findOne({ user_id,platform,company_id });

      if (!deviceRecord) {
          return res.status(404).json({ error: "Device token not found for the given user ID" });
      }
      if(!deviceRecord.status){
        return res.status(404).json({ error: "User not active" });
      }

      const { token } = deviceRecord;
      if (platform === "ios") {
          const apnProvider = new apn.Provider({
            token: {
                key: apnKeyFilePath, // Reference the .p8 file
                keyId: app.key_id, // Use app-specific keyId
                teamId: app.team_id, // Use app-specific teamId
            },
            production: false, // Set to `true` for production
        });

        const notification = new apn.Notification();
        notification.alert = message;
        notification.sound = "default";
        notification.topic = bundle_id; // Your app's bundle ID
        if (category) {
            notification.category = category;
        }
        if (image_url) {
            notification.mutableContent = 1; // Required for rich media
            notification.payload = { "media-url": image_url };
        }

        const result = await apnProvider.send(notification, token);
        apnProvider.shutdown(); // Close the APNs provider

        return res.status(200).json({ success: true, result });

      }else if (platform === "android") {
        // Handling Firebase notifications for Android
        const firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(require(firebaseKeyFilePath)), // Reference Firebase JSON file
        }, `app_${company_id}`);

        const messageData = {
            token: token,
            notification: {
                title: title,
                body: message,
                image: image_url || undefined, // Include image if provided
            },
        };

        const response = await firebaseApp.messaging().send(messageData);

        // Clean up
        admin.app(`app_${company_id}`).delete(); // Delete Firebase app instance

        return res.status(200).json({ success: true, response });

    } else if (platform === "huawei") {
        // Handling Huawei notifications
        const huaweiKeyFile = require(huaweiKeyFilePath); // Reference Huawei JSON file

        // Use Huawei's push service to send the notification (assumed similar to Firebase)
        const response = await sendHuaweiNotification(huaweiKeyFile, token, title, message, image_url);

        return res.status(200).json({ success: true, response });

    } else {
        return res.status(400).json({ error: "Invalid platform" });
    }
  } catch (error) {
      res.status(500).json({ error: "Failed to send notification", details: error.message });
  }
});


// Endpoint to send bulk notifications to all users
router.post("/send-notification-bulk", async (req, res) => {
  const { title, message, bundle_id, image_url, app_id, company_id, platform, category } = req.body;

  if (!message || !title || !company_id || !app_id) {
    return res.status(400).json({ error: "Title, message, company_id, and app_id are required." });
  }

  try {
    // Validate company and app
    const company = await Company.findOne({ company_id });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    const app = company.apps.find(app => app.app_id === app_id);
    if (!app) {
      return res.status(404).json({ error: "App not found" });
    }

    // Define file paths
    const appFolderPath = path.join(__dirname, '..', 'docs', `${company_id}_${app_id}`);
    const apnKeyFilePath = path.resolve(appFolderPath, 'ios.p8');
    const firebaseKeyFilePath = path.resolve(appFolderPath, 'android.json');
    const huaweiKeyFilePath = path.resolve(appFolderPath, 'huawei.json');

    // Filter device tokens based on company_id, app_id, and optionally platform
    const query = { company_id, platform: platform || { $exists: true }, status: true };
    const deviceTokens = await DeviceToken.find(query);

    if (deviceTokens.length === 0) {
      return res.status(404).json({ error: "No active devices found for the specified criteria." });
    }

    // Send notifications based on platform
    const responses = [];
    for (const device of deviceTokens) {
      const { platform, token } = device;

      try {
        if (platform === "ios") {
          const apnProvider = new apn.Provider({
            token: {
              key: apnKeyFilePath,
              keyId: app.key_id,
              teamId: app.team_id,
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
          responses.push({ platform, token, result });
          apnProvider.shutdown();

        } else if (platform === "android") {
          const firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(require(firebaseKeyFilePath)),
          }, `app_${company_id}_${device.device_id}`);

          const messageData = {
            token: token,
            notification: {
              title: title,
              body: message,
              image: image_url || undefined,
            },
          };

          const response = await firebaseApp.messaging().send(messageData);
          responses.push({ platform, token, response });
          admin.app(`app_${company_id}_${device.device_id}`).delete();

        } else if (platform === "huawei") {
          const huaweiKeyFile = require(huaweiKeyFilePath);
          const response = await sendHuaweiNotification(huaweiKeyFile, token, title, message, image_url);
          responses.push({ platform, token, response });

        } else {
          responses.push({ platform, token, error: "Unsupported platform" });
        }
      } catch (err) {
        responses.push({ platform, token, error: err.message });
      }
    }

    res.status(200).json({ success: true, responses });
  } catch (error) {
    res.status(500).json({ error: "Failed to send bulk notifications", details: error.message });
  }
});


  router.post("/capture-event", async (req, res) => {
    const { user_id, event_name, attributes } = req.body;
  
    if (!user_id || !event_name) {
      return res.status(400).json({ error: "User ID and event name are required" });
    }
  
    try {
      // Save the event to the database
      const event = new Event({ user_id, event_name, attributes });
      await event.save();
  
      // Trigger notifications based on event rules
      await checkEventTriggers(event);
      res.status(201).json({ message: "Event captured successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to capture event", details: error.message });
    }
  });
  

module.exports = router;
