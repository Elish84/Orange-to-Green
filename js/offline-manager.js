/**
 * OfflineManager - Handles IndexedDB for form persistence and background syncing.
 */

const DB_NAME = "O2G_OfflineDB";
const STORE_NAME = "offlineQueue";
const DB_VERSION = 1;

let dbInstance = null;

async function initDB() {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "localId" });
        store.createIndex("syncStatus", "syncStatus", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Enqueue a form for offline submission.
 * @param {string} formType - Entity/Form identifier (e.g., 'houseScan')
 * @param {object} payload - The form data
 */
async function enqueuePendingForm(formType, payload) {
  const db = await initDB();
  const localId = `off_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const record = {
    localId,
    formType,
    payload,
    syncStatus: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = () => resolve(localId);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all pending forms from the queue.
 */
async function getPendingForms() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("syncStatus");
    const req = index.getAll("pending");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Mark a form as synced and remove/update it.
 */
async function markFormSynced(localId) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(localId); // Removing once synced to keep DB lean
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Update sync status if failed.
 */
async function markSyncFailed(localId, errorMsg) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(localId);

    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) return resolve();
      record.syncStatus = "failed";
      record.lastError = errorMsg;
      record.retryCount = (record.retryCount || 0) + 1;
      record.updatedAt = new Date().toISOString();
      store.put(record);
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Count pending records.
 */
async function getPendingCount() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("syncStatus");
    const req = index.count("pending");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const OfflineManager = {
  enqueuePendingForm,
  getPendingForms,
  markFormSynced,
  markSyncFailed,
  getPendingCount
};
