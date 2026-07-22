const { withAndroidManifest } = require("expo/config-plugins");

function applyAndroidLanCleartext(manifest) {
  const application = manifest.manifest.application?.[0];
  if (!application) {
    throw new Error("AndroidManifest.xml is missing its application element");
  }
  application.$["android:usesCleartextTraffic"] = "true";
  return manifest;
}

function withAndroidLanCleartext(config) {
  return withAndroidManifest(config, (next) => {
    next.modResults = applyAndroidLanCleartext(next.modResults);
    return next;
  });
}

module.exports = withAndroidLanCleartext;
module.exports.applyAndroidLanCleartext = applyAndroidLanCleartext;
