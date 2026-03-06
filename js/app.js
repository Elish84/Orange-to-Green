
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
const SECTORS = ["א'","ב'","ג'","מסייעת","גדוד","אחר"];
const DETENTION_OPTIONS = ["ללא","נלקח לחקירה","תושאל טלפונית","עצור"];

// ===================== INIT =====================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
let isAdmin = false;

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

function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function setEditGpsFields(gps) {
  const latInput = $("editLatInput");
  const lngInput = $("editLngInput");
  const accInput = $("editAccInput");
  if (latInput) latInput.value = Number.isFinite(gps?.lat) ? String(gps.lat) : "";
  if (lngInput) lngInput.value = Number.isFinite(gps?.lng) ? String(gps.lng) : "";
  if (accInput) accInput.value = Number.isFinite(gps?.accuracy) ? String(gps.accuracy) : "";
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
function refreshVisibleTabData(tab) {
  const activeTab = tab || document.querySelector(".tab.active")?.dataset?.tab;

  if (activeTab === "map") {
    initMapIfNeeded();
    window.setTimeout(() => {
      try {
        mapState?.map?.invalidateSize?.();
      } catch (_) {}
    }, 80);
    renderMap(Array.isArray(mapRows) ? mapRows : []);
    return;
  }

  if ((activeTab === "dashboard" || activeTab === "records") && isAdmin) {
    if (activeTab === "dashboard") renderDashboard(liveRows);
    if (activeTab === "records") renderRecords(liveRows);
  }
}

function restartRelevantListeners() {
  try {
    unsubMap?.();
  } catch (_) {}
  unsubMap = null;
  startPublicMapListener();

  if (isAdmin) {
    try {
      unsubAdmin?.();
    } catch (_) {}
    unsubAdmin = null;
    startAdminListener();
  }
}

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

    restartRelevantListeners();
    refreshVisibleTabData(tab);
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  restartRelevantListeners();
  refreshVisibleTabData();
});

