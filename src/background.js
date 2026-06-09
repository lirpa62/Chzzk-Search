const SERVICE_API_BASE = "https://api.chzzk.naver.com/service/v1";
const API_BASE = `${SERVICE_API_BASE}/channels`;
const CACHE_TTL_MS = 1 * 60 * 60 * 1000;
const PAGE_SIZE = 50;
const CLIP_PAGE_SIZE = 50;
const SEARCH_CHANNEL_PAGE_SIZE = 33;
const MAX_CONCURRENT_PAGE_REQUESTS = 3;
const MAX_CONCURRENT_COLLECTION_TASKS = 2;
const CHANNEL_SEARCH_COOLDOWN_MS = 900;
const FETCH_RETRY_DELAYS_MS = [500, 1200, 2500];
const CLIP_MISSING_CONFIRMATION_COUNT = 2;
const CLIP_PAGE_THROTTLE_MS = 50;

const CACHE_STORAGE_PREFIX = "cache:";
const CHANNEL_SEARCH_STORAGE_PREFIX = "channelSearch:";
const CACHE_CHUNK_SEPARATOR = "#chunk:";
const CACHE_CHUNK_SIZE = 1000;

const cache = new Map();
const inFlightFetches = new Map();
const channelSearchCache = new Map();
const categoryInfoCache = new Map();
const categoryInfoInFlight = new Map();
const collectionTaskQueue = [];
let activeCollectionTaskCount = 0;
let channelSearchQueue = Promise.resolve();
let lastChannelSearchStartedAt = 0;

const persistentStorage =
  chrome.storage && chrome.storage.local ? chrome.storage.local : null;

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "update") return;

  try {
    const tabs = await chrome.tabs.query({ url: "https://chzzk.naver.com/*" });
    const version = chrome.runtime.getManifest().version;

    await Promise.allSettled(
      tabs
        .filter((tab) => Number.isInteger(tab.id))
        .map((tab) =>
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: showUpdateNotificationBanner,
            args: [version],
          }),
        ),
    );
  } catch (error) {
    console.warn("업데이트 안내 배너를 표시하지 못했습니다.", error);
  }
});

