const params = new URLSearchParams(location.search);
let activeChannelId = params.get("channelId") || "";
let activeChannelName = params.get("channelName") || "";
let activeContentType =
  params.get("contentType") === "clips" ? "clips" : "videos";
const EMPTY_RESULTS_ANIMATION_URL = chrome.runtime.getURL(
  "no-search-results-found-animation.svg",
);
const SEARCHING_ANIMATION_URL = chrome.runtime.getURL(
  "searching-animation.svg",
);

const elements = {
  subtitle: document.getElementById("popupSubtitle"),
  streamer: document.getElementById("streamerInput"),
  streamerReset: document.querySelector('[data-search-reset="streamer"]'),
  streamerSearch: document.getElementById("streamerSearchButton"),
  query: document.getElementById("queryInput"),
  categoryChip: document.getElementById("categoryFilterChip"),
  categoryChipLabel: document.getElementById("categoryFilterChipLabel"),
  queryReset: document.querySelector('[data-search-reset="query"]'),
  queryHelp: document.getElementById("queryHelpButton"),
  queryHelpPanel: document.getElementById("queryHelpPanel"),
  dateFrom: document.getElementById("dateFromInput"),
  dateTo: document.getElementById("dateToInput"),
  datePickers: document.querySelectorAll("[data-date-picker]"),
  durationPicker: document.getElementById("durationPicker"),
  durationField: document.querySelector(".popup-duration-field"),
  durationTrigger: document.getElementById("durationTrigger"),
  durationLabel: document.getElementById("durationLabel"),
  durationMenu: document.getElementById("durationMenu"),
  videoTypePicker: document.getElementById("videoTypePicker"),
  videoTypeTrigger: document.getElementById("videoTypeTrigger"),
  videoTypeLabel: document.getElementById("videoTypeLabel"),
  videoTypeMenu: document.getElementById("videoTypeMenu"),
  sortPicker: document.getElementById("sortPicker"),
  sortTrigger: document.getElementById("sortTrigger"),
  sortLabel: document.getElementById("sortLabel"),
  sortMenu: document.getElementById("sortMenu"),
  resetFilters: document.getElementById("resetFiltersButton"),
  themeToggle: document.getElementById("themeToggleButton"),
  refresh: document.getElementById("refreshButton"),
  channelStatus: document.getElementById("channelStatus"),
  summary: document.getElementById("summary"),
  progress: document.getElementById("fetchProgress"),
  progressBar: document.getElementById("fetchProgressBar"),
  progressLabel: document.getElementById("fetchProgressLabel"),
  results: document.getElementById("results"),
};

let videos = [];
let fromCache = false;
let fetchInfo = null;
let videoLoadToken = 0;
let streamerSearchToken = 0;
let streamerSearchInFlight = false;
let activeStreamerSearchNickname = "";
let pendingStreamerNickname = "";
let lastStreamerSearchStartedAt = 0;
let channelCandidateDialog = null;
let channelCandidateKeyword = "";
let activeFetchRequestId = "";
let activeFetchSilentRevalidate = false;
let progressClearTimer = 0;
let progressRenderTimer = 0;
let progressStallTimer = 0;
const PROGRESS_STALL_TIMEOUT_MS = 15000;
let progressResultSignature = "";
let renderedClipUIDs = new Set();
let knownClipUIDs = new Set();
let resultSignature = "";
let visibleCount = 120;
const clipOrientationCache = new Map();
const calendarMonths = {
  dateFrom: getMonthStart(new Date()),
  dateTo: getMonthStart(new Date()),
};

const STREAMER_SEARCH_COOLDOWN_MS = 900;
const THEME_STORAGE_KEY = "cheeseSearchTheme";
const OFFICIAL_MARK_ICON_URL =
  "https://ssl.pstatic.net/static/nng/glive/image/icon_official_mark.png";
const CACHE_TTL_MS = 1 * 60 * 60 * 1000;
const CACHE_CHUNK_SEPARATOR = "#chunk:";
const RESULT_INITIAL_RENDER_COUNT = 120;
const RESULT_RENDER_STEP_COUNT = 120;
const RESULT_SCROLL_THRESHOLD_PX = 2600;
const CANDIDATE_MIN_SKELETON_MS = 650;
const CANDIDATE_AVATAR_FADE_MS = 240;
const DURATION_FILTERS = {
  all: { label: "길이 전체", min: 0, max: Infinity },
  under10m: { label: "10분 이하", min: 0, max: 10 * 60 },
  "10m-30m": { label: "10분~30분", min: 10 * 60, max: 30 * 60 },
  "30m-1h": { label: "30분~1시간", min: 30 * 60, max: 60 * 60 },
  "1h-6h": { label: "1시간~6시간", min: 60 * 60, max: 6 * 60 * 60 },
  "6h-12h": { label: "6시간~12시간", min: 6 * 60 * 60, max: 12 * 60 * 60 },
  over12h: { label: "12시간 이상", min: 12 * 60 * 60, max: Infinity },
};
const VIDEO_TYPE_FILTERS = {
  all: { label: "유형 전체" },
  replay: { label: "다시보기" },
  upload: { label: "업로드" },
  watching: { label: "시청 중" },
  unwatched: { label: "시청안함" },
};

function createCloseIcon(className = "popup-close-icon") {
  return `
    <svg class="${className}" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
    </svg>
  `;
}

initializeTheme();
initializeContentMode();
elements.query.value = params.get("q") || "";
setCategoryFilter(params.get("categoryFilter") || "");
setDateValue("dateFrom", params.get("dateFrom") || "");
setDateValue("dateTo", params.get("dateTo") || "");
setDurationValue(params.get("duration") || "all");
setVideoTypeValue(params.get("videoTypeFilter") || "all");
setSortValue(params.get("sort") || getInitialSortValue());
updateSearchResetButtons();
renderAllCalendars();
renderChannelStatus();

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "알 수 없는 오류가 발생했습니다."));
        return;
      }
      resolve(response.result);
    });
  });
}

async function loadVideos(forceRefresh = false) {
  if (!activeChannelId) {
    elements.summary.textContent = `스트리머 닉네임을 입력해 ${getContentLabel()}을 검색할 수 있습니다.`;
    elements.results.innerHTML = "";
    return;
  }

  if (activeFetchRequestId) {
    await cancelActiveFetch({ render: false });
  }

  const currentLoadToken = ++videoLoadToken;
  const requestId = createRequestId("popup");
  activeFetchRequestId = requestId;
  updateRefreshButton();
  clearProgressStallTimer();
  const channelId = activeChannelId;
  const isClipSearch = activeContentType === "clips";

  if (isClipSearch) {
    renderSkeleton({ preserveSummary: true });
  }

  const cachedHydrated =
    !forceRefresh &&
    (await hydrateFromSessionCache({
      channelId,
      isClipSearch,
    }));

  if (currentLoadToken !== videoLoadToken || channelId !== activeChannelId) {
    return;
  }

  activeFetchSilentRevalidate = cachedHydrated;

  if (cachedHydrated && isClipSearch) {
    activeFetchRequestId = "";
    activeFetchSilentRevalidate = false;
    clearProgressStallTimer();
    clearFetchProgress();
    updateRefreshButton();
    return;
  }

  if (!cachedHydrated) {
    if (isClipSearch) {
      videos = [];
      knownClipUIDs = new Set();
      fetchInfo = null;
      resultSignature = "";
      progressResultSignature = "";
      renderedClipUIDs = new Set();
      visibleCount = RESULT_INITIAL_RENDER_COUNT;
    }
    setFetchProgress({
      phase: "start",
      fetchedPages: 0,
      totalPages: 0,
      totalCount: 0,
      contentType: isClipSearch ? "clips" : "videos",
    });
    renderSkeleton();
  }

  try {
    const result = await sendMessage({
      type: isClipSearch
        ? "CHEESE_SEARCH_FETCH_CLIPS"
        : "CHEESE_SEARCH_FETCH_VIDEOS",
      payload: {
        channelId,
        videoType: "",
        sortType: "LATEST",
        filterType: normalizeClipFilterType(params.get("filterType")),
        orderType: getClipOrderTypeFromSort(elements.sortPicker.dataset.sort),
        forceRefresh,
        requestId,
      },
    });

    if (isClipSearch && result && !result.accepted) {
      clearProgressStallTimer();

      if (
        currentLoadToken !== videoLoadToken ||
        channelId !== activeChannelId
      ) {
        return;
      }

      const clipList = Array.isArray(result.clips)
        ? result.clips.filter((clip) => !clip?.deletedAt)
        : [];
      videos = clipList;
      knownClipUIDs = new Set(
        clipList
          .map((clip) => String(clip?.clipUID || "").trim())
          .filter(Boolean),
      );
      fromCache = Boolean(result.fromCache);
      fetchInfo = result;
      resultSignature = "";
      progressResultSignature = "";
      renderedClipUIDs = new Set();
      visibleCount = RESULT_INITIAL_RENDER_COUNT;
      activeChannelName = getChannelNameFromVideos(videos) || activeChannelName;
      renderChannelStatus();
      activeFetchRequestId = "";
      activeFetchSilentRevalidate = false;
      clearFetchProgress();
      updateRefreshButton();
      renderProgressClipCards();
      return;
    }

    if (result?.accepted && isClipSearch) {
      if (cachedHydrated) {
        clearProgressStallTimer();
      } else {
        resetProgressStallTimer();
      }
      return;
    }
    clearProgressStallTimer();

    if (currentLoadToken !== videoLoadToken || channelId !== activeChannelId) {
      return;
    }

    const nextList = Array.isArray(result.videos)
      ? result.videos
      : Array.isArray(result.clips)
        ? result.clips
        : [];

    const unchangedRevalidation =
      cachedHydrated &&
      (result.checkedFresh ||
        (result.fromCache && nextList.length === videos.length));

    if (unchangedRevalidation) {
      fetchInfo = result;
      fromCache = Boolean(result.fromCache);
      return;
    }

    videos = nextList;
    activeChannelName = getChannelNameFromVideos(videos) || activeChannelName;
    fromCache = Boolean(result.fromCache);
    fetchInfo = result;
    resultSignature = "";
    visibleCount = RESULT_INITIAL_RENDER_COUNT;
    renderChannelStatus();
    if (isClipSearch) {
      renderProgressClipCards();
    } else {
      render();
    }
  } catch (error) {
    if (currentLoadToken !== videoLoadToken || channelId !== activeChannelId) {
      return;
    }
    elements.summary.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    if (activeContentType !== "clips" && currentLoadToken === videoLoadToken) {
      activeFetchRequestId = "";
      activeFetchSilentRevalidate = false;
      clearProgressStallTimer();
      scheduleClearFetchProgress();
      updateRefreshButton();
    }
  }
}

function handleRefreshClick() {
  if (activeFetchRequestId) {
    void cancelActiveFetch();
    return;
  }
  void loadVideos(true);
}

async function cancelActiveFetch({ render: shouldRender = true } = {}) {
  const requestId = activeFetchRequestId;
  if (!requestId) return;

  videoLoadToken += 1;
  activeFetchRequestId = "";
  activeFetchSilentRevalidate = false;
  clearProgressStallTimer();
  clearFetchProgress();
  updateRefreshButton();

  try {
    await sendMessage({
      type: "CHEESE_SEARCH_CANCEL_FETCH",
      payload: { requestId },
    });
  } catch {
    // The local search is already stopped even if the worker was restarted.
  }

  if (!shouldRender) return;
  if (videos.length) {
    render();
    return;
  }

  elements.summary.textContent = "검색을 중지했습니다.";
  elements.results.innerHTML = "";
}

