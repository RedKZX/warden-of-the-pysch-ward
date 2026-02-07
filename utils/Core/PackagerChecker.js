const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const Prompt = require("../Helpers/Prompt.js");

const BUILT_IN_PACKAGES = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", 
  "crypto", "dgram", "dns", "domain", "events", "fs", "http", "http2", "https", "inspector", 
  "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring", 
  "readline", "repl", "stream", "string_decoder", "timers", "tls", "trace_events", "tty", 
  "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib"
]);

const COLORS = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
};

const color = (text, colorName) => `${COLORS[colorName]}${text}${COLORS.reset}`;

async function getPackageManager(pmCommands, configPath) {
  let packageManager = null;
  
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config && config.packageManager && pmCommands[config.packageManager]) {
        packageManager = config.packageManager;
      }
    } catch {}
  }

  while (!packageManager || !pmCommands[packageManager]) {
    packageManager = (await Prompt(
      color("Select package manager ", "cyan") +
      color("npm", "red") + color("  |  ", "cyan") +
      color("yarn", "blue") + color("  |  ", "cyan") +
      color("pnpm", "yellow") + color(": ", "cyan")
    )).toLowerCase().trim();

    if (!pmCommands[packageManager]) {
      console.log(color("Invalid package manager. Please select npm, yarn, or pnpm.", "red"));
      continue;
    }

    const config = fs.existsSync(configPath) 
      ? JSON.parse(fs.readFileSync(configPath, "utf8") || '{}')
      : {};
    
    config.packageManager = packageManager;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(color(`Saved ${packageManager} as default package manager`, "cyan"));
  }

  return packageManager;
}

function scanDirectory(dir, requiredPackages) {
  fs.readdirSync(dir).forEach(item => {
    const itemPath = path.join(dir, item);
    if (item.endsWith(".js") && !itemPath.includes("node_modules") && !itemPath.includes(".git")) {
      const content = fs.readFileSync(itemPath, "utf8");

      const requireMatches = content.match(/require\(['"]([^'"]+)['"]\)/g) || [];
      requireMatches.forEach(m => {
        const pkg = m.match(/require\(['"]([^'"]+)['"]\)/)[1].replace(/^node:/, "").split("/")[0];
        if (!pkg.startsWith(".") && !BUILT_IN_PACKAGES.has(pkg)) {
          requiredPackages.add(pkg);
        }
      });

      const importMatches = content.match(/import.*from\s+['"]([^'"]+)['"]/g) || [];
      importMatches.forEach(m => {
        const pkg = m.match(/from\s+['"]([^'"]+)['"]/)[1].replace(/^node:/, "").split("/")[0];
        if (!pkg.startsWith(".") && !BUILT_IN_PACKAGES.has(pkg)) {
          requiredPackages.add(pkg);
        }
      });
      
      if (content.includes("render") && content.includes(".ejs") || 
          content.includes("ejs.renderFile") || 
          content.match(/<%.*%>/)) {
        requiredPackages.add("ejs");
      }
    } else if (fs.statSync(itemPath).isDirectory() && !itemPath.includes("node_modules") && !itemPath.includes(".git")) {
      scanDirectory(itemPath, requiredPackages);
    }
  });
}

function getWhitelist(configPath) {
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};
  return new Set(config.whitelistedPackages || []);
}

function updateWhitelist(configPath, packages) {
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};
  config.whitelistedPackages = [...new Set([...(config.whitelistedPackages || []), ...packages])];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function PackageChecker(autoInstall = true, autoRemove = false) {
  try {
    const pmCommands = { npm: "npm", yarn: "yarn", pnpm: "pnpm" };
    const configPath = path.resolve(__dirname, "..", "..", "config.json");
    const packageManager = await getPackageManager(pmCommands, configPath);
    
    const logs = require("../Logging/Logger.js");
    
    const projectRoot = path.resolve(__dirname, "..", "..");
    const packageJSON = path.resolve(projectRoot, "package.json");
    if (!fs.existsSync(packageJSON)) throw new Error("package.json not found");

    const requiredPackages = new Set();
    scanDirectory(projectRoot, requiredPackages);

    const pkgContent = JSON.parse(fs.readFileSync(packageJSON, "utf8"));
    const declaredDeps = new Set([
      ...Object.keys(pkgContent.dependencies || {}),
      ...Object.keys(pkgContent.devDependencies || {}),
    ]);

    const whitelist = getWhitelist(configPath);

    const missing = [...requiredPackages].filter(pkg => !declaredDeps.has(pkg));
    const unused = [...declaredDeps].filter(pkg => 
      !requiredPackages.has(pkg) && !whitelist.has(pkg)
    );

    if (autoInstall && missing.length > 0) {
      logs.info("Found missing packages, installing...");
      execSync(`${pmCommands[packageManager]} ${packageManager === "npm" ? "install" : "add"} ${missing.join(" ")}`, {
        cwd: projectRoot,
        stdio: "ignore",
      });
      logs.success(`Installed: ${missing.join(", ")}`);
    }

    if (unused.length > 0) {
      const options = color("\nOptions:", "cyan") +
        color("\n1)", "yellow") + color(" Remove unused packages", "cyan") +
        color("\n2)", "yellow") + color(" Whitelist packages", "cyan") +
        color("\n3)", "yellow") + color(" Skip", "cyan") +
        color("\nChoice (1-3): ", "cyan");

      const choice = await Prompt(
        color("Found unused packages: ", "cyan") +
        color(unused.join(", "), "yellow") +
        options
      );

      switch(choice.trim()) {
        case "1":
          execSync(`${pmCommands[packageManager]} ${packageManager === "npm" ? "uninstall" : "remove"} ${unused.join(" ")}`, {
            cwd: projectRoot,
            stdio: "ignore",
          });
          logs.success(`Removed: ${unused.join(", ")}`);
          break;
        case "2":
          const toWhitelist = (await Prompt(
            color("Enter package names to whitelist (comma-separated): ", "cyan")
          )).split(",").map(p => p.trim()).filter(p => unused.includes(p));
          
          if (toWhitelist.length) {
            updateWhitelist(configPath, toWhitelist);
            logs.success(`Whitelisted: ${toWhitelist.join(", ")}`);
          }
          break;
      }
    }

    return { required: [...requiredPackages], missing, unused };
  } catch (error) {
    logs.error(`PackageChecker failed: ${error.message}`);
    throw error;
  }
}

module.exports = PackageChecker;
