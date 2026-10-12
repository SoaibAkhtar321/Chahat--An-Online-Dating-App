const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Ensure Metro watches the workspace root and resolves root node_modules
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.server = {
  ...(config.server || {}),
  enhanceMiddleware: (metroMiddleware) => {
    return (req, res, next) => {
      if (req.url && req.url.startsWith("/../node_modules/")) {
        req.url = req.url.replace("/../node_modules/", "/node_modules/");
      }
      return metroMiddleware(req, res, next);
    };
  },
};

module.exports = config;