function showUpdateNotificationBanner(version) {
  const bannerId = "cheese-search-ext-update-banner";
  if (document.getElementById(bannerId)) return;

  const banner = document.createElement("div");
  banner.id = bannerId;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:2147483647",
    "box-sizing:border-box",
    "padding:11px 16px",
    "background:linear-gradient(90deg,#e4ce00,#168f5c,#4e41db)",
    "color:#fff",
    "font-family:Arial,sans-serif",
    "font-size:14px",
    "font-weight:600",
    "line-height:20px",
    "text-align:center",
    "box-shadow:0 2px 8px rgba(0,0,0,.2)",
    "transform:translateY(-100%)",
    "transition:transform .3s ease",
  ].join(";");

  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap">
      <span>치즈 서치가 v${version}으로 업데이트되었습니다. 정상적인 사용을 위해 페이지를 새로고침해 주세요.</span>
      <button type="button" data-cheese-search-update-refresh style="border:0;border-radius:5px;padding:5px 10px;background:#fff;color:#087b2b;font-size:13px;font-weight:700;line-height:18px;cursor:pointer">새로고침</button>
      <button type="button" data-cheese-search-update-close aria-label="업데이트 안내 닫기" style="display:inline-flex;align-items:center;justify-content:center;border:0;padding:4px;background:transparent;color:#fff;line-height:1;cursor:pointer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
        </svg>
      </button>
    </div>
  `;

  const root = document.body || document.documentElement;
  root.appendChild(banner);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      banner.style.transform = "translateY(0)";
    });
  });

  const refreshButton = banner.querySelector(
    "[data-cheese-search-update-refresh]",
  );
  const closeButton = banner.querySelector("[data-cheese-search-update-close]");

  refreshButton.addEventListener("click", () => {
    refreshButton.disabled = true;
    refreshButton.textContent = "새로고침 중...";
    location.reload();
  });

  closeButton.addEventListener("click", () => {
    banner.style.transform = "translateY(-100%)";
    setTimeout(() => banner.remove(), 300);
  });
}

const cacheHydration = hydrateCachesFromStorage();

async function hydrateCachesFromStorage() {
  if (!persistentStorage) return;
  try {
    const all = await persistentStorage.get(null);
    const now = Date.now();
    const chunks = new Map();
    const expiredKeysToRemove = [];

    for (const [storageKey, entry] of Object.entries(all || {})) {
      if (!entry || typeof entry !== "object") continue;
      if (storageKey.startsWith(CHANNEL_SEARCH_STORAGE_PREFIX)) {
        channelSearchCache.set(
          storageKey.slice(CHANNEL_SEARCH_STORAGE_PREFIX.length),
          entry,
        );
        continue;
      }
      if (!storageKey.startsWith(CACHE_STORAGE_PREFIX)) continue;
      const rawKey = storageKey.slice(CACHE_STORAGE_PREFIX.length);
      const separatorIndex = rawKey.indexOf(CACHE_CHUNK_SEPARATOR);
      if (separatorIndex < 0) {
        const createdAt = Number(entry?.createdAt || 0);
        if (createdAt && now - createdAt >= CACHE_TTL_MS) {
          expiredKeysToRemove.push(storageKey);
          continue;
        }
        cache.set(rawKey, entry);
        continue;
      }
      const baseKey = rawKey.slice(0, separatorIndex);
      const chunkIndex = Number(
        rawKey.slice(separatorIndex + CACHE_CHUNK_SEPARATOR.length),
      );
      if (!chunks.has(baseKey)) chunks.set(baseKey, []);
      chunks.get(baseKey).push({ chunkIndex, entry, storageKey });
    }

    for (const [baseKey, parts] of chunks.entries()) {
      const meta = cache.get(baseKey);
      const chunkStorageKeys = parts.map((p) => p.storageKey);
      if (!meta?.value || !Number.isInteger(meta.value.__chunkCount)) {
        expiredKeysToRemove.push(...chunkStorageKeys);
        continue;
      }
      parts.sort((a, b) => a.chunkIndex - b.chunkIndex);
      if (parts.length !== meta.value.__chunkCount) {
        cache.delete(baseKey);
        expiredKeysToRemove.push(
          `${CACHE_STORAGE_PREFIX}${baseKey}`,
          ...chunkStorageKeys,
        );
        continue;
      }
      const field = meta.value.__chunkField || "clips";
      const merged = [];
      for (const part of parts) {
        const chunk = part.entry?.value?.[field];
        if (Array.isArray(chunk)) merged.push(...chunk);
      }
      const { __chunkCount: _c, __chunkField: _f, ...rest } = meta.value;
      cache.set(baseKey, {
        ...meta,
        value: { ...rest, [field]: merged },
      });
    }

    if (expiredKeysToRemove.length) {
      try {
        await persistentStorage.remove(expiredKeysToRemove);
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.warn("[CheeseSearch] cache hydration failed", error);
  }
}

async function readCache(key) {
  const hit = cache.get(key);
  if (hit) return hit;
  await cacheHydration;
  return cache.get(key) || null;
}

const CLIP_PERSIST_FIELDS = [
  "clipUID",
  "clipTitle",
  "clipCategory",
  "clipCategoryValue",
  "categoryValue",
  "categoryType",
  "ownerChannelId",
  "thumbnailImageUrl",
  "readCount",
  "duration",
  "publishDateAt",
  "publishDate",
  "createdDate",
  "deletedAt",
  "missingCount",
];

const VIDEO_PERSIST_FIELDS = [
  "videoNo",
  "videoTitle",
  "videoCategory",
  "videoCategoryValue",
  "categoryType",
  "thumbnailImageUrl",
  "duration",
  "readCount",
  "viewCount",
  "livePv",
  "publishDateAt",
  "publishDate",
  "videoType",
  "adult",
  "tags",
  "watchTimeline",
];

function pickFields(item, fields) {
  if (!item || typeof item !== "object") return item;
  const result = {};
  for (const field of fields) {
    if (item[field] !== undefined) result[field] = item[field];
  }
  return result;
}

function slimEntryForPersist(entry) {
  if (!entry?.value) return entry;
  const value = entry.value;
  const slimValue = { ...value };
  if (Array.isArray(value.clips)) {
    slimValue.clips = value.clips.map((clip) =>
      pickFields(clip, CLIP_PERSIST_FIELDS),
    );
  }
  if (Array.isArray(value.allClips)) {
    slimValue.allClips = value.allClips.map((clip) =>
      pickFields(clip, CLIP_PERSIST_FIELDS),
    );
  }
  if (Array.isArray(value.videos)) {
    slimValue.videos = value.videos.map((video) => {
      const slim = pickFields(video, VIDEO_PERSIST_FIELDS);
      const channelObj = video?.channel;
      const channelMeta = channelObj?.channelName
        ? {
            channelId: channelObj.channelId,
            channelName: channelObj.channelName,
            channelImageUrl: channelObj.channelImageUrl,
            verifiedMark: channelObj.verifiedMark,
          }
        : null;
      if (channelMeta) slim.channel = channelMeta;
      return slim;
    });
  }
  return { ...entry, value: slimValue };
}

async function writeCache(key, entry) {
  cache.set(key, entry);
  if (!persistentStorage) return;
  await persistCacheEntry(key, entry);
}

async function persistCacheEntry(key, entry) {
  if (!persistentStorage) return;
  const slimEntry = slimEntryForPersist(entry);

  await removeChunkedStorageEntries(key);
  const writePlan = buildPersistWritePlan(key, slimEntry);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeStoragePlan(writePlan);
      return;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (!/quota/i.test(message)) {
        console.warn("[CheeseSearch] cache persist failed", error);
        await removeChunkedStorageEntries(key);
        return;
      }
      const evicted = await evictOldestCacheEntry(key);
      if (!evicted) {
        console.info(
          "[CheeseSearch] storage quota exhausted — keeping cache in memory only",
        );
        await removeChunkedStorageEntries(key);
        try {
          await persistentStorage.remove(`${CACHE_STORAGE_PREFIX}${key}`);
        } catch {
          // ignore
        }
        return;
      }
    }
  }
}

function buildPersistWritePlan(key, slimEntry) {
  const baseStorageKey = `${CACHE_STORAGE_PREFIX}${key}`;
  const value = slimEntry?.value;
  if (!value) return [{ [baseStorageKey]: slimEntry }];

  const chunkField = Array.isArray(value.clips)
    ? "clips"
    : Array.isArray(value.videos)
      ? "videos"
      : null;
  const list = chunkField ? value[chunkField] : null;
  if (!chunkField || !list || list.length <= CACHE_CHUNK_SIZE) {
    return [{ [baseStorageKey]: slimEntry }];
  }

  const chunks = [];
  for (let i = 0; i < list.length; i += CACHE_CHUNK_SIZE) {
    chunks.push(list.slice(i, i + CACHE_CHUNK_SIZE));
  }
  const { allClips: _allClips, ...metaValueRest } = value;
  const metaValue = {
    ...metaValueRest,
    [chunkField]: [],
    __chunkCount: chunks.length,
    __chunkField: chunkField,
  };
  const writes = [{ [baseStorageKey]: { ...slimEntry, value: metaValue } }];
  chunks.forEach((chunk, index) => {
    const chunkKey = `${baseStorageKey}${CACHE_CHUNK_SEPARATOR}${index}`;
    writes.push({
      [chunkKey]: {
        createdAt: slimEntry.createdAt,
        value: { [chunkField]: chunk },
      },
    });
  });
  return writes;
}

async function writeStoragePlan(writes) {
  for (const write of writes) {
    await persistentStorage.set(write);
  }
}

async function removeChunkedStorageEntries(key) {
  if (!persistentStorage) return;
  const baseStorageKey = `${CACHE_STORAGE_PREFIX}${key}`;
  const prefix = `${baseStorageKey}${CACHE_CHUNK_SEPARATOR}`;
  let all;
  try {
    all = await persistentStorage.get(null);
  } catch {
    return;
  }
  const toRemove = Object.keys(all || {}).filter((storageKey) =>
    storageKey.startsWith(prefix),
  );
  if (!toRemove.length) return;
  try {
    await persistentStorage.remove(toRemove);
  } catch {
    // ignore
  }
}

async function evictOldestCacheEntry(skipKey) {
  if (!persistentStorage) return false;
  let all;
  try {
    all = await persistentStorage.get(null);
  } catch {
    return false;
  }
  let oldestBaseKey = null;
  let oldestCreatedAt = Infinity;
  for (const [storageKey, entry] of Object.entries(all || {})) {
    if (!storageKey.startsWith(CACHE_STORAGE_PREFIX)) continue;
    const rawKey = storageKey.slice(CACHE_STORAGE_PREFIX.length);
    const separatorIndex = rawKey.indexOf(CACHE_CHUNK_SEPARATOR);
    if (separatorIndex >= 0) continue;
    if (rawKey === skipKey) continue;
    const createdAt = Number(entry?.createdAt || 0);
    if (createdAt < oldestCreatedAt) {
      oldestCreatedAt = createdAt;
      oldestBaseKey = rawKey;
    }
  }
  if (!oldestBaseKey) return false;
  const baseStorageKey = `${CACHE_STORAGE_PREFIX}${oldestBaseKey}`;
  const chunkPrefix = `${baseStorageKey}${CACHE_CHUNK_SEPARATOR}`;
  const toRemove = [baseStorageKey];
  for (const storageKey of Object.keys(all)) {
    if (storageKey.startsWith(chunkPrefix)) toRemove.push(storageKey);
  }
  try {
    await persistentStorage.remove(toRemove);
    cache.delete(oldestBaseKey);
    return true;
  } catch {
    return false;
  }
}

async function readChannelSearchCache(key) {
  const hit = channelSearchCache.get(key);
  if (hit) return hit;
  await cacheHydration;
  return channelSearchCache.get(key) || null;
}

function writeChannelSearchCache(key, value) {
  channelSearchCache.set(key, value);
  if (!persistentStorage) return;
  persistentStorage
    .set({ [`${CHANNEL_SEARCH_STORAGE_PREFIX}${key}`]: value })
    .catch((error) => {
      console.warn("[CheeseSearch] channel cache persist failed", error);
    });
}

function cacheKey({ channelId, videoType = "", sortType = "LATEST" }) {
  return `${channelId}:${videoType}:${sortType}`;
}

function clipCacheKey({ channelId, filterType = "ALL", orderType = "RECENT" }) {
  return `clips:${channelId}:${filterType}:${orderType}`;
}

function inFlightKey(request) {
  if (request.contentType === "clips") {
    return `${clipCacheKey(request)}:${request.forceRefresh ? "force" : "normal"}`;
  }
  return `videos:${cacheKey(request)}:${request.forceRefresh ? "force" : "normal"}`;
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeChannelName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

function createAbortError() {
  const error = new Error("검색이 중지되었습니다.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function fetchVideoPage(request) {
  let lastError = null;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      throwIfAborted(request.signal);
      return await fetchVideoPageOnce(request);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (attempt >= FETCH_RETRY_DELAYS_MS.length) break;
      await sleep(FETCH_RETRY_DELAYS_MS[attempt], request.signal);
    }
  }

  throw lastError;
}

async function fetchVideoPageOnce({
  channelId,
  page,
  videoType = "",
  sortType = "LATEST",
  signal,
}) {
  const url = new URL(`${API_BASE}/${channelId}/videos`);
  url.searchParams.set("sortType", sortType);
  url.searchParams.set("pagingType", "PAGE");
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("publishDateAt", "");
  url.searchParams.set("videoType", videoType);

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`CHZZK API 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.code !== 200 || !payload.content) {
    throw new Error(payload.message || "CHZZK API 응답을 읽을 수 없습니다.");
  }

  return payload.content;
}

