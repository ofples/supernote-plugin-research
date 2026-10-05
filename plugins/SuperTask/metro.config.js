const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const fs = require('fs');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
// Worktrees may reuse npm dependencies through a Windows directory junction.
// Metro also needs the junction target in its visible file map for offline builds.
const modules = path.join(__dirname, 'node_modules');
const realModules = fs.realpathSync(modules);
const config = realModules === modules ? {} : {
  watchFolders: [realModules],
  resolver: {nodeModulesPaths: [realModules]},
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
