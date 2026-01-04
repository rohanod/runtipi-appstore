#!/usr/bin/env node
// @ts-check

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync } = require("child_process");

const APPS_DIR = path.join(__dirname, "..", "apps");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/** @param {string} question */
function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

/** @param {string} appId */
function getAppPaths(appId) {
  const appDir = path.join(APPS_DIR, appId);
  return {
    configPath: path.join(appDir, "config.json"),
    composePath: path.join(appDir, "docker-compose.json"),
  };
}

/** @param {string} filePath */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * @param {string} filePath
 * @param {object} data
 */
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

/**
 * @param {string} imageTag
 * @param {string} newVersion
 */
function updateImageVersion(imageTag, newVersion) {
  const colonIndex = imageTag.lastIndexOf(":");
  if (colonIndex === -1) {
    return `${imageTag}:${newVersion}`;
  }
  return `${imageTag.substring(0, colonIndex)}:${newVersion}`;
}

function getApps() {
  return fs.readdirSync(APPS_DIR).filter((name) => {
    const appPath = path.join(APPS_DIR, name);
    return (
      fs.statSync(appPath).isDirectory() &&
      fs.existsSync(path.join(appPath, "config.json"))
    );
  });
}

/** @param {number} currentTipiVersion */
function getNextTipiVersion(currentTipiVersion) {
  return Math.ceil(currentTipiVersion) + 1;
}

/**
 * @param {string} appId
 * @param {string} newVersion
 */
function gitCommit(appId, newVersion) {
  const appDir = path.join("apps", appId);
  const commitMsg = `chore(${appId}): update to ${newVersion}`;
  
  try {
    execSync(`git add "${appDir}"`, { stdio: "inherit" });
    execSync(`git commit -m "${commitMsg}"`, { stdio: "inherit" });
    console.log(`\n✅ Committed: ${commitMsg}`);
    return true;
  } catch (err) {
    console.error(`\n❌ Git commit failed`);
    return false;
  }
}

/**
 * @param {string} appId
 * @param {string} newVersion
 */
function updateAppVersion(appId, newVersion) {
  const { configPath, composePath } = getAppPaths(appId);

  if (!fs.existsSync(configPath)) {
    console.error(`Error: App "${appId}" not found at ${configPath}`);
    return false;
  }

  const config = readJson(configPath);
  const oldVersion = config.version;
  const oldTipiVersion = config.tipi_version || 1;

  config.version = newVersion;
  config.tipi_version = getNextTipiVersion(oldTipiVersion);
  config.updated_at = Date.now();

  writeJson(configPath, config);
  console.log(`\n✓ Updated config.json:`);
  console.log(`  version: ${oldVersion} → ${newVersion}`);
  console.log(`  tipi_version: ${oldTipiVersion} → ${config.tipi_version}`);
  console.log(`  updated_at: ${config.updated_at}`);

  if (fs.existsSync(composePath)) {
    const compose = readJson(composePath);
    let updatedImages = 0;

    if (compose.services && Array.isArray(compose.services)) {
      for (const service of compose.services) {
        if (service.isMain && service.image) {
          const oldImage = service.image;
          service.image = updateImageVersion(service.image, newVersion);
          if (oldImage !== service.image) {
            console.log(`✓ Updated docker-compose.json:`);
            console.log(`  ${service.name}: ${oldImage} → ${service.image}`);
            updatedImages++;
          }
        }
      }
    }

    if (updatedImages > 0) {
      writeJson(composePath, compose);
    } else {
      console.log(`ℹ No main service image updated in docker-compose.json`);
    }
  }

  console.log(`\n✅ Successfully updated ${appId} to version ${newVersion}`);
  return true;
}

function listApps() {
  const apps = getApps();
  console.log("\nAvailable apps:\n");
  apps.forEach((app, index) => {
    const config = readJson(path.join(APPS_DIR, app, "config.json"));
    console.log(`  ${(index + 1).toString().padStart(2)}. ${app.padEnd(20)} ${config.version.padEnd(15)} (tipi: ${config.tipi_version})`);
  });
  return apps;
}

async function interactiveMode() {
  console.log("\n🔧 Runtipi App Version Updater\n");
  
  const apps = listApps();
  
  console.log("");
  const selection = await prompt("Select app number (or name): ");
  
  let appId;
  const num = parseInt(selection, 10);
  if (!isNaN(num) && num >= 1 && num <= apps.length) {
    appId = apps[num - 1];
  } else if (apps.includes(selection.trim())) {
    appId = selection.trim();
  } else {
    console.error(`\n❌ Invalid selection: "${selection}"`);
    rl.close();
    process.exit(1);
  }

  const { configPath } = getAppPaths(appId);
  const currentConfig = readJson(configPath);
  
  console.log(`\nSelected: ${appId}`);
  console.log(`Current version: ${currentConfig.version}`);
  
  const newVersion = await prompt("New version: ");
  
  if (!newVersion.trim()) {
    console.error("\n❌ Version cannot be empty");
    rl.close();
    process.exit(1);
  }

  console.log(`\n📋 Summary:`);
  console.log(`   App: ${appId}`);
  console.log(`   Version: ${currentConfig.version} → ${newVersion.trim()}`);
  console.log(`   Tipi version: ${currentConfig.tipi_version} → ${getNextTipiVersion(currentConfig.tipi_version || 1)}`);
  
  const confirm = await prompt("\nProceed? (Y/n): ");
  
  if (confirm.toLowerCase() === "n") {
    console.log("\n❌ Cancelled");
    rl.close();
    process.exit(0);
  }

  updateAppVersion(appId, newVersion.trim());
  
  const shouldCommit = await prompt("\nCommit changes? (y/N): ");
  if (shouldCommit.toLowerCase() === "y") {
    gitCommit(appId, newVersion.trim());
  }
  
  rl.close();
}

function showUsage() {
  console.log(`
Runtipi App Version Update Script

Usage:
  node scripts/update-version.js                    Interactive mode
  node scripts/update-version.js <app-id> <version> Direct update
  node scripts/update-version.js --list             List all apps

Examples:
  node scripts/update-version.js
  node scripts/update-version.js hoarder 0.30.0
  node scripts/update-version.js pocket-id v1.14.0

Options:
  --list, -l    List all available apps with their current versions
  --help, -h    Show this help message
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    showUsage();
    process.exit(0);
  }

  if (args.includes("--list") || args.includes("-l")) {
    listApps();
    rl.close();
    process.exit(0);
  }

  if (args.length === 0) {
    await interactiveMode();
    return;
  }

  if (args.length === 2) {
    const [appId, newVersion] = args;
    updateAppVersion(appId, newVersion);
    
    const shouldCommit = await prompt("\nCommit changes? (y/N): ");
    if (shouldCommit.toLowerCase() === "y") {
      gitCommit(appId, newVersion);
    }
    
    rl.close();
    process.exit(0);
  }

  console.error("Error: Expected 0 or 2 arguments");
  showUsage();
  rl.close();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