function updateRefreshButton() {
  const isFetching = Boolean(activeFetchRequestId);
  elements.refresh.dataset.mode = isFetching ? "stop" : "refresh";
  elements.refresh.setAttribute(
    "aria-label",
    isFetching ? "검색 중지" : "새로고침",
  );
  elements.refresh.title = isFetching ? "검색 중지" : "새로고침";
}

function createRequestId(prefix) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function peekBackgroundCache({ channelId, isClipSearch }) {
  try {
    const result = await sendMessage({
      type: "CHEESE_SEARCH_PEEK_CACHE",
      payload: {
        channelId,
        contentType: isClipSearch ? "clips" : "videos",
        videoType: "",
        sortType: "LATEST",
        filterType: normalizeClipFilterType(params.get("filterType")),
        orderType: getClipOrderTypeFromSort(elements.sortPicker.dataset.sort),
      },
    });
    return result || null;
  } catch {
    return null;
  }
}

function getSessionCacheKey({ channelId, isClipSearch }) {
  if (isClipSearch) {
    const filterType = normalizeClipFilterType(params.get("filterType"));
    const orderType = getClipOrderTypeFromSort(
      elements.sortPicker.dataset.sort,
    );
    return `cache:clips:${channelId}:${filterType}:${orderType}`;
  }
  return `cache:${channelId}::LATEST`;
}

async function readStoredCacheValue(storageKey) {
  if (!chrome.storage?.local) return null;
  const data = await chrome.storage.local.get(storageKey);
  const entry = data?.[storageKey];
  const createdAt = Number(entry?.createdAt || 0);
  const value = entry?.value;
  if (!value || !createdAt || Date.now() - createdAt >= CACHE_TTL_MS) {
    return null;
  }

  const chunkCount = Number(value.__chunkCount || 0);
  const chunkField =
    value.__chunkField ||
    (Array.isArray(value.clips)
      ? "clips"
      : Array.isArray(value.videos)
        ? "videos"
        : "");
  if (!chunkCount || !chunkField) return value;

  const chunkKeys = Array.from(
    { length: chunkCount },
    (_, index) => `${storageKey}${CACHE_CHUNK_SEPARATOR}${index}`,
  );
  const chunksData = await chrome.storage.local.get(chunkKeys);
  const merged = [];
  for (const chunkKey of chunkKeys) {
    const chunk = chunksData?.[chunkKey]?.value?.[chunkField];
    if (!Array.isArray(chunk)) return null;
    merged.push(...chunk);
  }

  const { __chunkCount: _chunkCount, __chunkField: _chunkField, ...rest } =
    value;
  return { ...rest, [chunkField]: merged };
}

async function hydrateFromSessionCache({ channelId, isClipSearch }) {
  let cachedValue = null;
  if (isClipSearch) {
    cachedValue = await peekBackgroundCache({ channelId, isClipSearch });
  }

  if (!cachedValue && chrome.storage?.local) {
    const key = getSessionCacheKey({ channelId, isClipSearch });
    try {
      cachedValue = await readStoredCacheValue(key);
    } catch {
      cachedValue = null;
    }
  }

  if (!cachedValue) {
    cachedValue = await peekBackgroundCache({ channelId, isClipSearch });
  }
  if (!cachedValue) return false;

  const cachedList = isClipSearch
    ? Array.isArray(cachedValue.clips)
      ? cachedValue.clips.filter((clip) => !clip?.deletedAt)
      : []
    : Array.isArray(cachedValue.videos)
      ? cachedValue.videos
      : [];
  if (!cachedList.length) return false;

  videos = cachedList;
  if (isClipSearch) {
    knownClipUIDs = new Set(
      cachedList
        .map((clip) => String(clip?.clipUID || "").trim())
        .filter(Boolean),
    );
  }
  activeChannelName = getChannelNameFromVideos(videos) || activeChannelName;
  fromCache = true;
  fetchInfo = { ...cachedValue, fromCache: true };
  resultSignature = "";
  progressResultSignature = "";
  renderedClipUIDs = new Set();
  visibleCount = RESULT_INITIAL_RENDER_COUNT;
  renderChannelStatus();
  if (isClipSearch) {
    renderProgressClipCards();
  } else {
    render();
  }
  return true;
}

function setFetchProgress(progress) {
  if (progressClearTimer) {
    clearTimeout(progressClearTimer);
    progressClearTimer = 0;
  }

  const label = ensureProgressLabel();
  const isClipProgress =
    progress?.contentType === "clips" || activeContentType === "clips";
  elements.progress.dataset.active = "1";
  elements.progress.dataset.mode = isClipProgress
    ? "indeterminate"
    : "determinate";
  elements.progress.setAttribute("aria-hidden", "false");

  if (isClipProgress) {
    elements.progressBar.style.width = "";
    label.textContent = getClipProgressText(progress);
    return;
  }

  const totalPages = Number(progress?.totalPages || 0);
  const fetchedPages = Number(progress?.fetchedPages || 0);
  const percent =
    totalPages > 0
      ? Math.max(
          4,
          Math.min(100, Math.round((fetchedPages / totalPages) * 100)),
        )
      : 4;

  elements.progressBar.style.width = `${progress?.phase === "done" ? 100 : percent}%`;
  label.textContent = "";

  if (progress?.phase === "fetching" && totalPages > 1) {
    elements.summary.textContent = "불러오는 중...";
  } else if (progress?.phase === "checking") {
    elements.summary.textContent = "불러오는 중...";
  }
}

function scheduleClearFetchProgress() {
  if (activeContentType === "clips") {
    setFetchProgress({
      phase: "done",
      fetchedPages: Math.max(1, Number(fetchInfo?.totalPages || 1)),
      totalPages: Math.max(1, Number(fetchInfo?.totalPages || 1)),
      totalCount: videos.length,
      contentType: "clips",
    });
    progressClearTimer = setTimeout(clearFetchProgress, 900);
    return;
  }
  setFetchProgress({ phase: "done", fetchedPages: 1, totalPages: 1 });
  progressClearTimer = setTimeout(clearFetchProgress, 650);
}

function ensureProgressLabel() {
  if (elements.progressLabel) return elements.progressLabel;
  const label = document.createElement("span");
  label.className = "popup-progress-label";
  label.id = "fetchProgressLabel";
  elements.progress.append(label);
  elements.progressLabel = label;
  return label;
}

function getClipProgressText(progress) {
  const totalCount = Number(progress?.totalCount || videos.length || 0);
  const formattedCount = totalCount.toLocaleString("ko-KR");
  const fetchedPages = Number(progress?.fetchedPages || 0);

  if (progress?.phase === "queued") {
    return totalCount
      ? `클립 모음 대기 중 · 현재 ${formattedCount}개`
      : "클립 모음 대기 중";
  }
  if (progress?.phase === "done") {
    return `클립 ${formattedCount}개 확인 완료`;
  }
  if (progress?.phase === "error") {
    return "클립 목록을 불러오지 못했습니다.";
  }
  if (progress?.phase === "cancelled") {
    return "클립 검색을 중지했습니다.";
  }
  if (fetchedPages > 0) {
    return `클립 모으는 중 · 현재 ${formattedCount}개`;
  }
  return "클립 목록을 불러오는 중";
}

function clearFetchProgress() {
  if (progressClearTimer) {
    clearTimeout(progressClearTimer);
    progressClearTimer = 0;
  }

  delete elements.progress.dataset.active;
  delete elements.progress.dataset.mode;
  elements.progress.setAttribute("aria-hidden", "true");
  elements.progressBar.style.width = "0%";
  if (elements.progressLabel) elements.progressLabel.textContent = "";
}

function appendProgressClips(progress) {
  if (activeContentType !== "clips") return false;
  const clips = Array.isArray(progress?.clips) ? progress.clips : [];
  if (!clips.length) return false;

  const newClips = [];
  for (const clip of clips) {
    const clipUID = String(clip?.clipUID || "").trim();
    if (!clipUID || knownClipUIDs.has(clipUID)) continue;
    knownClipUIDs.add(clipUID);
    newClips.push(clip);
  }
  if (!newClips.length) return false;

  videos = videos.concat(newClips);
  scheduleProgressRender();
  return true;
}

function scheduleProgressRender() {
  if (progressRenderTimer) return;
  progressRenderTimer = setTimeout(() => {
    progressRenderTimer = 0;
    render();
  }, 120);
}

function renderProgressClipCards() {
  if (activeContentType !== "clips") return;
  syncResultsMode();

  const signature = getResultSignature();
  const shouldReset =
    progressResultSignature !== signature ||
    elements.results.getAttribute("aria-busy") === "true";

  if (shouldReset) {
    progressResultSignature = signature;
    renderedClipUIDs = new Set();
    elements.results.removeAttribute("aria-busy");
    elements.results.innerHTML = "";
  }

  const filtered = getFilteredVideos();
  const visibleResults = filtered.slice(0, visibleCount);
  updateSummary(filtered);

  const nextItems = visibleResults.filter((clip) => {
    const clipUID = String(clip?.clipUID || "").trim();
    return clipUID && !renderedClipUIDs.has(clipUID);
  });

  if (nextItems.length) {
    elements.results.querySelector(".popup-empty")?.remove();
    elements.results.insertAdjacentHTML(
      "beforeend",
      nextItems.map(renderCard).join(""),
    );
    nextItems.forEach((clip) => {
      renderedClipUIDs.add(String(clip?.clipUID || "").trim());
    });
    normalizeRenderedClipCards(elements.results);
  } else if (!filtered.length && !elements.results.children.length) {
    elements.results.innerHTML = renderSearchingStatus();
  }
}

