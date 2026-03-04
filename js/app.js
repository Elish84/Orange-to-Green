
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// ===================== CONFIG =====================
const COLLECTION_NAME = "houseScans";
const SECTORS = ["א'","ב'","ג'","מסייעת","גדוד","אחר"];
const DETENTION_OPTIONS = ["ללא","נלקח לחקירה","תושאל טלפונית","עצור"];

// ===================== INIT =====================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
let isAdmin = false;

// משתמשים רגילים נכנסים בצורה אנונימית כדי לאפשר שמירה ל-DB בלי להקליד סיסמה
// (האדמין עדיין מתחבר עם אימייל/סיסמה כדי לקבל דשבורד/רשומות)
signInAnonymously(auth).catch((e) => {
  console.warn("Anonymous sign-in failed:", e);
});

async function checkIsAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch (e) {
    console.error("Admin check failed:", e);
    return false;
  }
}

async function promptAdminLogin() {
  const email = prompt("Admin Email:");
  if (!email) return false;

  const password = prompt("Password:");
  if (!password) return false;

  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
    return true;
  } catch (e) {
    console.error(e);
    alert("התחברות נכשלה");
    return false;
  }
}

async function ensureAdminOrLogin() {
  // כבר אדמין
  if (isAdmin) return true;

  // אם אין יוזר / או לא אדמין – ננסה התחברות
  const ok = await promptAdminLogin();
  if (!ok) return false;

  // נחכה לעדכון auth ואז נוודא admin
  const u = auth.currentUser;
  if (!u) return false;

  isAdmin = await checkIsAdmin(u.uid);
  if (!isAdmin) {
    alert("המשתמש מחובר אך אינו מוגדר כאדמין");
    await signOut(auth);
    return false;
  }
  return true;
}
// ===================== UI HELPERS =====================
const $ = (id) => document.getElementById(id);

function setToast(el, type, msg) {
  el.classList.remove("ok","bad");
  el.classList.add(type);
  el.textContent = msg;
  el.style.display = "block";
  window.clearTimeout(el._t);
  el._t = window.setTimeout(() => { el.style.display = "none"; }, 2800);
}

function toDatetimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
 return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseDatetimeLocalToISO(dtLocal) {
  const d = new Date(dtLocal);
  return d.toISOString();
}

function safeNum(x, def=0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

function fmtShortTime(isoOrDate) {
  const d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", { year:"2-digit", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function normalizeText(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function escapeHtml(str) {
  return (str ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ===================== AUTH (Anonymous) =====================


async function logoutAdmin() {
  try { await signOut(auth); } catch (e) { console.error(e); }
}
// UI indicators (optional, but useful)
function setRtStatus(ok, text) {
  const rtEl = $("rtStatus");
  if (!rtEl) return;
  rtEl.textContent = text;
  if (ok) {
    rtEl.style.borderColor = "rgba(25,195,125,0.45)";
    rtEl.style.background = "rgba(25,195,125,0.12)";
  } else {
    rtEl.style.borderColor = "rgba(255,77,77,0.5)";
    rtEl.style.background = "rgba(255,77,77,0.12)";
  }
}

function setAdminUI(admin) {
  const dashTabBtn = document.querySelector(`.tab[data-tab="dashboard"]`);
  const recTabBtn  = document.querySelector(`.tab[data-tab="records"]`);

  // תמיד להציג — רק לסמן נעול כשלא אדמין (דשבורד + רשומות בלבד)
  [dashTabBtn, recTabBtn].forEach(btn => {
    if (!btn) return;
    btn.style.display = ""; // לא להסתיר!
    btn.classList.toggle("locked", !admin);
  });

  // אם לא אדמין והוא כבר נמצא בדשבורד/רשומות/מפה — נחזיר לטופס
  if (!admin) {
    const activeEl = document.querySelector(".tab.active");
    const active = (activeEl && activeEl.dataset) ? activeEl.dataset.tab : null;

    if (active === "dashboard" || active === "records") {
      const formBtn = document.querySelector('.tab[data-tab="form"]');
      if (formBtn) formBtn.click();
    }
  }
}


// ===================== TABS =====================
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", async () => {

    const tab = btn.dataset.tab;

    // אם יוצאים מהמפה בזמן מצב "הכנסת איתורים" – נסגור את המצב
    if (tab !== "map" && mapState?.addMode) {
      try { exitAddTargetsMode(); } catch (_) {}
    }

    // אם מנסים להיכנס לדשבורד/רשומות – נדרוש אדמין
    if (tab === "dashboard" || tab === "records") {
      const ok = await ensureAdminOrLogin();
      if (!ok) return;
    }

    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".panel").forEach(p => p.classList.remove("show"));
    document.getElementById(`tab-${tab}`)?.classList.add("show");

    // Leaflet חייב invalidateSize אחרי שהאלמנט נהיה גלוי
    if (tab === "map") {
      initMapIfNeeded();
      window.setTimeout(() => {
        try { mapState?.map?.invalidateSize?.(); } catch (_) {}
      }, 80);
      renderTargetsOnMap();
    }
  });
});