async function fetchClipPage(request) {
  let lastError = null;

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      throwIfAborted(request.signal);
      return await fetchClipPageOnce(request);
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastError = error;
      if (attempt >= FETCH_RETRY_DELAYS_MS.length) break;
      await sleep(FETCH_RETRY_DELAYS_MS[attempt], request.signal);
    }
  }

  throw lastError;
}

async function fetchClipPageOnce({
  channelId,
  cursor = {},
  filterType = "ALL",
  orderType = "RECENT",
  signal,
}) {
  const url = new URL(`${API_BASE}/${channelId}/clips`);
  url.searchParams.set("clipUID", String(cursor.clipUID || ""));
  url.searchParams.set("filterType", normalizeClipFilterType(filterType));
  url.searchParams.set("orderType", normalizeClipOrderType(orderType));
  url.searchParams.set("size", String(CLIP_PAGE_SIZE));
  url.searchParams.set("readCount", String(cursor.readCount ?? ""));

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`CHZZK 클립 API 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200 || !payload.content) {
    throw new Error(
      payload?.message || "CHZZK 클립 API 응답을 읽을 수 없습니다.",
    );
  }

  return payload.content;
}

async function enrichClipsWithCategoryValues(clips, signal) {
  if (!Array.isArray(clips) || !clips.length) return [];

  const uniqueCategoryKeys = new Set();
  clips.forEach((clip) => {
    const existing = String(
      clip?.clipCategoryValue || clip?.categoryValue || "",
    ).trim();
    if (existing) return; // already enriched (e.g. from persisted cache)
    const key = getClipCategoryKey(clip);
    if (key && !categoryInfoCache.has(key)) uniqueCategoryKeys.add(key);
  });

  for (const key of uniqueCategoryKeys) {
    try {
      await fetchCategoryInfoByKey(key, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
  }

  return clips.map((clip) => {
    const existing = String(
      clip?.clipCategoryValue || clip?.categoryValue || "",
    ).trim();
    if (existing) return clip;
    const key = getClipCategoryKey(clip);
    const categoryInfo = key ? categoryInfoCache.get(key) : null;
    const categoryValue = String(categoryInfo?.categoryValue || "").trim();
    if (!categoryValue) return clip;
    return {
      ...clip,
      clipCategoryValue: categoryValue,
      categoryValue,
    };
  });
}

function getClipCategoryKey(clip) {
  const categoryType = String(clip?.categoryType || "").trim();
  const categoryId = String(clip?.clipCategory || "").trim();
  if (!categoryType || !categoryId) return "";
  return `${categoryType}:${categoryId}`;
}

async function fetchCategoryInfoByKey(key, signal) {
  const cached = categoryInfoCache.get(key);
  if (cached !== undefined) return cached;

  const inFlight = categoryInfoInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = fetchCategoryInfo(key, signal)
    .then((info) => {
      categoryInfoCache.set(key, info);
      return info;
    })
    .catch((error) => {
      if (isAbortError(error)) throw error;
      categoryInfoCache.set(key, null);
      return null;
    })
    .finally(() => {
      categoryInfoInFlight.delete(key);
    });
  categoryInfoInFlight.set(key, promise);
  return promise;
}

async function fetchCategoryInfo(key, signal) {
  const [categoryType, categoryId] = String(key || "").split(":");
  if (!categoryType || !categoryId) return null;

  throwIfAborted(signal);
  const url = new URL(
    `${SERVICE_API_BASE}/categories/${encodeURIComponent(categoryType)}/${encodeURIComponent(categoryId)}/info`,
  );
  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    signal,
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) return null;

  const payload = await response.json();
  if (Number(payload?.code) !== 200 || !payload.content) return null;
  return payload.content;
}

function createProgressReporter(sender, requestId) {
  if (!requestId) return () => {};

  return (progress) => {
    const message = {
      type: "CHEESE_SEARCH_FETCH_PROGRESS",
      requestId,
      progress,
    };

    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, message, () => {
        void chrome.runtime.lastError;
      });
      return;
    }

    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  };
}

function addProgressSubscriber(entry, requestId, progressReporter) {
  if (requestId) {
    const existing = entry.requestSubscribers.get(requestId);
    if (existing) {
      entry.progressReporters.delete(existing);
    }
    entry.requestSubscribers.set(requestId, progressReporter);
  }
  entry.progressReporters.add(progressReporter);
}

function removeProgressSubscriber(entry, requestId) {
  const progressReporter = entry.requestSubscribers.get(requestId);
  if (!progressReporter) return false;
  entry.requestSubscribers.delete(requestId);
  entry.progressReporters.delete(progressReporter);
  return true;
}

function subscribeToInFlightFetch(key, requestId, progressReporter) {
  const entry = inFlightFetches.get(key);
  if (!entry) return null;

  addProgressSubscriber(entry, requestId, progressReporter);
  if (entry.lastProgress) {
    progressReporter({
      ...entry.lastProgress,
      clips:
        entry.accumulatedClips.length &&
        entry.lastProgress.contentType === "clips"
          ? entry.accumulatedClips
          : entry.lastProgress.clips,
      shared: true,
    });
  }

  return entry.promise.finally(() => {
    removeProgressSubscriber(entry, requestId);
  });
}

function runFetchWithProgress(key, request, progressReporter) {
  const progressReporters = new Set([progressReporter]);
  const entry = {
    progressReporters,
    requestSubscribers: new Map(),
    accumulatedClips: [],
    lastProgress: null,
    promise: null,
    channelId: request.channelId,
    contentType: request.contentType || "videos",
    abortController: new AbortController(),
  };
  if (request.requestId) {
    entry.requestSubscribers.set(request.requestId, progressReporter);
  }

  const reportProgress = (rawProgress) => {
    const progress = {
      ...rawProgress,
      channelId: request.channelId,
      contentType: rawProgress.contentType || entry.contentType,
    };
    if (progress.contentType === "clips" && Array.isArray(progress.clips)) {
      entry.accumulatedClips.push(...progress.clips);
    }
    entry.lastProgress = progress;
    progressReporters.forEach((reporter) => reporter(progress));
  };

  const fetcher =
    request.contentType === "clips" ? fetchAllClips : fetchAllVideos;
  entry.promise = runCollectionTask(
    () =>
      fetcher(
        { ...request, signal: entry.abortController.signal },
        reportProgress,
      ),
    entry.abortController.signal,
    () =>
      reportProgress({
        phase: "queued",
        contentType: request.contentType || "videos",
      }),
  )
    .catch((error) => {
      reportProgress({
        phase: isAbortError(error) ? "cancelled" : "error",
        error: normalizeError(error),
        contentType: request.contentType || "videos",
      });
      throw error;
    })
    .finally(() => {
      if (inFlightFetches.get(key) === entry) {
        inFlightFetches.delete(key);
      }
    });
  inFlightFetches.set(key, entry);
  return entry.promise;
}

function fetchAllVideosShared(request, sender) {
  const key = inFlightKey(request);
  const progressReporter = createProgressReporter(sender, request.requestId);
  const inFlight = subscribeToInFlightFetch(
    key,
    request.requestId,
    progressReporter,
  );
  if (inFlight) return inFlight;
  return runFetchWithProgress(key, request, progressReporter);
}

function tryResubscribeInFlight(request, sender) {
  const key = inFlightKey({ ...request, forceRefresh: false });
  const entry = inFlightFetches.get(key);
  if (!entry) {
    const forceKey = inFlightKey({ ...request, forceRefresh: true });
    const forceEntry = inFlightFetches.get(forceKey);
    if (!forceEntry) return null;
    return attachReporter(forceEntry, request, sender);
  }
  return attachReporter(entry, request, sender);
}

function attachReporter(entry, request, sender) {
  const progressReporter = createProgressReporter(sender, request.requestId);
  addProgressSubscriber(entry, request.requestId, progressReporter);
  if (entry.lastProgress) {
    progressReporter({
      ...entry.lastProgress,
      clips:
        entry.accumulatedClips.length &&
        entry.lastProgress.contentType === "clips"
          ? entry.accumulatedClips
          : entry.lastProgress.clips,
      shared: true,
      resubscribed: true,
    });
  }
  entry.promise
    .finally(() => {
      removeProgressSubscriber(entry, request.requestId);
    })
    .catch(() => {});
  return {
    contentType: request.contentType || "videos",
    accumulatedCount: entry.accumulatedClips.length,
    lastPhase: entry.lastProgress?.phase || "fetching",
  };
}

function cancelFetchSubscription(requestId) {
  if (!requestId) return { matched: false, aborted: false };

  for (const entry of inFlightFetches.values()) {
    if (!removeProgressSubscriber(entry, requestId)) continue;
    const aborted = entry.progressReporters.size === 0;
    if (aborted) {
      console.warn(
        "[CheeseSearch] aborting fetch — last subscriber cancelled",
        requestId,
      );
      entry.abortController.abort();
      for (const [key, currentEntry] of inFlightFetches.entries()) {
        if (currentEntry === entry) {
          inFlightFetches.delete(key);
          break;
        }
      }
    }
    return { matched: true, aborted };
  }

  return { matched: false, aborted: false };
}

async function fetchAllVideos(request, reportProgress = () => {}) {
  const key = cacheKey(request);
  const cached = await readCache(key);
  const now = Date.now();
  reportProgress({
    phase: "start",
    fetchedPages: 0,
    totalPages: 0,
    totalCount: 0,
    pageSize: PAGE_SIZE,
  });

  if (
    cached &&
    now - cached.createdAt < CACHE_TTL_MS &&
    !request.forceRefresh
  ) {
    let firstPage;
    try {
      reportProgress({
        phase: "checking",
        fetchedPages: 0,
        totalPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalCount: Number(
          cached.value.totalCount || cached.value.videos?.length || 0,
        ),
        pageSize: PAGE_SIZE,
        fromCache: true,
      });
      firstPage = await fetchVideoPage({ ...request, page: 0 });
    } catch (error) {
      reportProgress({
        phase: "done",
        fetchedPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalCount: Number(
          cached.value.totalCount || cached.value.videos?.length || 0,
        ),
        pageSize: PAGE_SIZE,
        fromCache: true,
      });
      return { ...cached.value, fromCache: true, freshnessCheckFailed: true };
    }

    const firstData = Array.isArray(firstPage.data) ? firstPage.data : [];
    const latestCachedVideoNo = cached.value.videos?.[0]?.videoNo || null;
    const latestRemoteVideoNo = firstData[0]?.videoNo || null;
    const remoteTotalCount = Number(firstPage.totalCount || firstData.length);
    if (
      remoteTotalCount === cached.value.totalCount &&
      latestRemoteVideoNo === latestCachedVideoNo
    ) {
      reportProgress({
        phase: "done",
        fetchedPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalPages: Math.max(1, Number(cached.value.totalPages || 1)),
        totalCount: Number(
          cached.value.totalCount || cached.value.videos?.length || 0,
        ),
        pageSize: PAGE_SIZE,
        fromCache: true,
      });
      return { ...cached.value, fromCache: true, checkedFresh: true };
    }

    return fetchAllVideos({ ...request, forceRefresh: true }, reportProgress);
  }

  const firstPage = await fetchVideoPage({ ...request, page: 0 });
  const totalPages = Number(firstPage.totalPages || 0);
  const firstData = Array.isArray(firstPage.data) ? firstPage.data : [];
  reportProgress({
    phase: "fetching",
    fetchedPages: Math.min(1, Math.max(1, totalPages)),
    totalPages: Math.max(1, totalPages),
    totalCount: Number(firstPage.totalCount || firstData.length),
    pageSize: PAGE_SIZE,
  });

  if (totalPages <= 1) {
    const value = {
      channelId: request.channelId,
      videoType: request.videoType || "",
      sortType: request.sortType || "LATEST",
      totalCount: Number(firstPage.totalCount || firstData.length),
      totalPages: Math.max(1, totalPages),
      fetchedAt: now,
      videos: firstData,
    };
    await writeCache(key, { createdAt: now, value });
    reportProgress({
      phase: "done",
      fetchedPages: 1,
      totalPages: 1,
      totalCount: value.totalCount,
      pageSize: PAGE_SIZE,
    });
    return { ...value, fromCache: false };
  }

  const pageNumbers = Array.from(
    { length: totalPages - 1 },
    (_, index) => index + 1,
  );
  let fetchedPages = 1;
  const pages = await mapWithConcurrency(
    pageNumbers,
    MAX_CONCURRENT_PAGE_REQUESTS,
    (page) =>
      fetchVideoPage({ ...request, page }).then((result) => {
        fetchedPages += 1;
        reportProgress({
          phase: "fetching",
          fetchedPages,
          totalPages,
          totalCount: Number(firstPage.totalCount || 0),
          pageSize: PAGE_SIZE,
        });
        return result;
      }),
  );
  const videos = firstData.concat(
    pages.flatMap((page) => (Array.isArray(page.data) ? page.data : [])),
  );

  const value = {
    channelId: request.channelId,
    videoType: request.videoType || "",
    sortType: request.sortType || "LATEST",
    totalCount: Number(firstPage.totalCount || videos.length),
    totalPages,
    fetchedAt: now,
    videos,
  };

  await writeCache(key, { createdAt: now, value });
  reportProgress({
    phase: "done",
    fetchedPages: totalPages,
    totalPages,
    totalCount: value.totalCount,
    pageSize: PAGE_SIZE,
  });
  return { ...value, fromCache: false };
}

async function fetchAllClips(request, reportProgress = () => {}) {
  const normalizedRequest = {
    ...request,
    filterType: normalizeClipFilterType(request.filterType),
    orderType: normalizeClipOrderType(request.orderType),
  };
  const key = clipCacheKey(normalizedRequest);
  const cached = await readCache(key);
  const now = Date.now();

  reportProgress({
    phase: "start",
    fetchedPages: 0,
    totalPages: 0,
    totalCount: 0,
    pageSize: CLIP_PAGE_SIZE,
    contentType: "clips",
  });

  if (
    cached &&
    now - cached.createdAt < CACHE_TTL_MS &&
    !normalizedRequest.forceRefresh
  ) {
    const activeClips = await enrichClipsWithCategoryValues(
      getActiveClips(cached.value.clips),
      normalizedRequest.signal,
    );
    const { allClips: _allClips, ...publicValue } = cached.value;
    reportProgress({
      phase: "done",
      fetchedPages: Math.max(1, Number(cached.value.totalPages || 1)),
      totalPages: Math.max(1, Number(cached.value.totalPages || 1)),
      totalCount: activeClips.length,
      pageSize: CLIP_PAGE_SIZE,
      contentType: "clips",
      fromCache: true,
      clips: activeClips,
    });
    return {
      ...publicValue,
      clips: activeClips,
      totalCount: activeClips.length,
      fromCache: true,
    };
  }

  const remoteClips = [];
  const seenClipUIDs = new Set();
  const requestedCursors = new Set();
  let cursor = { clipUID: "", readCount: "" };
  let fetchedPages = 0;

  while (true) {
    const cursorKey = `${cursor.clipUID || ""}:${cursor.readCount ?? ""}`;
    if (requestedCursors.has(cursorKey)) {
      throw new Error("클립 페이지 커서가 반복되어 수집을 중단했습니다.");
    }
    requestedCursors.add(cursorKey);

    const page = await fetchClipPage({
      ...normalizedRequest,
      cursor,
    });
    const pageClips = await enrichClipsWithCategoryValues(
      Array.isArray(page.data) ? page.data : [],
      normalizedRequest.signal,
    );
    const newPageClips = [];

    pageClips.forEach((clip) => {
      const clipUID = String(clip?.clipUID || "").trim();
      if (!clipUID || seenClipUIDs.has(clipUID)) return;
      seenClipUIDs.add(clipUID);
      const normalizedClip = {
        ...clip,
        clipUID,
        deletedAt: null,
        missingCount: 0,
      };
      remoteClips.push(normalizedClip);
      newPageClips.push(normalizedClip);
    });

    fetchedPages += 1;
    reportProgress({
      phase: "fetching",
      fetchedPages,
      totalPages: 0,
      totalCount: remoteClips.length,
      pageSize: CLIP_PAGE_SIZE,
      contentType: "clips",
      clips: newPageClips,
    });

    const next = page?.page?.next;
    if (!next?.clipUID) break;
    cursor = {
      clipUID: String(next.clipUID || "").trim(),
      readCount: next.readCount ?? "",
    };
    if (CLIP_PAGE_THROTTLE_MS > 0) {
      await sleep(CLIP_PAGE_THROTTLE_MS, normalizedRequest.signal);
    }
  }

  const previousClips = Array.isArray(cached?.value?.allClips)
    ? cached.value.allClips
    : Array.isArray(cached?.value?.clips)
      ? cached.value.clips
      : [];
  const allClips = await enrichClipsWithCategoryValues(
    reconcileClipCache(previousClips, remoteClips, now),
    normalizedRequest.signal,
  );
  const activeClips = getActiveClips(allClips);
  const deletedCount = allClips.length - activeClips.length;
  const value = {
    channelId: normalizedRequest.channelId,
    contentType: "clips",
    filterType: normalizedRequest.filterType,
    orderType: normalizedRequest.orderType,
    totalCount: activeClips.length,
    totalPages: Math.max(1, fetchedPages),
    fetchedAt: now,
    clips: activeClips,
    allClips,
    deletedCount,
  };

  await writeCache(key, { createdAt: now, value });
  reportProgress({
    phase: "done",
    fetchedPages: Math.max(1, fetchedPages),
    totalPages: Math.max(1, fetchedPages),
    totalCount: activeClips.length,
    pageSize: CLIP_PAGE_SIZE,
    contentType: "clips",
  });

  const { allClips: _allClips, ...publicValue } = value;
  return { ...publicValue, fromCache: false };
}

function reconcileClipCache(previousClips, remoteClips, now) {
  const previousById = new Map();
  previousClips.forEach((clip) => {
    const clipUID = String(clip?.clipUID || "").trim();
    if (clipUID) previousById.set(clipUID, clip);
  });

  const remoteIds = new Set(remoteClips.map((clip) => clip.clipUID));
  const mergedActive = remoteClips.map((clip) => ({
    ...previousById.get(clip.clipUID),
    ...clip,
    deletedAt: null,
    missingCount: 0,
  }));

  const missing = [];
  previousById.forEach((clip, clipUID) => {
    if (remoteIds.has(clipUID)) return;
    const missingCount = Number(clip.missingCount || 0) + 1;
    missing.push({
      ...clip,
      missingCount,
      deletedAt:
        missingCount >= CLIP_MISSING_CONFIRMATION_COUNT
          ? clip.deletedAt || now
          : clip.deletedAt || null,
    });
  });

  return mergedActive.concat(missing);
}

function getActiveClips(clips) {
  return (Array.isArray(clips) ? clips : []).filter((clip) => !clip.deletedAt);
}

function normalizeClipFilterType(value) {
  const normalized = String(value || "ALL").toUpperCase();
  const allowed = new Set([
    "ALL",
    "WITHIN_ONE_DAY",
    "WITHIN_SEVEN_DAYS",
    "WITHIN_THIRTY_DAYS",
  ]);
  return allowed.has(normalized) ? normalized : "ALL";
}

function normalizeClipOrderType(value) {
  const normalized = String(value || "RECENT").toUpperCase();
  return normalized === "POPULAR" ? "POPULAR" : "RECENT";
}

async function runCollectionTask(task, signal, reportQueued) {
  const release = await acquireCollectionTaskSlot(signal, reportQueued);
  try {
    throwIfAborted(signal);
    return await task();
  } finally {
    release();
  }
}

function acquireCollectionTaskSlot(signal, reportQueued) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);

    const waiter = {
      signal,
      resolve,
      reject,
      handleAbort: null,
    };
    waiter.handleAbort = () => {
      const index = collectionTaskQueue.indexOf(waiter);
      if (index >= 0) collectionTaskQueue.splice(index, 1);
      reject(createAbortError());
    };

    if (activeCollectionTaskCount < MAX_CONCURRENT_COLLECTION_TASKS) {
      startCollectionTaskWaiter(waiter);
      return;
    }

    collectionTaskQueue.push(waiter);
    signal?.addEventListener("abort", waiter.handleAbort, { once: true });
    reportQueued?.();
  });
}

function startCollectionTaskWaiter(waiter) {
  if (waiter.signal?.aborted) {
    waiter.reject(createAbortError());
    return;
  }

  waiter.signal?.removeEventListener("abort", waiter.handleAbort);
  activeCollectionTaskCount += 1;
  let released = false;
  waiter.resolve(() => {
    if (released) return;
    released = true;
    activeCollectionTaskCount = Math.max(0, activeCollectionTaskCount - 1);
    drainCollectionTaskQueue();
  });
}

function drainCollectionTaskQueue() {
  while (
    activeCollectionTaskCount < MAX_CONCURRENT_COLLECTION_TASKS &&
    collectionTaskQueue.length
  ) {
    const waiter = collectionTaskQueue.shift();
    if (waiter.signal?.aborted) {
      waiter.reject(createAbortError());
      continue;
    }
    startCollectionTaskWaiter(waiter);
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function fetchExactChannelByNickname(nickname) {
  const keyword = String(nickname || "").trim();
  if (!keyword) {
    throw new Error("스트리머 닉네임을 입력해 주세요.");
  }

  const cachedExactChannel = await readChannelSearchCache(
    normalizeChannelName(keyword),
  );
  if (isExactCachedChannelMatch(cachedExactChannel, keyword)) {
    return cachedExactChannel;
  }

  const cachedChannel = await findCachedChannelByNickname(keyword);
  if (cachedChannel) {
    writeChannelSearchCache(
      normalizeChannelName(cachedChannel.channelName),
      cachedChannel,
    );
    return cachedChannel;
  }

  const url = new URL(
    `${API_BASE.replace("/service/v1/channels", "")}/service/v1/search/channels`,
  );
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("offset", "0");
  url.searchParams.set("size", String(SEARCH_CHANNEL_PAGE_SIZE));
  url.searchParams.set("withFirstChannelContent", "true");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`채널 검색 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200) {
    throw new Error("채널 검색 응답을 읽을 수 없습니다.");
  }

  const data = Array.isArray(payload?.content?.data)
    ? payload.content.data
    : [];
  if (!data.length) {
    throw new Error("검색 결과가 없습니다. 닉네임을 다시 확인해 주세요.");
  }

  const candidates = data
    .map((item) =>
      item && typeof item.channel === "object" ? item.channel : null,
    )
    .filter((channel) => channel && String(channel.channelId || "").trim())
    .map(normalizeChannelCandidate);
  const target = normalizeChannelName(keyword);
  const exactMatches = candidates.filter(
    (candidate) => normalizeChannelName(candidate.channelName) === target,
  );

  if (exactMatches.length === 1) {
    return validateSearchedChannel(exactMatches[0], keyword);
  }

  if (candidates.length === 1) {
    return validateSearchedChannel(candidates[0], keyword);
  }

  return {
    needsSelection: true,
    keyword,
    candidates,
  };
}

