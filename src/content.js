const SELECTORS = {
  tabList: '[role="tablist"][class*="tab_list__"][class*="channel_area__"]',
  header: '[class*="channel_component_header__"]',
  list: '[class*="channel_component_list__"]',
  noContent: '[class*="no_content_container__"]',
  pagination: '[class*="pagination_container__"]',
};

const CONTENT_CONFIG = {
  videos: {
    contentType: "videos",
    panelId: "videos-PANEL",
    itemSelector: '[class*="channel_vod_item__"], .cheese-search-card',
    emptyPattern: /등록된\s*동영상이\s*없습니다/,
    title: "다시보기",
    inputTitle: "제목, 태그, 카테고리를 검색합니다.",
    inputPlaceholder: "제목, #태그, @카테고리 검색",
  },
  clips: {
    contentType: "clips",
    panelId: "clips-PANEL",
    itemSelector: '[class*="channel_clip_item__"], .cheese-search-card',
    emptyPattern: /등록된\s*클립이\s*없습니다/,
    title: "클립",
    inputTitle: "클립 제목과 카테고리를 검색합니다.",
    inputPlaceholder: "클립 제목, @카테고리 검색",
  },
};

const EMPTY_RESULTS_ANIMATION_URL = chrome.runtime.getURL(
  "no-search-results-found-animation.svg",
);
const SEARCHING_ANIMATION_URL = chrome.runtime.getURL(
  "searching-animation.svg",
);

const state = {
  channelId: null,
  contentType: "videos",
  videos: [],
  fetchedAt: 0,
  fromCache: false,
  fetchInfo: null,
  hasLoaded: false,
  hasNoVideos: false,
  loading: false,
  error: "",
  activeFetchRequestId: "",
  activeFetchSilentRevalidate: false,
  progressClearTimer: 0,
  progressRenderTimer: 0,
  progressStallTimer: 0,
  progressResultSignature: "",
  renderedClipUIDs: new Set(),
  knownClipUIDs: new Set(),
  initializedFor: "",
  autoRestoreAttemptedFor: "",
  resultSignature: "",
  visibleCount: 120,
  originalHeaderHidden: false,
  originalListHidden: false,
  originalPaginationHidden: false,
  originalPaginationElement: null,
  originalViewRemembered: false,
  calendarMonths: {
    dateFrom: getMonthStart(new Date()),
    dateTo: getMonthStart(new Date()),
  },
};

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
const RESULT_INITIAL_RENDER_COUNT = 120;
const RESULT_RENDER_STEP_COUNT = 120;
const RESULT_SCROLL_THRESHOLD_PX = 2600;
const PROGRESS_STALL_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 1 * 60 * 60 * 1000;
const CACHE_CHUNK_SEPARATOR = "#chunk:";
const AUTO_RESTORE_DISABLED_PREFIX = "autoRestoreDisabled:";
const LAST_AUTO_RESTORE_PREFIX = "lastAutoRestore:";
const clipOrientationCache = new Map();
const viewRestoreCache = new Map();

function getPageContext() {
  const match = location.pathname.match(/^\/([a-f0-9]{32})\/(videos|clips)/i);
  if (!match) return null;
  return {
    channelId: match[1],
    contentType: match[2].toLowerCase(),
  };
}

function getContentConfig() {
  return CONTENT_CONFIG[state.contentType] || CONTENT_CONFIG.videos;
}

function isClipContent() {
  return getContentConfig().contentType === "clips";
}

function isVideoLikeContent() {
  return !isClipContent();
}

