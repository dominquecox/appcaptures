// Studio persistent state: per-app brand + screens in localStorage
// (v3 map with v2 back-compat), coerced through the models layer.
// Storage is injected — pass a fake in tests, localStorage in the browser.
// Supports server sync via D1 projects and screens API (AC-007) with seamless
// fallback to localStorage when unauthenticated or offline.
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
    projectId: null,
    serverSynced: false,
    user: null,
  };

  function read(key){ try{ return store.getItem(key); }catch(e){ return null; } }
  function write(key, val){ try{ store.setItem(key, val); }catch(e){} }

  let syncTimeout = null;
  function syncToServer(){
    if(!state.projectId || typeof fetch !== "function") return;
    if(syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async ()=>{
      try{
        await fetch("/api/projects/" + state.projectId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            name: state.brand.name,
            platforms: [state.platform],
            brand: state.brand,
          }),
        });
        for(const s of state.screens){
          if(s.id){
            await fetch("/api/screens/" + s.id, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                headline: s.headline,
                subhead: s.subhead || "",
                ord: s.ord,
              }),
            });
          }
        }
      }catch(e){
        // offline or network failure: fallback to localStorage
      }
    }, 350);
  }

  async function syncWithServer(){
    if(typeof fetch !== "function") return false;
    try{
      const meRes = await fetch("/api/me", { credentials: "same-origin" });
      if(!meRes.ok) return false;
      const meData = await meRes.json();
      if(!meData.ok || !meData.user) return false;
      state.user = meData.user;

      const projRes = await fetch("/api/projects", { credentials: "same-origin" });
      if(!projRes.ok) return false;
      const projData = await projRes.json();
      if(!projData.ok) return false;

      if(Array.isArray(projData.projects) && projData.projects.length > 0){
        const currentProj = projData.projects[0];
        const detailRes = await fetch("/api/projects/" + currentProj.id, { credentials: "same-origin" });
        if(detailRes.ok){
          const detailData = await detailRes.json();
          if(detailData.ok && detailData.project){
            state.projectId = detailData.project.id;
            state.brand = coerceBrand(detailData.project.brand, state.brand);
            if(Array.isArray(detailData.screens) && detailData.screens.length > 0){
              state.screens = detailData.screens.map((s, idx)=>({
                ...coerceScreen(s),
                id: s.id,
                ord: typeof s.ord === "number" ? s.ord : idx,
                subhead: s.subhead || "",
                capture_r2_key: s.capture_r2_key || null,
              }));
            }
            state.serverSynced = true;
            if(typeof window !== "undefined"){
              window.dispatchEvent(new CustomEvent("store:synced", { detail: state }));
            }
            return true;
          }
        }
      } else {
        const createRes = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            name: state.brand.name || "Untitled App",
            platforms: [state.platform],
            brand: state.brand,
            screens: state.screens.map((s, idx)=>({
              ord: idx,
              headline: s.headline,
              subhead: s.subhead || "",
            })),
          }),
        });
        if(createRes.ok){
          const createData = await createRes.json();
          if(createData.ok && createData.project){
            state.projectId = createData.project.id;
            state.serverSynced = true;
            const detailRes = await fetch("/api/projects/" + state.projectId, { credentials: "same-origin" });
            if(detailRes.ok){
              const detailData = await detailRes.json();
              if(detailData.ok && Array.isArray(detailData.screens)){
                state.screens = detailData.screens.map((s, idx)=>({
                  ...coerceScreen(s),
                  id: s.id,
                  ord: typeof s.ord === "number" ? s.ord : idx,
                  subhead: s.subhead || "",
                  capture_r2_key: s.capture_r2_key || null,
                }));
              }
            }
            if(typeof window !== "undefined"){
              window.dispatchEvent(new CustomEvent("store:synced", { detail: state }));
            }
            return true;
          }
        }
      }
    }catch(e){
      state.serverSynced = false;
    }
    return false;
  }

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

    if(typeof window !== "undefined" && typeof fetch === "function"){
      syncWithServer();
    }
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
    syncToServer();
  }

  function reset(){
    try{ store.removeItem(V3); store.removeItem(V2); }catch(e){}
  }

  return { state, load, save, reset, syncWithServer };
}