async function searchStreamer() {
  const nickname = elements.streamer.value.trim();
  if (!nickname) {
    setChannelStatus("스트리머 닉네임을 입력해 주세요.", true);
    elements.streamer.focus();
    return;
  }

  if (streamerSearchInFlight) {
    if (
      normalizeText(nickname) !== normalizeText(activeStreamerSearchNickname)
    ) {
      pendingStreamerNickname = nickname;
      streamerSearchToken += 1;
      videoLoadToken += 1;
      setChannelStatus("이전 검색이 끝나면 이어서 확인합니다.", false);
    }
    return;
  }

  const token = ++streamerSearchToken;
  activeStreamerSearchNickname = nickname;
  streamerSearchInFlight = true;
  elements.streamerSearch.disabled = true;
  setChannelStatus("스트리머를 확인하는 중입니다.", false);

  try {
    await waitForStreamerSearchSlot();
    if (token !== streamerSearchToken) return;

    const result = await sendMessage({
      type: "CHEESE_SEARCH_FIND_CHANNEL",
      payload: { nickname },
    });

    if (token !== streamerSearchToken) return;

    if (result?.needsSelection) {
      const candidates = Array.isArray(result.candidates)
        ? result.candidates
        : [];
      if (!candidates.length) {
        setChannelStatus(
          "검색 결과가 없습니다. 닉네임을 다시 확인해 주세요.",
          true,
        );
        return;
      }
      channelCandidateKeyword = result.keyword || nickname;
      showChannelCandidateDialog(channelCandidateKeyword, candidates);
      setChannelStatus(
        "여러 후보가 있습니다. 사용할 채널을 선택해 주세요.",
        false,
      );
      return;
    }

    activeChannelId = result.channelId;
    activeChannelName = result.channelName || nickname;
    await applySelectedChannel(result);
  } catch (error) {
    if (token === streamerSearchToken) {
      setChannelStatus(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  } finally {
    streamerSearchInFlight = false;
    activeStreamerSearchNickname = "";
    const nextNickname = pendingStreamerNickname.trim();
    pendingStreamerNickname = "";
    if (
      nextNickname &&
      normalizeText(nextNickname) !== normalizeText(nickname)
    ) {
      elements.streamer.value = nextNickname;
      searchStreamer();
      return;
    }
    elements.streamerSearch.disabled = false;
  }
}

async function applySelectedChannel(candidate, keyword = "") {
  activeChannelId = candidate.channelId;
  activeChannelName = candidate.channelName || keyword || activeChannelName;
  elements.streamer.value = activeChannelName;
  videos = [];
  knownClipUIDs = new Set();
  fromCache = false;
  fetchInfo = null;
  resultSignature = "";
  progressResultSignature = "";
  renderedClipUIDs = new Set();
  visibleCount = RESULT_INITIAL_RENDER_COUNT;
  filteredVideosCache = null;
  updateSearchResetButtons();
  renderChannelStatus();
  await loadVideos(false);
}

function showChannelCandidateDialog(keyword, candidates) {
  closeChannelCandidateDialog();

  const overlay = document.createElement("div");
  overlay.className = "popup-channel-candidate-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "channelCandidateTitle");
  overlay.innerHTML = `
    <div class="popup-channel-candidate-dialog">
      <header class="popup-channel-candidate-header">
        <div>
          <h2 id="channelCandidateTitle">채널 후보 선택</h2>
          <p>'${escapeHtml(keyword)}' 검색 결과 중 사용할 채널을 선택해 주세요.</p>
        </div>
        <button type="button" class="popup-channel-candidate-close" data-channel-candidate-close aria-label="닫기">${createCloseIcon()}</button>
      </header>
      <div class="popup-channel-candidate-list">
        ${candidates.map(renderChannelCandidateButton).join("")}
      </div>
    </div>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeChannelCandidateDialog();
  });
  overlay
    .querySelector("[data-channel-candidate-close]")
    ?.addEventListener("click", closeChannelCandidateDialog);
  overlay
    .querySelectorAll("[data-channel-candidate-index]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.channelCandidateIndex);
        const candidate = candidates[index];
        if (candidate) {
          void selectChannelCandidate(candidate, keyword);
        }
      });
    });
  overlay.querySelectorAll("[data-official-badge]").forEach((image) => {
    image.addEventListener("error", () => {
      image.hidden = true;
      image
        .closest(".popup-channel-candidate-verified-wrap")
        ?.querySelector(".popup-channel-candidate-verified")
        ?.removeAttribute("hidden");
    });
  });
  hydrateChannelCandidateItems(overlay);

  channelCandidateDialog = overlay;
  document.body.append(overlay);
  setTimeout(() => {
    overlay
      .querySelector("[data-channel-candidate-index]:not(:disabled)")
      ?.focus();
  }, CANDIDATE_MIN_SKELETON_MS + 20);
}

function renderChannelCandidateButton(candidate, index) {
  const name = String(candidate?.channelName || "이름 없는 채널");
  const imageUrl = String(candidate?.channelImageUrl || "");
  const avatar = imageUrl
    ? `<span class="popup-channel-candidate-avatar-shimmer popup-candidate-shimmer"></span><img data-channel-candidate-avatar-img src="${escapeAttribute(imageUrl)}" alt="" referrerpolicy="no-referrer" loading="eager"><span class="popup-channel-candidate-avatar-initial" data-channel-candidate-avatar-fallback hidden>${escapeHtml(name.slice(0, 1) || "?")}</span>`
    : `<span class="popup-channel-candidate-avatar-shimmer popup-candidate-shimmer"></span><span class="popup-channel-candidate-avatar-initial" data-channel-candidate-avatar-fallback>${escapeHtml(name.slice(0, 1) || "?")}</span>`;
  const verified = candidate?.verifiedMark
    ? `<span class="popup-channel-candidate-verified-wrap"><img class="popup-channel-candidate-official" data-official-badge src="${escapeAttribute(OFFICIAL_MARK_ICON_URL)}" alt="인증"><em class="popup-channel-candidate-verified" hidden>인증</em></span>`
    : "";
  return `
    <button type="button" class="popup-channel-candidate-item is-loading${imageUrl ? " is-avatar-pending" : ""}" data-channel-candidate-index="${index}" disabled>
      <span class="popup-channel-candidate-avatar">${avatar}</span>
      <span class="popup-channel-candidate-text">
        <span class="popup-channel-candidate-skeleton-name popup-candidate-shimmer"></span>
        <span class="popup-channel-candidate-skeleton-id popup-candidate-shimmer"></span>
        <strong class="popup-channel-candidate-real"><span>${escapeHtml(name)}</span>${verified}</strong>
        <code class="popup-channel-candidate-real">${escapeHtml(candidate?.channelId || "")}</code>
      </span>
    </button>
  `;
}

function hydrateChannelCandidateItems(root) {
  root.querySelectorAll("[data-channel-candidate-index]").forEach((button) => {
    const skeletonStartedAt = performance.now();
    const image = button.querySelector("[data-channel-candidate-avatar-img]");
    const fallback = button.querySelector(
      "[data-channel-candidate-avatar-fallback]",
    );
    const avatarShimmer = button.querySelector(
      ".popup-channel-candidate-avatar-shimmer",
    );
    const textSkeletons = button.querySelectorAll(
      ".popup-channel-candidate-skeleton-name, .popup-channel-candidate-skeleton-id",
    );

    const revealText = () => {
      textSkeletons.forEach((skeleton) => skeleton.remove());
      button.classList.remove("is-loading");
      button.disabled = false;
    };
    const revealAvatar = () => {
      if (image) image.hidden = false;
      fallback?.remove();
      button.classList.remove("is-avatar-pending");
      button.classList.add("is-avatar-loaded");
      setTimeout(() => avatarShimmer?.remove(), CANDIDATE_AVATAR_FADE_MS);
    };
    const revealFallback = () => {
      image?.remove();
      if (fallback) fallback.hidden = false;
      avatarShimmer?.remove();
      button.classList.remove("is-avatar-pending");
      revealText();
    };
    const afterMinimumSkeleton = (callback) => {
      const elapsed = performance.now() - skeletonStartedAt;
      const delay = Math.max(0, CANDIDATE_MIN_SKELETON_MS - elapsed);
      setTimeout(callback, delay);
    };

    if (!image) {
      afterMinimumSkeleton(() => {
        revealAvatar();
        revealText();
      });
      return;
    }

    image.addEventListener(
      "load",
      () => {
        afterMinimumSkeleton(() => {
          revealAvatar();
          revealText();
        });
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        afterMinimumSkeleton(revealFallback);
      },
      { once: true },
    );

    if (image.complete) {
      if (image.naturalWidth > 0) {
        afterMinimumSkeleton(() => {
          revealAvatar();
          revealText();
        });
      } else {
        afterMinimumSkeleton(revealFallback);
      }
      return;
    }

    setTimeout(revealText, CANDIDATE_MIN_SKELETON_MS);
  });
}

async function selectChannelCandidate(candidate, keyword) {
  closeChannelCandidateDialog();
  const token = ++streamerSearchToken;
  streamerSearchInFlight = true;
  elements.streamerSearch.disabled = true;
  setChannelStatus("선택한 스트리머를 확인하는 중입니다.", false);

  try {
    const result = await sendMessage({
      type: "CHEESE_SEARCH_VALIDATE_CHANNEL",
      payload: { candidate, keyword },
    });
    if (token !== streamerSearchToken) return;
    await applySelectedChannel(result, keyword);
  } catch (error) {
    if (token === streamerSearchToken) {
      setChannelStatus(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  } finally {
    streamerSearchInFlight = false;
    elements.streamerSearch.disabled = false;
  }
}

function closeChannelCandidateDialog() {
  channelCandidateDialog?.remove();
  channelCandidateDialog = null;
  channelCandidateKeyword = "";
}

async function waitForStreamerSearchSlot() {
  const elapsed = Date.now() - lastStreamerSearchStartedAt;
  const delay = Math.max(0, STREAMER_SEARCH_COOLDOWN_MS - elapsed);
  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastStreamerSearchStartedAt = Date.now();
}

function renderSkeleton({ preserveSummary = false } = {}) {
  if (!preserveSummary) {
    elements.summary.textContent = "";
  }
  syncResultsMode();
  const skeletonCount = activeContentType === "clips" ? 4 : 6;
  elements.results.innerHTML = Array.from({ length: skeletonCount }, () =>
    renderSkeletonCard(),
  ).join("");
}

function renderSkeletonCard() {
  if (activeContentType === "clips") {
    return `
      <li class="popup-skeleton-card channel_clip_item__eVWfU" aria-hidden="true">
        <div class="clip_card_container__aoMWB clip_card_is_horizontal__lTG78 clip_card_is_blur__2VGDh">
          <span class="popup-clip-skeleton-thumb popup-skeleton-shimmer"></span>
          <div class="clip_card_wrapper__AcHtn">
            <span class="popup-skeleton-line popup-skeleton-title popup-skeleton-shimmer"></span>
            <span class="popup-skeleton-line popup-skeleton-title-short popup-skeleton-shimmer"></span>
            <span class="popup-skeleton-pill popup-skeleton-shimmer"></span>
          </div>
        </div>
      </li>
    `;
  }

  return `
    <li class="popup-card popup-skeleton-card" aria-hidden="true">
      <div class="popup-skeleton-thumb popup-skeleton-shimmer"></div>
      <div class="popup-body">
        <div class="popup-skeleton-line popup-skeleton-title popup-skeleton-shimmer"></div>
        <div class="popup-skeleton-line popup-skeleton-title-short popup-skeleton-shimmer"></div>
        <div class="popup-skeleton-meta">
          <span class="popup-skeleton-pill popup-skeleton-shimmer"></span>
          <span class="popup-skeleton-pill popup-skeleton-shimmer"></span>
        </div>
        <div class="popup-skeleton-tags">
          <span class="popup-skeleton-tag popup-skeleton-shimmer"></span>
          <span class="popup-skeleton-tag popup-skeleton-shimmer"></span>
          <span class="popup-skeleton-tag popup-skeleton-shimmer"></span>
        </div>
      </div>
    </li>
  `;
}

function render() {
  syncFilterUrl();
  syncResultsMode();

  if (!videos.length) {
    elements.summary.textContent = "";
    renderNoContent();
    return;
  }

  const nextResultSignature = getResultSignature();
  if (resultSignature !== nextResultSignature) {
    resultSignature = nextResultSignature;
    visibleCount = RESULT_INITIAL_RENDER_COUNT;
  }
  const filtered = getFilteredVideos();

  const visibleResults = filtered.slice(0, visibleCount);
  updateSummary(filtered);

  if (!filtered.length) {
    if (activeContentType === "clips" && activeFetchRequestId && !fetchInfo) {
      elements.results.innerHTML = renderSearchingStatus();
      return;
    }
    elements.results.innerHTML = renderSearchEmpty(elements.query.value);
    return;
  }

  elements.results.innerHTML = visibleResults.map(renderCard).join("");
  if (activeContentType === "clips") {
    renderedClipUIDs = new Set(
      visibleResults
        .map((clip) => String(clip?.clipUID || "").trim())
        .filter(Boolean),
    );
  }
  normalizeRenderedClipCards(elements.results);
}

let filteredVideosCache = null;

function getFilteredVideos() {
  const signature = getResultSignature();
  if (
    filteredVideosCache &&
    filteredVideosCache.signature === signature &&
    filteredVideosCache.videosLength === videos.length &&
    filteredVideosCache.videosRef === videos
  ) {
    return filteredVideosCache.result;
  }

  const dateFrom = elements.dateFrom.value
    ? getDayStart(elements.dateFrom.value)
    : 0;
  const dateTo = elements.dateTo.value ? getDayEnd(elements.dateTo.value) : 0;
  const searchOptions = getSearchOptions();

  const result = videos
    .filter((video) => {
      const videoTime = getItemTime(video);
      if (dateFrom && videoTime < dateFrom) return false;
      if (dateTo && videoTime > dateTo) return false;
      if (
        activeContentType === "videos" &&
        !matchesDuration(video, elements.durationPicker.dataset.duration)
      ) {
        return false;
      }
      if (
        activeContentType === "videos" &&
        !matchesVideoType(video, elements.videoTypePicker.dataset.videoType)
      ) {
        return false;
      }
      return (
        CheeseSearchQuery.matches(video, elements.query.value, searchOptions) &&
        matchesActiveCategoryFilter(video, searchOptions)
      );
    })
    .sort((a, b) => {
      if (
        elements.sortPicker.dataset.sort === "popular" ||
        elements.sortPicker.dataset.sort === "views"
      ) {
        return (
          getViewCount(b) - getViewCount(a) || getItemTime(b) - getItemTime(a)
        );
      }
      if (elements.sortPicker.dataset.sort === "livePv") {
        return (
          getLivePvCount(b) - getLivePvCount(a) ||
          getItemTime(b) - getItemTime(a)
        );
      }
      const diff = getItemTime(b) - getItemTime(a);
      return elements.sortPicker.dataset.sort === "oldest" ? -diff : diff;
    });

  filteredVideosCache = {
    signature,
    videosLength: videos.length,
    videosRef: videos,
    result,
  };
  return result;
}

function updateSummary(filtered) {
  if (shouldHideClipSummary()) {
    elements.summary.textContent = "";
    return;
  }
  elements.summary.innerHTML = `
    <span>검색 결과 ${filtered.length.toLocaleString("ko-KR")}개 / 전체 ${videos.length.toLocaleString("ko-KR")}개</span>
  `;
}

function shouldHideClipSummary() {
  return (
    activeContentType === "clips" &&
    activeFetchRequestId &&
    !fetchInfo &&
    !activeFetchSilentRevalidate
  );
}

function getResultSignature() {
  return [
    elements.query.value.trim(),
    elements.categoryChip.dataset.categoryFilter || "",
    elements.dateFrom.value,
    elements.dateTo.value,
    elements.durationPicker.dataset.duration || "all",
    elements.videoTypePicker.dataset.videoType || "all",
    elements.sortPicker.dataset.sort || "latest",
  ].join("|");
}

function matchesActiveCategoryFilter(video, searchOptions) {
  const categoryFilter = String(
    elements.categoryChip.dataset.categoryFilter || "",
  ).trim();
  if (!categoryFilter) return true;
  return CheeseSearchQuery.matches(
    video,
    CheeseSearchQuery.buildCategoryTerm(categoryFilter),
    searchOptions,
  );
}

function renderSearchEmpty(query) {
  const trimmedQuery = String(query || "").trim();
  const title = trimmedQuery
    ? `'<span>${escapeHtml(trimmedQuery)}</span>' 검색 결과가 없습니다.`
    : "검색 조건에 맞는 결과가 없습니다.";

  return `
    <li class="popup-empty">
      <div class="popup-empty-visual" aria-hidden="true">
        <img src="${escapeAttribute(EMPTY_RESULTS_ANIMATION_URL)}" alt="" loading="lazy" decoding="async">
      </div>
      <strong>${title}</strong>
      <p>검색어 또는 필터를 확인해주세요.</p>
    </li>
  `;
}

function renderSearchingStatus() {
  return `
    <li class="popup-empty popup-searching">
      <div class="popup-searching-visual" aria-hidden="true">
        <img src="${escapeAttribute(SEARCHING_ANIMATION_URL)}" alt="" loading="lazy" decoding="async">
      </div>
      <strong>클립을 모으며 검색 중입니다.</strong>
      <p>현재 ${videos.length.toLocaleString("ko-KR")}개를 확인했습니다.</p>
    </li>
  `;
}

function renderNoContent() {
  elements.results.innerHTML = `
    <li class="popup-no-content no_content_container">
      <i class="popup-no-content-image no_content_image no_content_image_video" aria-hidden="true"></i>
      <p class="popup-no-content-text no_content_text">등록된 ${getContentLabel()}이 없습니다.</p>
    </li>
  `;
}

function getChannelNameFromVideos(items) {
  const first = Array.isArray(items)
    ? items.find((item) => item?.channel?.channelName)
    : null;
  return first ? String(first.channel.channelName || "").trim() : "";
}

function renderChannelStatus() {
  if (!activeChannelId) {
    setChannelStatus(
      "현재 채널이 없습니다. 스트리머 닉네임으로 검색해 주세요.",
      false,
    );
    return;
  }

  const label = activeChannelName || activeChannelId;
  setChannelStatus(`검색 대상: ${label}`, false);
}

function setChannelStatus(message, isError) {
  elements.channelStatus.textContent = message;
  elements.channelStatus.classList.toggle("is-error", Boolean(isError));
}

function getVideoUrl(video) {
  return `https://chzzk.naver.com/video/${video.videoNo}`;
}

function getCategoryUrl(video) {
  const categoryType = String(video?.categoryType || "").trim();
  const videoCategory = String(video?.videoCategory || "").trim();
  if (!categoryType || !videoCategory) return "";
  return `https://chzzk.naver.com/category/${encodeURIComponent(categoryType)}/${encodeURIComponent(videoCategory)}/videos`;
}

function getTagUrl(tag) {
  return `https://chzzk.naver.com/videos?tags=${encodeURIComponent(tag)}`;
}

function getItemTime(item) {
  return (
    Number(item?.publishDateAt || 0) ||
    parsePublishDate(item?.publishDate) ||
    parsePublishDate(item?.createdDate)
  );
}

function getViewCount(item) {
  return Number(item?.readCount ?? item?.viewCount ?? 0);
}

function getLivePvCount(item) {
  return Number(item?.livePv ?? 0);
}

function isUploadVideoType(video) {
  return String(video?.videoType || "").toUpperCase() === "UPLOAD";
}

function getVideoTypeLabel(video) {
  return isUploadVideoType(video) ? "업로드" : "다시보기";
}

function matchesVideoType(video, filterValue) {
  if (filterValue === "watching") return isWatchingVideo(video);
  if (filterValue === "unwatched") return isUnwatchedVideo(video);
  if (filterValue === "upload") return isUploadVideoType(video);
  if (filterValue === "replay") return !isUploadVideoType(video);
  return true;
}

function isWatchingVideo(video) {
  if (video?.watchTimeline == null) return false;
  const durationSeconds = Number(video?.duration || 0);
  if (!durationSeconds) return false;
  const watchedSeconds = normalizeWatchTimelineSeconds(
    video.watchTimeline,
    durationSeconds,
  );
  return (
    watchedSeconds !== null &&
    watchedSeconds > 0 &&
    watchedSeconds < durationSeconds
  );
}

function isUnwatchedVideo(video) {
  if (video?.watchTimeline == null) return true;
  const durationSeconds = Number(video?.duration || 0);
  if (!durationSeconds) return false;
  const watchedSeconds = normalizeWatchTimelineSeconds(
    video.watchTimeline,
    durationSeconds,
  );
  return watchedSeconds === null || watchedSeconds <= 0;
}

function renderWatchTimelineBar(video, classPrefix) {
  const percent = getWatchTimelinePercent(video);
  if (percent === null) return "";
  const width = Math.max(0, Math.min(100, percent));
  return `
    <span class="${classPrefix}-watch-timeline" aria-hidden="true">
      <span style="width: ${width.toFixed(2)}%"></span>
    </span>
  `;
}

function getWatchTimelinePercent(video) {
  if (video?.watchTimeline == null) return null;
  const durationSeconds = Number(video?.duration || 0);
  if (!durationSeconds) return null;
  const watchedSeconds = normalizeWatchTimelineSeconds(
    video.watchTimeline,
    durationSeconds,
  );
  if (watchedSeconds === null) return null;
  return (watchedSeconds / durationSeconds) * 100;
}

function normalizeWatchTimelineSeconds(value, durationSeconds) {
  if (typeof value === "number") {
    return normalizeWatchTimelineNumber(value, durationSeconds);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(?::\d+){1,2}$/.test(trimmed)) {
      const parts = trimmed.split(":").map(Number);
      return parts.reduce((total, part) => total * 60 + part, 0);
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric)
      ? normalizeWatchTimelineNumber(numeric, durationSeconds)
      : null;
  }
  if (value && typeof value === "object") {
    const candidates = [
      "watchTime",
      "watchTimeSec",
      "watchTimeline",
      "lastWatchTime",
      "currentTime",
      "currentTimestamp",
      "playTime",
      "position",
      "seconds",
      "time",
    ];
    for (const key of candidates) {
      if (value[key] == null) continue;
      const normalized = normalizeWatchTimelineSeconds(
        value[key],
        durationSeconds,
      );
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

function normalizeWatchTimelineNumber(value, durationSeconds) {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value * durationSeconds;
  if (value > durationSeconds && value / 1000 <= durationSeconds * 1.1) {
    return value / 1000;
  }
  return value;
}

function getSearchOptions() {
  if (activeContentType === "clips") {
    return {
      useTags: false,
      fields: [
        "clipTitle",
        "clipCategoryValue",
        "categoryValue",
        "clipCategory",
        "categoryType",
        "ownerChannelId",
      ],
      categoryFields: ["clipCategoryValue", "categoryValue", "clipCategory"],
    };
  }
  return {};
}

function parsePublishDate(value) {
  if (!value) return 0;
  const text = String(value).trim();
  if (/T/.test(text)) {
    return new Date(text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).getTime();
  }
  return new Date(text.replace(" ", "T") + "+09:00").getTime();
}

function getDayStart(value) {
  return new Date(`${value}T00:00:00+09:00`).getTime();
}

function getDayEnd(value) {
  return new Date(`${value}T23:59:59.999+09:00`).getTime();
}

function formatDateLabel(value) {
  const [year, month, day] = value.split("-");
  return `${String(year || "").slice(-2)}.${month}.${day}.`;
}

function normalizeText(value) {
  return CheeseSearchQuery.normalizeText(value);
}

function normalizeClipFilterType(value) {
  const normalized = String(value || "ALL").toUpperCase();
  return [
    "ALL",
    "WITHIN_ONE_DAY",
    "WITHIN_SEVEN_DAYS",
    "WITHIN_THIRTY_DAYS",
  ].includes(normalized)
    ? normalized
    : "ALL";
}

function getClipOrderTypeFromSort(sort) {
  if (activeContentType !== "clips") return "RECENT";
  if (sort === "popular") return "POPULAR";
  return "RECENT";
}

function normalizeClipOrderType(value) {
  const normalized = String(value || "RECENT").toUpperCase();
  return normalized === "POPULAR" ? "POPULAR" : "RECENT";
}

function getInitialSortValue() {
  if (activeContentType !== "clips") return "latest";
  return normalizeClipOrderType(params.get("orderType")) === "POPULAR"
    ? "popular"
    : "latest";
}

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(video) {
  const time = getItemTime(video);
  if (!time) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
}

function getPublishTime(video) {
  return getItemTime(video);
}

function getLiveStartTime(video) {
  const publishTime = getPublishTime(video);
  const durationSeconds = Number(video?.duration || 0);

  if (!publishTime || !durationSeconds) return 0;
  return publishTime - durationSeconds * 1000;
}

function formatDateTimeFromMs(time) {
  if (!time) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(time));
}

function formatLiveStartDateTime(video) {
  return formatDateTimeFromMs(getLiveStartTime(video));
}

function formatPublishDateTime(video) {
  return formatDateTimeFromMs(getPublishTime(video));
}

function formatClipCreatedDate(clip) {
  const time = getItemTime(clip);
  if (!time) return "";
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}.`;
}

function matchesDuration(video, filterValue) {
  const filter = DURATION_FILTERS[filterValue] || DURATION_FILTERS.all;
  if (filter === DURATION_FILTERS.all) return true;
  const seconds = Number(video?.duration || 0);
  return seconds >= filter.min && seconds <= filter.max;
}

function formatCompactCount(value) {
  const number = Number(value || 0);
  if (number >= 10000) {
    const compact = Math.floor(number / 1000) / 10;
    return `${compact.toLocaleString("ko-KR")}만`;
  }
  return number.toLocaleString("ko-KR");
}

function isAdultVideo(video) {
  return (
    video?.adult === true || String(video?.adult || "").toLowerCase() === "true"
  );
}

function canShowAdultThumbnail(video) {
  return !isAdultVideo(video) || Boolean(video?.thumbnailImageUrl);
}

function getThumbnailImageUrl(video) {
  const imageUrl = String(video?.thumbnailImageUrl || "").trim();
  if (!imageUrl) return imageUrl;

  try {
    const url = new URL(imageUrl);
    if (isLiveRewindThumbnailUrl(url)) return url.toString();
    const type = url.searchParams.get("type") || "";
    if (!type.includes("blur")) {
      url.searchParams.set("type", "o500x280_blur");
    }
    return url.toString();
  } catch (_error) {
    return imageUrl;
  }
}

function isLiveRewindThumbnailUrl(url) {
  return (
    url.hostname === "livecloud-thumb.akamaized.net" &&
    url.pathname.includes("/live-rewind-image/")
  );
}

function renderCard(video) {
  if (activeContentType === "clips") {
    return renderClipCard(video);
  }

  const tags = Array.isArray(video.tags) ? video.tags.slice(0, 5) : [];
  const isAdult = isAdultVideo(video);
  const showThumbnail = canShowAdultThumbnail(video);
  const thumbnailImageUrl = getThumbnailImageUrl(video);
  const videoTypeLabel = getVideoTypeLabel(video);
  const isUploadVideo = isUploadVideoType(video);
  const videoTypeBadgeClasses = [
    "popup-thumb-badge",
    "popup-thumb-badge-replay",
    isUploadVideo ? "popup-thumb-badge-upload" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const thumbClasses = [
    "popup-thumb",
    isAdult ? "is-adult" : "",
    isAdult && !showThumbnail ? "is-dimmed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const categoryUrl = getCategoryUrl(video);
  const categoryHtml = video.videoCategoryValue
    ? categoryUrl
      ? `<a href="${escapeAttribute(categoryUrl)}" target="_blank" rel="noreferrer" data-cheese-category-filter="${escapeAttribute(video.videoCategoryValue)}"><span class="popup-category">${escapeHtml(video.videoCategoryValue)}</span></a>`
      : `<span class="popup-category">${escapeHtml(video.videoCategoryValue)}</span>`
    : "";
  const tagHtml = tags
    .map(
      (tag) =>
        `<a href="${escapeAttribute(getTagUrl(tag))}" target="_blank" rel="noreferrer"><span class="popup-category popup-tag">${escapeHtml(tag)}</span></a>`,
    )
    .join("");
  const livePvBadge = video.livePv
    ? `<span class="popup-thumb-badge">${formatCompactCount(video.livePv)}회 시청된 라이브</span>`
    : "";
  const watchTimelineBar = renderWatchTimelineBar(video, "popup");
  return `
    <li class="popup-card">
      <a class="${thumbClasses}" href="${getVideoUrl(video)}" target="_blank" rel="noreferrer">
        ${isAdult ? `<span class="popup-sr-only">19 연령 제한</span>` : ""}
        ${isAdult && !showThumbnail ? `<span class="popup-adult-dimmed"></span>` : ""}
        ${showThumbnail && thumbnailImageUrl ? `<img alt="" src="${escapeAttribute(thumbnailImageUrl)}" loading="lazy">` : ""}
        ${isAdult ? `<span class="popup-age-limit" aria-hidden="true"><span class="age-limit-number">19</span><span class="age-limit-text">연령 제한</span></span>` : ""}
        <div class="popup-thumb-badges">
          <em class="${videoTypeBadgeClasses}">${videoTypeLabel}</em>
          ${livePvBadge}
        </div>
        <span class="popup-duration">${formatDuration(video.duration)}</span>
        ${watchTimelineBar}
      </a>
      <div class="popup-body">
        <a class="popup-title" href="${getVideoUrl(video)}" target="_blank" rel="noreferrer">${escapeHtml(video.videoTitle || "제목 없음")}</a>
        <div class="popup-meta">
          <span>조회수 ${Number(video.readCount || 0).toLocaleString("ko-KR")}회</span>
          <div>
            ${
              formatLiveStartDateTime(video)
                ? `<span class="popup-live">${escapeHtml(formatLiveStartDateTime(video))}</span>`
                : ""
            }
            ${
              formatPublishDateTime(video)
                ? `<span class="popup-publish">${escapeHtml(formatPublishDateTime(video))}</span>`
                : ""
            }          
          </div>
        </div>
        ${categoryHtml || tagHtml ? `<div class="popup-link-info">${categoryHtml}${tagHtml}</div>` : ""}
      </div>
    </li>
  `;
}

function getClipUrl(clip) {
  return `https://chzzk.naver.com/clips/${encodeURIComponent(String(clip?.clipUID || ""))}`;
}

function getClipCategoryUrl(clip) {
  const categoryType = String(clip?.categoryType || "").trim();
  const clipCategory = String(clip?.clipCategory || "").trim();
  if (!categoryType || !clipCategory) return "";
  return `https://chzzk.naver.com/category/${encodeURIComponent(categoryType)}/${encodeURIComponent(clipCategory)}/clips`;
}

function getClipCategoryLabel(clip) {
  return String(
    clip?.clipCategoryValue || clip?.categoryValue || clip?.clipCategory || "",
  ).trim();
}

function createClipPlayIcon() {
  return `
    <svg width="11" height="12" viewBox="0 0 9 10" fill="none" xmlns="http://www.w3.org/2000/svg" class="clip_card_icon_play__NHlLB" aria-hidden="true">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M3.23261 1.29239C2.7002 0.950127 2 1.3324 2 1.96533V8.03467C2 8.6676 2.7002 9.04987 3.23261 8.70761L7.9532 5.67294C8.44306 5.35803 8.44306 4.64197 7.9532 4.32706L3.23261 1.29239Z" stroke="currentColor"></path>
    </svg>
  `;
}

function createClipCategoryIcon() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="15" fill="none" viewBox="0 0 14 15" role="img" aria-hidden="true">
      <circle cx="4.085" cy="4.585" r="1.885" stroke="currentColor" stroke-width="0.9"></circle>
      <path stroke="currentColor" stroke-width="0.9" d="M8 3.7a1 1 0 0 1 1-1h1.78a1 1 0 0 1 .99 1v1.78a1 1 0 0 1-1 .99H9a1 1 0 0 1-.99-1z"></path>
      <path fill="currentColor" fill-rule="evenodd" d="M1.75 9.44c0-.8.65-1.44 1.44-1.44h1.79c.8 0 1.44.65 1.44 1.44v1.79c0 .8-.65 1.44-1.44 1.44H3.19c-.8 0-1.44-.64-1.44-1.44zm1.44-.55c-.3 0-.55.25-.55.55v1.79c0 .3.25.55.55.55h1.79c.3 0 .55-.25.55-.55V9.44c0-.3-.25-.55-.55-.55z" clip-rule="evenodd"></path>
      <path stroke="currentColor" stroke-width="0.9" d="M9.23 8.92a.73.73 0 0 1 1.28 0l1.15 1.99a.73.73 0 0 1-.64 1.1h-2.3a.73.73 0 0 1-.63-1.1z"></path>
    </svg>
  `;
}

function renderClipAdultArea() {
  return `
    <div class="clip_card_area__gi6nZ">
      <svg width="38" height="38" viewBox="0 0 14 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="7" cy="7.5" r="6.4" stroke="currentColor" stroke-width="1.2"></circle>
        <path d="M8.65333 10.4453C7.71108 10.4453 7.02114 10.0116 6.78459 9.50302C6.7294 9.39263 6.70574 9.29406 6.70574 9.19156C6.70574 8.92741 6.88315 8.72635 7.19855 8.72635C7.43904 8.72635 7.57309 8.83279 7.7505 9.02992C8.01465 9.34926 8.26697 9.50302 8.6967 9.50302C9.53645 9.50302 9.92281 8.70269 9.92675 7.516V7.45292H9.9031C9.69809 8.00093 9.13826 8.37546 8.38918 8.37546C7.33654 8.37546 6.50073 7.62639 6.50073 6.51855C6.50073 5.33975 7.42327 4.5 8.69275 4.5C9.59953 4.5 10.3171 4.92185 10.731 5.75765C10.9479 6.19527 11.0661 6.75904 11.0661 7.42532C11.0661 9.31772 10.1633 10.4453 8.65333 10.4453ZM8.6967 7.49235C9.2999 7.49235 9.75328 7.0705 9.75328 6.49096C9.75328 5.90353 9.29596 5.45014 8.70852 5.45014C8.12109 5.45014 7.65982 5.89564 7.65982 6.47124C7.65982 7.06656 8.10138 7.49235 8.6967 7.49235Z" fill="currentColor"></path>
        <path d="M4.98 10.4017C4.62912 10.4017 4.38863 10.1652 4.38863 9.80643V5.73384H4.36497L3.53311 6.31339C3.42272 6.39224 3.33993 6.41984 3.21771 6.41984C2.97722 6.41984 2.7998 6.24637 2.7998 5.99405C2.7998 5.81269 2.87077 5.67865 3.05607 5.54855L4.18362 4.76793C4.45959 4.5787 4.64883 4.54321 4.89326 4.54321C5.31511 4.54321 5.56743 4.79947 5.56743 5.20949V9.80643C5.56743 10.1652 5.33088 10.4017 4.98 10.4017Z" fill="currentColor"></path>
      </svg>
      <span class="blind">19</span>
      <em class="clip_card_description__k7S+l">연령 제한</em>
    </div>
  `;
}

function renderClipCategoryLink(clip) {
  const categoryLabel = getClipCategoryLabel(clip);
  const categoryUrl = getClipCategoryUrl(clip);
  if (!categoryLabel || !categoryUrl) return "";
  return `
    <a class="cheese-search-clip-category-link" href="${escapeAttribute(categoryUrl)}" target="_blank" rel="noreferrer" data-cheese-category-filter="${escapeAttribute(categoryLabel)}">
      <span>${createClipCategoryIcon()}</span>
      <div><span>${escapeHtml(categoryLabel)}</span></div>
    </a>
  `;
}

function getClipThumbnailImageUrl(clip) {
  return String(clip?.thumbnailImageUrl || "").trim();
}

function getClipBlurThumbnailImageUrl(clip) {
  const imageUrl = getClipThumbnailImageUrl(clip);
  if (!imageUrl) return imageUrl;

  try {
    const url = new URL(imageUrl);
    url.searchParams.set("type", "o280x500_blur");
    return url.toString();
  } catch (_error) {
    const separator = imageUrl.includes("?") ? "&" : "?";
    return `${imageUrl}${separator}type=o280x500_blur`;
  }
}

function renderClipCard(clip) {
  const thumbnailImageUrl = getClipThumbnailImageUrl(clip);
  const isAdult = isAdultVideo(clip);
  const clipUID = String(clip?.clipUID || "").trim();
  const cachedOrientation = clipUID
    ? clipOrientationCache.get(clipUID)
    : undefined;
  const blurThumbnailImageUrl = getClipBlurThumbnailImageUrl(clip);
  const resolvedBackgroundUrl = thumbnailImageUrl
    ? cachedOrientation === "vertical"
      ? thumbnailImageUrl
      : blurThumbnailImageUrl
    : "";
  const backgroundImage = resolvedBackgroundUrl
    ? ` style="background-image: url('${escapeAttribute(resolvedBackgroundUrl)}');"`
    : "";
  const orientationClass = cachedOrientation
    ? cachedOrientation === "vertical"
      ? "clip_card_is_vertical__4prEq"
      : "clip_card_is_horizontal__lTG78 clip_card_is_blur__2VGDh"
    : "clip_card_is_horizontal__lTG78 clip_card_is_blur__2VGDh";
  const clipContainerClasses = [
    "clip_card_container__aoMWB",
    orientationClass,
    isAdult ? "cheese-search-clip-is-adult" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const orientationReady = cachedOrientation
    ? ' data-clip-orientation-ready="1"'
    : "";
  const title = String(clip?.clipTitle || "제목 없음");
  const createdDate = formatClipCreatedDate(clip);
  const clipUrl = getClipUrl(clip);
  const categoryLink = isAdult ? "" : renderClipCategoryLink(clip);

  return `
    <li class="channel_clip_item__eVWfU">
      <div class="clip_card_link__Pxcf6">
        <div class="${clipContainerClasses}"${backgroundImage} data-clip-thumbnail-url="${escapeAttribute(thumbnailImageUrl)}" data-clip-uid="${escapeAttribute(clipUID)}"${orientationReady}>
          <a class="cheese-search-clip-cover-link" href="${escapeAttribute(clipUrl)}" target="_blank" rel="noreferrer" aria-label="${escapeAttribute(title)}"></a>
          <div class="clip_card_wrapper__AcHtn">
            ${isAdult ? renderClipAdultArea() : ""}
            <strong class="clip_card_title__Pc2jc">${escapeHtml(title)}</strong>
            ${categoryLink}
            <span class="clip_card_information__8-dGy clip_card_-play__hqsAe">
              <span class="cheese-search-clip-info-main">
                ${createClipPlayIcon()}<span class="blind">재생 수</span>${formatCompactCount(clip?.readCount)}
                ${createdDate ? `<span class="cheese-search-clip-date">${escapeHtml(createdDate)}</span>` : ""}
              </span>
              <span class="cheese-search-clip-duration">${formatDuration(clip?.duration)}</span>
            </span>
          </div>
        </div>
        <div></div>
      </div>
    </li>
  `;
}

function normalizeRenderedClipCards(root = document) {
  if (activeContentType !== "clips") return;
  root
    .querySelectorAll(
      "[data-clip-thumbnail-url]:not([data-clip-orientation-ready])",
    )
    .forEach(normalizeClipCardOrientation);
}

function normalizeClipCardOrientation(container) {
  const thumbnailImageUrl = String(
    container.dataset.clipThumbnailUrl || "",
  ).trim();
  const clipUID = String(container.dataset.clipUid || "").trim();
  container.dataset.clipOrientationReady = "1";
  if (!thumbnailImageUrl) return;

  const image = new Image();
  image.onload = () => {
    const isVertical = image.naturalHeight > image.naturalWidth;
    if (clipUID) {
      clipOrientationCache.set(clipUID, isVertical ? "vertical" : "horizontal");
    }
    container.classList.toggle("clip_card_is_vertical__4prEq", isVertical);
    container.classList.toggle("clip_card_is_horizontal__lTG78", !isVertical);
    container.classList.toggle("clip_card_is_blur__2VGDh", !isVertical);
    container.style.backgroundImage = `url("${isVertical ? thumbnailImageUrl : getClipBlurThumbnailImageUrl({ thumbnailImageUrl })}")`;
  };
  image.src = thumbnailImageUrl;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

elements.query.addEventListener("input", updateSearchResetButtons);
elements.query.addEventListener("input", debounce(handleFilterChange, 120));
elements.results.addEventListener("click", handleCategoryFilterClick);
elements.categoryChip.addEventListener("click", () => {
  setCategoryFilter("");
  handleFilterChange();
  elements.query.focus();
});
elements.queryReset.addEventListener("click", handleSearchReset);
elements.streamer.addEventListener("input", () => {
  updateSearchResetButtons();
  closeChannelCandidateDialog();
});
elements.streamerReset.addEventListener("click", handleSearchReset);
elements.datePickers.forEach((picker) => {
  picker.addEventListener("click", handleDatePickerClick);
});
elements.durationPicker.addEventListener("click", handleDurationClick);
elements.videoTypePicker.addEventListener("click", handleVideoTypeClick);
elements.sortPicker.addEventListener("click", handleSortClick);
document.addEventListener("click", closeDurationFromOutside);
document.addEventListener("click", closeVideoTypeFromOutside);
document.addEventListener("click", closeSortFromOutside);
document.addEventListener("click", closeDatePickersFromOutside);
elements.queryHelp.addEventListener("click", toggleQueryHelp);
document.addEventListener("click", closeQueryHelpFromOutside);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeChannelCandidateDialog();
});
elements.resetFilters.addEventListener("click", resetFilters);
elements.themeToggle.addEventListener("click", toggleTheme);
elements.refresh.addEventListener("click", handleRefreshClick);
elements.streamerSearch.addEventListener("click", searchStreamer);
elements.streamer.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  searchStreamer();
});
ensureScrollTopButton();
window.addEventListener("scroll", debounce(handleWindowScroll, 120), {
  passive: true,
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "CHEESE_SEARCH_FETCH_PROGRESS") return;
  if (!activeFetchRequestId || message.requestId !== activeFetchRequestId)
    return;
  const progressChannelId = message.progress?.channelId;
  if (progressChannelId && progressChannelId !== activeChannelId) return;
  const progressContentType = message.progress?.contentType;
  if (
    progressContentType &&
    progressContentType !== activeContentType &&
    !(progressContentType === "videos" && activeContentType !== "clips")
  ) {
    return;
  }
  const progress = message.progress || {};
  const isSilent = activeFetchSilentRevalidate;
  if (!isSilent) {
    appendProgressClips(progress);
    setFetchProgress(progress);
  }
  if (progress.phase === "error") {
    elements.summary.textContent =
      progress.error || "클립 목록을 불러오지 못했습니다.";
    activeFetchRequestId = "";
    activeFetchSilentRevalidate = false;
    fetchInfo = null;
    clearProgressStallTimer();
    scheduleClearFetchProgress();
    updateRefreshButton();
    return;
  }
  if (progress.phase === "done" && activeContentType === "clips") {
    activeFetchRequestId = "";
    fetchInfo = progress;
    activeFetchSilentRevalidate = false;
    clearProgressStallTimer();
    updateRefreshButton();
    if (!isSilent) {
      renderProgressClipCards();
    }
    scheduleClearFetchProgress();
    return;
  }
  if (progress.phase === "queued") {
    resetProgressStallTimer();
    if (activeContentType === "clips") {
      renderProgressClipCards();
    } else {
      elements.summary.textContent = "다른 검색이 끝나면 이어서 불러옵니다.";
    }
    return;
  }
  resetProgressStallTimer();
});

function resetProgressStallTimer() {
  clearProgressStallTimer();
  progressStallTimer = setTimeout(
    handleProgressStall,
    PROGRESS_STALL_TIMEOUT_MS,
  );
}

function clearProgressStallTimer() {
  if (progressStallTimer) {
    clearTimeout(progressStallTimer);
    progressStallTimer = 0;
  }
}

async function handleProgressStall() {
  progressStallTimer = 0;
  if (!activeFetchRequestId || !activeChannelId) return;
  const isClipSearch = activeContentType === "clips";
  if (!isClipSearch) return;
  const newRequestId = createRequestId("popup-resume");
  const previousRequestId = activeFetchRequestId;
  activeFetchRequestId = newRequestId;
  let response;
  try {
    response = await sendMessage({
      type: "CHEESE_SEARCH_RESUBSCRIBE",
      payload: {
        channelId: activeChannelId,
        contentType: isClipSearch ? "clips" : "videos",
        videoType: "",
        sortType: "LATEST",
        filterType: normalizeClipFilterType(params.get("filterType")),
        orderType: getClipOrderTypeFromSort(elements.sortPicker.dataset.sort),
        requestId: newRequestId,
      },
    });
  } catch {
    response = null;
  }
  if (response) {
    if (response.lastPhase === "done") {
      activeFetchRequestId = "";
      fetchInfo = response;
      activeFetchSilentRevalidate = false;
      updateRefreshButton();
      renderProgressClipCards();
      return;
    }
    updateRefreshButton();
    resetProgressStallTimer();
    return;
  }
  activeFetchRequestId = previousRequestId;
  activeFetchRequestId = "";
  activeFetchSilentRevalidate = false;
  updateRefreshButton();
  loadVideos(false);
}

updateRefreshButton();
loadVideos(false);

function handleFilterChange() {
  if (activeContentType === "clips" && activeFetchRequestId) {
    renderProgressClipCards();
    return;
  }
  render();
}

function handleCategoryFilterClick(event) {
  const link = event.target.closest("[data-cheese-category-filter]");
  if (!link || event.ctrlKey) return;
  if (!elements.results.contains(link)) return;

  event.preventDefault();
  event.stopPropagation();
  applyCategoryFilter(link.dataset.cheeseCategoryFilter);
}

function applyCategoryFilter(category) {
  setCategoryFilter(category);
  updateSearchResetButtons();
  handleFilterChange();
  elements.query.focus();
}

function setCategoryFilter(category) {
  const value = String(category || "").trim();
  if (value) {
    elements.categoryChip.dataset.categoryFilter = value;
  } else {
    delete elements.categoryChip.dataset.categoryFilter;
  }
  updateCategoryChip();
}

function updateCategoryChip() {
  const value = String(
    elements.categoryChip.dataset.categoryFilter || "",
  ).trim();
  elements.categoryChip.hidden = !value;
  elements.categoryChipLabel.textContent = value ? `${value}` : "";
}

function updateSearchResetButtons() {
  elements.queryReset.hidden = !elements.query.value;
  elements.streamerReset.hidden = !elements.streamer.value;
}

function handleSearchReset(event) {
  event.preventDefault();
  const target = event.currentTarget.dataset.searchReset;
  if (target === "query") {
    elements.query.value = "";
    updateSearchResetButtons();
    resultSignature = "";
    visibleCount = RESULT_INITIAL_RENDER_COUNT;
    handleFilterChange();
    elements.query.focus();
    return;
  }
  elements.streamer.value = "";
  updateSearchResetButtons();
  elements.streamer.focus();
}

function handleWindowScroll() {
  updateScrollTopButton();
  if (!videos.length) return;
  if (!isNearBottom()) return;
  revealMoreResults();
}

function isNearBottom() {
  return (
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - RESULT_SCROLL_THRESHOLD_PX
  );
}

function revealMoreResults() {
  const filtered = getFilteredVideos();
  const nextVisibleCount = Math.min(
    filtered.length,
    visibleCount + RESULT_RENDER_STEP_COUNT,
  );
  if (nextVisibleCount <= visibleCount) return;
  const nextResults = filtered.slice(visibleCount, nextVisibleCount);
  visibleCount = nextVisibleCount;
  elements.results.insertAdjacentHTML(
    "beforeend",
    nextResults.map(renderCard).join(""),
  );
  normalizeRenderedClipCards(elements.results);
  updateSummary(filtered);
}

function syncResultsMode() {
  elements.results.dataset.contentType = activeContentType;
  elements.results.classList.toggle(
    "channel_component_list__kCgKT",
    activeContentType === "clips",
  );
  elements.results.classList.toggle(
    "channel_component_type_clip__kt2kT",
    activeContentType === "clips",
  );
}

function createScrollTopIcon() {
  return `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function ensureScrollTopButton() {
  let button = document.querySelector(".popup-scroll-top");
  if (button) return button;
  button = document.createElement("button");
  button.type = "button";
  button.className = "popup-scroll-top";
  button.setAttribute("aria-label", "최상단으로 이동");
  button.hidden = true;
  button.innerHTML = createScrollTopIcon();
  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.body.append(button);
  return button;
}

function updateScrollTopButton() {
  const button = ensureScrollTopButton();
  button.hidden = window.scrollY < Math.max(800, window.innerHeight * 1.15);
}

function resetFilters() {
  elements.streamer.value = "";
  elements.query.value = "";
  setCategoryFilter("");
  updateSearchResetButtons();
  resultSignature = "";
  visibleCount = RESULT_INITIAL_RENDER_COUNT;
  setDateValue("dateFrom", "");
  setDateValue("dateTo", "");
  resetCalendarMonthsToCurrent();
  setDurationValue("all");
  setVideoTypeValue("all");
  setSortValue("latest");
  syncFilterUrl();
  closeDurationMenu();
  closeVideoTypeMenu();
  closeSortMenu();
  closeQueryHelp();
  closeAllDatePickers();
  renderAllCalendars();
  if (!activeChannelId) {
    elements.summary.textContent = `스트리머 닉네임을 입력해 ${getContentLabel()}을 검색할 수 있습니다.`;
    elements.results.innerHTML = "";
    renderChannelStatus();
    return;
  }
  render();
}

function syncFilterUrl() {
  const url = new URL(location.href);
  url.searchParams.set("contentType", activeContentType);
  url.searchParams.set(
    "filterType",
    normalizeClipFilterType(params.get("filterType")),
  );
  url.searchParams.set(
    "orderType",
    getClipOrderTypeFromSort(elements.sortPicker.dataset.sort),
  );
  url.searchParams.set("q", elements.query.value.trim());
  url.searchParams.set(
    "categoryFilter",
    elements.categoryChip.dataset.categoryFilter || "",
  );
  url.searchParams.set("dateFrom", elements.dateFrom.value);
  url.searchParams.set("dateTo", elements.dateTo.value);
  url.searchParams.set(
    "duration",
    elements.durationPicker.dataset.duration || "all",
  );
  url.searchParams.set(
    "videoTypeFilter",
    elements.videoTypePicker.dataset.videoType || "all",
  );
  url.searchParams.set("sort", elements.sortPicker.dataset.sort || "latest");
  history.replaceState(null, "", url.toString());
}

function handleSortClick(event) {
  if (event.target.closest("#sortTrigger")) {
    closeDurationMenu();
    closeVideoTypeMenu();
    closeQueryHelp();
    closeAllDatePickers();
    const nextOpen = elements.sortMenu.hidden;
    elements.sortMenu.hidden = !nextOpen;
    elements.sortTrigger.setAttribute("aria-expanded", String(nextOpen));
    return;
  }

  const option = event.target.closest("[data-sort-value]");
  if (!option) return;
  setSortValue(option.dataset.sortValue);
  closeSortMenu();
  handleFilterChange();
}

function handleDurationClick(event) {
  if (event.target.closest("#durationTrigger")) {
    closeSortMenu();
    closeVideoTypeMenu();
    closeQueryHelp();
    closeAllDatePickers();
    const nextOpen = elements.durationMenu.hidden;
    elements.durationMenu.hidden = !nextOpen;
    elements.durationTrigger.setAttribute("aria-expanded", String(nextOpen));
    return;
  }

  const option = event.target.closest("[data-duration-value]");
  if (!option) return;
  setDurationValue(option.dataset.durationValue);
  closeDurationMenu();
  handleFilterChange();
}

function handleVideoTypeClick(event) {
  if (event.target.closest("#videoTypeTrigger")) {
    closeSortMenu();
    closeDurationMenu();
    closeQueryHelp();
    closeAllDatePickers();
    const nextOpen = elements.videoTypeMenu.hidden;
    elements.videoTypeMenu.hidden = !nextOpen;
    elements.videoTypeTrigger.setAttribute("aria-expanded", String(nextOpen));
    return;
  }

  const option = event.target.closest("[data-video-type-value]");
  if (!option) return;
  setVideoTypeValue(option.dataset.videoTypeValue);
  closeVideoTypeMenu();
  handleFilterChange();
}

function closeDurationFromOutside(event) {
  if (elements.durationPicker.contains(event.target)) return;
  closeDurationMenu();
}

function closeVideoTypeFromOutside(event) {
  if (elements.videoTypePicker.contains(event.target)) return;
  closeVideoTypeMenu();
}

function closeDurationMenu() {
  elements.durationMenu.hidden = true;
  elements.durationTrigger.setAttribute("aria-expanded", "false");
}

function closeVideoTypeMenu() {
  elements.videoTypeMenu.hidden = true;
  elements.videoTypeTrigger.setAttribute("aria-expanded", "false");
}

function closeSortFromOutside(event) {
  if (elements.sortPicker.contains(event.target)) return;
  closeSortMenu();
}

function closeSortMenu() {
  elements.sortMenu.hidden = true;
  elements.sortTrigger.setAttribute("aria-expanded", "false");
}

function toggleQueryHelp(event) {
  event.preventDefault();
  closeDurationMenu();
  closeVideoTypeMenu();
  closeSortMenu();
  closeAllDatePickers();
  const nextOpen = elements.queryHelpPanel.hidden;
  elements.queryHelpPanel.hidden = !nextOpen;
  elements.queryHelp.setAttribute("aria-expanded", String(nextOpen));
}

function closeQueryHelpFromOutside(event) {
  if (event.target.closest(".popup-query-box")) return;
  closeQueryHelp();
}

function closeQueryHelp() {
  elements.queryHelpPanel.hidden = true;
  elements.queryHelp.setAttribute("aria-expanded", "false");
}

function handleDatePickerClick(event) {
  const picker = event.currentTarget;
  const type = picker.dataset.datePicker;
  const action = event.target.closest(
    "[data-action], [data-calendar-action], [data-calendar-year], [data-calendar-month], [data-range-preset], [data-date]",
  )?.dataset;
  if (!type || !action) return;
  event.stopPropagation();

  if (action.action === "date-toggle") {
    closeDurationMenu();
    closeVideoTypeMenu();
    closeSortMenu();
    closeQueryHelp();
    closeOtherDatePickers(picker);
    toggleDatePicker(picker);
    return;
  }

  if (action.calendarAction === "prev") {
    calendarMonths[type] = addMonths(calendarMonths[type], -1);
    renderCalendar(picker);
    return;
  }

  if (action.calendarAction === "next") {
    calendarMonths[type] = addMonths(calendarMonths[type], 1);
    renderCalendar(picker);
    return;
  }

  if (action.calendarAction === "month-popover") {
    toggleCalendarMonthPopover(picker);
    return;
  }

  if (action.calendarYear) {
    calendarMonths[type] = new Date(
      Number(action.calendarYear),
      calendarMonths[type].getMonth(),
      1,
    );
    renderCalendar(picker);
    closeCalendarMonthPopover(picker);
    keepDatePickerOpen(picker);
    refreshClipLoadingView();
    return;
  }

  if (action.calendarMonth) {
    calendarMonths[type] = new Date(
      calendarMonths[type].getFullYear(),
      Number(action.calendarMonth) - 1,
      1,
    );
    renderCalendar(picker);
    closeCalendarMonthPopover(picker);
    keepDatePickerOpen(picker);
    refreshClipLoadingView();
    return;
  }

  if (action.calendarAction === "clear") {
    setDateValue(type, "");
    renderAllCalendars();
    handleFilterChange();
    return;
  }

  if (action.calendarAction === "close") {
    closeDatePicker(picker);
    return;
  }

  if (action.rangePreset) {
    applyRangePreset(action.rangePreset);
    closeAllDatePickers();
    renderAllCalendars();
    handleFilterChange();
    return;
  }

  if (action.date) {
    setDateValue(type, action.date);
    normalizeDateRange(type);
    closeDatePicker(picker);
    renderAllCalendars();
    handleFilterChange();
  }
}

function refreshClipLoadingView() {
  if (activeContentType === "clips" && activeFetchRequestId) {
    renderProgressClipCards();
  }
}

function closeDatePickersFromOutside(event) {
  if (event.target.closest(".popup-date-picker")) return;
  closeAllDatePickers();
}

function toggleDatePicker(picker) {
  const calendar = picker.querySelector(".popup-calendar");
  const trigger = picker.querySelector(".popup-date-trigger");
  const nextOpen = calendar.hidden;
  calendar.hidden = !nextOpen;
  trigger.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) renderCalendar(picker);
}

function closeDatePicker(picker) {
  const calendar = picker.querySelector(".popup-calendar");
  const trigger = picker.querySelector(".popup-date-trigger");
  if (!calendar || !trigger) return;
  closeCalendarMonthPopover(picker);
  calendar.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
}

function keepDatePickerOpen(picker) {
  const calendar = picker.querySelector(".popup-calendar");
  const trigger = picker.querySelector(".popup-date-trigger");
  if (!calendar || !trigger) return;
  calendar.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
}

function closeAllDatePickers() {
  elements.datePickers.forEach(closeDatePicker);
}

function closeOtherDatePickers(currentPicker) {
  elements.datePickers.forEach((picker) => {
    if (picker !== currentPicker) closeDatePicker(picker);
  });
}

function applyRangePreset(preset) {
  const today = new Date();
  const end = toDateKey(today);
  const startDate = new Date(today);

  if (preset === "week") {
    startDate.setDate(today.getDate() - 7);
  } else if (preset === "month1") {
    startDate.setMonth(today.getMonth() - 1);
  } else if (preset === "month3") {
    startDate.setMonth(today.getMonth() - 3);
  } else if (preset === "month6") {
    startDate.setMonth(today.getMonth() - 6);
  } else if (preset === "year1") {
    startDate.setFullYear(today.getFullYear() - 1);
  }

  setDateValue("dateFrom", toDateKey(startDate));
  setDateValue("dateTo", end);
  calendarMonths.dateFrom = getMonthStart(startDate);
  calendarMonths.dateTo = getMonthStart(today);
}

function setDateValue(type, value) {
  const input = type === "dateFrom" ? elements.dateFrom : elements.dateTo;
  if (!input) return;
  input.value = value;

  const label = document.querySelector(`[data-date-label="${type}"]`);
  if (label) {
    label.textContent = value ? formatDateLabel(value) : "선택 안 함";
  }

  if (value) {
    calendarMonths[type] = getMonthStart(new Date(`${value}T00:00:00+09:00`));
  }
}

function normalizeDateRange(changedType) {
  const dateFrom = elements.dateFrom.value;
  const dateTo = elements.dateTo.value;
  if (!dateFrom || !dateTo || dateFrom <= dateTo) return;

  if (changedType === "dateFrom") {
    setDateValue("dateTo", "");
  } else {
    setDateValue("dateFrom", "");
  }
}

function renderAllCalendars() {
  elements.datePickers.forEach(renderCalendar);
}

function renderCalendar(picker) {
  const type = picker.dataset.datePicker;
  const title = picker.querySelector("[data-calendar-title]");
  const grid = picker.querySelector("[data-calendar-grid]");
  if (!type || !title || !grid) return;

  const month = calendarMonths[type] || getMonthStart(new Date());

  const titleText = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(month);
  title.innerHTML = `<button type="button" class="popup-calendar-title-button" data-calendar-action="month-popover" aria-haspopup="dialog" aria-expanded="${String(isCalendarMonthPopoverOpen(picker))}">${escapeHtml(titleText)}</button>`;
  renderCalendarMonthPopover(picker, month);

  const dateFrom = elements.dateFrom.value;
  const dateTo = elements.dateTo.value;
  const selectedDate = type === "dateFrom" ? dateFrom : dateTo;
  const today = toDateKey(new Date());

  grid.innerHTML = getCalendarDates(month)
    .map((date) => {
      const key = toDateKey(date);
      const isOutside = date.getMonth() !== month.getMonth();
      const isStart = key === dateFrom;
      const isEnd = key === dateTo;
      const isSelected = key === selectedDate;
      const isInRange = dateFrom && dateTo && key > dateFrom && key < dateTo;
      const classes = [
        "popup-calendar-day",
        isOutside ? "is-outside" : "",
        key === today ? "is-today" : "",
        isSelected ? "is-selected" : "",
        isStart ? "is-start" : "",
        isEnd ? "is-end" : "",
        isInRange ? "is-range" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="${classes}" data-date="${key}">${date.getDate()}</button>`;
    })
    .join("");
}

function ensureCalendarMonthPopover(picker) {
  let popover = picker.querySelector("[data-calendar-month-popover]");
  if (popover) return popover;

  popover = document.createElement("div");
  popover.className = "popup-calendar-month-popover";
  popover.dataset.calendarMonthPopover = "1";
  popover.hidden = true;
  picker.querySelector(".popup-calendar-head")?.after(popover);
  return popover;
}

function renderCalendarMonthPopover(picker, month) {
  const popover = ensureCalendarMonthPopover(picker);
  const currentYear = new Date().getFullYear();
  const selectedYear = month.getFullYear();
  const selectedMonth = month.getMonth() + 1;
  const years = Array.from(
    { length: Math.max(1, currentYear - 2023 + 1) },
    (_, index) => 2023 + index,
  );

  popover.innerHTML = `
    <div class="popup-calendar-picker-years" aria-label="년도 선택">
      ${years
        .map(
          (year) =>
            `<button type="button" data-calendar-year="${year}" aria-selected="${String(year === selectedYear)}">${year}년</button>`,
        )
        .join("")}
    </div>
    <div class="popup-calendar-picker-months" aria-label="월 선택">
      ${Array.from({ length: 12 }, (_, index) => index + 1)
        .map(
          (monthNumber) =>
            `<button type="button" data-calendar-month="${monthNumber}" aria-selected="${String(monthNumber === selectedMonth)}">${monthNumber}월</button>`,
        )
        .join("")}
    </div>
  `;
}

function isCalendarMonthPopoverOpen(picker) {
  return (
    picker.querySelector("[data-calendar-month-popover]")?.hidden === false
  );
}

function toggleCalendarMonthPopover(picker) {
  const popover = ensureCalendarMonthPopover(picker);
  const nextOpen = popover.hidden;
  popover.hidden = !nextOpen;
  const trigger = picker.querySelector(
    "[data-calendar-action='month-popover']",
  );
  trigger?.setAttribute("aria-expanded", String(nextOpen));
}

function closeCalendarMonthPopover(picker) {
  const popover = picker.querySelector("[data-calendar-month-popover]");
  if (!popover) return;
  popover.hidden = true;
  const trigger = picker.querySelector(
    "[data-calendar-action='month-popover']",
  );
  trigger?.setAttribute("aria-expanded", "false");
}

function getCalendarDates(monthDate) {
  const first = getMonthStart(monthDate);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function resetCalendarMonthsToCurrent() {
  const currentMonth = getMonthStart(new Date());
  calendarMonths.dateFrom = new Date(currentMonth);
  calendarMonths.dateTo = new Date(currentMonth);
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setSortValue(value) {
  const options = getSortOptions();
  const labels = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  );
  const normalizedValue = labels[value] ? value : options[0].value;
  elements.sortPicker.dataset.sort = normalizedValue;
  elements.sortLabel.textContent = labels[normalizedValue] || options[0].label;
  elements.sortMenu.querySelectorAll("[data-sort-value]").forEach((option) => {
    option.setAttribute(
      "aria-selected",
      String(option.dataset.sortValue === normalizedValue),
    );
  });
}

function setDurationValue(value) {
  const normalizedValue = DURATION_FILTERS[value] ? value : "all";
  elements.durationPicker.dataset.duration = normalizedValue;
  elements.durationLabel.textContent = DURATION_FILTERS[normalizedValue].label;
  elements.durationMenu
    .querySelectorAll("[data-duration-value]")
    .forEach((option) => {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.durationValue === normalizedValue),
      );
    });
}

function setVideoTypeValue(value) {
  const normalizedValue = VIDEO_TYPE_FILTERS[value] ? value : "all";
  elements.videoTypePicker.dataset.videoType = normalizedValue;
  elements.videoTypeLabel.textContent =
    VIDEO_TYPE_FILTERS[normalizedValue].label;
  elements.videoTypeMenu
    .querySelectorAll("[data-video-type-value]")
    .forEach((option) => {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.videoTypeValue === normalizedValue),
      );
    });
}

function initializeContentMode() {
  resetCalendarMonthsToCurrent();
  document.body.dataset.contentType = activeContentType;
  elements.subtitle.textContent = `${getContentLabel()} 검색`;
  elements.query.placeholder =
    activeContentType === "clips"
      ? "클립 제목, @카테고리"
      : "제목, #태그, @카테고리";
  elements.durationField.hidden = activeContentType === "clips";
  elements.videoTypePicker.closest(".popup-video-type-field").hidden =
    activeContentType === "clips";
  elements.datePickers.forEach((picker) => {
    const presets = picker.querySelector(".popup-calendar-presets");
    if (presets) presets.hidden = false;
  });
  elements.queryHelpPanel.innerHTML =
    activeContentType === "clips"
      ? `
      <strong>검색 방법</strong>
      <p>클립 제목과 카테고리에서 찾습니다.</p>
      <p><code>@</code>, <code>category:</code>, <code>cat:</code>, <code>카테고리:</code>는 카테고리에서만 찾습니다.</p>
      <p>띄어쓰기나 빈칸이 포함된 카테고리는 <code>@"리그 오브 레전드"</code>처럼 묶어 검색합니다.</p>
      <p><code>단어1 | 단어2</code>, <code>단어1 OR 단어2</code></p>
      <p><code>단어1 단어2</code>, <code>단어1 AND 단어2</code></p>
      <p><code>-단어</code>로 제외합니다.</p>
      <p><code>(단어1 | 단어2) 제목</code>처럼 묶어서 쓸 수 있습니다.</p>
    `
      : `
      <strong>검색 방법</strong>
      <p><code>#태그</code>는 태그에서만 찾습니다.</p>
      <p><code>@</code>, <code>category:</code>, <code>cat:</code>, <code>카테고리:</code>는 카테고리에서만 찾습니다.</p>
      <p>띄어쓰기나 빈칸이 포함된 카테고리는 <code>@"리그 오브 레전드"</code>처럼 묶어 검색합니다.</p>
      <p><code>#태그1 | #태그2</code>, <code>#태그1 OR #태그2</code></p>
      <p><code>#태그1 #태그2</code>, <code>#태그1 AND #태그2</code></p>
      <p><code>-#태그</code>로 제외합니다.</p>
      <p>
        <code>(#태그1 | @카테고리) 제목</code>처럼 제목, 태그와 섞어 쓸
        수 있습니다.
      </p>
    `;
  elements.sortMenu.innerHTML = getSortOptions()
    .map(
      (option, index) =>
        `<button type="button" role="option" aria-selected="${index === 0}" data-sort-value="${option.value}">${option.label}</button>`,
    )
    .join("");
}

function getSortOptions() {
  if (activeContentType === "clips") {
    return [
      { value: "latest", label: "최신순" },
      { value: "oldest", label: "오래된순" },
      { value: "popular", label: "인기순" },
    ];
  }
  return [
    { value: "latest", label: "최신순" },
    { value: "oldest", label: "오래된순" },
    { value: "popular", label: "인기순" },
    { value: "livePv", label: "라이브 시청순" },
  ];
}

function getContentLabel() {
  return activeContentType === "clips" ? "클립" : "다시보기";
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(savedTheme === "dark" ? "dark" : "light");
}

function toggleTheme() {
  const currentTheme =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  elements.themeToggle.setAttribute("aria-pressed", String(isDark));
  elements.themeToggle.setAttribute(
    "aria-label",
    isDark ? "라이트 모드로 전환" : "다크 모드로 전환",
  );
}