window.addEventListener("pageshow", () => {
  restartRelevantListeners();
  refreshVisibleTabData();
});

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

    // 1) Write full record (admin-only read)
    const ref = await addDoc(collection(db, COLLECTION_NAME), payload);

    // 2) Write/overwrite public pin (readable by everyone)
    await setDoc(doc(db, MAP_COLLECTION, ref.id), {
      sector: payload.sector,
      houseSite: payload.houseSite,
      eventTimeISO: payload.eventTimeISO,
      eventTimeLocal: payload.eventTimeLocal,
      gps: payload.gps ?? null,
      updatedAt: serverTimestamp()
    });

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

  const { bySector, overall } = computeAggregates(rows);

  $("totalRecords").textContent = rows.length;
  $("kpiCompleted").textContent = overall.total;
  $("kpiWeapon").textContent = overall.weapon;
  $("kpiAttachments").textContent = overall.attachments;

  $("lastUpdate").textContent = fmtShortTime(new Date());

  if (chartBySector) {
    chartBySector.data.datasets[0].data = SECTORS.map((s) => bySector[s].total);
    chartBySector.update();
  }

  if (chartDetention) {
    chartDetention.data.datasets[0].data = DETENTION_OPTIONS.map((k) => overall.detentionCounts[k] ?? 0);
    chartDetention.update();
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

function renderRecords(rows) {
  if (!isAdmin) return;

  const tbody = $("recordsTbody");
  const empty = $("emptyState");
  if (!tbody || !empty) return;

  tbody.innerHTML = "";

  const qText = normalizeText($("searchBox")?.value);
  const sectorFilter = $("sectorFilter")?.value;

  const filtered = rows.filter((r) => {
    if (sectorFilter && r.sector !== sectorFilter) return false;
    if (!qText) return true;
    const hay = [r.fillerName, r.sector, r.houseSite, r.status?.detention, r.notes].map(normalizeText).join(" | ");
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
  if (!isAdmin) return;

  currentEditRow = row;

  $("editId").value = row.id;
  $("editEventTime").value = row.eventTimeLocal || toDatetimeLocalValue(new Date(row.eventTimeISO || Date.now()));
  $("editFillerName").value = row.fillerName || "";
  $("editSector").value = SECTORS.includes(row.sector) ? row.sector : "אחר";
  $("editHouseSite").value = row.houseSite || "";

  const gps = row.gps ?? null;
  setEditGpsFields(gps);

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

function openLocModalForRow(row) {
  if (!isAdmin) return;
  if (!row) return;
  if (typeof L === "undefined") {
    alert("Map library not loaded");
    return;
  }

  refineState.docId = row.id;
  refineState.baseGps = row.gps ?? null;

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
      // בלי GPS קיים — מציבים את המפה באזור כללי ומחכים ללחיצה
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
  if (!isAdmin) return;
  const toast = $("locToast");

  if (!refineState.marker) {
    if (toast) setToast(toast, "bad", "בחר נקודה על המפה");
    return;
  }

  const ll = refineState.marker.getLatLng();
  const baseAcc = refineState.baseGps?.accuracy ?? null;

  const patch = {
    gps: {
      lat: Number(ll.lat.toFixed(6)),
      lng: Number(ll.lng.toFixed(6)),
      accuracy: baseAcc,
      capturedAt: new Date().toISOString(),
      refinedFromMap: true
    },
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, refineState.docId), patch);

    // Keep public pin in sync (map is public)
    try {
      await setDoc(
        doc(db, MAP_COLLECTION, refineState.docId),
        {
          sector: currentEditRow?.sector ?? "אחר",
          houseSite: currentEditRow?.houseSite ?? "",
          eventTimeISO: currentEditRow?.eventTimeISO ?? null,
          eventTimeLocal: currentEditRow?.eventTimeLocal ?? "",
          gps: patch.gps,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (e2) {
      console.warn("Failed to update public pin:", e2);
    }

    if (toast) setToast(toast, "ok", "מיקום עודכן ✅");

    // עדכון מיידי ב-UI (גם לפני ה-snapshot הבא)
    try {
      setEditGpsFields(patch.gps);
      if (currentEditRow && currentEditRow.id === refineState.docId) currentEditRow.gps = patch.gps;
    } catch (_) {}

    window.setTimeout(closeLocModal, 450);
  } catch (e) {
    console.error(e);
    if (toast) setToast(toast, "bad", "שגיאה בעדכון מיקום");
  }
});

$("editHasAttachment")?.addEventListener("change", (e) => {
  $("editAttachmentCountWrap").style.display = e.target.checked ? "block" : "none";
  if (!e.target.checked) $("editAttachmentCount").value = 1;
});

$("btnClearEditGps")?.addEventListener("click", () => {
  setEditGpsFields(null);
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

  if (!id || !eventTimeLocal || !sector || !houseSite) {
    if (toast) setToast(toast, "bad", "חסרים שדות חובה");
    return;
  }

  const hasAttachment = $("editHasAttachment").checked;
  const attachmentCount = hasAttachment ? Math.max(1, safeNum($("editAttachmentCount").value, 1)) : 0;

  const latVal = parseOptionalNumber($("editLatInput")?.value);
  const lngVal = parseOptionalNumber($("editLngInput")?.value);
  const accVal = parseOptionalNumber($("editAccInput")?.value);

  if (Number.isNaN(latVal) || Number.isNaN(lngVal) || Number.isNaN(accVal)) {
    if (toast) setToast(toast, "bad", "ערכי GPS לא תקינים");
    return;
  }

  if ((latVal === null) !== (lngVal === null)) {
    if (toast) setToast(toast, "bad", "כדי לעדכן GPS ידנית צריך גם Lat וגם Lng");
    return;
  }

  if (latVal !== null && (latVal < -90 || latVal > 90 || lngVal < -180 || lngVal > 180)) {
    if (toast) setToast(toast, "bad", "Lat/Lng מחוץ לטווח התקין");
    return;
  }

  const manualGps = latVal === null
    ? null
    : {
        lat: Number(latVal.toFixed(6)),
        lng: Number(lngVal.toFixed(6)),
        accuracy: accVal === null ? null : Number(accVal.toFixed(1)),
        capturedAt: currentEditRow?.gps?.capturedAt ?? new Date().toISOString(),
        refinedFromMap: currentEditRow?.gps?.refinedFromMap ?? false,
        editedManually: true
      };

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
    gps: manualGps,
    updatedAt: serverTimestamp()
  };

  try {
    await updateDoc(doc(db, COLLECTION_NAME, id), patch);

    // Keep public pin in sync (sector/house/time might have changed)
    try {
      await setDoc(
        doc(db, MAP_COLLECTION, id),
        {
          sector: patch.sector,
          houseSite: patch.houseSite,
          eventTimeISO: patch.eventTimeISO,
          eventTimeLocal: patch.eventTimeLocal,
          gps: patch.gps,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (e2) {
      console.warn("Failed to update public pin:", e2);
    }

    if (currentEditRow && currentEditRow.id === id) {
      currentEditRow = { ...currentEditRow, ...patch, gps: patch.gps };
    }

    if (toast) setToast(toast, "ok", "עודכן ✅");
    refreshVisibleTabData("records");
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

function stopListeners() {
  try {
    unsubAdmin?.();
  } catch (_) {}
  try {
    unsubMap?.();
  } catch (_) {}
  unsubAdmin = null;
  unsubMap = null;
}

/**
 * Backfill: מסנכרן מסמכים קיימים מ-houseScans אל mapPins,
 * כדי שמשתמשים לא-אדמין יראו גם נתונים "ישנים" במפה.
 * רץ רק לאדמין.
 */
let _backfillRunning = false;
async function backfillMapPinsFromHouseScans(rows) {
  if (!isAdmin) return;
  if (_backfillRunning) return; // הגנה מפני ריצה מקבילית
  if (!Array.isArray(rows) || rows.length === 0) return;

  _backfillRunning = true;
  try {
    let count = 0;

    for (const r of rows) {
      if (!r?.id) continue;

      // pin ציבורי מינימלי
      const pin = {
        sector: r.sector ?? "אחר",
        houseSite: r.houseSite ?? "",
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

function startPublicMapListener() {
  try {
    unsubMap?.();
  } catch (_) {}

  // ✅ orderBy stable field (exists on all pins)
  const q = query(collection(db, MAP_COLLECTION), orderBy("updatedAt", "desc"));

  unsubMap = onSnapshot(
    q,
    (snap) => {
      console.log("mapPins snapshot size:", snap.size);

      const rows = [];
      snap.forEach((d) => {
        const data = d.data();
        rows.push({
          id: d.id,
          sector: data.sector ?? "אחר",
          houseSite: data.houseSite ?? "",
          eventTimeISO: data.eventTimeISO ?? null,
          eventTimeLocal: data.eventTimeLocal ?? "",
          gps: data.gps ?? null
        });
      });

      // ✅ חשוב: mapRows חייב להתעדכן מהקולקשן הציבורי בלבד
      mapRows = rows;

      // מפה חופשית לכולם
      renderMap(mapRows);
      refreshVisibleTabData();
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

  initCharts();

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

      // ✅ Backfill: ודא שכל הרשומות קיימות גם ב-mapPins (לציבור)
      backfillMapPinsFromHouseScans(rows);

      renderDashboard(rows);
      renderRecords(rows);

      // ✅ אדמין מצייר בדיוק כמו כולם: רק לפי mapPins
      renderMap(mapRows);
      refreshVisibleTabData();
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
  startPublicMapListener();

  if (isAdmin) {
    startAdminListener();
  } else {
    setRtStatus(true, "מחובר ל-DB: כן (מילוי בלבד)");
  }
});

