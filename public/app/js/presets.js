// Studio preset data: apps, platform sizes, bundled screenshots.
// SaaS swaps this module for D1-backed presets; the shape stays identical.
export const VIDILOOP_ASSETS = [
  {label:"Onboarding — Welcome", path:"presets/vidiloop/onboarding/screen.png"},
  {label:"Feed — For You", path:"presets/vidiloop/for_you_feed/screen.png"},
  {label:"Capture — Camera", path:"presets/vidiloop/capture/screen.png"},
  {label:"Editor — Trim", path:"presets/vidiloop/trim_editor/screen.png"},
  {label:"Discovery — Search", path:"presets/vidiloop/discover/screen.png"},
  {label:"Profile + Top 8", path:"presets/vidiloop/profile_top8/screen.png"},
  {label:"Notifications", path:"presets/vidiloop/notifications/screen.png"},
  {label:"Vidiloop+ — Paywall", path:"presets/vidiloop/plus_paywall/screen.png"},
];

export const PLATFORM_SIZES = {
  ios: [
    {value:"1320x2868", label:"1320×2868", note:"6.9\""},
    {value:"1290x2796", label:"1290×2796", note:"6.7\""},
    {value:"1260x2736", label:"1260×2736", note:"iPhone Air"},
    {value:"1284x2778", label:"1284×2778", note:"6.5\""},
    {value:"1242x2688", label:"1242×2688", note:"6.5\" Face ID"},
    {value:"1206x2622", label:"1206×2622", note:"6.1\" DI"},
    {value:"1179x2556", label:"1179×2556", note:"6.1\" DI (Required)"},
    {value:"2064x2752", label:"2064×2752", note:"iPad 13\""},
    {value:"2048x2732", label:"2048×2732", note:"iPad 13\""},
  ],
  android: [
    {value:"1080x1920", label:"1080×1920", note:"Phone"},
    {value:"1440x2560", label:"1440×2560", note:"QHD"},
    {value:"1080x2160", label:"1080×2160", note:"18:9"},
  ],
  marketing: [
    {value:"5244x2950", label:"5244×2950", note:"Header 16:9"},
    {value:"3840x1646", label:"3840×1646", note:"Header wide"},
    {value:"1024x500", label:"1024×500", note:"Play Feature Graphic"},
    {value:"512x512", label:"512×512", note:"Play App Icon"},
    {value:"1024x1024", label:"1024×1024", note:"App Store Icon"},
  ],
  duo: [
    {value:"1398x2034", label:"1398×2034", note:"Duo outer"},
    {value:"2007x2853", label:"2007×2853", note:"Duo inner"},
    {value:"2034x1398", label:"2034×1398", note:"Duo outer land"},
    {value:"2853x2007", label:"2853×2007", note:"Duo inner land"},
  ]
};

export const STORE_PREVIEWS = [
  {value:"1024x500", label:"1024×500", note:"Play Feature Graphic", platform:"android"},
  {value:"512x512", label:"512×512", note:"Play App Icon", platform:"android"},
  {value:"1024x1024", label:"1024×1024", note:"App Store Icon", platform:"ios"},
];

export const APP_PRESETS = {
  vidiloop: {
    id:"vidiloop", name:"Vidiloop", primary:"#7c5cff", bg:"#0b0914", headlineSize:50, headlineWeight:"700", headlineColor:"#0f172a", headlineAlign:"center", screens:[
      {headline:"Welcome to Vidiloop", file:"presets/vidiloop/onboarding/screen.png", asset:0},
      {headline:"Loop any moment", file:"presets/vidiloop/for_you_feed/screen.png", asset:1},
      {headline:"Capture in 8 seconds", file:"presets/vidiloop/capture/screen.png", asset:2},
      {headline:"Trim in seconds", file:"presets/vidiloop/trim_editor/screen.png", asset:3},
      {headline:"Discover endless loops", file:"presets/vidiloop/discover/screen.png", asset:4},
      {headline:"Your Top 8 is showing", file:"presets/vidiloop/profile_top8/screen.png", asset:5},
      {headline:"Never miss a loop", file:"presets/vidiloop/notifications/screen.png", asset:6},
      {headline:"Go further with Plus", file:"presets/vidiloop/plus_paywall/screen.png", asset:7},
    ]
  },
  yaps: {
    id:"yaps", name:"Yaps", primary:"#ff6b00", bg:"#0d0b14", headlineSize:50, headlineWeight:"700", headlineColor:"#0f172a", headlineAlign:"center", screens:[
      {headline:"Speak your mind", file:"", asset:-1},
      {headline:"Short posts, big opinions", file:"", asset:-1},
      {headline:"Good conversation", file:"", asset:-1},
      {headline:"Adults-only, free", file:"", asset:-1},
      {headline:"Join the conversation", file:"", asset:-1},
    ]
  },
  typepress: {
    id:"typepress", name:"TypePress", primary:"#0ea5e9", bg:"#0f172a", headlineSize:50, headlineWeight:"700", headlineColor:"#0f172a", headlineAlign:"center", screens:[
      {headline:"Write without limits", file:"", asset:-1},
      {headline:"Publish in seconds", file:"", asset:-1},
      {headline:"Own your audience", file:"", asset:-1},
      {headline:"Themes that convert", file:"", asset:-1},
      {headline:"Start writing today", file:"", asset:-1},
    ]
  },
  generic: {
    id:"generic", name:"Generic App", primary:"#2563eb", bg:"#0a0a0f", headlineSize:50, headlineWeight:"700", headlineColor:"#0f172a", headlineAlign:"center", screens:[
      {headline:"Your app, your way", file:"", asset:-1},
      {headline:"Design that converts", file:"", asset:-1},
      {headline:"Built for speed", file:"", asset:-1},
      {headline:"Stay in control", file:"", asset:-1},
      {headline:"Get started today", file:"", asset:-1},
    ]
  }
};
