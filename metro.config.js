// Learn more https://docs.expo.io/guides/customizing-metro
require('@expo/env').load(__dirname);
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('cjs');

config.resolver.unstable_enablePackageExports = false;

// Firebase 11 ships getReactNativePersistence in @firebase/auth/dist/rn/index.js
// but doesn't register 'firebase/auth/react-native' as a subpath export.
// resolveRequest is the reliable way to intercept paths that contain slashes.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'firebase/auth/react-native') {
    return {
      filePath: path.resolve(__dirname, 'node_modules/@firebase/auth/dist/rn/index.js'),
      type: 'sourceFile',
    };
  }
  return (originalResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