// ===================== MAP (Leaflet + Esri World Imagery) =====================
// מפה פתוחה לכולם. דשבורד/רשומות נשארים מאחורי סיסמת אדמין.
const mapState = {
  map: null,
  cluster: null,
  markerByKey: new Map(),
  hasFit: false,
  addMode: false,
  _addClickHandler: null
};

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function computeDotSize() {
  const m = mapState.map;
  if (!m) return 6;
  const z = m.getZoom?.() ?? 10;
  const size = m.getSize?.() ?? { x: 900, y: 600 };
  // יחסית לגודל המסך + מעט תלוי זום, כדי להישאר פרופורציונלי ולא להשתלט.
  const base = Math.min(size.x, size.y);
  const byScreen = Math.round(base / 240);   // 600px -> ~2-3, 1000px -> ~4
  const byZoom = Math.round((z - 8) * 0.6);
  return clamp(4 + byScreen + byZoom, 4, 10);
}

function makeDotIcon(px, color = "red") {
  const s = Number(px) || 6;
  return L.divIcon({
    className: "",
    html: `<div class="map-dot ${color}" style="width:${s}px;height:${s}px;"></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2]
  });
}

function initMapIfNeeded() {
  if (mapState.map) return;
  const el = document.getElementById("map");
  if (!el || typeof L === "undefined") return;

  // Israel-ish default view
  const m = L.map(el, {
    zoomControl: true,
    preferCanvas: true,
    worldCopyJump: true
  }).setView([31.7, 35.2], 9);

  // Esri World Imagery
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
    }
  ).addTo(m);

  L.control.scale({ imperial: false }).addTo(m);

  // Clustering כדי למנוע חפיפה בין נקודות
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 44,
    disableClusteringAtZoom: 18
  });
  m.addLayer(cluster);

  mapState.map = m;
  mapState.cluster = cluster;

  // עדכון גודל נקודות בהתאם לזום/מסך
  m.on("zoomend", () => updateAllMarkerIcons());
}

function updateAllMarkerIcons() {
  if (!mapState.map || !mapState.cluster) return;
  const px = computeDotSize();
  mapState.markerByKey.forEach((marker) => {
    const color = marker?._o2gColor || "red";
    try { marker.setIcon(makeDotIcon(px, color)); } catch (_) {}
  });
}

// ===================== HOUSE TARGETS (Loaded list) =====================
const TARGETS_STORAGE_KEY = "o2g_house_targets_v1";
const COMPLETED_STORAGE_KEY = "o2g_house_targets_completed_v1";

let houseTargets = []; // [{ houseSite, lat, lng }]
let completedHouseSites = new Set();

function normalizeKey(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function loadFromStorage() {
  try {
    const rawT = localStorage.getItem(TARGETS_STORAGE_KEY);
    if (rawT) houseTargets = JSON.parse(rawT) || [];
  } catch (_) {
    houseTargets = [];
  }

  try {
    const rawC = localStorage.getItem(COMPLETED_STORAGE_KEY);
    const arr = rawC ? (JSON.parse(rawC) || []) : [];
    completedHouseSites = new Set(arr.map(normalizeKey).filter(Boolean));
  } catch (_) {
    completedHouseSites = new Set();
  }
}

function saveTargetsToStorage() {
  try {
    localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(houseTargets));
  } catch (_) {}
}

function saveCompletedToStorage() {
  try {
    localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(Array.from(completedHouseSites)));
  } catch (_) {}
}

function parseTargetsText(text) {
  const t = (text ?? "").trim();
  if (!t) return [];

  // JSON
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const obj = JSON.parse(t);
      const arr = Array.isArray(obj) ? obj : (Array.isArray(obj?.targets) ? obj.targets : []);
      return (arr || []).map(x => ({
        houseSite: (x.houseSite ?? x.site ?? x.id ?? "").toString().trim(),
        lat: Number(x.lat ?? x.latitude),
        lng: Number(x.lng ?? x.lon ?? x.longitude)
      })).filter(x => x.houseSite && Number.isFinite(x.lat) && Number.isFinite(x.lng));
    } catch (_) {
      // fallthrough to CSV
    }
  }

  // CSV / TSV / ;
  const lines = t.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    // skip header
    if (/housesite/i.test(line) && /lat/i.test(line) && /lng|lon/i.test(line)) continue;
    const parts = line.split(/[;,\t]/).map(x => x.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    const houseSite = parts[0];
    const lat = Number(parts[1]);
    const lng = Number(parts[2]);
    if (!houseSite || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ houseSite, lat, lng });
  }
  return out;
}

function setTargetsToast(type, msg) {
  const el = $("targetsToast");
  if (!el) return;
  setToast(el, type, msg);
}

function hydrateTemplateLink() {
  const a = $("btnDownloadTemplate");
  if (!a) return;
  const csv = "houseSite,lat,lng\n101,31.7683,35.2137\n102,31.7701,35.2099\n";
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
}

async function readFileAsText(file) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("file read failed"));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsText(file);
  });
}

function initTargetsUI() {
  hydrateTemplateLink();

  $("btnLoadTargets")?.addEventListener("click", async () => {
    const paste = $("targetsPaste")?.value ?? "";
    const file = $("targetsFile")?.files?.[0] ?? null;

    let text = paste;
    if (!text.trim() && file) {
      try { text = await readFileAsText(file); }
      catch (_) {
        setTargetsToast("bad", "שגיאה בקריאת הקובץ");
        return;
      }
    }

    const parsed = parseTargetsText(text);
    if (!parsed.length) {
      setTargetsToast("bad", "לא נמצאו שורות תקינות (בדוק פורמט: houseSite,lat,lng)");
      return;
    }

    // Dedup by houseSite key
    const map = new Map();
    for (const x of parsed) map.set(normalizeKey(x.houseSite), x);
    houseTargets = Array.from(map.values());
    saveTargetsToStorage();
    mapState.hasFit = false;
    renderTargetsOnMap(true);
    setTargetsToast("ok", `נטענו ${houseTargets.length} איתורים ✅`);
  });

  $("btnClearTargets")?.addEventListener("click", () => {
    houseTargets = [];
    saveTargetsToStorage();
    mapState.hasFit = false;
    renderTargetsOnMap(true);
    setTargetsToast("ok", "הרשימה נוקתה");
  });


// ===================== MAP: ADD TARGETS MODE (Click to add) =====================
function setAddModeUI(active) {
  const enterBtn = $("btnEnterAddMode");
  const exitBtn = $("btnExitAddMode");
  const hint = $("addModeHint");
  const mapHint = $("mapHint");
  const mapEl = $("map");

  if (enterBtn) enterBtn.style.display = active ? "none" : "inline-flex";
  if (exitBtn) exitBtn.style.display = active ? "inline-flex" : "none";

  if (hint) {
    hint.textContent = active
      ? "מצב הכנסת איתורים פעיל: לחץ על המפה, הזן מספר איתור בית, והמשך להוסיף. לסיום לחץ “סיים”."
      : "";
  }

  if (mapHint) {
    mapHint.textContent = active
      ? "מצב הכנסת איתורים: לחץ על המפה כדי להוסיף נקודה חדשה"
      : "לחיצה על נקודה פותחת טופס עם מספר איתור הבית מראש";
  }

  if (mapEl) {
    mapEl.style.cursor = active ? "crosshair" : "";
  }
}

function exitAddTargetsMode() {
  if (!mapState.map) return;
  mapState.addMode = false;
  setAddModeUI(false);

  if (mapState._addClickHandler) {
    try { mapState.map.off("click", mapState._addClickHandler); } catch (_) {}
    mapState._addClickHandler = null;
  }
}

function enterAddTargetsMode() {
  initMapIfNeeded();
  if (!mapState.map) return;

  mapState.addMode = true;
  setAddModeUI(true);

  if (mapState._addClickHandler) {
    try { mapState.map.off("click", mapState._addClickHandler); } catch (_) {}
  }

  mapState._addClickHandler = (e) => {
    if (!mapState.addMode) return;
    const lat = Number(e?.latlng?.lat);
    const lng = Number(e?.latlng?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    let houseSite = window.prompt("מספר איתור הבית:", "");
    if (houseSite == null) return; // cancel
    houseSite = String(houseSite).trim();
    if (!houseSite) return;

    const key = normalizeKey(houseSite);
    if (!key) return;

    // Upsert
    const idx = (houseTargets || []).findIndex(x => normalizeKey(x?.houseSite) === key);
    const rec = { houseSite, lat, lng };
    if (idx >= 0) houseTargets[idx] = rec;
    else houseTargets.push(rec);

    saveTargetsToStorage();
    mapState.hasFit = false;
    renderTargetsOnMap(false);
    setTargetsToast("ok", `נוסף איתור ${houseSite} ✅`);
  };

  mapState.map.on("click", mapState._addClickHandler);
}

function initAddTargetsModeUI() {
  $("btnEnterAddMode")?.addEventListener("click", () => enterAddTargetsMode());
  $("btnExitAddMode")?.addEventListener("click", () => exitAddTargetsMode());

  // Esc exits add mode
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mapState.addMode) exitAddTargetsMode();
  });
}
}

function openFormForHouse(houseSite) {
  const formBtn = document.querySelector('.tab[data-tab="form"]');
  if (formBtn) formBtn.click();
  const el = $("houseSite");
  if (el) {
    el.value = String(houseSite ?? "");
    el.focus();
    el.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }
}

function markHouseCompleted(houseSite) {
  const key = normalizeKey(houseSite);
  if (!key) return;
  completedHouseSites.add(key);
  saveCompletedToStorage();
  updateMarkerColor(key);
}

function updateMarkerColor(key) {
  const marker = mapState.markerByKey.get(key);
  if (!marker) return;
  const px = computeDotSize();
  const isDone = completedHouseSites.has(key);
  const color = isDone ? "blue" : "red";
  marker._o2gColor = color;
  try { marker.setIcon(makeDotIcon(px, color)); } catch (_) {}
}

function renderTargetsOnMap(forceRebuild = false) {
  const totalEl = document.getElementById("mapTotal");
  if (totalEl) totalEl.textContent = String(houseTargets.length);

  if (!mapState.map || !mapState.cluster) return;

  if (forceRebuild) {
    try { mapState.cluster.clearLayers(); } catch (_) {}
    mapState.markerByKey.clear();
  }

  const valid = (houseTargets || []).filter(x => x && x.houseSite && Number.isFinite(x.lat) && Number.isFinite(x.lng));
  const keySet = new Set(valid.map(x => normalizeKey(x.houseSite)));

  // remove missing
  for (const [key, marker] of mapState.markerByKey.entries()) {
    if (!keySet.has(key)) {
      mapState.cluster.removeLayer(marker);
      mapState.markerByKey.delete(key);
    }
  }

  const px = computeDotSize();

  for (const x of valid) {
    const key = normalizeKey(x.houseSite);
    const existing = mapState.markerByKey.get(key);
    const isDone = completedHouseSites.has(key);
    const color = isDone ? "blue" : "red";

    if (existing) {
      existing.setLatLng([x.lat, x.lng]);
      if (existing.getTooltip?.()) existing.setTooltipContent(String(x.houseSite));
      updateMarkerColor(key);
      continue;
    }

    const marker = L.marker([x.lat, x.lng], { icon: makeDotIcon(px, color) });
    marker._o2gColor = color;
    marker.bindTooltip(String(x.houseSite), {
      direction: "top",
      opacity: 0.95,
      offset: [0, -(px / 2 + 4)]
    });
    marker.on("click", () => openFormForHouse(x.houseSite));

    mapState.markerByKey.set(key, marker);
    mapState.cluster.addLayer(marker);
  }

  if (!mapState.hasFit && valid.length) {
    try {
      const b = mapState.cluster.getBounds();
      if (b && b.isValid()) {
        mapState.map.fitBounds(b, { padding: [18, 18] });
        mapState.hasFit = true;
      }
    } catch (_) {}
  }
}

// ===================== FORM DEFAULTS =====================
const eventTimeEl = $("eventTime");
if (eventTimeEl) eventTimeEl.value = toDatetimeLocalValue(new Date());

$("btnReset")?.addEventListener("click", () => {
  $("scanForm")?.reset();
  if (eventTimeEl) eventTimeEl.value = toDatetimeLocalValue(new Date());
  clearGPS();
  const wrap = $("attachmentCountWrap");
  if (wrap) wrap.style.display = "none";
  const c = $("attachmentCount");
  if (c) c.value = 1;
  const det = $("detention");
  if (det) det.value = "ללא";
});

$("hasAttachment")?.addEventListener("change", (e) => {
  const wrap = $("attachmentCountWrap");
  if (wrap) wrap.style.display = e.target.checked ? "block" : "none";
  if (!e.target.checked) {
    const c = $("attachmentCount");
    if (c) c.value = 1;
  }
});

let currentGPS = null;

function setGPSStatus(text, muted=false) {
  const el = $("gpsStatus");
  if (!el) return;
  el.textContent = `GPS: ${text}`;
  el.classList.toggle("muted", muted);
}

function renderGPSPreview(gps) {
  const lat = $("latVal"), lng = $("lngVal"), acc = $("accVal");
  if (lat) lat.textContent = gps?.lat ?? "—";
  if (lng) lng.textContent = gps?.lng ?? "—";
  if (acc) acc.textContent = gps?.accuracy ?? "—";
}

function clearGPS() {
  currentGPS = null;
  renderGPSPreview(null);
  setGPSStatus("לא בוצע", true);
}

$("btnClearGPS")?.addEventListener("click", clearGPS);

$("btnGetGPS")?.addEventListener("click", async () => {
  if (!navigator.geolocation) {
    setGPSStatus("לא נתמך במכשיר", false);
    return;
  }
  setGPSStatus("מבצע…", false);

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      currentGPS = {
        lat: Number(latitude.toFixed(6)),
        lng: Number(longitude.toFixed(6)),
        accuracy: Math.round(accuracy),
        capturedAt: new Date().toISOString()
      };
      renderGPSPreview(currentGPS);
      setGPSStatus("נשמר", false);
    },
    (err) => {
      setGPSStatus(`שגיאה (${err.code})`, false);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
});

// ===================== SAVE FORM =====================
$("scanForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const toast = $("formToast");

  const eventTimeLocal = $("eventTime")?.value;
  const sector = $("sector")?.value;
  const houseSite = $("houseSite")?.value?.trim();

  if (!eventTimeLocal || !sector || !houseSite) {
    if (toast) setToast(toast, "bad", "חסרים שדות חובה: זמן/תאריך, גזרה, איתור בית");
    return;
  }

  const hasAttachment = $("hasAttachment")?.checked;
  const attachmentCount = hasAttachment ? Math.max(1, safeNum($("attachmentCount")?.value, 1)) : 0;

  const payload = {
    eventTimeLocal,
    eventTimeISO: parseDatetimeLocalToISO(eventTimeLocal),
    fillerName: ($("fillerName")?.value ?? "").trim(),
    sector,
    houseSite,
    gps: currentGPS,
    status: {
      hasAttachment: !!hasAttachment,
      attachmentCount,
      weaponScan: !!$("weaponScan")?.checked,
      mapping: !!$("mapping")?.checked,
      detention: $("detention")?.value || "ללא"
    },
    notes: ($("notes")?.value ?? "").trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    const btn = $("btnSave");
    if (btn) btn.disabled = true;

    await addDoc(collection(db, COLLECTION_NAME), payload);

    // עדכון המפה: איתור שהושלם נצבע כחול (לפי מספר איתור הבית)
    markHouseCompleted(houseSite);

    if (toast) setToast(toast, "ok", "נשמר בהצלחה ✅");
    $("btnReset")?.click();
  } catch (err) {
    console.error(err);
    if (toast) setToast(toast, "bad", "שגיאה בשמירה ל-DB (בדוק הרשאות/Auth)");
  } finally {
    const btn = $("btnSave");
    if (btn) btn.disabled = false;
  }
});

// ===================== CHARTS =====================
let liveRows = [];
let chartBySector = null;
let chartDetention = null;

function initCharts() {
  const ctx1 = $("chartBySector");
  const ctx2 = $("chartDetention");
  if (!ctx1 || !ctx2) return;

  chartBySector = new Chart(ctx1, {
    type: "bar",
    data: {
      labels: SECTORS,
      datasets: [{ label: "כמות איתורים (רשומות)", data: SECTORS.map(() => 0) }]
    },
    options: { responsive: true, plugins: { legend: { display: true } } }
  });

  chartDetention = new Chart(ctx2, {
    type: "doughnut",
    data: {
      labels: DETENTION_OPTIONS,
      datasets: [{ label: "חקירות/מעצרים", data: DETENTION_OPTIONS.map(() => 0) }]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}

function computeAggregates(rows) {
  const bySector = Object.fromEntries(SECTORS.map(s => [s, {
    total: 0,
    weapon: 0,
    attachments: 0,
    detentionCounts: Object.fromEntries(DETENTION_OPTIONS.map(x => [x, 0]))
  }]));

  const overall = {
    total: 0,
    weapon: 0,
    attachments: 0,
    detentionCounts: Object.fromEntries(DETENTION_OPTIONS.map(x => [x, 0]))
  };

  for (const r of rows) {
    const s = SECTORS.includes(r.sector) ? r.sector : "אחר";
    const det = DETENTION_OPTIONS.includes(r.status.detention) ? r.status.detention : "ללא";

    bySector[s].total += 1;
    overall.total += 1;

    if (r.status.weaponScan) { bySector[s].weapon += 1; overall.weapon += 1; }

    if (r.status.hasAttachment) {
      const cnt = Math.max(0, safeNum(r.status.attachmentCount, 0));
      bySector[s].attachments += cnt;
      overall.attachments += cnt;
    }

    bySector[s].detentionCounts[det] += 1;
    overall.detentionCounts[det] += 1;
  }

  return { bySector, overall };
}

function renderDashboard(rows) {
  if (!isAdmin) return;

  const { bySector, overall } = computeAggregates(rows);

  $("totalRecords").textContent = rows.length;
  $("kpiCompleted").textContent = overall.total;
  $("kpiWeapon").textContent = overall.weapon;
  $("kpiAttachments").textContent = overall.attachments;

  $("lastUpdate").textContent = fmtShortTime(new Date());

  if (chartBySector) {
    chartBySector.data.datasets[0].data = SECTORS.map(s => bySector[s].total);
    chartBySector.update();
  }

  if (chartDetention) {
    chartDetention.data.datasets[0].data = DETENTION_OPTIONS.map(k => overall.detentionCounts[k] ?? 0);
    chartDetention.update();
  }

  const wrap = $("sectorCards");
  if (wrap) {
    wrap.innerHTML = "";
    for (const s of SECTORS) {
      const ag = bySector[s];
      const detTop = DETENTION_OPTIONS
        .map(k => ({ k, v: ag.detentionCounts[k] ?? 0 }))
        .sort((a,b) => b.v - a.v)[0];

      const el = document.createElement("div");
      el.className = "sectorCard";
      el.innerHTML = `
        <div class="sectorTitle">גזרה ${s}</div>
        <div class="sectorStats">
          <div class="statBox"><div class="k">איתורים הושלמו</div><div class="v">${ag.total}</div></div>
          <div class="statBox"><div class="k">סריקות אמל"ח</div><div class="v">${ag.weapon}</div></div>
          <div class="statBox"><div class="k">סה"כ הצמדות</div><div class="v">${ag.attachments}</div></div>
          <div class="statBox"><div class="k">חקירות/מעצרים (מוביל)</div><div class="v">${detTop.k}: ${detTop.v}</div></div>
        </div>
      `;
      wrap.appendChild(el);
    }
  }
}

// ===================== RECORDS =====================
$("searchBox")?.addEventListener("input", () => renderRecords(liveRows));
$("sectorFilter")?.addEventListener("change", () => renderRecords(liveRows));

function renderRecords(rows) {
  if (!isAdmin) return;

  const tbody = $("recordsTbody");
  const empty = $("emptyState");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";

  const qText = normalizeText($("searchBox")?.value);
  const sectorFilter = $("sectorFilter")?.value;

  const filtered = rows.filter(r => {
    if (sectorFilter && r.sector !== sectorFilter) return false;
    if (!qText) return true;
    const hay = [
      r.fillerName, r.sector, r.houseSite,
      r.status?.detention, r.notes
    ].map(normalizeText).join(" | ");
    return hay.includes(qText);
  });

  if (filtered.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const r of filtered) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtShortTime(r.eventTimeISO)}</td>
      <td>${escapeHtml(r.fillerName)}</td>
      <td>${escapeHtml(r.sector)}</td>
      <td>${escapeHtml(r.houseSite)}</td>
      <td>${r.status.weaponScan ? "כן" : "לא"}</td>
      <td>${r.status.hasAttachment ? `כן (${safeNum(r.status.attachmentCount,0)})` : "לא"}</td>
      <td>${escapeHtml(r.status.detention)}</td>
      <td>
        <div class="rowActions">
          <button class="linkBtn" data-act="edit" data-id="${r.id}">עריכה</button>
          <button class="linkBtn danger" data-act="del" data-id="${r.id}">מחיקה</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const row = liveRows.find(x => x.id === id);
      if (!row) return;

      if (act === "edit") openEditModal(row);
      if (act === "del") await deleteRow(row);
    });
  });
}

// ===================== DELETE =====================
async function deleteRow(row) {
  if (!isAdmin) return;

  const ok = confirm(`למחוק רשומה?\nגזרה: ${row.sector}\nאיתור: ${row.houseSite}\nזמן: ${fmtShortTime(row.eventTimeISO)}`);
  if (!ok) return;

  try {
    await deleteDoc(doc(db, COLLECTION_NAME, row.id));
  } catch (e) {
    console.error(e);
    alert("שגיאה במחיקה");
  }
}

// ===================== EDIT MODAL =====================
const modal = $("editModal");

function openEditModal(row) {
  if (!isAdmin) return;

  $("editId").value = row.id;
  $("editEventTime").value = row.eventTimeLocal || toDatetimeLocalValue(new Date(row.eventTimeISO || Date.now()));
  $("editFillerName").value = row.fillerName || "";
  $("editSector").value = SECTORS.includes(row.sector) ? row.sector : "אחר";
  $("editHouseSite").value = row.houseSite || "";

  const gps = row.gps ?? null;
  $("editLat").textContent = gps?.lat ?? "—";
  $("editLng").textContent = gps?.lng ?? "—";
  $("editAcc").textContent = gps?.accuracy ?? "—";

  $("editHasAttachment").checked = !!row.status.hasAttachment;
  $("editWeaponScan").checked = !!row.status.weaponScan;
  $("editMapping").checked = !!row.status.mapping;
  $("editDetention").value = DETENTION_OPTIONS.includes(row.status.detention) ? row.status.detention : "ללא";

  $("editAttachmentCountWrap").style.display = row.status.hasAttachment ? "block" : "none";
  $("editAttachmentCount").value = Math.max(1, safeNum(row.status.attachmentCount, 1));

  $("editNotes").value = row.notes || "";

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

$("btnCloseModal")?.addEventListener("click", closeModal);
$("btnCancelEdit")?.addEventListener("click", closeModal);

$("editHasAttachment")?.addEventListener("change", (e) => {
  $("editAttachmentCountWrap").style.display = e.target.checked ? "block" : "none";
  if (!e.target.checked) $("editAttachmentCount").value = 1;
});

modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

$("editForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin) return;

  const toast = $("editToast");

  const id = $("editId").value;
  const eventTimeLocal = $("editEventTime").value;
  const sector = $("editSector").value;
  const houseSite = $("editHouseSite").value?.trim();

  if (!id || !eventTimeLocal || !sector || !houseSite) {
    if (toast) setToast(toast, "bad", "חסרים שדות חובה");
    return;
  }

  const hasAttachment = $("editHasAttachment").checked;
  const attachmentCount = hasAttachment ? Math.max(1, safeNum($("editAttachmentCount").value, 1)) : 0;

  const patch = {
    eventTimeLocal,
    eventTimeISO: parseDatetimeLocalToISO(eventTimeLocal),
    fillerName: ($("editFillerName").value ?? "").trim(),
    sector,
    houseSite,
    status: {
      hasAttachment,
      attachmentCount,
      weaponScan: $("editWeaponScan").checked,
      mapping: $("editMapping").checked,
      detention: $("editDetention").value || "ללא"
    },
    notes: ($("editNotes").value ?? "").trim(),
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), patch);
    if (toast) setToast(toast, "ok", "עודכן ✅");
    window.setTimeout(closeModal, 650);
  } catch (err) {
    console.error(err);
    if (toast) setToast(toast, "bad", "שגיאה בעדכון");
  }
});

// ===================== ADMIN GATE + REALTIME LISTENER =====================
function startRealtimeListener() {
  if (!isAdmin) {
    setRtStatus(true, "מחובר ל-DB: כן (מילוי בלבד)");
    return;
  }

  initCharts();

  const q = query(collection(db, COLLECTION_NAME), orderBy("eventTimeISO", "desc"));
  onSnapshot(q, (snap) => {
    setRtStatus(true, "מחובר ל-DB: כן (Admin)");

    const rows = [];
    snap.forEach(d => {
      const data = d.data();
      rows.push({
        id: d.id,
        ...data,
        sector: data.sector ?? "אחר",
        fillerName: data.fillerName ?? "",
        houseSite: data.houseSite ?? "",
        eventTimeISO: data.eventTimeISO ?? null,
        eventTimeLocal: data.eventTimeLocal ?? "",
        gps: data.gps ?? null,
        status: {
          hasAttachment: !!data?.status?.hasAttachment,
          attachmentCount: safeNum(data?.status?.attachmentCount, 0),
          weaponScan: !!data?.status?.weaponScan,
          mapping: !!data?.status?.mapping,
          detention: data?.status?.detention ?? "ללא"
        },
        notes: data.notes ?? ""
      });
    });

    liveRows = rows;
    renderDashboard(rows);
    renderRecords(rows);

    // אופציונלי: אם אדמין צופה במפה — נסמן כחול כל איתור שיש לו רשומה.
    // זה מאפשר "כחול" להיות משותף לצוות (תלוי בהרשאות Firestore לקריאה).
    try {
      rows.forEach(r => { if (r?.houseSite) completedHouseSites.add(normalizeKey(r.houseSite)); });
      saveCompletedToStorage();
      renderTargetsOnMap(false);
    } catch (_) {}
  }, (err) => {
    console.error(err);
    setRtStatus(false, "מחובר ל-DB: שגיאה (בדוק הרשאות)");
  });
}

// קובע האם המשתמש אדמין ואז מפעיל listener רק לאדמין
onAuthStateChanged(auth, async (u) => {
  console.log("AUTH:", u ? u.uid : "NO USER");

  if (!u) {
    isAdmin = false;
    setAdminUI(false);
    setRtStatus(false, "מחובר ל-DB: לא מחובר");
    return;
  }

  isAdmin = await checkIsAdmin(u.uid);
  console.log("isAdmin:", isAdmin);

  setAdminUI(isAdmin);

  // מפעיל real-time listener בהתאם להרשאות
  startRealtimeListener();
});

// Init map + targets UI after all scripts (Leaflet) are ready
window.addEventListener("load", () => {
  loadFromStorage();
  initTargetsUI();
  initAddTargetsModeUI();
  initMapIfNeeded();
  window.setTimeout(() => {
    try { mapState?.map?.invalidateSize?.(); } catch (_) {}
    renderTargetsOnMap(true);
  }, 80);
});

