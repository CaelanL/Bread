// The runtime version (and so whether a merge needs a store build) is this project's native
// fingerprint. These are the default "balanced" preset's skips plus every package.json script:
// scripts never reach the binary, so a scripts-only merge no longer forces a store build (#76).
// patches/ is still hashed, so a postinstall change still counts.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: [
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    'ExpoConfigVersions',
    'ExpoConfigRuntimeVersionIfString',
    'EasJson',
    'Easignore',
    'AutolinkingConfigPaths',
    'PackageJsonScriptsAll',
  ],
};
