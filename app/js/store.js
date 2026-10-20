// Studio persistent state: per-app brand + screens in localStorage
// (v3 map with v2 back-compat), coerced through the models layer.
// Storage is injected — pass a fake in tests, localStorage in the browser.
import { APP_PRESETS } from "./presets.js";
import { coerceBrand, coerceScreen, presetFor, screensFor } from "./models.js";

const V3 = "ploonu_screenshots_v3";
const V2 = "ploonu_screenshots_v2";

function memStore(){
  const m = new Map();
  return {
    getItem: k=>(m.has(k) ? m.get(k) : null),
    setItem: (k, v)=>{ m.set(k, String(v)); },
    removeItem: k=>{ m.delete(k); },
  };
}

export function createStore(storage){
  let store = storage;
  try{ storage.setItem("__probe", "1"); storage.removeItem("__probe"); }
  catch(e){ store = memStore(); }

  const state = {
    appId: "vidiloop",
    screens: screensFor("vidiloop"),
    selected: 0,
    platform: "ios",
    exportSize: "1320x2868",
    brand: coerceBrand(null, presetFor("vidiloop")),
    apps: {},
  };

  function read(key){ try{ return store.getItem(key); }catch(e){ return null; } }
  function write(key, val){ try{ store.setItem(key, val); }catch(e){} }

  function load(){
    try{
      const raw3 = read(V3);
      if(raw3){
        const j = JSON.parse(raw3);
        if(j.currentAppId) state.appId = j.currentAppId;
        if(j.platform) state.platform = j.platform;
        if(j.exportSize) state.exportSize = j.exportSize;
        if(j.apps) state.apps = j.apps;
        const cur = state.apps[state.appId];
        if(cur){
          state.brand = coerceBrand(cur.brand, presetFor(state.appId));
          state.screens = (cur.screens || []).map(coerceScreen);
        }
      } else {
        const raw2 = read(V2);
        if(raw2){
          const j = JSON.parse(raw2);
          if(j.appId) state.appId = j.appId;
          if(j.platform) state.platform = j.platform;
          if(j.exportSize) state.exportSize = j.exportSize;
          state.brand = coerceBrand(j.brand, state.brand);
          if(j.screens) state.screens = j.screens.map(coerceScreen);
          state.apps[state.appId] = {
            brand: JSON.parse(JSON.stringify(state.brand)),
            screens: JSON.parse(JSON.stringify(state.screens)),
          };
        }
        const p = presetFor(state.appId);
        state.brand = coerceBrand(state.brand, p);
        if(!state.screens.length) state.screens = screensFor(state.appId);
      }
    }catch(e){ /* corrupt state: fall back to preset below */ }
    state.brand = coerceBrand(state.brand, presetFor(state.appId));
    if(!state.screens.length) state.screens = screensFor(state.appId);
    return state;
  }

  function save(){
    state.apps[state.appId] = {
      brand: JSON.parse(JSON.stringify(state.brand)),
      screens: JSON.parse(JSON.stringify(state.screens)),
    };
    write(V3, JSON.stringify({
      currentAppId: state.appId, platform: state.platform,
      exportSize: state.exportSize, apps: state.apps,
    }));
    write(V2, JSON.stringify({
      appId: state.appId, platform: state.platform,
      exportSize: state.exportSize, brand: state.brand, screens: state.screens,
    }));
  }

  function reset(){
    try{ store.removeItem(V3); store.removeItem(V2); }catch(e){}
  }

  return { state, load, save, reset };
}
