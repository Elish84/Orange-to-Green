
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
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
  signInAnonymously,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// ===================== CONFIG =====================
const COLLECTION_NAME = "houseScans";
// Public, minimal collection for map pins (readable by non-admin users)
const MAP_COLLECTION = "mapPins";
const PLACES_COLLECTION = "places";
const SECTORS = ["א'","ב'","ג'","מסייעת","גדוד","אחר"];
const DETENTION_OPTIONS = ["ללא","נלקח לחקירה","תושאל טלפונית","עצור"];

// ===================== INIT =====================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
let isAdmin = false;
let allPlaces = [];

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
  el.classList.remove("ok", "bad");
  el.classList.add(type);
  el.textContent = msg;
  el.style.display = "block";
  window.clearTimeout(el._t);
  el._t = window.setTimeout(() => {
    el.style.display = "none";
  }, 2800);
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

function safeNum(x, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

function fmtShortTime(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normalizeText(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

function normalizePlaceName(s) {
  return (s ?? "").toString().trim();
}

function getPlaceKey(s) {
  return normalizePlaceName(s).toLowerCase();
}

function uniquePlacesSorted(values) {
  const map = new Map();
  for (const raw of values || []) {
    const v = normalizePlaceName(raw);
    if (!v) continue;
    const k = getPlaceKey(v);
    if (!map.has(k)) map.set(k, v);
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b, "he", { sensitivity: "base", numeric: true }));
}

function populatePlaceSelect(selectId, selectedValue = "", includeBlank = true) {
  const el = $(selectId);
  if (!el) return;
  const current = normalizePlaceName(selectedValue || el.value || "");
  const opts = uniquePlacesSorted([...(allPlaces || []), current]);
  const blankText = selectId === "dashboardPlaceFilter" || selectId === "placeFilter" ? "כל המקומות" : "בחר מקום…";
  el.innerHTML = "";
  if (includeBlank) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = blankText;
    if (!current) {
      if (selectId === "place" || selectId === "editPlace") {
        opt.disabled = true;
        opt.selected = true;
      }
    }
    el.appendChild(opt);
  }
  for (const place of opts) {
    const opt = document.createElement("option");
    opt.value = place;
    opt.textContent = place;
    if (current && getPlaceKey(current) === getPlaceKey(place)) opt.selected = true;
    el.appendChild(opt);
  }
  if (current) el.value = current;
}

function refreshPlaceOptions() {
  populatePlaceSelect("place", $("place")?.value || "", true);
  populatePlaceSelect("editPlace", $("editPlace")?.value || "", true);
  populatePlaceSelect("dashboardPlaceFilter", $("dashboardPlaceFilter")?.value || "", true);
  populatePlaceSelect("placeFilter", $("placeFilter")?.value || "", true);
}

function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasGpsForRecord(record) {
  const lat = record?.gps?.lat;
  const lng = record?.gps?.lng;
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function getActiveTabName() {
  return document.querySelector(".tab.active")?.dataset?.tab || "form";
}

function refreshVisibleViews() {
  const activeTab = getActiveTabName();

  if (activeTab === "dashboard" && isAdmin) {
    renderDashboard(liveRows);
  }

  if (activeTab === "records" && isAdmin) {
    renderRecords(liveRows);
  }

  if (activeTab === "map") {
    initMapIfNeeded();
    try {
      mapState?.map?.invalidateSize?.();
    } catch (_) {}
    renderMap(mapRows);
  }
}

// ===================== AUTH (Anonymous) =====================
async function ensureSignedIn() {
  try {
    if (auth.currentUser) return;
    await signInAnonymously(auth);
  } catch (e) {
    console.error("Anonymous sign-in failed:", e);
  }
}

// ננסה להבטיח משתמש מחובר (אנונימי) כדי שטופס/מפה יעבדו לפי הרשאות ה-Firestore
ensureSignedIn();

async function logoutAdmin() {
  try {
    await signOut(auth);
  } catch (e) {
    console.error(e);
  }
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
  const mapTabBtn = document.querySelector(`.tab[data-tab="map"]`);
  const recTabBtn = document.querySelector(`.tab[data-tab="records"]`);
  const adminPlaceField = $("adminPlaceField");

  if (adminPlaceField) adminPlaceField.style.display = admin ? "flex" : "none";

  // תמיד להציג
  [dashTabBtn, mapTabBtn, recTabBtn].forEach((btn) => {
    if (!btn) return;
    btn.style.display = ""; // לא להסתיר!
    // דשבורד + רשומות נעולים ללא אדמין. המפה חופשית לכולם.
    if (btn === mapTabBtn) btn.classList.remove("locked");
    else btn.classList.toggle("locked", !admin);
  });

  // אם לא אדמין והוא כבר נמצא בדשבורד/רשומות — נחזיר לטופס
  if (!admin) {
    const activeEl = document.querySelector(".tab.active");
    const active = activeEl && activeEl.dataset ? activeEl.dataset.tab : null;

    if (active === "dashboard" || active === "records") {
      const formBtn = document.querySelector('.tab[data-tab="form"]');
      if (formBtn) formBtn.click();
    }
  }
}

// ===================== TABS =====================
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const tab = btn.dataset.tab;

    if (tab === "dashboard" || tab === "records") {
      const ok = await ensureAdminOrLogin();
      if (!ok) return;
    }

    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("show"));
    document.getElementById(`tab-${tab}`)?.classList.add("show");

    if (tab === "map") {
      initMapIfNeeded();
      window.setTimeout(() => {
        try {
          mapState?.map?.invalidateSize?.();
        } catch (_) {}
        renderMap(mapRows);
      }, 80);
      return;
    }

    if (tab === "dashboard" && isAdmin) {
      initCharts(false);
      renderDashboard(liveRows);
      return;
    }

    if (tab === "records" && isAdmin) {
      renderRecords(liveRows);
    }
  });
});