async function fetchExactChannelByNicknameQueued(nickname) {
  const keyword = String(nickname || "").trim();
  if (!keyword) {
    throw new Error("스트리머 닉네임을 입력해 주세요.");
  }

  const cachedExactChannel = await readChannelSearchCache(
    normalizeChannelName(keyword),
  );
  if (isExactCachedChannelMatch(cachedExactChannel, keyword)) {
    return cachedExactChannel;
  }

  const cachedChannel = await findCachedChannelByNickname(keyword);
  if (cachedChannel) {
    writeChannelSearchCache(
      normalizeChannelName(cachedChannel.channelName),
      cachedChannel,
    );
    return cachedChannel;
  }

  const run = async () => {
    await waitForChannelSearchSlot();
    return fetchExactChannelByNickname(keyword);
  };
  const queued = channelSearchQueue.then(run, run);
  channelSearchQueue = queued.catch(() => {});
  return queued;
}

async function waitForChannelSearchSlot() {
  const elapsed = Date.now() - lastChannelSearchStartedAt;
  const delay = Math.max(0, CHANNEL_SEARCH_COOLDOWN_MS - elapsed);
  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastChannelSearchStartedAt = Date.now();
}

async function findCachedChannelByNickname(nickname) {
  await cacheHydration;
  const target = normalizeChannelName(nickname);
  for (const entry of cache.values()) {
    const videos = Array.isArray(entry?.value?.videos)
      ? entry.value.videos
      : [];
    const matched = videos.find((video) => {
      const channel =
        video && typeof video.channel === "object" ? video.channel : null;
      return channel && normalizeChannelName(channel.channelName) === target;
    });
    if (!matched?.channel?.channelId) continue;

    return {
      channelId: String(matched.channel.channelId || "").trim(),
      channelName: String(matched.channel.channelName || nickname).trim(),
      channelImageUrl: String(matched.channel.channelImageUrl || "").trim(),
      verifiedMark: matched.channel.verifiedMark === true,
    };
  }
  return null;
}

