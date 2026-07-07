#!/usr/bin/env node
/**
 * AI-v24.13.0 Setup Script
 * Run: npm run setup
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("\nAI-v24.13.0 Setup\n");

// Check Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.replace("v", "").split(".")[0]);
if (majorVersion < 24) {
  console.error("ERROR: Node.js >= 24.0.0 required. Current: " + nodeVersion);
  console.error("   Install: nvm install 24.13.0 && nvm use 24.13.0");
  process.exit(1);
}
console.log("OK Node.js " + nodeVersion + "\n");

// Check if openclaw is installed
try {
  execSync("openclaw --version", { stdio: "pipe" });
  console.log("OK OpenClaw is installed\n");
} catch (e) {
  console.error("ERROR: OpenClaw not found. Install: npm install -g openclaw@2026.6.11\n");
  process.exit(1);
}

// Check if config exists
const configPath = path.join(__dirname, "openclaw.json");
if (!fs.existsSync(configPath)) {
  console.log("INFO: No openclaw.json found. Copying from example...\n");
  const examplePath = path.join(__dirname, "config", "openclaw.json.example");
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, configPath);
    console.log("OK Copied config/openclaw.json.example -> openclaw.json\n");
    console.log("IMPORTANT: Edit openclaw.json and fill in your API Key!\n");
  }
} else {
  console.log("OK openclaw.json exists\n");
}

console.log("Setup complete!\n");
console.log("Start the gateway:");
console.log("  .\\start-gateway.bat");
console.log("  or");
console.log("  node start-gateway.js");
console.log("");