window.addEventListener("focus", refreshVisibleViews);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshVisibleViews();
});
window.addEventListener("pageshow", refreshVisibleViews);

// ===================== MAP (Leaflet + Esri World Imagery) =====================
const mapState = {
  map: null,
  cluster: null,
  markerById: new Map(),
  hasFit: false
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function computeDotSize() {
  const m = mapState.map;
  if (!m) return 6;
  const z = m.getZoom?.() ?? 10;
  const size = m.getSize?.() ?? { x: 900, y: 600 };
  // יחסית לגודל המסך + מעט תלוי זום, כדי להישאר פרופורציונלי ולא להשתלט.
  const base = Math.min(size.x, size.y);
  const byScreen = Math.round(base / 240); // 600px -> ~2-3, 1000px -> ~4
  const byZoom = Math.round((z - 8) * 0.6);
  return clamp(4 + byScreen + byZoom, 4, 10);
}

function makeDotIcon(px) {
  const s = Number(px) || 6;
  return L.divIcon({
    className: "",
    html: `<div class="map-dot" style="width:${s}px;height:${s}px;"></div>`,
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
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
  }).addTo(m);

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
  const icon = makeDotIcon(px);
  mapState.markerById.forEach((marker) => {
    try {
      marker.setIcon(icon);
    } catch (_) {}
  });
}

function renderMap(rows) {
  const totalEl = document.getElementById("mapTotal");
  const valid = (rows || []).filter((r) => {
    const lat = r?.gps?.lat;
    const lng = r?.gps?.lng;
    return Number.isFinite(lat) && Number.isFinite(lng);
  });

  if (totalEl) totalEl.textContent = String(valid.length);

  // אם המפה עוד לא מאותחלת (לא נכנסו לטאב) — אין מה לצייר כרגע
  if (!mapState.map || !mapState.cluster) return;

  const idSet = new Set(valid.map((r) => r.id));

  // מחיקה של נקודות שנעלמו
  for (const [id, marker] of mapState.markerById.entries()) {
    if (!idSet.has(id)) {
      mapState.cluster.removeLayer(marker);
      mapState.markerById.delete(id);
    }
  }

  const px = computeDotSize();
  const icon = makeDotIcon(px);

  // הוספה/עדכון
  for (const r of valid) {
    const lat = r.gps.lat;
    const lng = r.gps.lng;
    const houseSite = (r.houseSite ?? "—").toString();

    const existing = mapState.markerById.get(r.id);
    if (existing) {
      existing.setLatLng([lat, lng]);
      if (existing.getTooltip?.()) existing.setTooltipContent(houseSite);
      continue;
    }

    const marker = L.marker([lat, lng], { icon });
    marker.bindTooltip(houseSite, {
      direction: "top",
      opacity: 0.95,
      offset: [0, -(px / 2 + 4)]
    });

    // אופציונלי: קליק מציג עוד פרטים
    const popupHtml = `
      <div style="min-width:220px; font-family:system-ui;">
        <div style="font-weight:900; margin-bottom:6px;">איתור בית: ${escapeHtml(houseSite)}</div>
        <div style="opacity:.85; font-size:12px;">זמן: ${escapeHtml(fmtShortTime(r.eventTimeISO || r.eventTimeLocal || ""))}</div>
        <div style="opacity:.85; font-size:12px;">גזרה: ${escapeHtml(r.sector || "—")}</div>
        <div style="opacity:.85; font-size:12px;">ממלא: ${escapeHtml(r.fillerName || "—")}</div>
        <div style="opacity:.8; font-size:12px; margin-top:6px;">Lat/Lng: ${escapeHtml(lat)}, ${escapeHtml(lng)}</div>
      </div>`;
    marker.bindPopup(popupHtml);

    mapState.markerById.set(r.id, marker);
    mapState.cluster.addLayer(marker);
  }

  // Fit bounds פעם אחת (כדי לא "לקפוץ" למשתמש כל עדכון)
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
  const c = $("attachmentCount");
  if (c) c.value = "";
  const det = $("detention");
  if (det) det.value = "ללא";
  populatePlaceSelect("place", "", true);
});