function normalizeChannelCandidate(channel) {
  return {
    channelId: String(channel?.channelId || "").trim(),
    channelName: String(channel?.channelName || "").trim(),
    channelImageUrl: String(channel?.channelImageUrl || "").trim(),
    verifiedMark: channel?.verifiedMark === true,
  };
}

function isExactCachedChannelMatch(channel, keyword) {
  return (
    channel?.channelId &&
    normalizeChannelName(channel.channelName) === normalizeChannelName(keyword)
  );
}

async function validateSearchedChannel(candidate, keyword = "") {
  const normalizedCandidate = normalizeChannelCandidate(candidate);
  if (!normalizedCandidate.channelId) {
    throw new Error("선택한 채널 정보를 확인할 수 없습니다.");
  }

  const liveStatus = await fetchLiveStatusByChannelId(
    normalizedCandidate.channelId,
  );
  if (!liveStatus.hasStreamingHistory) {
    throw new Error("방송 이력이 있는 스트리머만 검색할 수 있습니다.");
  }

  const result = {
    ...normalizedCandidate,
    channelName:
      normalizedCandidate.channelName || String(keyword || "").trim(),
  };
  if (result.channelName) {
    writeChannelSearchCache(normalizeChannelName(result.channelName), result);
  }
  return result;
}

