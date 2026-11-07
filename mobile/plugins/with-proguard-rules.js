// Keep rules for the release build's R8 minifier (android/ is regenerated on
// every build, so they go in through this plugin, not by hand).
//
// Two libraries find code by name at run time, which R8 renames or removes:
// - expo-camera turns barcode scanning on only if
//   Class.forName("com.google.mlkit.vision.barcode.BarcodeScanning") succeeds
//   (CameraUtils.isMLKitBarcodeScannerAvailable). Renamed, scanning is
//   silently off: the scanner shows the camera and never reads a code.
// - The ESP provisioning module hears "connected" through EventBus, which finds
//   @Subscribe methods by reflection. Its handler survives today (checked in
//   0.4.0 with dexdump), but nothing guaranteed it: EventBus's own rules pin it.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARK = "# --- IO Driven keep rules (plugins/with-proguard-rules.js) ---";
const RULES = `
${MARK}
-keep class com.google.mlkit.vision.barcode.BarcodeScanning { *; }
-keepnames class com.google.mlkit.vision.barcode.** { *; }
-keepattributes *Annotation*
-keepclassmembers class * {
    @org.greenrobot.eventbus.Subscribe <methods>;
}
-keep enum org.greenrobot.eventbus.ThreadMode { *; }
-keep class com.espidfprovisioning.** { *; }
`;

module.exports = function withProguardRules(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!current.includes(MARK)) fs.writeFileSync(file, current + RULES);
      return cfg;
    },
  ]);
};