let currentGPS = null;

function setGPSStatus(text, muted = false) {
  const el = $("gpsStatus");
  if (!el) return;
  el.textContent = `GPS: ${text}`;
  el.classList.toggle("muted", muted);
}

function renderGPSPreview(gps) {
  const lat = $("latVal"),
    lng = $("lngVal"),
    acc = $("accVal");
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

$("btnAddPlace")?.addEventListener("click", async () => {
  if (!isAdmin) return;
  const raw = $("newPlaceInput")?.value || "";
  const place = normalizePlaceName(raw);
  if (!place) {
    setToast($("formToast"), "bad", "יש להזין מקום תקין");
    return;
  }
  try {
    const id = getPlaceKey(place).replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || `place_${Date.now()}`;
    await setDoc(doc(db, PLACES_COLLECTION, id), {
      name: place,
      nameLower: getPlaceKey(place),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge: true });
    if ($("newPlaceInput")) $("newPlaceInput").value = "";
    if ($("place")) $("place").value = place;
    setToast($("formToast"), "ok", `המקום "${place}" נוסף`);
  } catch (e) {
    console.error(e);
    setToast($("formToast"), "bad", "שגיאה בהוספת מקום");
  }
});

$("btnPickGPSFromMap")?.addEventListener("click", () => {
  $("locContext").value = "form";
  openLocModalForForm();
});

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
  const place = normalizePlaceName($("place")?.value);
  const attachmentCountRaw = $("attachmentCount")?.value;
  const attachmentCount = Number(attachmentCountRaw);

  if (!eventTimeLocal || !sector || !houseSite || !place) {
    if (toast) setToast(toast, "bad", "חסרים שדות חובה: זמן/תאריך, גזרה, איתור בית, מקום");
    return;
  }

  if (!Number.isInteger(attachmentCount) || attachmentCount < 0) {
    if (toast) setToast(toast, "bad", "כמות הצמדות חייבת להיות מספר שלם 0 ומעלה");
    return;
  }

  const payload = {
    eventTimeLocal,
    eventTimeISO: parseDatetimeLocalToISO(eventTimeLocal),
    fillerName: ($("fillerName")?.value ?? "").trim(),
    sector,
    houseSite,
    place,
    gps: currentGPS,
    status: {
      hasAttachment: attachmentCount > 0,
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

    // 1) Write full record (admin-only read)
    const ref = await addDoc(collection(db, COLLECTION_NAME), payload);

    // 2) Write/overwrite public pin (readable by everyone)
    await syncMapPinForRow(ref.id, payload);

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
let recordsSort = { key: "eventTimeISO", dir: "desc" };

function destroyChartSafe(instance, canvasId) {
  try {
    instance?.destroy?.();
  } catch (_) {}

  try {
    const existing = window.Chart?.getChart?.(canvasId) || window.Chart?.getChart?.($(canvasId));
    if (existing) existing.destroy();
  } catch (_) {}
}

function initCharts(forceRecreate = false) {
  const ctx1 = $("chartBySector");
  const ctx2 = $("chartDetention");
  if (!ctx1 || !ctx2 || typeof Chart === "undefined") return;

  if (forceRecreate) {
    destroyChartSafe(chartBySector, "chartBySector");
    destroyChartSafe(chartDetention, "chartDetention");
    chartBySector = null;
    chartDetention = null;
  }

  if (!chartBySector) {
    destroyChartSafe(null, "chartBySector");
    chartBySector = new Chart(ctx1, {
      type: "bar",
      data: {
        labels: SECTORS,
        datasets: [{ label: "כמות איתורים (רשומות)", data: SECTORS.map(() => 0) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        resizeDelay: 150,
        plugins: { legend: { display: true } }
      }
    });
  }

  if (!chartDetention) {
    destroyChartSafe(null, "chartDetention");
    chartDetention = new Chart(ctx2, {
      type: "doughnut",
      data: {
        labels: SECTORS,
        datasets: [{ label: "הצמדות לפי גזרה", data: SECTORS.map(() => 0) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        resizeDelay: 150,
        plugins: { legend: { position: "bottom" } }
      }
    });
  }
}

function getDashboardFilteredRows(rows) {
  const placeFilter = normalizePlaceName($("dashboardPlaceFilter")?.value);
  if (!placeFilter) return rows;
  return rows.filter((r) => normalizePlaceName(r.place) === placeFilter);
}

function computeAggregates(rows) {
  const bySector = Object.fromEntries(
    SECTORS.map((s) => [
      s,
      {
        total: 0,
        weapon: 0,
        attachments: 0,
        detentionCounts: Object.fromEntries(DETENTION_OPTIONS.map((x) => [x, 0]))
      }
    ])
  );

  const overall = {
    total: 0,
    weapon: 0,
    attachments: 0,
    detentionCounts: Object.fromEntries(DETENTION_OPTIONS.map((x) => [x, 0]))
  };

  for (const r of rows) {
    const s = SECTORS.includes(r.sector) ? r.sector : "אחר";
    const det = DETENTION_OPTIONS.includes(r.status.detention) ? r.status.detention : "ללא";

    bySector[s].total += 1;
    overall.total += 1;

    if (r.status.weaponScan) {
      bySector[s].weapon += 1;
      overall.weapon += 1;
    }

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

  initCharts(false);

  const filteredRows = getDashboardFilteredRows(rows);
  const { bySector, overall } = computeAggregates(filteredRows);

  $("totalRecords").textContent = filteredRows.length;
  $("kpiCompleted").textContent = overall.total;
  $("kpiWeapon").textContent = overall.weapon;
  $("kpiAttachments").textContent = overall.attachments;

  $("lastUpdate").textContent = fmtShortTime(new Date());

  if (chartBySector) {
    chartBySector.data.datasets[0].data = SECTORS.map((s) => bySector[s].total);
    chartBySector.update("none");
  }

  if (chartDetention) {
    chartDetention.data.labels = SECTORS;
    chartDetention.data.datasets[0].data = SECTORS.map((s) => bySector[s].attachments ?? 0);
    chartDetention.update("none");
  }

  const wrap = $("sectorCards");
  if (wrap) {
    wrap.innerHTML = "";
    for (const s of SECTORS) {
      const ag = bySector[s];
      const detTop = DETENTION_OPTIONS.map((k) => ({ k, v: ag.detentionCounts[k] ?? 0 })).sort((a, b) => b.v - a.v)[0];

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
$("placeFilter")?.addEventListener("change", () => renderRecords(liveRows));
$("dashboardPlaceFilter")?.addEventListener("change", () => renderDashboard(liveRows));
$("btnExportCsv")?.addEventListener("click", exportAllRowsToCsv);

document.querySelectorAll("th.sortable[data-sort-key]").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sortKey;
    if (!key) return;
    if (recordsSort.key === key) recordsSort.dir = recordsSort.dir === "asc" ? "desc" : "asc";
    else recordsSort = { key, dir: "asc" };
    updateSortIndicators();
    renderRecords(liveRows);
  });
});
updateSortIndicators();

function getSortValue(row, key) {
  switch (key) {
    case "eventTimeISO": return row?.eventTimeISO || row?.eventTimeLocal || "";
    case "fillerName": return normalizeText(row?.fillerName);
    case "sector": return normalizeText(row?.sector);
    case "houseSite": return normalizeText(row?.houseSite);
    case "place": return normalizeText(row?.place);
    case "hasGps": return hasGpsForRecord(row) ? 1 : 0;
    case "weaponScan": return row?.status?.weaponScan ? 1 : 0;
    case "attachmentCount": return row?.status?.hasAttachment ? safeNum(row?.status?.attachmentCount, 0) : 0;
    case "detention": return normalizeText(row?.status?.detention);
    default: return "";
  }
}

function compareRows(a, b, key, dir) {
  const av = getSortValue(a, key);
  const bv = getSortValue(b, key);
  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv), "he", { numeric: true, sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

function updateSortIndicators() {
  document.querySelectorAll("th.sortable[data-sort-key]").forEach((th) => {
    const mark = th.querySelector(".sortMark");
    if (!mark) return;
    const key = th.dataset.sortKey;
    if (key === recordsSort.key) mark.textContent = recordsSort.dir === "asc" ? "▲" : "▼";
    else mark.textContent = "";
  });
}

function buildFilteredSortedRows(rows) {
  const qText = normalizeText($("searchBox")?.value);
  const sectorFilter = $("sectorFilter")?.value;
  const placeFilter = $("placeFilter")?.value;

  const filtered = rows.filter((r) => {
    if (sectorFilter && r.sector !== sectorFilter) return false;
    if (placeFilter && normalizePlaceName(r.place) !== placeFilter) return false;
    if (!qText) return true;
    const hay = [r.fillerName, r.sector, r.houseSite, r.place, r.status?.detention, r.notes].map(normalizeText).join(" | ");
    return hay.includes(qText);
  });

  return [...filtered].sort((a, b) => compareRows(a, b, recordsSort.key, recordsSort.dir));
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return '"' + s.replaceAll('"', '""') + '"';
}

function exportAllRowsToCsv() {
  if (!isAdmin) return;
  const rows = [...liveRows].sort((a, b) => compareRows(a, b, "eventTimeISO", "desc"));
  const headers = [
    "id", "eventTimeLocal", "eventTimeISO", "fillerName", "sector", "houseSite", "place",
    "hasGps", "lat", "lng", "accuracy", "hasAttachment", "attachmentCount",
    "weaponScan", "mapping", "detention", "notes"
  ];
  const lines = [headers.map(csvEscape).join(",")];

  for (const r of rows) {
    const line = [
      r.id,
      r.eventTimeLocal || "",
      r.eventTimeISO || "",
      r.fillerName || "",
      r.sector || "",
      r.houseSite || "",
      r.place || "",
      hasGpsForRecord(r) ? "כן" : "לא",
      r?.gps?.lat ?? "",
      r?.gps?.lng ?? "",
      r?.gps?.accuracy ?? "",
      r?.status?.hasAttachment ? "כן" : "לא",
      r?.status?.hasAttachment ? safeNum(r?.status?.attachmentCount, 0) : 0,
      r?.status?.weaponScan ? "כן" : "לא",
      r?.status?.mapping ? "כן" : "לא",
      r?.status?.detention || "",
      r.notes || ""
    ];
    lines.push(line.map(csvEscape).join(","));
  }

const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  a.href = url;
  a.download = `house-scans-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderRecords(rows) {
  if (!isAdmin) return;

  const tbody = $("recordsTbody");
  const empty = $("emptyState");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";

  const filtered = buildFilteredSortedRows(rows);

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
      <td>${hasGpsForRecord(r) ? "כן" : "לא"}</td>
      <td>${r.status.weaponScan ? "כן" : "לא"}</td>
      <td>${r.status.hasAttachment ? `כן (${safeNum(r.status.attachmentCount, 0)})` : "לא"}</td>
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

  tbody.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const row = liveRows.find((x) => x.id === id);
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

    // Also remove public map pin (best-effort)
    try {
      await deleteDoc(doc(db, MAP_COLLECTION, row.id));
    } catch (_) {}
  } catch (e) {
    console.error(e);
    alert("שגיאה במחיקה");
  }
}

// ===================== EDIT MODAL =====================
const modal = $("editModal");
let currentEditRow = null;

function openEditModal(row) {
  if (!isAdmin || !row) return;

  currentEditRow = row;
  const status = row.status ?? {};

  $("editId").value = row.id;
  $("editEventTime").value = row.eventTimeLocal || toDatetimeLocalValue(new Date(row.eventTimeISO || Date.now()));
  $("editFillerName").value = row.fillerName || "";
  $("editSector").value = SECTORS.includes(row.sector) ? row.sector : "אחר";
  $("editHouseSite").value = row.houseSite || "";
  populatePlaceSelect("editPlace", row.place || "", true);

  const gps = row.gps ?? null;
  if ($("editLatInput")) $("editLatInput").value = gps?.lat ?? "";
  if ($("editLngInput")) $("editLngInput").value = gps?.lng ?? "";
  if ($("editAccInput")) $("editAccInput").value = gps?.accuracy ?? "";

  $("editWeaponScan").checked = !!status.weaponScan;
  $("editMapping").checked = !!status.mapping;
  $("editDetention").value = DETENTION_OPTIONS.includes(status.detention) ? status.detention : "ללא";
  $("editAttachmentCount").value = Math.max(0, safeNum(status.attachmentCount, 0));

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

// ===================== REFINE LOCATION (MAP PICKER) =====================
const locModal = $("locModal");
let refineState = {
  map: null,
  marker: null,
  docId: null,
  baseGps: null
};

function getGeneralCenter() {
  const rows = Array.isArray(mapRows) && mapRows.length ? mapRows : liveRows;
  const pts = [];
  for (const r of rows) {
    const g = r?.gps;
    if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) pts.push([g.lat, g.lng]);
  }
  if (!pts.length) return { center: [31.7, 35.2], zoom: 9 };

  const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { center: [lat, lng], zoom: 15 };
}

function makeGreenIcon(px = 14) {
  const s = Number(px) || 14;
  return L.divIcon({
    className: "",
    html: `<div style="width:${s}px;height:${s}px;border-radius:999px;background:rgba(25,195,125,0.95);box-shadow:0 0 0 2px rgba(25,195,125,0.22);border:1px solid rgba(0,0,0,0.35);"></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2]
  });
}

function openLocModal(baseGps = null) {
  if (typeof L === "undefined") {
    alert("Map library not loaded");
    return;
  }

  refineState.baseGps = baseGps ?? null;

  locModal?.classList.add("show");
  locModal?.setAttribute("aria-hidden", "false");

  window.setTimeout(() => {
    const el = document.getElementById("refineMap");
    if (!el) return;

    if (!refineState.map) {
      const { center, zoom } = getGeneralCenter();
      refineState.map = L.map(el, {
        zoomControl: true,
        preferCanvas: true,
        worldCopyJump: true
      }).setView(center, zoom);

      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Tiles © Esri"
      }).addTo(refineState.map);

      refineState.map.on("click", (e) => {
        const ll = e.latlng;
        if (!refineState.marker) {
          refineState.marker = L.marker(ll, { draggable: true, icon: makeGreenIcon(14) }).addTo(refineState.map);
        } else {
          refineState.marker.setLatLng(ll);
        }
      });
    }

    try {
      refineState.map.invalidateSize();
    } catch (_) {}

    const g = refineState.baseGps;
    if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) {
      const pos = [g.lat, g.lng];
      refineState.map.setView(pos, 18);
      if (!refineState.marker) {
        refineState.marker = L.marker(pos, { draggable: true, icon: makeGreenIcon(14) }).addTo(refineState.map);
      } else {
        refineState.marker.setLatLng(pos);
      }
    } else {
      const { center, zoom } = getGeneralCenter();
      refineState.map.setView(center, zoom);
      if (refineState.marker) {
        try {
          refineState.map.removeLayer(refineState.marker);
        } catch (_) {}
        refineState.marker = null;
      }
    }
  }, 120);
}

function openLocModalForRow(row) {
  if (!isAdmin || !row) return;
  refineState.docId = row.id;
  $("locContext").value = "edit";
  openLocModal(row.gps ?? null);
}

function closeLocModal() {
  locModal?.classList.remove("show");
  locModal?.setAttribute("aria-hidden", "true");
}

$("btnRefineLocation")?.addEventListener("click", () => openLocModalForRow(currentEditRow));
$("btnCloseLoc")?.addEventListener("click", closeLocModal);
$("btnCancelLoc")?.addEventListener("click", closeLocModal);

locModal?.addEventListener("click", (e) => {
  if (e.target === locModal) closeLocModal();
});

$("btnConfirmLoc")?.addEventListener("click", async () => {
  const toast = $("locToast");
  const ctx = $("locContext")?.value || "edit";

  if (!refineState.marker) {
    if (toast) setToast(toast, "bad", "בחר נקודה על המפה");
    return;
  }

  const ll = refineState.marker.getLatLng();
  const baseAcc = refineState.baseGps?.accuracy ?? null;
  const gpsPatch = {
    lat: Number(ll.lat.toFixed(6)),
    lng: Number(ll.lng.toFixed(6)),
    accuracy: baseAcc,
    capturedAt: new Date().toISOString(),
    refinedFromMap: true
  };

  if (ctx === "form") {
    applyFormGps(gpsPatch);
    if (toast) setToast(toast, "ok", "המיקום נשמר לטופס ✅");
    window.setTimeout(closeLocModal, 300);
    return;
  }

  if (!isAdmin || !refineState.docId) return;

  const patch = {
    gps: gpsPatch,
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, refineState.docId), patch);

    try {
      await syncMapPinForRow(refineState.docId, {
        sector: currentEditRow?.sector ?? "אחר",
        houseSite: currentEditRow?.houseSite ?? "",
        place: currentEditRow?.place ?? "",
        eventTimeISO: currentEditRow?.eventTimeISO ?? null,
        eventTimeLocal: currentEditRow?.eventTimeLocal ?? "",
        gps: patch.gps
      });
    } catch (e2) {
      console.warn("Failed to update public pin:", e2);
    }

    if (toast) setToast(toast, "ok", "מיקום עודכן ✅");

    try {
      if ($("editLatInput")) $("editLatInput").value = patch.gps.lat ?? "";
      if ($("editLngInput")) $("editLngInput").value = patch.gps.lng ?? "";
      if ($("editAccInput")) $("editAccInput").value = patch.gps.accuracy ?? "";
      if (currentEditRow && currentEditRow.id === refineState.docId) currentEditRow.gps = patch.gps;
    } catch (_) {}

    window.setTimeout(closeLocModal, 450);
  } catch (e) {
    console.error(e);
    if (toast) setToast(toast, "bad", "שגיאה בעדכון מיקום");
  }
});