async function fetchLiveStatusByChannelId(channelId) {
  const normalizedChannelId = String(channelId || "").trim();
  if (!normalizedChannelId) {
    return { hasStreamingHistory: false };
  }

  const url = new URL(
    `${API_BASE}/${encodeURIComponent(normalizedChannelId)}/data`,
  );
  url.searchParams.set("fields", "channelHistory");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`스트리머 확인 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200) {
    throw new Error("스트리머 확인 응답을 읽을 수 없습니다.");
  }

  const history = payload?.content?.channelHistory;
  const firstLiveDate = String(history?.firstLiveDate || "").trim();
  const totalLiveHours = Number(history?.totalLiveHours || 0);
  return {
    hasStreamingHistory: Boolean(firstLiveDate) || totalLiveHours > 0,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === "CHEESE_SEARCH_FETCH_VIDEOS") {
    fetchAllVideosShared(message.payload, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_FETCH_CLIPS") {
    const request = { ...(message.payload || {}), contentType: "clips" };
    handleFetchClipsMessage(request, sender, sendResponse);
    return true;
  }

  if (message.type === "CHEESE_SEARCH_FIND_CHANNEL") {
    fetchExactChannelByNicknameQueued(message.payload?.nickname)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_VALIDATE_CHANNEL") {
    validateSearchedChannel(
      message.payload?.candidate,
      message.payload?.keyword,
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  if (message.type === "CHEESE_SEARCH_RESUBSCRIBE") {
    const payload = message.payload || {};
    const request = {
      ...payload,
      contentType: payload.contentType || "videos",
    };
    const result = tryResubscribeInFlight(request, sender);
    sendResponse({ ok: true, result });
    return false;
  }

  if (message.type === "CHEESE_SEARCH_CANCEL_FETCH") {
    const result = cancelFetchSubscription(message.payload?.requestId);
    sendResponse({ ok: true, result });
    return false;
  }

  if (message.type === "CHEESE_SEARCH_PEEK_CACHE") {
    const payload = message.payload || {};
    peekCacheValue(payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error) }),
      );
    return true;
  }

  return false;
});

async function handleFetchClipsMessage(request, sender, sendResponse) {
  if (!request.forceRefresh) {
    try {
      const cachedResult = await peekCacheValue({
        contentType: "clips",
        channelId: request.channelId,
        filterType: request.filterType,
        orderType: request.orderType,
      });
      if (cachedResult) {
        sendResponse({ ok: true, result: cachedResult });
        return;
      }
    } catch {
      // fall through to async fetch
    }
  }
  fetchAllVideosShared(request, sender).catch(() => {});
  sendResponse({
    ok: true,
    result: {
      accepted: true,
      contentType: "clips",
      requestId: request.requestId || "",
    },
  });
}

async function peekCacheValue(payload) {
  const isClipSearch = payload.contentType === "clips";
  const key = isClipSearch
    ? clipCacheKey({
        channelId: payload.channelId,
        filterType: payload.filterType,
        orderType: payload.orderType,
      })
    : cacheKey({
        channelId: payload.channelId,
        contentType: payload.contentType,
        videoType: payload.videoType,
        sortType: payload.sortType,
      });
  const cached = await readCache(key);
  if (!cached?.value) return null;
  const now = Date.now();
  if (now - cached.createdAt >= CACHE_TTL_MS) return null;
  if (isClipSearch) {
    // peek must stay lightweight — category enrichment already happened at
    // fetch time and is persisted via CLIP_PERSIST_FIELDS, so we just read.
    const activeClips = getActiveClips(cached.value.clips);
    if (!activeClips.length) return null;
    const { allClips: _allClips, ...publicValue } = cached.value;
    return { ...publicValue, clips: activeClips, fromCache: true };
  }
  if (!Array.isArray(cached.value.videos) || !cached.value.videos.length) {
    return null;
  }
  return { ...cached.value, fromCache: true };
}