function createIcon() {
  return `
    <svg class="cheese-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
}

function createHelpIcon() {
  return `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"></circle>
      <path d="M12 17v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <path d="M12 8h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path>
    </svg>
  `;
}

function createCloseIcon(className = "cheese-search-close-icon") {
  return `
    <svg class="${className}" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
    </svg>
  `;
}

function mountControls(list) {
  const config = getContentConfig();
  const isVideoLike = isVideoLikeContent();
  const existing = document.querySelector(".cheese-search-shell");
  if (existing) {
    updateControlsDisabled();
    return existing;
  }

  const activeExisting = document.querySelector(".cheese-search-shell");
  if (activeExisting) {
    updateControlsDisabled();
    return activeExisting;
  }

  const shell = document.createElement("div");
  shell.className = "cheese-search-shell";
  shell.dataset.cheeseSearch = "1";
  shell.innerHTML = `
    <div class="cheese-search-query-column">
      <label class="cheese-search-field" title="${escapeAttribute(config.inputTitle)}">
        ${createIcon()}
        <input class="cheese-search-input" type="search" placeholder="${escapeAttribute(config.inputPlaceholder)}" autocomplete="off" />
        <button type="reset" class="search_form_button__+3aOm" data-action="query-reset" hidden>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 15 16" fill="none" aria-hidden="true">
            <path fill="currentColor" fill-rule="evenodd" d="M7.5 15.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm2.995-10.495a.7.7 0 0 0-.903-.074l-.087.074L7.5 7.01 5.495 5.005l-.087-.074a.7.7 0 0 0-.903 1.064L6.51 8l-2.005 2.005a.7.7 0 0 0 .903 1.064l.087-.074L7.5 8.99l2.005 2.005.087.074a.7.7 0 0 0 .903-1.064L8.49 8l2.005-2.005a.7.7 0 0 0 0-.99Z" clip-rule="evenodd" opacity="0.5"></path>
          </svg>
          <span class="blind">삭제</span>
        </button>
        <button type="button" class="cheese-search-help-button" data-action="search-help" aria-label="검색 방법 보기" aria-expanded="false" aria-controls="cheese-search-help">
          ${createHelpIcon()}
        </button>
        <div class="cheese-search-help" id="cheese-search-help" role="tooltip" hidden>
          ${renderSearchHelp()}
        </div>
      </label>
    </div>
    ${createDatePicker("dateFrom", "시작일")}
    ${createDatePicker("dateTo", "종료일")}
    ${
      isVideoLike
        ? `<div class="cheese-search-duration-picker" data-duration-picker>
      <button type="button" class="cheese-search-control cheese-search-duration-trigger" data-action="duration-toggle" aria-haspopup="listbox" aria-expanded="false">
        <span data-duration-label>길이 전체</span>
      </button>
      <div class="cheese-search-duration-menu" role="listbox" aria-label="영상 길이 선택" hidden>
        ${Object.entries(DURATION_FILTERS)
          .map(
            ([value, option]) =>
              `<button type="button" role="option" aria-selected="${value === "all"}" data-duration-value="${value}">${option.label}</button>`,
          )
          .join("")}
      </div>
    </div>`
        : ""
    }
    ${
      isVideoLike
        ? `<div class="cheese-search-video-type-picker" data-video-type-picker>
      <button type="button" class="cheese-search-control cheese-search-video-type-trigger" data-action="video-type-toggle" aria-haspopup="listbox" aria-expanded="false">
        <span data-video-type-label>유형 전체</span>
      </button>
      <div class="cheese-search-video-type-menu" role="listbox" aria-label="영상 유형 선택" hidden>
        ${Object.entries(VIDEO_TYPE_FILTERS)
          .map(
            ([value, option]) =>
              `<button type="button" role="option" aria-selected="${value === "all"}" data-video-type-value="${value}">${option.label}</button>`,
          )
          .join("")}
      </div>
    </div>`
        : ""
    }
    <div class="cheese-search-sort-picker" data-sort-picker>
      <button type="button" class="cheese-search-control cheese-search-sort-trigger" data-action="sort-toggle" aria-haspopup="listbox" aria-expanded="false">
        <span data-sort-label>최신순</span>
      </button>
      <div class="cheese-search-sort-menu" role="listbox" aria-label="정렬 선택" hidden>
        ${getSortOptions()
          .map(
            (option, index) =>
              `<button type="button" role="option" aria-selected="${index === 0}" data-sort-value="${option.value}">${option.label}</button>`,
          )
          .join("")}
      </div>
    </div>
    <button type="button" class="cheese-search-control cheese-search-button cheese-search-button-primary" data-action="fetch">검색</button>
    <button type="button" class="cheese-search-control cheese-search-button" data-action="popup">팝업</button>
    <button type="button" class="cheese-search-control cheese-search-button" data-action="reset">초기화</button>
    <div class="cheese-search-progress" aria-hidden="true" aria-live="polite" hidden>
      <span class="cheese-search-progress-bar"></span>
      <span class="cheese-search-progress-label" data-progress-label></span>
    </div>
  `;

  list.before(shell);
  shell.dataset.contentType = config.contentType;
  shell.dataset.sort = "latest";
  shell.dataset.duration = "all";
  shell.dataset.videoType = "all";

  shell
    .querySelector(".cheese-search-input")
    .addEventListener("input", updateQueryResetButton);
  shell
    .querySelector(".cheese-search-input")
    .addEventListener("input", debounce(handleFilterChange, 160));
  shell
    .querySelector('[data-action="query-reset"]')
    .addEventListener("click", handleQueryResetClick);
  shell
    .querySelector('[data-action="search-help"]')
    .addEventListener("click", handleSearchHelpClick);
  shell.querySelectorAll("[data-date-picker]").forEach((picker) => {
    picker.addEventListener("click", handleDatePickerClick);
  });
  shell
    .querySelector("[data-sort-picker]")
    .addEventListener("click", handleSortPickerClick);
  shell
    .querySelector("[data-duration-picker]")
    ?.addEventListener("click", handleDurationPickerClick);
  shell
    .querySelector("[data-video-type-picker]")
    ?.addEventListener("click", handleVideoTypePickerClick);
  shell
    .querySelector('[data-action="fetch"]')
    .addEventListener("click", handleFetchButtonClick);
  shell
    .querySelector('[data-action="popup"]')
    ?.addEventListener("click", openPopupSearch);
  shell
    .querySelector('[data-action="reset"]')
    .addEventListener("click", resetSearch);
  document.addEventListener("click", closeFloatingControlsFromOutside);
  shell.querySelectorAll("[data-date-picker]").forEach(renderCalendar);
  setSortValue(shell, getInitialSortValue());
  updateControlsDisabled();

  return shell;
}

function renderSearchHelp() {
  if (isClipContent()) {
    return `
      <strong>검색 방법</strong>
      <p>클립 제목과 카테고리에서 찾습니다.</p>
      <p><code>@</code>, <code>category:</code>, <code>cat:</code>, <code>카테고리:</code>는 카테고리에서만 찾습니다.</p>
      <p>띄어쓰기나 빈칸이 포함된 카테고리는 <code>@"리그 오브 레전드"</code>처럼 묶어 검색합니다.</p>
      <p><code>단어1 | 단어2</code>, <code>단어1 OR 단어2</code></p>
      <p><code>단어1 단어2</code>, <code>단어1 AND 단어2</code></p>
      <p><code>-단어</code>로 제외합니다.</p>
      <p><code>(단어1 | 단어2) 제목</code>처럼 묶어서 쓸 수 있습니다.</p>
    `;
  }
  return `
    <strong>검색 방법</strong>
    <p><code>#태그</code>는 태그에서만 찾습니다.</p>
    <p><code>@</code>, <code>category:</code>, <code>cat:</code>, <code>카테고리:</code>는 카테고리에서만 찾습니다.</p>
    <p>띄어쓰기나 빈칸이 포함된 카테고리는 <code>@"리그 오브 레전드"</code>처럼 묶어 검색합니다.</p>
    <p><code>#태그1 | #태그2</code>, <code>#태그1 OR #태그2</code></p>
    <p><code>#태그1 #태그2</code>, <code>#태그1 AND #태그2</code></p>
    <p><code>-#태그</code>로 제외합니다.</p>
    <p><code>(#태그1 | @카테고리) 제목</code>처럼 제목, 태그와 섞어 쓸 수 있습니다.</p>
  `;
}

function getSortOptions() {
  if (isClipContent()) {
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

function createDatePicker(type, label, includePresets = true) {
  return `
    <div class="cheese-search-date-picker" data-date-picker="${type}">
      <button type="button" class="cheese-search-control cheese-search-date-trigger" data-action="date-toggle" aria-haspopup="dialog" aria-expanded="false">
        <span class="cheese-search-date-caption">${label}</span>
        <span data-date-label="${type}">선택 안 함</span>
      </button>
      <div class="cheese-search-calendar" role="dialog" aria-label="${label} 선택" hidden>
        <div class="cheese-search-calendar-head">
          <button type="button" class="cheese-search-calendar-nav" data-calendar-action="prev" aria-label="이전 달">${createCalendarNavIcon("prev")}</button>
          <strong data-calendar-title></strong>
          <button type="button" class="cheese-search-calendar-nav" data-calendar-action="next" aria-label="다음 달">${createCalendarNavIcon("next")}</button>
        </div>
        ${
          includePresets
            ? `<div class="cheese-search-calendar-presets" aria-label="빠른 기간 선택">
          <button type="button" data-range-preset="week">최근 1주일</button>
          <button type="button" data-range-preset="month1">1개월</button>
          <button type="button" data-range-preset="month3">3개월</button>
          <button type="button" data-range-preset="month6">6개월</button>
          <button type="button" data-range-preset="year1">1년</button>
        </div>`
            : ""
        }
        <div class="cheese-search-calendar-weekdays" aria-hidden="true">
          <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
        </div>
        <div class="cheese-search-calendar-grid" data-calendar-grid></div>
        <div class="cheese-search-calendar-actions">
          <button type="button" data-calendar-action="clear">초기화</button>
          <button type="button" data-calendar-action="close">닫기</button>
        </div>
      </div>
    </div>
  `;
}

function createCalendarNavIcon(direction) {
  const path = direction === "next" ? "M9 5l6 7-6 7" : "M15 5l-6 7 6 7";
  return `
    <svg class="cheese-search-calendar-nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="${path}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

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

async function loadVideos({ forceRefresh = false } = {}) {
  if (!state.channelId || state.loading || state.hasNoVideos) return;
  const requestId = createRequestId("content");
  const contentType = getContentConfig().contentType;
  const controls = getControls();
  const isClipSearch = isClipContent();
  state.activeFetchRequestId = requestId;
  state.loading = true;
  state.error = "";
  clearProgressStallTimer();
  updateFetchButton();
  await clearAutoRestoreDisabledForCurrentContent();
  await clearAutoRestoreDisabled({ isClipSearch, controls });
  if (isClipSearch) {
    setFetchProgress({
      phase: "start",
      fetchedPages: 0,
      totalPages: 0,
      totalCount: 0,
      contentType,
    });
  }

  const cachedHydrated =
    !forceRefresh &&
    (await hydrateFromSessionCache({ isClipSearch, controls }));

  if (state.activeFetchRequestId !== requestId) {
    return;
  }

  state.activeFetchSilentRevalidate = cachedHydrated;

  if (cachedHydrated && isClipSearch) {
    state.loading = false;
    state.activeFetchRequestId = "";
    state.activeFetchSilentRevalidate = false;
    clearProgressStallTimer();
    clearFetchProgress();
    updateFetchButton();
    return;
  }

  if (!cachedHydrated) {
    if (isClipSearch) {
      state.videos = [];
      state.knownClipUIDs = new Set();
      state.fetchInfo = null;
      state.hasLoaded = false;
      state.resultSignature = "";
      state.progressResultSignature = "";
      state.renderedClipUIDs = new Set();
      state.visibleCount = RESULT_INITIAL_RENDER_COUNT;
    }
    if (!isClipSearch) {
      setFetchProgress({
        phase: "start",
        fetchedPages: 0,
        totalPages: 0,
        totalCount: 0,
        contentType,
      });
    }
    renderSkeleton();
  }

  try {
    const result = await sendMessage({
      type: isClipSearch
        ? "CHEESE_SEARCH_FETCH_CLIPS"
        : "CHEESE_SEARCH_FETCH_VIDEOS",
      payload: {
        channelId: state.channelId,
        contentType,
        videoType: "",
        sortType: "LATEST",
        filterType: getCurrentClipFilterType(),
        orderType: getClipOrderTypeFromSort(controls?.sort),
        forceRefresh,
        requestId,
      },
    });

    if (state.activeFetchRequestId !== requestId) {
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

    const nextList = Array.isArray(result.videos)
      ? result.videos
      : Array.isArray(result.clips)
        ? result.clips.filter((clip) => !clip?.deletedAt)
        : [];

    const unchangedRevalidation =
      cachedHydrated &&
      (result.checkedFresh ||
        (result.fromCache && nextList.length === state.videos.length));

    if (unchangedRevalidation) {
      state.fetchInfo = result;
      state.fromCache = Boolean(result.fromCache);
      state.fetchedAt = result.fetchedAt || state.fetchedAt;
      if (isClipSearch) {
        state.loading = false;
        state.activeFetchRequestId = "";
        state.activeFetchSilentRevalidate = false;
        clearProgressStallTimer();
      }
      return;
    }

    state.videos = nextList;
    if (isClipSearch) {
      state.knownClipUIDs = new Set(
        nextList
          .map((clip) => String(clip?.clipUID || "").trim())
          .filter(Boolean),
      );
    }
    state.hasNoVideos = state.videos.length === 0;
    state.fetchedAt = result.fetchedAt || Date.now();
    state.fromCache = Boolean(result.fromCache);
    state.fetchInfo = result;
    state.resultSignature = "";
    state.visibleCount = RESULT_INITIAL_RENDER_COUNT;
    state.hasLoaded = true;
    writeViewRestoreSnapshot({ isClipSearch, controls });
    void writeLastAutoRestoreState({ isClipSearch, controls });
    updateControlsDisabled();
    if (isClipSearch) {
      state.loading = false;
      state.activeFetchRequestId = "";
      state.activeFetchSilentRevalidate = false;
      clearProgressStallTimer();
      clearFetchProgress();
      renderProgressClipCards();
    } else {
      renderResults();
    }
  } catch (error) {
    if (state.activeFetchRequestId !== requestId) {
      return;
    }
    state.error = error instanceof Error ? error.message : String(error);
    renderStatus(`목록을 불러오지 못했습니다. ${state.error}`);
  } finally {
    if (!isClipSearch && state.activeFetchRequestId === requestId) {
      state.loading = false;
      state.activeFetchRequestId = "";
      state.activeFetchSilentRevalidate = false;
      clearProgressStallTimer();
      scheduleClearFetchProgress();
      updateFetchButton();
    }
  }
}

function handleFetchButtonClick() {
  if (state.loading && state.activeFetchRequestId) {
    void cancelActiveFetch();
    return;
  }
  void loadVideos({ forceRefresh: false });
}

async function cancelActiveFetch() {
  const requestId = state.activeFetchRequestId;
  if (!requestId) return;

  state.activeFetchRequestId = "";
  state.loading = false;
  state.activeFetchSilentRevalidate = false;
  clearProgressStallTimer();
  clearFetchProgress();
  updateFetchButton();

  try {
    await sendMessage({
      type: "CHEESE_SEARCH_CANCEL_FETCH",
      payload: { requestId },
    });
  } catch {
    // The local search is already stopped even if the worker was restarted.
  }

  if (state.videos.length) {
    state.hasLoaded = true;
    state.error = "";
    renderResults();
    return;
  }

  renderStatus("검색을 중지했습니다.");
}

function getSessionCacheKey({ isClipSearch, controls }) {
  if (isClipSearch) {
    const filterType = getCurrentClipFilterType();
    const orderType = getClipOrderTypeFromSort(controls?.sort);
    return `cache:clips:${state.channelId}:${filterType}:${orderType}`;
  }
  return `cache:${state.channelId}::LATEST`;
}

function getSessionCacheKeyFromRestoreState({ isClipSearch, restoreState }) {
  if (!state.channelId || !restoreState) return "";
  if (isClipSearch) {
    const filterType = normalizeClipFilterType(restoreState.filterType);
    const orderType = normalizeClipOrderType(restoreState.orderType);
    return `cache:clips:${state.channelId}:${filterType}:${orderType}`;
  }
  return `cache:${state.channelId}::LATEST`;
}

function getViewRestoreKey({ isClipSearch, controls, restoreState = null }) {
  if (!state.channelId) return "";
  if (isClipSearch) {
    const filterType = restoreState
      ? normalizeClipFilterType(restoreState.filterType)
      : getCurrentClipFilterType();
    const orderType = restoreState
      ? normalizeClipOrderType(restoreState.orderType)
      : getClipOrderTypeFromSort(controls?.sort);
    return `${state.channelId}:clips:${filterType}:${orderType}`;
  }
  return `${state.channelId}:videos`;
}

function writeViewRestoreSnapshot({ isClipSearch, controls }) {
  if (!state.channelId || !state.videos.length) return;
  const key = getViewRestoreKey({ isClipSearch, controls });
  if (!key) return;
  viewRestoreCache.set(key, {
    createdAt: Date.now(),
    value: {
      channelId: state.channelId,
      contentType: isClipSearch ? "clips" : "videos",
      clips: isClipSearch ? state.videos.slice() : undefined,
      videos: isClipSearch ? undefined : state.videos.slice(),
      totalCount: state.videos.length,
      totalPages: Math.max(1, Number(state.fetchInfo?.totalPages || 1)),
      fetchedAt: state.fetchedAt || Date.now(),
      fromCache: true,
    },
  });
}

function readViewRestoreSnapshot({ isClipSearch, controls, restoreState }) {
  const key = getViewRestoreKey({ isClipSearch, controls, restoreState });
  if (!key) return null;
  const entry = viewRestoreCache.get(key);
  if (!entry?.value) return null;
  if (Date.now() - Number(entry.createdAt || 0) >= CACHE_TTL_MS) {
    viewRestoreCache.delete(key);
    return null;
  }
  return entry.value;
}

function clearViewRestoreSnapshotForCurrentContent() {
  if (!state.channelId) return;
  const prefix = `${state.channelId}:${isClipContent() ? "clips" : "videos"}`;
  for (const key of viewRestoreCache.keys()) {
    if (key.startsWith(prefix)) viewRestoreCache.delete(key);
  }
}

function getAutoRestoreDisabledKey({ isClipSearch, controls }) {
  if (!state.channelId) return "";
  if (isClipSearch) {
    const filterType = getCurrentClipFilterType();
    const orderType = getClipOrderTypeFromSort(controls?.sort);
    return `${AUTO_RESTORE_DISABLED_PREFIX}${state.channelId}:clips:${filterType}:${orderType}`;
  }
  return `${AUTO_RESTORE_DISABLED_PREFIX}${state.channelId}:videos`;
}

function getAutoRestoreDisabledKeyFromRestoreState({
  isClipSearch,
  restoreState,
}) {
  if (!state.channelId || !restoreState) return "";
  if (isClipSearch) {
    const filterType = normalizeClipFilterType(restoreState.filterType);
    const orderType = normalizeClipOrderType(restoreState.orderType);
    return `${AUTO_RESTORE_DISABLED_PREFIX}${state.channelId}:clips:${filterType}:${orderType}`;
  }
  return `${AUTO_RESTORE_DISABLED_PREFIX}${state.channelId}:videos`;
}

function getLastAutoRestoreKey({ isClipSearch }) {
  if (!state.channelId) return "";
  return `${LAST_AUTO_RESTORE_PREFIX}${state.channelId}:${isClipSearch ? "clips" : "videos"}`;
}

async function readLastAutoRestoreState({ isClipSearch }) {
  if (!chrome.storage?.local) return null;
  const key = getLastAutoRestoreKey({ isClipSearch });
  if (!key) return null;
  try {
    const data = await chrome.storage.local.get(key);
    const value = data?.[key];
    if (!value || typeof value !== "object") return null;
    const createdAt = Number(value.createdAt || 0);
    if (!createdAt || Date.now() - createdAt >= CACHE_TTL_MS) return null;
    return value;
  } catch {
    return null;
  }
}

async function writeLastAutoRestoreState({ isClipSearch, controls }) {
  if (!chrome.storage?.local || !state.channelId) return;
  const key = getLastAutoRestoreKey({ isClipSearch });
  if (!key) return;
  const value = {
    channelId: state.channelId,
    contentType: isClipSearch ? "clips" : "videos",
    createdAt: Date.now(),
  };
  if (isClipSearch) {
    value.filterType = getCurrentClipFilterType();
    value.orderType = getClipOrderTypeFromSort(controls?.sort);
    value.sort = value.orderType === "POPULAR" ? "popular" : "latest";
  }
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    // Automatic view restoration is a convenience; cache usage still works.
  }
}

async function refreshLastAutoRestoreState({ isClipSearch, restoreState }) {
  if (!chrome.storage?.local || !state.channelId || !restoreState) return;
  const key = getLastAutoRestoreKey({ isClipSearch });
  if (!key) return;
  try {
    await chrome.storage.local.set({
      [key]: {
        ...restoreState,
        channelId: state.channelId,
        contentType: isClipSearch ? "clips" : "videos",
        createdAt: Date.now(),
      },
    });
  } catch {
    // Ignore marker refresh failures.
  }
}

async function clearLastAutoRestoreState({ isClipSearch }) {
  if (!chrome.storage?.local) return;
  const key = getLastAutoRestoreKey({ isClipSearch });
  if (!key) return;
  try {
    await chrome.storage.local.remove(key);
  } catch {
    // Ignore restoration marker cleanup failures.
  }
}

async function isAutoRestoreDisabled({ isClipSearch, controls }) {
  if (!chrome.storage?.local) return false;
  const key = getAutoRestoreDisabledKey({ isClipSearch, controls });
  if (!key) return false;
  try {
    const data = await chrome.storage.local.get(key);
    return Boolean(data?.[key]);
  } catch {
    return false;
  }
}

async function isAutoRestoreDisabledForRestoreState({
  isClipSearch,
  restoreState,
}) {
  if (!chrome.storage?.local) return false;
  const key = getAutoRestoreDisabledKeyFromRestoreState({
    isClipSearch,
    restoreState,
  });
  if (!key) return false;
  try {
    const data = await chrome.storage.local.get(key);
    return Boolean(data?.[key]);
  } catch {
    return false;
  }
}

async function setAutoRestoreDisabled({ isClipSearch, controls }) {
  if (!chrome.storage?.local) return;
  const key = getAutoRestoreDisabledKey({ isClipSearch, controls });
  if (!key) return;
  try {
    await chrome.storage.local.set({
      [key]: {
        channelId: state.channelId,
        contentType: isClipSearch ? "clips" : "videos",
        createdAt: Date.now(),
      },
    });
  } catch {
    // Cache remains available; only automatic view restoration is skipped.
  }
}

async function clearAutoRestoreDisabled({ isClipSearch, controls }) {
  if (!chrome.storage?.local) return;
  const key = getAutoRestoreDisabledKey({ isClipSearch, controls });
  if (!key) return;
  try {
    await chrome.storage.local.remove(key);
  } catch {
    // The user-triggered search can continue even if the marker remains.
  }
}

async function clearAutoRestoreDisabledForCurrentContent() {
  if (!chrome.storage?.local || !state.channelId) return;
  const contentType = isClipContent() ? "clips" : "videos";
  const prefix = `${AUTO_RESTORE_DISABLED_PREFIX}${state.channelId}:${contentType}`;
  try {
    const data = await chrome.storage.local.get(null);
    const keys = Object.keys(data || {}).filter((key) =>
      key.startsWith(prefix),
    );
    if (keys.length) await chrome.storage.local.remove(keys);
  } catch {
    // A direct search should proceed even if stale restore markers remain.
  }
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

async function peekBackgroundCache({ isClipSearch, controls, restoreState }) {
  try {
    const result = await sendMessage({
      type: "CHEESE_SEARCH_PEEK_CACHE",
      payload: {
        channelId: state.channelId,
        contentType: getContentConfig().contentType,
        videoType: "",
        sortType: "LATEST",
        filterType: restoreState
          ? normalizeClipFilterType(restoreState.filterType)
          : getCurrentClipFilterType(),
        orderType: restoreState
          ? normalizeClipOrderType(restoreState.orderType)
          : getClipOrderTypeFromSort(controls?.sort),
      },
    });
    return result || null;
  } catch {
    return null;
  }
}

async function hydrateFromSessionCache({
  isClipSearch,
  controls,
  restoreState = null,
}) {
  let cachedValue = readViewRestoreSnapshot({
    isClipSearch,
    controls,
    restoreState,
  });
  if (isClipSearch) {
    cachedValue =
      cachedValue ||
      (await peekBackgroundCache({
        isClipSearch,
        controls,
        restoreState,
      }));
  }

  if (!cachedValue && chrome.storage?.local) {
    const key = restoreState
      ? getSessionCacheKeyFromRestoreState({ isClipSearch, restoreState })
      : getSessionCacheKey({ isClipSearch, controls });
    try {
      cachedValue = await readStoredCacheValue(key);
    } catch {
      cachedValue = null;
    }
  }

  if (!cachedValue) {
    cachedValue = await peekBackgroundCache({
      isClipSearch,
      controls,
      restoreState,
    });
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

  state.videos = cachedList;
  if (isClipSearch) {
    state.knownClipUIDs = new Set(
      cachedList
        .map((clip) => String(clip?.clipUID || "").trim())
        .filter(Boolean),
    );
  }
  state.hasNoVideos = false;
  state.fromCache = true;
  state.fetchInfo = { ...cachedValue, fromCache: true };
  state.fetchedAt = cachedValue.fetchedAt || Date.now();
  state.resultSignature = "";
  state.progressResultSignature = "";
  state.renderedClipUIDs = new Set();
  state.visibleCount = RESULT_INITIAL_RENDER_COUNT;
  state.hasLoaded = true;
  if (isClipSearch && restoreState?.sort) {
    const shell = document.querySelector(".cheese-search-shell");
    if (shell) setSortValue(shell, restoreState.sort);
  }
  if (restoreState) {
    void refreshLastAutoRestoreState({ isClipSearch, restoreState });
  } else {
    void writeLastAutoRestoreState({ isClipSearch, controls });
  }
  writeViewRestoreSnapshot({ isClipSearch, controls });
  updateControlsDisabled();
  if (isClipSearch) {
    renderProgressClipCards();
  } else {
    renderResults();
  }
  return true;
}

function createRequestId(prefix) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function setFetchProgress(progress) {
  if (state.progressClearTimer) {
    clearTimeout(state.progressClearTimer);
    state.progressClearTimer = 0;
  }

  const shell = document.querySelector(".cheese-search-shell");
  const progressElement = shell?.querySelector(".cheese-search-progress");
  const bar = shell?.querySelector(".cheese-search-progress-bar");
  let label = shell?.querySelector("[data-progress-label]");
  if (!progressElement || !bar) return;
  if (!label) {
    label = document.createElement("span");
    label.className = "cheese-search-progress-label";
    label.dataset.progressLabel = "";
    progressElement.append(label);
  }

  const isClipProgress =
    progress?.contentType === "clips" ||
    getContentConfig().contentType === "clips";

  progressElement.hidden = false;
  progressElement.setAttribute("aria-hidden", "false");
  progressElement.dataset.mode = isClipProgress
    ? "indeterminate"
    : "determinate";
  shell?.classList.toggle("has-progress-label", isClipProgress);

  if (isClipProgress) {
    bar.style.width = "";
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
  label.textContent = "";
  bar.style.width = `${progress?.phase === "done" ? 100 : percent}%`;
}

function scheduleClearFetchProgress() {
  if (isClipContent()) {
    setFetchProgress({
      phase: "done",
      fetchedPages: Math.max(1, Number(state.fetchInfo?.totalPages || 1)),
      totalPages: Math.max(1, Number(state.fetchInfo?.totalPages || 1)),
      totalCount: state.videos.length,
      contentType: "clips",
    });
    state.progressClearTimer = setTimeout(clearFetchProgress, 900);
    return;
  }
  setFetchProgress({ phase: "done", fetchedPages: 1, totalPages: 1 });
  state.progressClearTimer = setTimeout(clearFetchProgress, 650);
}

function getClipProgressText(progress) {
  const totalCount = Number(progress?.totalCount || state.videos.length || 0);
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
  if (state.progressClearTimer) {
    clearTimeout(state.progressClearTimer);
    state.progressClearTimer = 0;
  }

  const shell = document.querySelector(".cheese-search-shell");
  const progressElement = shell?.querySelector(".cheese-search-progress");
  const bar = shell?.querySelector(".cheese-search-progress-bar");
  const label = shell?.querySelector("[data-progress-label]");
  if (!progressElement || !bar) return;
  progressElement.hidden = true;
  progressElement.setAttribute("aria-hidden", "true");
  progressElement.removeAttribute("data-mode");
  shell?.classList.remove("has-progress-label");
  bar.style.width = "0%";
  if (label) label.textContent = "";
}

function appendProgressClips(progress) {
  if (!isClipContent()) return false;
  const clips = Array.isArray(progress?.clips) ? progress.clips : [];
  if (!clips.length) {
    renderProgressClipCards();
    return false;
  }

  const newClips = [];
  for (const clip of clips) {
    const clipUID = String(clip?.clipUID || "").trim();
    if (!clipUID || state.knownClipUIDs.has(clipUID)) continue;
    state.knownClipUIDs.add(clipUID);
    newClips.push(clip);
  }
  if (!newClips.length) {
    renderProgressClipCards();
    return false;
  }

  state.videos = state.videos.concat(newClips);
  state.hasLoaded = true;
  state.hasNoVideos = false;
  updateControlsDisabled();
  scheduleProgressRender();
  return true;
}

function scheduleProgressRender() {
  if (state.progressRenderTimer) return;
  state.progressRenderTimer = setTimeout(() => {
    state.progressRenderTimer = 0;
    if (isClipContent()) {
      renderProgressClipCards();
      return;
    }
    renderResults();
  }, 120);
}

function renderProgressClipCards() {
  if (!isClipContent()) return;
  const controls = getControls();
  const { header: nativeHeader, list, pagination } = getPanelElements();
  if (!controls || !list) return;

  const searchList = activateSearchView({
    header: nativeHeader,
    list,
    pagination,
  });
  const signature = getResultSignature(controls);
  const shouldReset =
    state.progressResultSignature !== signature ||
    searchList.getAttribute("aria-busy") === "true";

  if (shouldReset) {
    state.progressResultSignature = signature;
    state.renderedClipUIDs = new Set();
    searchList.removeAttribute("aria-busy");
    searchList.innerHTML = "";
  }

  const filtered = getFilteredVideos(controls);
  const visibleResults = filtered.slice(0, state.visibleCount);
  if (shouldHideClipResultHeader()) {
    removeResultHeader();
  } else {
    updateResultHeader(ensureHeader(searchList), filtered);
  }

  const nextItems = visibleResults.filter((clip) => {
    const clipUID = String(clip?.clipUID || "").trim();
    return clipUID && !state.renderedClipUIDs.has(clipUID);
  });

  if (nextItems.length) {
    searchList.querySelector(".cheese-search-status")?.remove();
    searchList.insertAdjacentHTML(
      "beforeend",
      nextItems.map(renderItemCard).join(""),
    );
    nextItems.forEach((clip) => {
      state.renderedClipUIDs.add(String(clip?.clipUID || "").trim());
    });
    normalizeRenderedClipCards(searchList);
  } else if (!filtered.length && !searchList.children.length) {
    searchList.innerHTML = renderSearchingStatus(getClipSearchingMessage());
  }
}

function handleFilterChange() {
  if (state.hasNoVideos) return;

  if (!state.hasLoaded && !state.loading) {
    loadVideos({ forceRefresh: false });
    return;
  }
  if (state.loading && isClipContent()) {
    renderProgressClipCards();
    return;
  }
  renderResults();
}

function getResultSignature(controls) {
  if (!controls) return "";
  return [
    controls.query,
    controls.categoryFilter,
    controls.dateFrom,
    controls.dateTo,
    controls.duration,
    controls.videoType,
    controls.sort,
  ].join("|");
}

function updateQueryResetButton() {
  const shell = document.querySelector(".cheese-search-shell");
  if (!shell) return;
  const input = shell.querySelector(".cheese-search-input");
  const button = shell.querySelector('[data-action="query-reset"]');
  if (button) button.hidden = !input?.value;
}

function handleQueryResetClick(event) {
  event.preventDefault();
  const shell = event.currentTarget.closest(".cheese-search-shell");
  const input = shell?.querySelector(".cheese-search-input");
  if (!input) return;
  if (!input.value) {
    input.focus();
    return;
  }
  input.value = "";
  updateQueryResetButton();
  state.resultSignature = "";
  state.visibleCount = RESULT_INITIAL_RENDER_COUNT;
  handleFilterChange();
  input.focus();
}

function handleCategoryResetClick(event) {
  event.preventDefault();
  const shell = document.querySelector(".cheese-search-shell");
  if (!shell) return;
  setCategoryFilter(shell, "");
  handleFilterChange();
  shell.querySelector(".cheese-search-input")?.focus();
}

function handleCategoryFilterClick(event) {
  const link = event.target.closest("[data-cheese-category-filter]");
  if (!link || event.ctrlKey) return;
  const searchList = link.closest(".cheese-search-results-list");
  if (!searchList) return;

  event.preventDefault();
  event.stopPropagation();
  applyCategoryFilter(link.dataset.cheeseCategoryFilter);
}

function handleCategoryResetDocumentClick(event) {
  const button = event.target.closest('[data-action="category-reset"]');
  if (!button?.closest(".cheese-search-result-header")) return;
  handleCategoryResetClick(event);
}

function applyCategoryFilter(category) {
  const shell = document.querySelector(".cheese-search-shell");
  if (!shell) return;
  setCategoryFilter(shell, category);
  handleFilterChange();
  shell.querySelector(".cheese-search-input")?.focus();
}

function setCategoryFilter(shell, category) {
  const value = String(category || "").trim();
  if (value) {
    shell.dataset.categoryFilter = value;
  } else {
    delete shell.dataset.categoryFilter;
  }
  updateCategoryChip(shell);
}

function updateCategoryChip(
  shell = document.querySelector(".cheese-search-shell"),
) {
  const header = document.querySelector(".cheese-search-result-header");
  const controls = getControls();
  if (
    !shell ||
    !header ||
    !controls ||
    !state.hasLoaded ||
    !state.videos.length
  ) {
    return;
  }
  updateResultHeader(header, getFilteredVideos(controls));
}

let filteredVideosCache = null;

function getFilteredVideos(controls) {
  const signature = getResultSignature(controls);
  if (
    filteredVideosCache &&
    filteredVideosCache.signature === signature &&
    filteredVideosCache.videosRef === state.videos
  ) {
    return filteredVideosCache.result;
  }

  const dateFrom = controls.dateFrom ? getDayStart(controls.dateFrom) : 0;
  const dateTo = controls.dateTo ? getDayEnd(controls.dateTo) : 0;
  const searchOptions = getSearchOptions();

  const result = state.videos
    .filter((video) => {
      const videoTime = getItemTime(video);
      if (dateFrom && videoTime < dateFrom) return false;
      if (dateTo && videoTime > dateTo) return false;
      if (isVideoLikeContent() && !matchesDuration(video, controls.duration))
        return false;
      if (isVideoLikeContent() && !matchesVideoType(video, controls.videoType))
        return false;
      if (!CheeseSearchQuery.matches(video, controls.query, searchOptions))
        return false;
      if (
        controls.categoryFilter &&
        !CheeseSearchQuery.matches(
          video,
          CheeseSearchQuery.buildCategoryTerm(controls.categoryFilter),
          searchOptions,
        )
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (controls.sort === "popular" || controls.sort === "views") {
        return (
          getViewCount(b) - getViewCount(a) || getItemTime(b) - getItemTime(a)
        );
      }
      if (controls.sort === "livePv") {
        return (
          getLivePvCount(b) - getLivePvCount(a) ||
          getItemTime(b) - getItemTime(a)
        );
      }
      const diff = getItemTime(b) - getItemTime(a);
      return controls.sort === "oldest" ? -diff : diff;
    });

  filteredVideosCache = {
    signature,
    videosRef: state.videos,
    result,
  };
  return result;
}

function renderCategoryFilterChip(category) {
  const value = String(category || "").trim();
  if (!value) return "";
  return `
    <button type="button" class="cheese-search-category-chip" data-action="category-reset">
      <span data-category-chip-label>${escapeHtml(value)}</span>
      ${createCloseIcon()}
    </button>
  `;
}

function updateResultHeader(header, filtered) {
  const controls = getControls();
  header.innerHTML = `
    <div class="cheese-search-result-summary">
      <strong>검색 결과 ${filtered.length.toLocaleString("ko-KR")}개</strong>
      <span class="cheese-search-result-meta">
        전체 ${state.videos.length.toLocaleString("ko-KR")}개
      </span>
    </div>
    ${renderCategoryFilterChip(controls?.categoryFilter)}
  `;
}

function shouldHideClipResultHeader() {
  return (
    isClipContent() &&
    state.loading &&
    !state.fetchInfo &&
    !state.activeFetchSilentRevalidate
  );
}

function removeResultHeader() {
  document.querySelector(".cheese-search-result-header")?.remove();
}

function getControls() {
  const shell = document.querySelector(".cheese-search-shell");
  if (!shell) return null;

  return {
    query: shell.querySelector(".cheese-search-input")?.value.trim() || "",
    categoryFilter: shell.dataset.categoryFilter || "",
    dateFrom: shell.dataset.dateFrom || "",
    dateTo: shell.dataset.dateTo || "",
    duration: shell.dataset.duration || "all",
    videoType: shell.dataset.videoType || "all",
    sort: shell.dataset.sort || "latest",
  };
}

function getPanelElements() {
  const panel = document.querySelector(
    `[role="tabpanel"][id="${getContentConfig().panelId}"]`,
  );
  const header =
    panel?.querySelector(SELECTORS.header) ||
    document.querySelector(SELECTORS.header);
  const list =
    getNativeContentList(panel) ||
    panel?.querySelector(".cheese-search-results-list") ||
    null;
  const noContent = panel?.querySelector(SELECTORS.noContent) || null;
  const pagination = getPaginationElement(panel);
  return { panel, header, list, noContent, pagination };
}

function getPaginationElement(panel) {
  return (
    panel?.querySelector(SELECTORS.pagination) ||
    document.querySelector(SELECTORS.pagination) ||
    state.originalPaginationElement ||
    null
  );
}

function getNativeContentList(panel) {
  const lists = Array.from(panel?.querySelectorAll(SELECTORS.list) || []);
  return (
    lists.find(
      (list) => !list.classList.contains("cheese-search-results-list"),
    ) || null
  );
}

function updateControlsDisabled() {
  const shell = document.querySelector(".cheese-search-shell");
  if (!shell) return;

  shell.classList.toggle("is-disabled", state.hasNoVideos);
  const controls = shell.querySelectorAll(
    "input, button:not([data-action='popup']):not([data-action='search-help'])",
  );
  controls.forEach((control) => {
    control.disabled = state.hasNoVideos;
    control.setAttribute("aria-disabled", String(state.hasNoVideos));
  });
  updateFetchButton();
}

function updateFetchButton() {
  const button = document.querySelector(
    '.cheese-search-shell [data-action="fetch"]',
  );
  if (!button) return;
  const isFetching = Boolean(state.loading && state.activeFetchRequestId);
  const label = isFetching ? "검색 중지" : "검색";
  if (button.textContent !== label) {
    button.textContent = label;
  }
  button.classList.toggle("is-stop", isFetching);
  button.setAttribute("aria-label", label);
}

function ensureHeader(list) {
  let header = document.querySelector(".cheese-search-result-header");
  if (!header) {
    header = document.createElement("div");
    header.className = "cheese-search-result-header";
  }
  if (header.nextElementSibling !== list) {
    list.before(header);
  }
  showOriginalElement(header);
  return header;
}

function ensureSearchList(list) {
  if (list?.classList?.contains("cheese-search-results-list")) {
    return list;
  }
  const existing = document.querySelector(".cheese-search-results-list");
  const searchList =
    existing ||
    document.createElement(list.tagName.toLowerCase() === "ol" ? "ol" : "ul");
  searchList.className = isClipContent()
    ? "cheese-search-results-list channel_component_list__kCgKT channel_component_type_clip__kt2kT"
    : "cheese-search-results-list";
  searchList.dataset.cheeseSearchActive = "1";
  searchList.dataset.contentType = getContentConfig().contentType;
  if (!existing || searchList.previousElementSibling !== list) {
    list.after(searchList);
  }
  return searchList;
}

function renderStatus(message) {
  const { header: nativeHeader, list, pagination } = getPanelElements();
  if (!list) return;

  const searchList = activateSearchView({
    header: nativeHeader,
    list,
    pagination,
  });
  const header = document.querySelector(".cheese-search-result-header");
  header?.remove();
  searchList.removeAttribute("aria-busy");
  searchList.innerHTML = `<li class="cheese-search-status">${escapeHtml(message)}</li>`;
}

function renderSearchingStatus(message) {
  return `
    <li class="cheese-search-status cheese-search-loading">
      <div class="cheese-search-loading-visual" aria-hidden="true">
        <img src="${escapeAttribute(SEARCHING_ANIMATION_URL)}" alt="" loading="lazy" decoding="async">
      </div>
      <strong>${escapeHtml(message)}</strong>
    </li>
  `;
}

function getClipSearchingMessage() {
  return `클립을 모으며 검색 중입니다. 현재 ${state.videos.length.toLocaleString("ko-KR")}개를 확인했습니다.`;
}

function renderSkeleton() {
  const { header: nativeHeader, list, pagination } = getPanelElements();
  if (!list) return;

  const searchList = activateSearchView({
    header: nativeHeader,
    list,
    pagination,
  });
  const header = document.querySelector(".cheese-search-result-header");
  header?.remove();
  searchList.setAttribute("aria-busy", "true");
  searchList.innerHTML = Array.from({ length: 6 }, () =>
    renderSkeletonCard(),
  ).join("");
}

function renderSkeletonCard() {
  if (isClipContent()) {
    return `
      <li class="cheese-search-skeleton-card channel_clip_item__eVWfU" aria-hidden="true">
        <div class="clip_card_container__aoMWB clip_card_is_horizontal__lTG78 clip_card_is_blur__2VGDh">
          <span class="cheese-search-clip-skeleton-thumb cheese-search-skeleton-shimmer"></span>
          <div class="clip_card_wrapper__AcHtn">
            <span class="cheese-search-skeleton-line cheese-search-skeleton-title cheese-search-skeleton-shimmer"></span>
            <span class="cheese-search-skeleton-line cheese-search-skeleton-title-short cheese-search-skeleton-shimmer"></span>
            <span class="cheese-search-skeleton-pill cheese-search-skeleton-shimmer"></span>
          </div>
        </div>
      </li>
    `;
  }

  return `
    <li class="cheese-search-card cheese-search-skeleton-card channel_vod_item__PhCKQ" aria-hidden="true">
      <div class="video_card_container__urjO6 video_card_vertical__+gTMT">
        <div class="cheese-search-skeleton-thumb cheese-search-skeleton-shimmer"></div>
        <div class="video_card_wrapper__M6XT7">
          <div class="video_card_area__FtMQV">
            <div class="cheese-search-skeleton-line cheese-search-skeleton-title cheese-search-skeleton-shimmer"></div>
            <div class="cheese-search-skeleton-line cheese-search-skeleton-title-short cheese-search-skeleton-shimmer"></div>
            <div class="cheese-search-skeleton-meta">
              <span class="cheese-search-skeleton-pill cheese-search-skeleton-shimmer"></span>
              <span class="cheese-search-skeleton-pill cheese-search-skeleton-shimmer"></span>
            </div>
            <div class="cheese-search-skeleton-tags">
              <span class="cheese-search-skeleton-tag cheese-search-skeleton-shimmer"></span>
              <span class="cheese-search-skeleton-tag cheese-search-skeleton-shimmer"></span>
              <span class="cheese-search-skeleton-tag cheese-search-skeleton-shimmer"></span>
            </div>
          </div>
        </div>
      </div>
    </li>
  `;
}

function renderResults() {
  const controls = getControls();
  const { header: nativeHeader, list, pagination } = getPanelElements();
  if (!controls || !list) return;

  if (state.error) {
    renderStatus(`목록을 불러오지 못했습니다. ${state.error}`);
    return;
  }

  if (!state.hasLoaded) {
    renderStatus(
      `검색어를 입력하거나 검색 버튼을 눌러 ${getContentConfig().title} 목록을 불러오세요.`,
    );
    return;
  }

  if (!state.videos.length) {
    state.hasNoVideos = true;
    updateControlsDisabled();
    renderStatus(
      `이 채널의 ${getContentConfig().title} 탭에서 찾을 수 있는 ${getContentConfig().title}이 없습니다.`,
    );
    return;
  }

  const resultSignature = getResultSignature(controls);
  if (state.resultSignature !== resultSignature) {
    state.resultSignature = resultSignature;
    state.visibleCount = RESULT_INITIAL_RENDER_COUNT;
  }

  const filtered = getFilteredVideos(controls);

  const searchList = activateSearchView({
    header: nativeHeader,
    list,
    pagination,
  });
  const header = ensureHeader(searchList);
  const visibleResults = filtered.slice(0, state.visibleCount);
  if (shouldHideClipResultHeader()) {
    removeResultHeader();
  } else {
    updateResultHeader(header, filtered);
  }

  if (!filtered.length) {
    searchList.removeAttribute("aria-busy");
    if (state.loading && !state.fetchInfo && isClipContent()) {
      searchList.innerHTML = renderSearchingStatus(getClipSearchingMessage());
      return;
    }
    searchList.innerHTML = renderSearchEmpty(controls.query);
    return;
  }

  searchList.removeAttribute("aria-busy");
  searchList.innerHTML = visibleResults.map(renderItemCard).join("");
  if (isClipContent()) {
    state.renderedClipUIDs = new Set(
      visibleResults
        .map((clip) => String(clip?.clipUID || "").trim())
        .filter(Boolean),
    );
  }
  normalizeRenderedClipCards(searchList);
}

function renderSearchEmpty(query) {
  const trimmedQuery = String(query || "").trim();
  const title = trimmedQuery
    ? `'<span>${escapeHtml(trimmedQuery)}</span>' 검색 결과가 없습니다.`
    : "검색 조건에 맞는 결과가 없습니다.";

  return `
    <li class="cheese-search-status cheese-search-empty">
      <div class="cheese-search-empty-visual" aria-hidden="true">
        <img src="${escapeAttribute(EMPTY_RESULTS_ANIMATION_URL)}" alt="" loading="lazy" decoding="async">
      </div>
      <strong>${title}</strong>
      <p>검색어 또는 필터를 확인해주세요.</p>
    </li>
  `;
}

async function resetSearch() {
  const shell = document.querySelector(".cheese-search-shell");
  if (!shell) return;
  if (state.hasNoVideos) return;

  const isClipSearch = isClipContent();
  const controlsBeforeReset = getControls();
  const requestIdToCancel = state.activeFetchRequestId;
  shell.querySelector(".cheese-search-input").value = "";
  updateQueryResetButton();
  setCategoryFilter(shell, "");
  state.resultSignature = "";
  state.visibleCount = RESULT_INITIAL_RENDER_COUNT;
  setDateValue(shell, "dateFrom", "");
  setDateValue(shell, "dateTo", "");
  resetCalendarMonthsToCurrent();
  setDurationValue(shell, "all");
  setVideoTypeValue(shell, "all");
  setSortValue(shell, "latest");
  closeFloatingControls(shell);

  const header = document.querySelector(".cheese-search-result-header");
  header?.remove();

  state.videos = [];
  state.knownClipUIDs = new Set();
  state.renderedClipUIDs = new Set();
  state.fetchInfo = null;
  state.fromCache = false;
  state.hasLoaded = false;
  state.hasNoVideos = false;
  state.loading = false;
  state.error = "";
  state.activeFetchRequestId = "";
  state.activeFetchSilentRevalidate = false;
  state.progressResultSignature = "";
  clearProgressStallTimer();
  clearFetchProgress();
  clearViewRestoreSnapshotForCurrentContent();
  updateControlsDisabled();
  updateFetchButton();
  restoreOriginalView();
  await setAutoRestoreDisabled({
    isClipSearch,
    controls: controlsBeforeReset,
  });
  await setAutoRestoreDisabled({
    isClipSearch,
    controls: getControls(),
  });
  await clearLastAutoRestoreState({ isClipSearch });
  if (requestIdToCancel) {
    try {
      await sendMessage({
        type: "CHEESE_SEARCH_CANCEL_FETCH",
        payload: { requestId: requestIdToCancel },
      });
    } catch {
      // The page already returned to the original CHZZK view.
    }
  }
}

function restoreOriginalView() {
  const { header, list, pagination } = getPanelElements();
  const paginationElement = pagination || state.originalPaginationElement;
  const resultHeader = document.querySelector(".cheese-search-result-header");
  const searchList = document.querySelector(".cheese-search-results-list");
  resultHeader?.remove();
  searchList?.remove();

  if (header && !state.originalHeaderHidden) {
    showOriginalElement(header);
  }

  if (list && !state.originalListHidden) {
    showOriginalElement(list);
    list.removeAttribute("aria-busy");
  }

  if (paginationElement && !state.originalPaginationHidden) {
    showOriginalElement(paginationElement);
  }

  state.originalHeaderHidden = false;
  state.originalListHidden = false;
  state.originalPaginationHidden = false;
  state.originalPaginationElement = null;
  state.originalViewRemembered = false;
}

function activateSearchView({ header, list, pagination }) {
  if (list?.classList?.contains("cheese-search-results-list")) {
    hidePaginationWhileSearching();
    return ensureSearchList(list);
  }
  rememberOriginalView({ header, list, pagination });
  if (header && !state.originalHeaderHidden) hideOriginalElement(header);
  if (list && !state.originalListHidden) hideOriginalElement(list);
  hidePaginationWhileSearching(pagination);
  return ensureSearchList(list);
}

function rememberOriginalView({ header, list, pagination }) {
  if (state.originalViewRemembered) return;
  const paginationElement = pagination || getPaginationElement();
  state.originalHeaderHidden = isElementHidden(header);
  state.originalListHidden = isElementHidden(list);
  state.originalPaginationHidden = isElementHidden(paginationElement);
  state.originalPaginationElement = paginationElement;
  state.originalViewRemembered = true;
}

function hidePaginationWhileSearching(pagination = getPaginationElement()) {
  if (!pagination) return;
  if (!state.originalPaginationElement) {
    state.originalPaginationElement = pagination;
    state.originalPaginationHidden = isElementHidden(pagination);
  }
  if (!state.originalPaginationHidden) {
    hideOriginalElement(pagination);
  }
}

function hideOriginalElement(element) {
  element.classList.add("cheese-search-original-hidden");
  element.setAttribute("aria-hidden", "true");
}

function showOriginalElement(element) {
  element.classList.remove(
    "cheese-search-original-hidden",
    "cheese-search-hidden",
  );
  element.hidden = false;
  element.removeAttribute("aria-hidden");
  if (element.style.display === "none") {
    element.style.display = "";
  }
}

function isElementHidden(element) {
  if (!element) return true;
  return (
    element.hidden ||
    element.classList.contains("cheese-search-hidden") ||
    element.style.display === "none"
  );
}

function openPopupSearch() {
  const controls = getControls() || {
    query: "",
    dateFrom: "",
    dateTo: "",
    duration: "all",
    videoType: "all",
    sort: "latest",
    categoryFilter: "",
  };
  const url = new URL(chrome.runtime.getURL("popup.html"));
  url.searchParams.set("channelId", state.channelId);
  url.searchParams.set("channelName", getCurrentChannelName());
  url.searchParams.set("contentType", getContentConfig().contentType);
  url.searchParams.set("filterType", getCurrentClipFilterType());
  url.searchParams.set("orderType", getClipOrderTypeFromSort(controls.sort));
  url.searchParams.set("q", controls.query);
  url.searchParams.set("categoryFilter", controls.categoryFilter || "");
  url.searchParams.set("dateFrom", controls.dateFrom);
  url.searchParams.set("dateTo", controls.dateTo);
  url.searchParams.set("duration", controls.duration);
  url.searchParams.set("videoTypeFilter", controls.videoType);
  url.searchParams.set("sort", controls.sort);
  window.open(url.toString(), "cheese-search-popup", "width=1080,height=735");
}

function getCurrentChannelName() {
  const selectors = [
    '[class*="channel_profile_name__"] [class*="name_text__"]',
    '[class*="channel_profile_name__"]',
    '[class*="name_text__"]',
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }

  return "";
}

function getCurrentClipFilterType() {
  if (!isClipContent()) return "ALL";
  const fromUrl = new URLSearchParams(location.search).get("filterType");
  if (fromUrl) return normalizeClipFilterType(fromUrl);
  const selected = document.querySelector(
    '#clips-PANEL [id="ALL"][aria-selected="true"], #clips-PANEL [id="WITHIN_ONE_DAY"][aria-selected="true"], #clips-PANEL [id="WITHIN_SEVEN_DAYS"][aria-selected="true"], #clips-PANEL [id="WITHIN_THIRTY_DAYS"][aria-selected="true"]',
  );
  return normalizeClipFilterType(selected?.id || "ALL");
}

function getClipOrderTypeFromSort(sort) {
  if (!isClipContent()) return "RECENT";
  if (sort === "popular") return "POPULAR";
  return "RECENT";
}

function getInitialSortValue() {
  if (!isClipContent()) return "latest";
  const fromUrl = new URLSearchParams(location.search).get("orderType");
  if (normalizeClipOrderType(fromUrl) === "POPULAR") return "popular";
  const selected = document.querySelector(
    '#clips-PANEL [id="POPULAR"][aria-selected="true"], #clips-PANEL [id="RECENT"][aria-selected="true"]',
  );
  return normalizeClipOrderType(selected?.id || "RECENT") === "POPULAR"
    ? "popular"
    : "latest";
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

function normalizeClipOrderType(value) {
  const normalized = String(value || "RECENT").toUpperCase();
  return normalized === "POPULAR" ? "POPULAR" : "RECENT";
}

function handleDatePickerClick(event) {
  const picker = event.currentTarget;
  const shell = picker.closest(".cheese-search-shell");
  const type = picker.dataset.datePicker;
  if (!shell || !type) return;

  const action = event.target.closest(
    "[data-action], [data-calendar-action], [data-calendar-year], [data-calendar-month], [data-range-preset], [data-date]",
  )?.dataset;
  if (!action) return;
  event.stopPropagation();

  if (action.action === "date-toggle") {
    closeSearchHelp(shell);
    closeSortPicker(shell);
    closeDurationPicker(shell);
    closeVideoTypePicker(shell);
    closeOtherDatePickers(shell, picker);
    toggleDatePicker(picker);
    return;
  }

  if (action.calendarAction === "prev") {
    state.calendarMonths[type] = addMonths(state.calendarMonths[type], -1);
    renderCalendar(picker);
    return;
  }

  if (action.calendarAction === "next") {
    state.calendarMonths[type] = addMonths(state.calendarMonths[type], 1);
    renderCalendar(picker);
    return;
  }

  if (action.calendarAction === "month-popover") {
    toggleCalendarMonthPopover(picker);
    return;
  }

  if (action.calendarYear) {
    state.calendarMonths[type] = new Date(
      Number(action.calendarYear),
      state.calendarMonths[type].getMonth(),
      1,
    );
    renderCalendar(picker);
    closeCalendarMonthPopover(picker);
    keepDatePickerOpen(picker);
    refreshClipLoadingView();
    return;
  }

  if (action.calendarMonth) {
    state.calendarMonths[type] = new Date(
      state.calendarMonths[type].getFullYear(),
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
    setDateValue(shell, type, "");
    renderAllCalendars(shell);
    handleFilterChange();
    return;
  }

  if (action.calendarAction === "close") {
    closeDatePicker(picker);
    return;
  }

  if (action.rangePreset) {
    applyRangePreset(shell, action.rangePreset);
    closeFloatingControls(shell);
    renderAllCalendars(shell);
    handleFilterChange();
    return;
  }

  if (action.date) {
    setDateValue(shell, type, action.date);
    normalizeDateRange(shell, type);
    closeDatePicker(picker);
    renderAllCalendars(shell);
    handleFilterChange();
  }
}

function refreshClipLoadingView() {
  if (state.loading && isClipContent()) {
    renderProgressClipCards();
  }
}

function applyRangePreset(shell, preset) {
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

  const start = toDateKey(startDate);
  setDateValue(shell, "dateFrom", start);
  setDateValue(shell, "dateTo", end);
  state.calendarMonths.dateFrom = getMonthStart(startDate);
  state.calendarMonths.dateTo = getMonthStart(today);
}

function handleSortPickerClick(event) {
  const picker = event.currentTarget;
  const shell = picker.closest(".cheese-search-shell");
  if (!shell) return;

  const toggle = event.target.closest('[data-action="sort-toggle"]');
  if (toggle) {
    closeSearchHelp(shell);
    closeAllDatePickers(shell);
    closeDurationPicker(shell);
    closeVideoTypePicker(shell);
    toggleSortPicker(shell);
    return;
  }

  const option = event.target.closest("[data-sort-value]");
  if (!option) return;
  setSortValue(shell, option.dataset.sortValue);
  closeSortPicker(shell);
  handleFilterChange();
}

function handleDurationPickerClick(event) {
  const picker = event.currentTarget;
  const shell = picker.closest(".cheese-search-shell");
  if (!shell) return;

  const toggle = event.target.closest('[data-action="duration-toggle"]');
  if (toggle) {
    closeSearchHelp(shell);
    closeAllDatePickers(shell);
    closeSortPicker(shell);
    closeVideoTypePicker(shell);
    toggleDurationPicker(shell);
    return;
  }

  const option = event.target.closest("[data-duration-value]");
  if (!option) return;
  setDurationValue(shell, option.dataset.durationValue);
  closeDurationPicker(shell);
  handleFilterChange();
}

function handleVideoTypePickerClick(event) {
  const picker = event.currentTarget;
  const shell = picker.closest(".cheese-search-shell");
  if (!shell) return;

  const toggle = event.target.closest('[data-action="video-type-toggle"]');
  if (toggle) {
    closeSearchHelp(shell);
    closeAllDatePickers(shell);
    closeSortPicker(shell);
    closeDurationPicker(shell);
    toggleVideoTypePicker(shell);
    return;
  }

  const option = event.target.closest("[data-video-type-value]");
  if (!option) return;
  setVideoTypeValue(shell, option.dataset.videoTypeValue);
  closeVideoTypePicker(shell);
  handleFilterChange();
}

function handleSearchHelpClick(event) {
  event.preventDefault();
  const shell = event.currentTarget.closest(".cheese-search-shell");
  if (!shell) return;

  closeAllDatePickers(shell);
  closeSortPicker(shell);
  closeDurationPicker(shell);
  closeVideoTypePicker(shell);
  toggleSearchHelp(shell);
}

function toggleDatePicker(picker) {
  const calendar = picker.querySelector(".cheese-search-calendar");
  const trigger = picker.querySelector(".cheese-search-date-trigger");
  const nextOpen = calendar.hidden;
  calendar.hidden = !nextOpen;
  trigger.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) renderCalendar(picker);
}

function closeDatePicker(picker) {
  const calendar = picker.querySelector(".cheese-search-calendar");
  const trigger = picker.querySelector(".cheese-search-date-trigger");
  if (!calendar || !trigger) return;
  closeCalendarMonthPopover(picker);
  calendar.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
}

function keepDatePickerOpen(picker) {
  const calendar = picker.querySelector(".cheese-search-calendar");
  const trigger = picker.querySelector(".cheese-search-date-trigger");
  if (!calendar || !trigger) return;
  calendar.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
}

function closeFloatingControlsFromOutside(event) {
  const shell = document.querySelector(".cheese-search-shell");
  if (!shell || shell.contains(event.target)) return;
  closeFloatingControls(shell);
}

function closeFloatingControls(shell) {
  closeAllDatePickers(shell);
  closeSortPicker(shell);
  closeDurationPicker(shell);
  closeVideoTypePicker(shell);
  closeSearchHelp(shell);
}

function closeAllDatePickers(shell) {
  shell.querySelectorAll("[data-date-picker]").forEach(closeDatePicker);
}

function closeOtherDatePickers(shell, currentPicker) {
  shell.querySelectorAll("[data-date-picker]").forEach((picker) => {
    if (picker !== currentPicker) closeDatePicker(picker);
  });
}

function toggleSortPicker(shell) {
  const menu = shell.querySelector(".cheese-search-sort-menu");
  const trigger = shell.querySelector(".cheese-search-sort-trigger");
  const nextOpen = menu.hidden;
  menu.hidden = !nextOpen;
  trigger.setAttribute("aria-expanded", String(nextOpen));
}

function toggleDurationPicker(shell) {
  const menu = shell.querySelector(".cheese-search-duration-menu");
  const trigger = shell.querySelector(".cheese-search-duration-trigger");
  if (!menu || !trigger) return;
  const nextOpen = menu.hidden;
  menu.hidden = !nextOpen;
  trigger.setAttribute("aria-expanded", String(nextOpen));
}

function toggleVideoTypePicker(shell) {
  const menu = shell.querySelector(".cheese-search-video-type-menu");
  const trigger = shell.querySelector(".cheese-search-video-type-trigger");
  if (!menu || !trigger) return;
  const nextOpen = menu.hidden;
  menu.hidden = !nextOpen;
  trigger.setAttribute("aria-expanded", String(nextOpen));
}

function closeSortPicker(shell) {
  const menu = shell.querySelector(".cheese-search-sort-menu");
  const trigger = shell.querySelector(".cheese-search-sort-trigger");
  if (!menu || !trigger) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
}

function closeDurationPicker(shell) {
  const menu = shell.querySelector(".cheese-search-duration-menu");
  const trigger = shell.querySelector(".cheese-search-duration-trigger");
  if (!menu || !trigger) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
}

function closeVideoTypePicker(shell) {
  const menu = shell.querySelector(".cheese-search-video-type-menu");
  const trigger = shell.querySelector(".cheese-search-video-type-trigger");
  if (!menu || !trigger) return;
  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
}

function toggleSearchHelp(shell) {
  const help = shell.querySelector(".cheese-search-help");
  const trigger = shell.querySelector('[data-action="search-help"]');
  if (!help || !trigger) return;
  const nextOpen = help.hidden;
  help.hidden = !nextOpen;
  trigger.setAttribute("aria-expanded", String(nextOpen));
}

function closeSearchHelp(shell) {
  const help = shell.querySelector(".cheese-search-help");
  const trigger = shell.querySelector('[data-action="search-help"]');
  if (!help || !trigger) return;
  help.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
}

function setSortValue(shell, value) {
  const options = getSortOptions();
  const labels = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  );
  const normalizedValue = labels[value] ? value : options[0].value;
  shell.dataset.sort = normalizedValue;
  const label = shell.querySelector("[data-sort-label]");
  if (label) label.textContent = labels[normalizedValue] || options[0].label;
  shell.querySelectorAll("[data-sort-value]").forEach((option) => {
    option.setAttribute(
      "aria-selected",
      String(option.dataset.sortValue === normalizedValue),
    );
  });
}

function setDurationValue(shell, value) {
  const normalizedValue = DURATION_FILTERS[value] ? value : "all";
  shell.dataset.duration = normalizedValue;
  const label = shell.querySelector("[data-duration-label]");
  if (label) label.textContent = DURATION_FILTERS[normalizedValue].label;
  shell.querySelectorAll("[data-duration-value]").forEach((option) => {
    option.setAttribute(
      "aria-selected",
      String(option.dataset.durationValue === normalizedValue),
    );
  });
}

function setVideoTypeValue(shell, value) {
  const normalizedValue = VIDEO_TYPE_FILTERS[value] ? value : "all";
  shell.dataset.videoType = normalizedValue;
  const label = shell.querySelector("[data-video-type-label]");
  if (label) label.textContent = VIDEO_TYPE_FILTERS[normalizedValue].label;
  shell.querySelectorAll("[data-video-type-value]").forEach((option) => {
    option.setAttribute(
      "aria-selected",
      String(option.dataset.videoTypeValue === normalizedValue),
    );
  });
}

function setDateValue(shell, type, value) {
  shell.dataset[type] = value;
  const label = shell.querySelector(`[data-date-label="${type}"]`);
  if (!label) return;
  label.textContent = value ? formatDateLabel(value) : "선택 안 함";
}

function normalizeDateRange(shell, changedType) {
  const dateFrom = shell.dataset.dateFrom || "";
  const dateTo = shell.dataset.dateTo || "";
  if (!dateFrom || !dateTo || dateFrom <= dateTo) return;

  if (changedType === "dateFrom") {
    setDateValue(shell, "dateTo", "");
  } else {
    setDateValue(shell, "dateFrom", "");
  }
}

function renderAllCalendars(shell) {
  shell.querySelectorAll("[data-date-picker]").forEach(renderCalendar);
}

function renderCalendar(picker) {
  const type = picker.dataset.datePicker;
  const title = picker.querySelector("[data-calendar-title]");
  const grid = picker.querySelector("[data-calendar-grid]");
  if (!type || !title || !grid) return;

  const month = state.calendarMonths[type] || getMonthStart(new Date());

  const titleText = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(month);
  title.innerHTML = `<button type="button" class="cheese-search-calendar-title-button" data-calendar-action="month-popover" aria-haspopup="dialog" aria-expanded="${String(isCalendarMonthPopoverOpen(picker))}">${escapeHtml(titleText)}</button>`;
  renderCalendarMonthPopover(picker, month);

  const shell = picker.closest(".cheese-search-shell");
  const dateFrom = shell?.dataset.dateFrom || "";
  const dateTo = shell?.dataset.dateTo || "";
  const selectedDate = shell?.dataset[type] || "";
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
        "cheese-search-calendar-day",
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
  popover.className = "cheese-search-calendar-month-popover";
  popover.dataset.calendarMonthPopover = "1";
  popover.hidden = true;
  picker.querySelector(".cheese-search-calendar-head")?.after(popover);
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
    <div class="cheese-search-calendar-picker-years" aria-label="년도 선택">
      ${years
        .map(
          (year) =>
            `<button type="button" data-calendar-year="${year}" aria-selected="${String(year === selectedYear)}">${year}년</button>`,
        )
        .join("")}
    </div>
    <div class="cheese-search-calendar-picker-months" aria-label="월 선택">
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
  state.calendarMonths = {
    dateFrom: new Date(currentMonth),
    dateTo: new Date(currentMonth),
  };
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
  if (isClipContent()) {
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

function matchesDuration(video, filterValue) {
  const filter = DURATION_FILTERS[filterValue] || DURATION_FILTERS.all;
  if (filterValue === "all" || filter === DURATION_FILTERS.all) return true;
  const seconds = Number(video?.duration || 0);
  return seconds >= filter.min && seconds <= filter.max;
}

function parsePublishDate(value) {
  if (!value) return 0;
  const text = String(value).trim();
  if (/T/.test(text)) {
    return new Date(text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).getTime();
  }
  return new Date(text.replace(" ", "T") + "+09:00").getTime();
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
  const date = new Date(time);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function formatCount(value) {
  const number = Number(value || 0);
  return number.toLocaleString("ko-KR");
}

function isAdultVideo(video) {
  return (
    video?.adult === true || String(video?.adult || "").toLowerCase() === "true"
  );
}

function renderItemCard(item) {
  return isClipContent() ? renderClipCard(item) : renderVideoCard(item);
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
    <li class="cheese-search-card channel_clip_item__eVWfU">
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
  if (!isClipContent()) return;
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

function renderVideoCard(video) {
  const tags = Array.isArray(video.tags) ? video.tags : [];
  const isAdult = isAdultVideo(video);
  const showThumbnail = canShowAdultThumbnail(video);
  const thumbnailImageUrl = getThumbnailImageUrl(video);
  const videoTypeLabel = getVideoTypeLabel(video);
  const isUploadVideo = isUploadVideoType(video);
  const videoTypeBadgeClasses = [
    "thumbnail_badge_container__sMIz3",
    "thumbnail_badge_replay__atyb4",
    "thumbnail_badge_bold_font__sH+-P",
    isUploadVideo ? "cheese-search-upload-badge" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const thumbnailClasses = [
    "video_card_thumbnail__QXYT8",
    isAdult ? "video_card_is_adult__f3RBL" : "",
    isAdult && !showThumbnail ? "video_card_is_dimmed__9YEzr" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const categoryUrl = getCategoryUrl(video);
  const categoryHtml = video.videoCategoryValue
    ? categoryUrl
      ? `<a href="${escapeAttribute(categoryUrl)}" target="_blank" rel="noreferrer" data-cheese-category-filter="${escapeAttribute(video.videoCategoryValue)}"><span class="video_card_category__xQ15T">${escapeHtml(video.videoCategoryValue)}</span></a>`
      : `<span class="video_card_category__xQ15T">${escapeHtml(video.videoCategoryValue)}</span>`
    : "";
  const tagHtml = tags
    .map((tag) => {
      const safeTag = escapeHtml(tag);
      return `<a href="${escapeAttribute(getTagUrl(tag))}" target="_blank" rel="noreferrer"><span class="video_card_category__xQ15T video_card_tag__4NF6R">${safeTag}</span></a>`;
    })
    .join("");
  const livePvBadge = video.livePv
    ? `<span class="thumbnail_badge_container__sMIz3">${formatCompactCount(video.livePv)}회 시청된 라이브</span>`
    : "";
  const watchTimelineBar = renderWatchTimelineBar(video, "cheese-search");

  return `
    <li class="cheese-search-card channel_vod_item__PhCKQ">
      <div class="video_card_container__urjO6 video_card_vertical__+gTMT">
        <a class="${thumbnailClasses}" href="${getVideoUrl(video)}" target="_blank" rel="noreferrer" title="${escapeAttribute(isAdult ? "" : video.videoTitle || "")}">
          ${isAdult ? `<span class="blind">19 연령 제한</span>` : ""}
          ${isAdult && !showThumbnail ? `<span class="video_card_dimmed__yR1oT"></span>` : ""}
          ${showThumbnail && thumbnailImageUrl ? `<img width="100%" height="100%" alt="" src="${escapeAttribute(thumbnailImageUrl)}" class="video_card_image__yHXqv" loading="lazy">` : ""}
          <div class="video_card_description__2sUfw">
            <em class="${videoTypeBadgeClasses}">${videoTypeLabel}</em>
            ${livePvBadge}
          </div>
          <span class="video_card_time__NAWm6">${formatDuration(video.duration)}</span>
          ${watchTimelineBar}
          <span class="blind">${escapeHtml(video.channel?.channelName || "")}동영상 엔드로 이동</span>
        </a>
        <div class="video_card_wrapper__M6XT7">
          <div class="video_card_area__FtMQV">
            <a class="video_card_title__Amjk2" href="${getVideoUrl(video)}" target="_blank" rel="noreferrer">${escapeHtml(video.videoTitle || "제목 없음")}<span class="blind">동영상 엔드로 이동</span></a>
            <div class="video_card_information__1w2l-">
              <span class="video_card_item__lOC8Y">조회수 ${formatCount(video.readCount)}회</span>
              <div class="video_card_time_info">
                <span class="video_card_item__lOC8Y">${escapeHtml(formatLiveStartDateTime(video))}</span>
                <span class="video_card_item__lOC8Y">${escapeHtml(formatPublishDateTime(video))}</span>
              </div>
            </div>
            ${categoryHtml || tagHtml ? `<div class="video_card_information__1w2l- video_card_link__XSQ6l">${categoryHtml}${tagHtml}</div>` : ""}
          </div>
          <div class="video_card_layer__WHTbQ">
            <div>
              <button type="button" class="video_card_more_button__yXWHm" aria-haspopup="true" aria-expanded="false">
                <span class="blind">더보기</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  `;
}

function formatCompactCount(value) {
  const number = Number(value || 0);
  if (number >= 10000) {
    const compact = Math.floor(number / 1000) / 10;
    return `${compact.toLocaleString("ko-KR")}만`;
  }
  return number.toLocaleString("ko-KR");
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

function init() {
  const context = getPageContext();
  if (!context?.channelId) {
    if (state.initializedFor) {
      restoreOriginalView();
      document.querySelector(".cheese-search-shell")?.remove();
      document.querySelector(".cheese-search-result-header")?.remove();
      document.querySelector(".cheese-search-results-list")?.remove();
      state.initializedFor = "";
      state.autoRestoreAttemptedFor = "";
      state.channelId = null;
      state.contentType = "videos";
      state.loading = false;
      state.activeFetchRequestId = "";
      clearProgressStallTimer();
      clearFetchProgress();
    }
    return;
  }

  const initializedFor = `${context.channelId}:${context.contentType}`;
  const isFreshContext = state.initializedFor !== initializedFor;
  const shouldResumeStaleLoading =
    !isFreshContext && state.loading && !state.activeFetchRequestId;

  if (isFreshContext) {
    state.activeFetchRequestId = "";
    restoreOriginalView();
    document.querySelector(".cheese-search-shell")?.remove();
    state.channelId = context.channelId;
    state.contentType = context.contentType;
    state.videos = [];
    state.knownClipUIDs = new Set();
    state.error = "";
    state.fetchInfo = null;
    state.hasLoaded = false;
    state.hasNoVideos = false;
    state.loading = false;
    if (state.progressRenderTimer) {
      clearTimeout(state.progressRenderTimer);
      state.progressRenderTimer = 0;
    }
    state.initializedFor = initializedFor;
    state.autoRestoreAttemptedFor = "";
    state.resultSignature = "";
    state.visibleCount = RESULT_INITIAL_RENDER_COUNT;
    resetCalendarMonthsToCurrent();
    state.originalHeaderHidden = false;
    state.originalListHidden = false;
    state.originalPaginationHidden = false;
    state.originalPaginationElement = null;
    state.originalViewRemembered = false;
  } else if (shouldResumeStaleLoading) {
    state.loading = false;
  }

  const { list, noContent } = getPanelElements();
  const anchor = list || noContent;
  if (!anchor) return;

  mountControls(anchor);
  if (document.querySelector(".cheese-search-results-list")) {
    hidePaginationWhileSearching();
  }
  detectInitialNoVideos();

  const shouldAttemptAutoRestore =
    (isFreshContext ||
      shouldResumeStaleLoading ||
      state.autoRestoreAttemptedFor !== initializedFor) &&
    !state.hasNoVideos &&
    !state.hasLoaded &&
    !state.loading;

  if (shouldAttemptAutoRestore) {
    state.autoRestoreAttemptedFor = initializedFor;
    void resumeFromBackgroundOrCache();
  }
}

async function resumeFromBackgroundOrCache() {
  const isClipSearch = isClipContent();
  const controls = getControls();
  const resubscribed = await tryResubscribeOngoingFetch();
  if (resubscribed) return;
  if (state.hasLoaded || state.loading) return;
  const isCurrentRestoreDisabled = await isAutoRestoreDisabled({
    isClipSearch,
    controls,
  });
  const hydrated = isCurrentRestoreDisabled
    ? false
    : await hydrateFromSessionCache({ isClipSearch, controls });
  if (hydrated || !isClipSearch) return;
  const restoreState = await readLastAutoRestoreState({ isClipSearch });
  if (!restoreState) return;
  if (
    await isAutoRestoreDisabledForRestoreState({
      isClipSearch,
      restoreState,
    })
  ) {
    return;
  }
  await hydrateFromSessionCache({ isClipSearch, controls, restoreState });
}

async function tryResubscribeOngoingFetch() {
  if (!state.channelId) return false;
  const isClipSearch = isClipContent();
  const requestId = createRequestId("content");
  const controls = getControls();
  const payload = {
    channelId: state.channelId,
    contentType: getContentConfig().contentType,
    videoType: "",
    sortType: "LATEST",
    filterType: getCurrentClipFilterType(),
    orderType: getClipOrderTypeFromSort(controls?.sort),
    requestId,
  };
  const previousRequestId = state.activeFetchRequestId;
  state.activeFetchRequestId = requestId;
  let response;
  try {
    response = await sendMessage({
      type: "CHEESE_SEARCH_RESUBSCRIBE",
      payload,
    });
  } catch {
    state.activeFetchRequestId = previousRequestId;
    return false;
  }
  if (!response) {
    state.activeFetchRequestId = previousRequestId;
    return false;
  }
  state.loading = true;
  updateFetchButton();
  resetProgressStallTimer();
  setFetchProgress({
    phase: "start",
    fetchedPages: 0,
    totalPages: 0,
    totalCount: 0,
    contentType: getContentConfig().contentType,
  });
  if (!state.hasLoaded) {
    renderSkeleton();
  }
  return true;
}

function detectInitialNoVideos() {
  if (state.hasLoaded) return;

  const { list, noContent } = getPanelElements();
  if (list?.querySelector(getContentConfig().itemSelector)) {
    state.hasNoVideos = false;
    updateControlsDisabled();
    return;
  }

  const text = noContent?.textContent || "";
  state.hasNoVideos =
    getContentConfig().emptyPattern.test(text) && isVisible(noContent);
  updateControlsDisabled();
}

function isVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function handleWindowScroll() {
  updateScrollTopButton();
  if (!state.hasLoaded || state.loading) return;
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
  const controls = getControls();
  const searchList = document.querySelector(".cheese-search-results-list");
  const header = document.querySelector(".cheese-search-result-header");
  if (!controls || !searchList || !header) return;

  const filtered = getFilteredVideos(controls);
  const nextVisibleCount = Math.min(
    filtered.length,
    state.visibleCount + RESULT_RENDER_STEP_COUNT,
  );
  if (nextVisibleCount <= state.visibleCount) return;
  const nextResults = filtered.slice(state.visibleCount, nextVisibleCount);
  state.visibleCount = nextVisibleCount;
  searchList.insertAdjacentHTML(
    "beforeend",
    nextResults.map(renderItemCard).join(""),
  );
  normalizeRenderedClipCards(searchList);
  updateResultHeader(header, filtered);
}

function createScrollTopIcon() {
  return `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function ensureScrollTopButton() {
  let button = document.querySelector(".cheese-search-scroll-top");
  if (button) return button;
  button = document.createElement("button");
  button.type = "button";
  button.className = "cheese-search-scroll-top";
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
  button.hidden = window.scrollY < Math.max(1000, window.innerHeight * 1.2);
}

const observer = new MutationObserver(() => init());
observer.observe(document.documentElement, { childList: true, subtree: true });
ensureScrollTopButton();
window.addEventListener("scroll", debounce(handleWindowScroll, 120), {
  passive: true,
});
document.addEventListener("click", handleCategoryFilterClick);
document.addEventListener("click", handleCategoryResetDocumentClick);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "CHEESE_SEARCH_FETCH_PROGRESS") return;
  if (
    !state.activeFetchRequestId ||
    message.requestId !== state.activeFetchRequestId
  )
    return;
  const progress = message.progress || {};
  if (progress.channelId && progress.channelId !== state.channelId) return;
  if (
    progress.contentType &&
    progress.contentType !== getContentConfig().contentType &&
    !(
      progress.contentType === "videos" &&
      getContentConfig().contentType === "videos"
    )
  ) {
    return;
  }
  const isSilent = state.activeFetchSilentRevalidate;
  if (!isSilent) {
    appendProgressClips(progress);
    setFetchProgress(progress);
  }
  if (progress.phase === "error") {
    state.error = progress.error || "클립 목록을 불러오지 못했습니다.";
    state.loading = false;
    state.activeFetchRequestId = "";
    state.activeFetchSilentRevalidate = false;
    clearProgressStallTimer();
    updateFetchButton();
    renderStatus(`목록을 불러오지 못했습니다. ${state.error}`);
    scheduleClearFetchProgress();
    return;
  }
  if (progress.phase === "done" && isClipContent()) {
    void finalizeClipProgressDone(progress, isSilent);
    return;
  }
  if (progress.phase === "queued") {
    if (isClipContent()) {
      renderProgressClipCards();
    }
    resetProgressStallTimer();
    return;
  }
  resetProgressStallTimer();
});

async function finalizeClipProgressDone(progress, isSilent) {
  const channelId = state.channelId;
  const controls = getControls();
  state.fetchInfo = {
    ...(state.fetchInfo || {}),
    ...progress,
    contentType: "clips",
    phase: "done",
  };

  const expectedTotal = Number(progress?.totalCount || 0);
  if (
    !state.videos.length ||
    (expectedTotal && state.videos.length < expectedTotal)
  ) {
    await hydrateFromSessionCache({
      isClipSearch: true,
      controls,
    });
  }

  if (state.channelId !== channelId || !isClipContent()) return;

  state.loading = false;
  state.hasLoaded = true;
  state.hasNoVideos = state.videos.length === 0;
  state.fetchedAt = progress.fetchedAt || state.fetchedAt || Date.now();
  state.activeFetchRequestId = "";
  state.activeFetchSilentRevalidate = false;
  clearProgressStallTimer();
  updateControlsDisabled();
  updateFetchButton();
  writeViewRestoreSnapshot({
    isClipSearch: true,
    controls,
  });
  void writeLastAutoRestoreState({
    isClipSearch: true,
    controls,
  });
  if (!isSilent) {
    state.resultSignature = "";
    renderResults();
  }
  scheduleClearFetchProgress();
}

function resetProgressStallTimer() {
  clearProgressStallTimer();
  state.progressStallTimer = setTimeout(
    handleProgressStall,
    PROGRESS_STALL_TIMEOUT_MS,
  );
}

function clearProgressStallTimer() {
  if (state.progressStallTimer) {
    clearTimeout(state.progressStallTimer);
    state.progressStallTimer = 0;
  }
}

async function handleProgressStall() {
  state.progressStallTimer = 0;
  if (!state.activeFetchRequestId || !state.channelId) return;
  const isClipSearch = isClipContent();
  if (!isClipSearch) return;
  const controls = getControls();
  const newRequestId = createRequestId("content-resume");
  const previousRequestId = state.activeFetchRequestId;
  state.activeFetchRequestId = newRequestId;
  let response;
  try {
    response = await sendMessage({
      type: "CHEESE_SEARCH_RESUBSCRIBE",
      payload: {
        channelId: state.channelId,
        contentType: getContentConfig().contentType,
        videoType: "",
        sortType: "LATEST",
        filterType: getCurrentClipFilterType(),
        orderType: getClipOrderTypeFromSort(controls?.sort),
        requestId: newRequestId,
      },
    });
  } catch {
    response = null;
  }
  if (response) {
    if (response.lastPhase === "done") {
      state.loading = false;
      state.activeFetchRequestId = "";
      state.activeFetchSilentRevalidate = false;
      state.fetchInfo = response;
      updateFetchButton();
      renderProgressClipCards();
      return;
    }
    resetProgressStallTimer();
    return;
  }
  state.activeFetchRequestId = previousRequestId;
  state.activeFetchRequestId = "";
  state.loading = false;
  state.activeFetchSilentRevalidate = false;
  updateFetchButton();
  loadVideos({ forceRefresh: false });
}

init();