$("btnClearEditGps")?.addEventListener("click", () => {
  if ($("editLatInput")) $("editLatInput").value = "";
  if ($("editLngInput")) $("editLngInput").value = "";
  if ($("editAccInput")) $("editAccInput").value = "";
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
  const houseSite = $("editHouseSite")?.value?.trim();
  const place = normalizePlaceName($("editPlace")?.value);
  const attachmentCount = Number($("editAttachmentCount").value);

  if (!id || !eventTimeLocal || !sector || !houseSite || !place) {
    if (toast) setToast(toast, "bad", "חסרים שדות חובה");
    return;
  }

  if (!Number.isInteger(attachmentCount) || attachmentCount < 0) {
    if (toast) setToast(toast, "bad", "כמות הצמדות חייבת להיות מספר שלם 0 ומעלה");
    return;
  }

  const latRaw = $("editLatInput")?.value?.trim();
  const lngRaw = $("editLngInput")?.value?.trim();
  const accRaw = $("editAccInput")?.value?.trim();

  const lat = latRaw === "" ? null : Number(latRaw);
  const lng = lngRaw === "" ? null : Number(lngRaw);
  const accuracy = accRaw === "" ? null : Number(accRaw);

  const hasManualGps =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180;

  const patch = {
    eventTimeLocal,
    eventTimeISO: parseDatetimeLocalToISO(eventTimeLocal),
    fillerName: ($("editFillerName").value ?? "").trim(),
    sector,
    houseSite,
    place,
    gps: hasManualGps
      ? {
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
          capturedAt: new Date().toISOString(),
          editedManually: true
        }
      : null,
    status: {
      hasAttachment: attachmentCount > 0,
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

    // Keep public pin in sync (sector/house/time might have changed)
    try {
      await syncMapPinForRow(id, patch);
    } catch (e2) {
      console.warn("Failed to update public pin:", e2);
    }

    if (toast) setToast(toast, "ok", "עודכן ✅");
    window.setTimeout(closeModal, 650);
  } catch (err) {
    console.error(err);
    if (toast) setToast(toast, "bad", "שגיאה בעדכון");
  }
});

// ===================== ADMIN GATE + REALTIME LISTENER =====================
let unsubAdmin = null;
let unsubMap = null;
let mapRows = [];

let unsubPlaces = null;

function startPlacesListener() {
  try {
    unsubPlaces?.();
  } catch (_) {}

    unsubPlaces = onSnapshot(
    collection(db, PLACES_COLLECTION),
    (snap) => {
      const rows = [];
      snap.forEach((d) => {
        const data = d.data() || {};
        const name = normalizePlaceName(data.name || d.id || "");
        if (name) rows.push(name);
      });
      allPlaces = uniquePlacesSorted(rows);
      refreshPlaceOptions();
      refreshVisibleViews();
    },
    (err) => {
      console.error("places listener failed:", err);
    }
  );
}

function openLocModalForForm() {
  refineState.docId = null;
  $("locContext").value = "form";
  openLocModal(currentGPS);
}

function applyFormGps(gps) {
  currentGPS = gps;
  renderGPSPreview(currentGPS);
  setGPSStatus("נשמר", false);
}

function stopListeners() {
  try {
    unsubAdmin?.();
  } catch (_) {}
  try {
    unsubMap?.();
  } catch (_) {}
  try {
    unsubPlaces?.();
  } catch (_) {}
  unsubAdmin = null;
  unsubMap = null;
  unsubPlaces = null;
}

/**
 * Repair helper בלבד.
 * לא רץ אוטומטית על כל snapshot כדי לא לחסום עריכה/מחיקה
 * ולא לייצר טעינה מלאה של mapPins אחרי כל שינוי קטן.
 */
let _backfillRunning = false;
async function backfillMapPinsFromHouseScans(rows) {
  if (!isAdmin) return;
  if (_backfillRunning) return;
  if (!Array.isArray(rows) || rows.length === 0) return;

  _backfillRunning = true;
  try {
    let count = 0;

    for (const r of rows) {
      if (!r?.id) continue;

      const pin = {
        sector: r.sector ?? "אחר",
        houseSite: r.houseSite ?? "",
        place: r.place ?? "",
        eventTimeISO: r.eventTimeISO ?? null,
        eventTimeLocal: r.eventTimeLocal ?? "",
        gps: r.gps ?? null,
        updatedAt: serverTimestamp()
      };

      try {
        await setDoc(doc(db, MAP_COLLECTION, r.id), pin, { merge: true });
        count++;
      } catch (e) {
        console.warn("backfill pin failed:", r.id, e);
      }
    }

    console.log("backfillMapPinsFromHouseScans done:", count);
  } finally {
    _backfillRunning = false;
  }
}


async function syncMapPinForRow(id, patch) {
  if (!id) return;
  await setDoc(
    doc(db, MAP_COLLECTION, id),
    {
      sector: patch?.sector ?? "אחר",
      houseSite: patch?.houseSite ?? "",
      place: patch?.place ?? "",
      eventTimeISO: patch?.eventTimeISO ?? null,
      eventTimeLocal: patch?.eventTimeLocal ?? "",
      gps: patch?.gps ?? null,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

function startPublicMapListener() {
  try {
    unsubMap?.();
  } catch (_) {}

  // ✅ orderBy stable field (exists on all pins)
  const q = query(collection(db, MAP_COLLECTION), orderBy("updatedAt", "desc"));

  unsubMap = onSnapshot(
    q,
    (snap) => {
      // console.log("mapPins snapshot size:", snap.size);

      const rows = [];
      snap.forEach((d) => {
        const data = d.data();
        rows.push({
          id: d.id,
          sector: data.sector ?? "אחר",
          houseSite: data.houseSite ?? "",
          place: data.place ?? "",
          eventTimeISO: data.eventTimeISO ?? null,
          eventTimeLocal: data.eventTimeLocal ?? "",
          gps: data.gps ?? null
        });
      });

      // ✅ חשוב: mapRows חייב להתעדכן מהקולקשן הציבורי בלבד
      mapRows = rows;

      // מפה חופשית לכולם
      renderMap(mapRows);
    },
    (err) => {
      console.error(err);
      const hint = $("mapHint");
      if (hint) hint.textContent = "שגיאה בטעינת מפה (בדוק הרשאות קריאה)";
    }
  );
}

function startAdminListener() {
  if (!isAdmin) return;

  initCharts(false);

  try {
    unsubAdmin?.();
  } catch (_) {}

  const q = query(collection(db, COLLECTION_NAME), orderBy("eventTimeISO", "desc"));
  unsubAdmin = onSnapshot(
    q,
    (snap) => {
      setRtStatus(true, "מחובר ל-DB: כן (Admin)");

      const rows = [];
      snap.forEach((d) => {
        const data = d.data();
        rows.push({
          id: d.id,
          ...data,
          sector: data.sector ?? "אחר",
          fillerName: data.fillerName ?? "",
          houseSite: data.houseSite ?? "",
          place: data.place ?? "",
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
      allPlaces = uniquePlacesSorted([...(allPlaces || []), ...rows.map((r) => r.place)]);
      refreshPlaceOptions();

      refreshVisibleViews();
    },
    (err) => {
      console.error(err);
      setRtStatus(false, "מחובר ל-DB: שגיאה (בדוק הרשאות)");
    }
  );
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

  // מאזינים בהתאם להרשאות:
  // - מפה: חופשית לכולם
  // - דשבורד + רשומות: אדמין בלבד
  stopListeners();
  startPlacesListener();
  startPublicMapListener();

  if (isAdmin) {
    startAdminListener();
  } else {
    setRtStatus(true, "מחובר ל-DB: כן (מילוי בלבד)");
  }

  window.setTimeout(refreshVisibleViews, 120);
});

