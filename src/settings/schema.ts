/**
 * settings.json is a single flat Dictionary<string,object> - 279 top-level
 * keys, no nesting by area. Grouping below is by key-name prefix/membership
 * only; it mirrors how VNyan itself names things (ARKit*, MP*, SteamVR*,
 * Bloom*, ...). Props/Colliders/Pendulums(Chains)/StretchBones/Gestures/
 * Expressions have their own dedicated tools instead of living under a
 * generic area, since they're structured lists worth their own read/write
 * semantics.
 */

export const SETTINGS_AREAS = [
  "tracking",
  "output",
  "graphics",
  "audio",
  "connections",
  "misc",
] as const;
export type SettingsArea = (typeof SETTINGS_AREAS)[number];

const TRACKING_PREFIXES = ["ARKit", "MP", "Leap", "SteamVR", "RhyLiveTrack"];
const TRACKING_EXACT = [
  "VMCLayers", "Trackers", "RhyLiveUse", "VRCVirtualTrackers",
  "WebcamAdjustment", "PhoneAdjustment", "BlendshapeAdd", "WebcamTexture",
];

const OUTPUT_EXACT = [
  "UseSpout", "SpoutName", "Spout2Cameras", "UseNDI",
  "VCamActive", "VCamMirror", "VCamFPS",
  "LimitFps", "LimitFpsValue", "AllowWindowResize", "NoUpdateOffScreen",
  "ConfirmQuit", "SkipStartWizard", "SkipNewWizard", "WhatsNewModalVersion",
  "DisplayLightMonitor", "DisplayLightOpacity",
  "UIScale", "UITheme", "UIHelp", "AdvancedMode", "HideNSFW", "LastPath",
  "ResetCameraOnAvatarSwap", "OldCameraRig",
  "DefaultCameraDistance", "DefaultCameraRotX", "DefaultCameraRotY", "DefaultCameraX", "DefaultCameraY",
  "Cameras", "AvatarPositions", "AvatarCacheInUse",
];

const GRAPHICS_PREFIXES = [
  "Bloom", "Analog", "Chromatic", "Digital", "Binary", "Lens", "Color", "AO", "Grain",
  "Direct", "Ambient",
];
const GRAPHICS_EXACT = ["Antialias", "AntialiasValue", "SMAA", "FocalDistance", "ContactShadows"];

const AUDIO_EXACT = [
  "VolumeMaster", "VolumeBonk", "VolumeConfetti",
  "LipsyncInput", "LipsyncGain", "LipsyncSmooth",
  "AudioLinkInput", "AudioLinkGain",
  "AudioLinkThreshold1", "AudioLinkThreshold2", "AudioLinkThreshold3", "AudioLinkThreshold4",
  "SpeechRecognition",
];

const CONNECTIONS_EXACT = [
  "RESTPort", "WebSocketPort", "WebSocketInUse", "OSCPort",
  "VMCPort", "VMCSenderPort", "VMCSenderIP", "VMCSenderActive",
  "VTSPort", "VTSOverlayMode",
  "OBSAddress", "OBSPort", "OBSPassword", "OBSAutoConnect", "OBSAutoReconnect",
  "RhyLivePort", "LovenseIP", "LovensePort", "VRChatPort",
  "VNyanNetServerUrl", "VNyanNetServerPass", "VNyanNetUserName",
  "ChaturbateToken", "KickUserName", "FanslyAccount", "YoutubeChannelID", "TiltifyCampaign",
  "TwitchScopeVersion", "EmoteWhitelist", "EmoteDropper",
];

// Everything else (NodeGraphCount, wind, breathing, arm sway, expression
// tilt, mouth/food collider offsets, ...) falls through to "misc".

const SECRET_KEYS = new Set(["ChaturbateToken", "VNyanNetServerPass", "OBSPassword"]);

// Keys with their own dedicated tool (vnyan_prop, vnyan_collider, vnyan_pendulum,
// vnyan_stretchbone, vnyan_gesture, vnyan_expression) - excluded from the
// generic area dump so there's exactly one documented way to reach them.
const DEDICATED_KEYS = new Set([
  "Props", "Chains", "StretchBones", "Gestures", "Expressions",
  "HeadColliderSize", "HeadColliderOffset", "TorsoColliderSize", "TorsoColliderOffset",
  "MouthColliderSize", "MouthColliderDepth", "MouthColliderHeight",
  "RightFoodOffset", "LeftFoodOffset", "RightFoodRot", "LeftFoodRot",
]);

function matches(key: string, prefixes: string[], exact: string[]): boolean {
  return exact.includes(key) || prefixes.some((p) => key.startsWith(p));
}

export function areaOf(key: string): SettingsArea {
  if (matches(key, [], CONNECTIONS_EXACT)) return "connections";
  if (matches(key, TRACKING_PREFIXES, TRACKING_EXACT)) return "tracking";
  if (matches(key, [], OUTPUT_EXACT)) return "output";
  if (matches(key, GRAPHICS_PREFIXES, GRAPHICS_EXACT)) return "graphics";
  if (matches(key, [], AUDIO_EXACT)) return "audio";
  return "misc";
}

export function isSecret(key: string): boolean {
  return SECRET_KEYS.has(key);
}

export function isDedicated(key: string): boolean {
  return DEDICATED_KEYS.has(key);
}
