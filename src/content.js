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
const STUDIO_MANAGE_API_BASE = "https://api.chzzk.naver.com/manage/v1";
const VIDEO_COMMENT_MARKER_SELECTOR = ".cheese-search-comment-marker";
const VIDEO_COMMENT_MARKER_LAYER_CLASS = "cheese-search-comment-marker-layer";
const VIDEO_COMMENT_BUTTON_CLASS = "cheese-search-comment-timestamp-button";
const VIDEO_COMMENT_BUTTON_DISABLED_CLASS = "comment-timestamp-button-disabled";
const VIDEO_COMMENT_PANEL_CLASS = "cheese-search-comment-timestamp-panel";
const VIDEO_COMMENT_PREVIEW_TOOLTIP_CLASS =
  "cheese-search-comment-preview-tooltip";
const COMMENT_BUTTON_INSERT_COOLDOWN_MS = 2000;
const COMMENT_MARKER_RENDER_RETRY_LIMIT = 30;
const COMMENT_PANEL_RIGHT_PX = 22;
const COMMENT_PANEL_BOTTOM_PX = 60;
const COMMENT_PANEL_TOP_GAP_PX = 12;
const COMMENT_PANEL_MAX_HEIGHT_PX = 430;
const COMMENT_PANEL_MIN_HEIGHT_PX = 120;
const COMMENT_PANEL_ANCHOR_CHECK_MS = 250;
const COMMENT_PANEL_AUTO_CLOSE_DELAY_MS = 4000;
const CHEESE_SEARCH_MUTATION_IGNORE_SELECTOR = [
  ".cheese-search-shell",
  ".cheese-search-result-header",
  ".cheese-search-results-list",
  ".cheese-search-studio-summary",
  ".cheese-search-studio-menu",
  ".cheese-search-studio-more-menu",
  "[data-cheese-studio-row]",
  "[data-cheese-studio-toast]",
  ".cheese-search-scroll-top",
  ".cheese-search-comment-marker-layer",
  ".cheese-search-comment-marker",
  ".cheese-search-comment-timestamp-button",
  ".cheese-search-comment-timestamp-panel",
  ".cheese-search-comment-preview-tooltip",
].join(",");

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

const commentMarkerState = {
  videoNo: "",
  loadingVideoNo: "",
  markers: [],
  renderedSignature: "",
  retryTimer: 0,
  retryCount: 0,
  lastButtonInsertAt: 0,
  activePreviewSeconds: "",
  previewTooltipTimer: 0,
  panelAnchorTimer: 0,
  panelAnchorCloseTimer: 0,
};

const observerState = {
  initTimer: 0,
  studioMakeClipInitTimer: 0,
};

const studioMakeClipState = {
  channelId: "",
  initializedFor: "",
  clips: [],
  streamers: [],
  preloaded: false,
  preloadPromise: null,
  preloadError: "",
  hasLoaded: false,
  loading: false,
  error: "",
  query: "",
  dateFrom: "",
  dateTo: "",
  streamer: "all",
  sort: "latest",
  tableSortField: "",
  tableSortDirection: "asc",
  originalRows: [],
  streamerOptionsSignature: "",
  resultSignature: "",
  visibleCount: 120,
  inactive: false,
  deletedClipUIDs: new Set(),
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
const STUDIO_MAKE_CLIP_INIT_DELAY_MS = 240;
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
      { value: "likes", label: "좋아요순" },
    ];
  }
  return [
    { value: "latest", label: "최신순" },
    { value: "oldest", label: "오래된순" },
    { value: "popular", label: "인기순" },
    { value: "comments", label: "댓글 많은순" },
    { value: "livePv", label: "라이브 시청순" },
  ];
}

function createDatePicker(type, label, includePresets = true) {
  return `
    <div class="cheese-search-date-picker" data-date-picker="${type}">
      <button type="button" class="_component_14lz7_8 _large_14lz7_44 cheese-search-control cheese-search-date-trigger" data-action="date-toggle" aria-haspopup="dialog" aria-expanded="false">
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
        sort: controls?.sort || "latest",
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
    value.sort = controls?.sort || "latest";
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

  const {
    __chunkCount: _chunkCount,
    __chunkField: _chunkField,
    ...rest
  } = value;
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
        sort: restoreState?.sort || controls?.sort || "latest",
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
  const metricType = getSortMetricType(
    restoreState?.sort || controls?.sort || "latest",
  );
  if (metricType) {
    const field = getSortMetricField(metricType);
    if (field && !hasMetricForEveryItem(cachedList, field)) {
      return false;
    }
  }

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
  const updatedClipsById = new Map();
  for (const clip of clips) {
    const clipUID = String(clip?.clipUID || "").trim();
    if (!clipUID) continue;
    if (state.knownClipUIDs.has(clipUID)) {
      updatedClipsById.set(clipUID, clip);
      continue;
    }
    state.knownClipUIDs.add(clipUID);
    newClips.push(clip);
  }
  if (!newClips.length && !updatedClipsById.size) {
    renderProgressClipCards();
    return false;
  }

  if (updatedClipsById.size) {
    state.videos = state.videos.map((item) => {
      const clipUID = String(item?.clipUID || "").trim();
      const updatedClip = updatedClipsById.get(clipUID);
      return updatedClip ? { ...item, ...updatedClip } : item;
    });
    state.progressResultSignature = "";
    state.renderedClipUIDs = new Set();
  }
  if (newClips.length) {
    state.videos = state.videos.concat(newClips);
  }
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
  updateClipSearchingStatus(searchList);
  if (shouldHideClipResultHeader()) {
    removeResultHeader();
  } else {
    updateResultHeader(ensureHeader(searchList), filtered);
  }

  if (!filtered.length) {
    searchList.removeAttribute("aria-busy");
    if (state.loading && !state.fetchInfo) {
      if (!searchList.querySelector(".cheese-search-status")) {
        searchList.innerHTML = renderSearchingStatus(getClipSearchingMessage());
      }
      updateClipSearchingStatus(searchList);
      return;
    }
    state.renderedClipUIDs = new Set();
    searchList.innerHTML = renderSearchEmpty(controls.query);
    return;
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
  }
  updateClipSearchingStatus(searchList);
}

function updateClipSearchingStatus(searchList) {
  const message = searchList?.querySelector("[data-clip-searching-message]");
  if (!message) return;
  message.textContent = getClipSearchingMessage();
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
  if (needsSortMetricRefreshForCurrentResults()) {
    loadVideos({ forceRefresh: false });
    return;
  }
  renderResults();
}

function needsSortMetricRefreshForCurrentResults() {
  const controls = getControls();
  const metricType = getSortMetricType(controls?.sort);
  if (!metricType || !state.videos.length) return false;
  const field = getSortMetricField(metricType);
  if (!field) return false;
  return !hasMetricForEveryItem(state.videos, field);
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
  if (!link || event.ctrlKey || event.metaKey) return;
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
      if (controls.sort === "comments") {
        return (
          getCommentCount(b) - getCommentCount(a) ||
          getItemTime(b) - getItemTime(a)
        );
      }
      if (controls.sort === "likes") {
        return (
          getLikeCount(b) - getLikeCount(a) || getItemTime(b) - getItemTime(a)
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
      <strong data-clip-searching-message>${escapeHtml(message)}</strong>
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
  setSortValue(shell, getInitialSortValue());
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
  // 좋아요순은 전체 수집 후 실제 좋아요 수로 재정렬하므로 수집 orderType은
  // 결과 정확성과 무관하다. 조회수 높은 클립이 대체로 좋아요도 많아, POPULAR로
  // 수집하면 상위권에 가까운 클립이 먼저 도착·표시되어 점진 표시가 자연스럽다.
  if (sort === "popular" || sort === "likes") return "POPULAR";
  return "RECENT";
}

function getSortMetricType(sort) {
  if (isClipContent()) {
    return sort === "likes" ? "likes" : "";
  }
  if (sort === "comments") return "comments";
  return "";
}

function getSortMetricField(metricType) {
  if (metricType === "comments") return "commentCount";
  if (metricType === "likes") return "likeCount";
  return "";
}

function hasMetricForEveryItem(items, field) {
  return (Array.isArray(items) ? items : []).every((item) =>
    Object.prototype.hasOwnProperty.call(item || {}, field),
  );
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
  const isStudioShell = shell.classList.contains("cheese-search-studio-shell");

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
    closeStudioMenus();
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
    if (isStudioShell) {
      handleStudioDateFilterChange(shell);
      return;
    }
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
    if (isStudioShell) {
      handleStudioDateFilterChange(shell);
      return;
    }
    handleFilterChange();
    return;
  }

  if (action.date) {
    setDateValue(shell, type, action.date);
    normalizeDateRange(shell, type);
    closeDatePicker(picker);
    renderAllCalendars(shell);
    if (isStudioShell) {
      handleStudioDateFilterChange(shell);
      return;
    }
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
  document.querySelectorAll(".cheese-search-shell").forEach((shell) => {
    if (!shell.contains(event.target)) {
      closeFloatingControls(shell);
      return;
    }
    shell.querySelectorAll("[data-date-picker]").forEach((picker) => {
      if (!picker.contains(event.target)) closeDatePicker(picker);
    });
  });
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

function getCommentCount(item) {
  return Number(
    item?.commentCount ??
      item?.commentsCount ??
      item?.optionalProperty?.commentCount ??
      item?.interaction?.comment?.count ??
      0,
  );
}

function getLikeReactionCount(interaction) {
  const reactions = interaction?.like?.reactions;
  if (!Array.isArray(reactions)) return undefined;
  const likeReaction =
    reactions.find((reaction) => reaction?.reactionType === "like") ??
    reactions[0];
  const count = Number(likeReaction?.count ?? likeReaction?.reactionCount);
  return Number.isFinite(count) ? count : undefined;
}

function getLikeCount(item) {
  return Number(
    item?.likeCount ??
      item?.reactionCount ??
      item?.reaction?.count ??
      item?.interaction?.reaction?.count ??
      getLikeReactionCount(item?.interaction) ??
      0,
  );
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

function createClipLikeIcon() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 30 30" fill="none" role="img" aria-hidden="true" class="cheese-search-clip-like-icon"><g clip-path="url(#clip0_14053_82258)"><g filter="url(#filter0_d_14053_82258)"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.53 4c-2.07 0-3.94.87-5.29 2.26-.63.66-1.19 1.4-1.57 2.33s-.58 2-.57 3.3c.02 2.74 1.35 4.66 3.67 7l.03.03c3.03 2.86 5.7 5.36 8.56 7.68.37.3.9.3 1.26 0 2.86-2.31 6.29-5.38 8.59-7.7s3.69-4.16 3.69-7.02c0-2.09-.82-4.26-2.25-5.67A7.7 7.7 0 0 0 20.12 4c-1.46.07-2.8.6-3.9 1.42q-.68.51-1.23 1.13-.61-.69-1.37-1.23A7 7 0 0 0 9.52 4M5.85 7.82c.98-1 2.3-1.62 3.78-1.62 1.05 0 2.04.35 2.88.94q.98.7 1.62 1.75a.98.98 0 0 0 1.66.04q.68-1.04 1.58-1.71 1.21-.92 2.73-1.01c1.62 0 2.99.61 3.97 1.59a6 6 0 0 1 1.63 4.17c0 1.98-.86 3.28-3.06 5.5A111 111 0 0 1 15 24.4c-2.51-2.08-4.9-4.32-7.66-6.93-2.17-2.2-3.01-3.6-3.03-5.5a6 6 0 0 1 .4-2.47q.4-.91 1.15-1.67" fill="currentColor"></path></g></g><defs><filter id="filter0_d_14053_82258" x="0.0996094" y="2" width="29.8008" height="26.825" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"></feColorMatrix><feOffset></feOffset><feGaussianBlur stdDeviation="1"></feGaussianBlur><feComposite in2="hardAlpha" operator="out"></feComposite><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.15 0"></feColorMatrix><feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_14053_82258"></feBlend><feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_14053_82258" result="shape"></feBlend></filter><clipPath id="clip0_14053_82258"><rect width="30" height="30" fill="currentColor"></rect></clipPath></defs></svg>
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
  const likeCount = getLikeCount(clip);
  const likeCountHtml =
    likeCount > 0
      ? `<span class="cheese-search-clip-like">${createClipLikeIcon()}<span class="blind">좋아요 수</span>${formatCompactCount(likeCount)}</span>`
      : "";

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
                ${likeCountHtml}
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
  const commentCount = getCommentCount(video);
  const commentCountHtml =
    commentCount > 0
      ? `<span class="video_card_item__lOC8Y">댓글수 ${formatCount(commentCount)}개</span>`
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
              ${commentCountHtml}
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

function initCommentTimestampMarkers() {
  const videoNo = getCurrentVideoNo();
  if (!videoNo) {
    resetCommentTimestampMarkers();
    return;
  }

  if (commentMarkerState.videoNo !== videoNo) {
    resetCommentTimestampMarkers({ keepVideoNo: true });
    commentMarkerState.videoNo = videoNo;
    commentMarkerState.loadingVideoNo = videoNo;
    ensureCommentTimestampButton();
    void loadCommentTimestampMarkers(videoNo);
    return;
  }

  ensureCommentTimestampButton();
  if (commentMarkerState.markers.length) {
    scheduleCommentMarkerRender();
  }
}

function getCurrentVideoNo() {
  const match = location.pathname.match(/^\/video\/(\d+)/);
  return match ? match[1] : "";
}

function resetCommentTimestampMarkers({ keepVideoNo = false } = {}) {
  clearCommentMarkerRetryTimer();
  clearCommentMarkerPreviewTooltipTimer();
  removeCommentMarkerPreviewTooltip();
  document
    .querySelectorAll(`.${VIDEO_COMMENT_MARKER_LAYER_CLASS}`)
    .forEach((layer) => layer.remove());
  document
    .querySelectorAll(`.${VIDEO_COMMENT_BUTTON_CLASS}`)
    .forEach((button) => button.remove());
  closeCommentTimestampPanel();
  commentMarkerState.markers = [];
  commentMarkerState.loadingVideoNo = "";
  commentMarkerState.renderedSignature = "";
  commentMarkerState.retryCount = 0;
  commentMarkerState.lastButtonInsertAt = 0;
  commentMarkerState.activePreviewSeconds = "";
  if (!keepVideoNo) commentMarkerState.videoNo = "";
}

async function loadCommentTimestampMarkers(videoNo) {
  try {
    const result = await sendMessage({
      type: "CHEESE_SEARCH_FETCH_COMMENT_TIMESTAMPS",
      payload: { videoNo },
    });
    if (commentMarkerState.videoNo !== videoNo) return;
    commentMarkerState.loadingVideoNo = "";
    commentMarkerState.markers = Array.isArray(result?.markers)
      ? result.markers
      : [];
    ensureCommentTimestampButton();
    if (!commentMarkerState.markers.length) {
      closeCommentTimestampPanel();
    }
    renderCommentTimestampPanel();
    scheduleCommentMarkerRender();
  } catch (error) {
    if (commentMarkerState.videoNo !== videoNo) return;
    commentMarkerState.loadingVideoNo = "";
    commentMarkerState.markers = [];
    document
      .querySelectorAll(`.${VIDEO_COMMENT_MARKER_LAYER_CLASS}`)
      .forEach((layer) => layer.remove());
    ensureCommentTimestampButton();
    closeCommentTimestampPanel();
    renderCommentTimestampPanel();
    console.debug(
      "[ChzzkSearch] 댓글 타임스탬프를 불러오지 못했습니다.",
      error,
    );
  }
}

function ensureCommentTimestampButton() {
  if (!getCurrentVideoNo()) return;
  const controls = document.querySelector(".pzp-pc__bottom-buttons-right");
  if (!controls) {
    scheduleCommentMarkerRender(500);
    return;
  }

  let button = controls.querySelector(`.${VIDEO_COMMENT_BUTTON_CLASS}`);
  if (!button) {
    const now = Date.now();
    if (
      commentMarkerState.lastButtonInsertAt &&
      now - commentMarkerState.lastButtonInsertAt <
        COMMENT_BUTTON_INSERT_COOLDOWN_MS
    ) {
      return;
    }
    commentMarkerState.lastButtonInsertAt = now;
    button = document.createElement("button");
    button.type = "button";
    button.className = `${VIDEO_COMMENT_BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    button.setAttribute("aria-label", "댓글 타임스탬프");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `
      <span class="pzp-button__tooltip pzp-button__tooltip--top">댓글 타임스탬프</span>
      <span class="pzp-ui-icon cheese-search-comment-timestamp-icon">
      <svg class="pzp-ui-icon__svg" width="20" height="20" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clip-path="url(#clip0_88_32943)">
        <path d="M7.96094 26.8867C8.41797 26.8867 8.75781 26.6523 9.30859 26.1367L13.5391 22.2695H21.4609C24.9531 22.2695 26.8281 20.3477 26.8281 16.9141V7.9375C26.8281 4.50391 24.9531 2.57031 21.4609 2.57031H6.36719C2.875 2.57031 1 4.49219 1 7.9375V16.9141C1 20.3594 2.875 22.2695 6.36719 22.2695H6.91797V25.6797C6.91797 26.4062 7.29297 26.8867 7.96094 26.8867Z" fill="white"/>
        <path d="M19.8438 14.1484C18.8828 14.1484 18.1094 13.375 18.1094 12.4141C18.1094 11.4531 18.8828 10.6797 19.8438 10.6797C20.8047 10.6797 21.5781 11.4531 21.5781 12.4141C21.5781 13.375 20.8047 14.1484 19.8438 14.1484Z" fill="black"/>
        <path d="M13.9258 14.1484C12.9648 14.1484 12.1797 13.375 12.1797 12.4141C12.1797 11.4531 12.9648 10.6797 13.9258 10.6797C14.875 10.6797 15.6602 11.4531 15.6602 12.4141C15.6602 13.375 14.875 14.1484 13.9258 14.1484Z" fill="black"/>
        <path d="M7.99609 14.1484C7.04688 14.1484 6.26172 13.375 6.26172 12.4141C6.26172 11.4531 7.04688 10.6797 7.99609 10.6797C8.95703 10.6797 9.73047 11.4531 9.73047 12.4141C9.73047 13.375 8.95703 14.1484 7.99609 14.1484Z" fill="black"/>
        </g>
        <defs>
        <clipPath id="clip0_88_32943">
        <rect width="25.8281" height="25.8867" fill="white" transform="translate(1 1)"/>
        </clipPath>
        </defs>
        </svg>
      </span>
      <span class="cheese-search-comment-timestamp-count" aria-hidden="true"></span>
    `;
    button.addEventListener("click", handleCommentTimestampButtonClick);
    const clipButton = controls.querySelector(".custom__clip-button");
    controls.insertBefore(button, clipButton || controls.firstChild);
    setTimeout(() => {
      if (
        getCurrentVideoNo() &&
        !document.querySelector(`.${VIDEO_COMMENT_BUTTON_CLASS}`)
      ) {
        ensureCommentTimestampButton();
      }
    }, COMMENT_BUTTON_INSERT_COOLDOWN_MS);
  }
  updateCommentTimestampButton(button);
}

function updateCommentTimestampButton(
  button = document.querySelector(`.${VIDEO_COMMENT_BUTTON_CLASS}`),
) {
  if (!button) return;
  const count = commentMarkerState.markers.length;
  const isLoading =
    commentMarkerState.loadingVideoNo &&
    commentMarkerState.loadingVideoNo === getCurrentVideoNo();
  const isDisabled = !isLoading && count === 0;
  button.classList.toggle("is-loading", Boolean(isLoading));
  button.classList.toggle("has-markers", count > 0);
  button.classList.toggle(VIDEO_COMMENT_BUTTON_DISABLED_CLASS, isDisabled);
  button.setAttribute("aria-disabled", isDisabled ? "true" : "false");
  button.setAttribute(
    "aria-label",
    isLoading
      ? "댓글 타임스탬프를 불러오는 중"
      : count
        ? `댓글 타임스탬프 ${count}개`
        : "댓글 타임스탬프 없음",
  );
  const countElement = button.querySelector(
    ".cheese-search-comment-timestamp-count",
  );
  if (countElement) {
    countElement.textContent = count ? String(Math.min(count, 99)) : "";
  }
}

function handleCommentTimestampButtonClick(event) {
  event.preventDefault();
  event.stopPropagation();
  if (
    event.currentTarget?.classList?.contains(
      VIDEO_COMMENT_BUTTON_DISABLED_CLASS,
    )
  ) {
    return;
  }
  const panel = document.querySelector(`.${VIDEO_COMMENT_PANEL_CLASS}`);
  if (panel) {
    closeCommentTimestampPanel();
    return;
  }
  openCommentTimestampPanel(event.currentTarget);
}

function openCommentTimestampPanel(anchor) {
  closeCommentTimestampPanel();
  const root = getCommentTimestampPanelRoot(anchor);
  if (!root) return;
  if (getComputedStyle(root).position === "static") {
    root.style.position = "relative";
  }
  root.style.overflow = "visible";
  const panel = document.createElement("div");
  panel.className = VIDEO_COMMENT_PANEL_CLASS;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "댓글 타임스탬프");
  root.append(panel);
  renderCommentTimestampPanel(panel);
  positionCommentTimestampPanel(panel, root);
  startCommentTimestampPanelAnchorMonitor();
  anchor?.setAttribute("aria-expanded", "true");
}

function getCommentTimestampPanelRoot(anchor) {
  return (
    anchor?.closest(".pzp-pc") ||
    anchor?.closest(".webplayer-internal-core") ||
    anchor?.closest("[class*='player']") ||
    document.querySelector(".pzp-pc")
  );
}

function closeCommentTimestampPanel() {
  stopCommentTimestampPanelAnchorMonitor();
  document.querySelector(`.${VIDEO_COMMENT_PANEL_CLASS}`)?.remove();
  document
    .querySelector(`.${VIDEO_COMMENT_BUTTON_CLASS}`)
    ?.setAttribute("aria-expanded", "false");
}

function startCommentTimestampPanelAnchorMonitor() {
  stopCommentTimestampPanelAnchorMonitor();
  commentMarkerState.panelAnchorTimer = setInterval(() => {
    if (!isCommentTimestampPanelAnchorAvailable()) {
      scheduleCommentTimestampPanelAnchorClose();
      return;
    }
    clearCommentTimestampPanelAnchorCloseTimer();
    repositionOpenCommentTimestampPanel();
  }, COMMENT_PANEL_ANCHOR_CHECK_MS);
}

function stopCommentTimestampPanelAnchorMonitor() {
  if (!commentMarkerState.panelAnchorTimer) return;
  clearInterval(commentMarkerState.panelAnchorTimer);
  commentMarkerState.panelAnchorTimer = 0;
  clearCommentTimestampPanelAnchorCloseTimer();
}

function scheduleCommentTimestampPanelAnchorClose() {
  if (commentMarkerState.panelAnchorCloseTimer) return;
  commentMarkerState.panelAnchorCloseTimer = setTimeout(() => {
    commentMarkerState.panelAnchorCloseTimer = 0;
    if (isCommentTimestampPanelAnchorAvailable()) return;
    closeCommentTimestampPanel();
  }, COMMENT_PANEL_AUTO_CLOSE_DELAY_MS);
}

function clearCommentTimestampPanelAnchorCloseTimer() {
  if (!commentMarkerState.panelAnchorCloseTimer) return;
  clearTimeout(commentMarkerState.panelAnchorCloseTimer);
  commentMarkerState.panelAnchorCloseTimer = 0;
}

function isCommentTimestampPanelAnchorAvailable() {
  const panel = document.querySelector(`.${VIDEO_COMMENT_PANEL_CLASS}`);
  if (!panel) return false;
  const button = document.querySelector(`.${VIDEO_COMMENT_BUTTON_CLASS}`);
  const slider = findPlayerSliderProgressWrap();
  return isElementRendered(button) && isElementRendered(slider);
}

function isElementRendered(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (!document.documentElement.contains(element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  let current = element;
  while (current && current !== document.documentElement) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

function renderCommentTimestampPanel(
  panel = document.querySelector(`.${VIDEO_COMMENT_PANEL_CLASS}`),
) {
  updateCommentTimestampButton();
  if (!panel) return;
  const isLoading =
    commentMarkerState.loadingVideoNo &&
    commentMarkerState.loadingVideoNo === getCurrentVideoNo();
  const markers = commentMarkerState.markers;
  panel.innerHTML = `
    <div class="cheese-search-comment-panel-head">
      <strong>댓글 타임스탬프</strong>
      <button type="button" data-comment-panel-close aria-label="닫기">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path>
        </svg>
      </button>
    </div>
    ${
      isLoading
        ? `<p class="cheese-search-comment-panel-status">댓글 타임스탬프를 불러오는 중입니다.</p>`
        : markers.length
          ? `<ol class="cheese-search-comment-panel-list">
              ${markers.map(renderCommentTimestampPanelItem).join("")}
            </ol>`
          : `<p class="cheese-search-comment-panel-status">표시할 댓글 타임스탬프가 없습니다.</p>`
    }
  `;
  panel
    .querySelector("[data-comment-panel-close]")
    ?.addEventListener("click", closeCommentTimestampPanel);
  panel.querySelectorAll("[data-comment-marker-seek]").forEach((button) => {
    button.addEventListener("click", handleCommentTimestampPanelSeek);
  });
}

function renderCommentTimestampPanelItem(marker) {
  const comments = Array.isArray(marker.comments) ? marker.comments : [];
  const description = comments[0]
    ? getCommentTimestampDescription(comments[0])
    : "";
  return `
    <li>
      <button type="button" data-comment-marker-seek="${escapeAttribute(marker.seconds)}">
        <span>${escapeHtml(marker.timeLabel || formatSeconds(marker.seconds))}</span>
        <strong>${escapeHtml(description)}</strong>
      </button>
    </li>
  `;
}

function handleCommentTimestampPanelSeek(event) {
  const seconds = Number(event.currentTarget.dataset.commentMarkerSeek || 0);
  seekVideoToCommentTimestamp(seconds);
  closeCommentTimestampPanel();
}

function positionCommentTimestampPanel(panel, root) {
  if (!panel || !root) return;
  const rootRect = root.getBoundingClientRect();
  const viewportAvailableHeight =
    window.innerHeight -
    Math.max(COMMENT_PANEL_TOP_GAP_PX, rootRect.top) -
    COMMENT_PANEL_BOTTOM_PX -
    COMMENT_PANEL_TOP_GAP_PX;
  const rootAvailableHeight =
    rootRect.height - COMMENT_PANEL_BOTTOM_PX - COMMENT_PANEL_TOP_GAP_PX;
  const maxHeight = Math.max(
    COMMENT_PANEL_MIN_HEIGHT_PX,
    Math.min(
      COMMENT_PANEL_MAX_HEIGHT_PX,
      viewportAvailableHeight,
      rootAvailableHeight,
    ),
  );

  panel.style.right = `${COMMENT_PANEL_RIGHT_PX}px`;
  panel.style.bottom = `${COMMENT_PANEL_BOTTOM_PX}px`;
  panel.style.setProperty(
    "--cheese-search-comment-panel-max-height",
    `${Math.floor(maxHeight)}px`,
  );
}

function repositionOpenCommentTimestampPanel() {
  const panel = document.querySelector(`.${VIDEO_COMMENT_PANEL_CLASS}`);
  if (!panel) return;
  const button = document.querySelector(`.${VIDEO_COMMENT_BUTTON_CLASS}`);
  const root = getCommentTimestampPanelRoot(button);
  if (!root) return;
  positionCommentTimestampPanel(panel, root);
}

function handleCommentTimestampDocumentClick(event) {
  const panel = event.target.closest(`.${VIDEO_COMMENT_PANEL_CLASS}`);
  const button = event.target.closest(`.${VIDEO_COMMENT_BUTTON_CLASS}`);
  if (panel || button) return;
  closeCommentTimestampPanel();
}

function handleCommentTimestampKeydown(event) {
  if (event.key !== "Escape") return;
  closeCommentTimestampPanel();
}

function scheduleCommentMarkerRender(delay = 120) {
  clearCommentMarkerRetryTimer();
  commentMarkerState.retryTimer = setTimeout(() => {
    commentMarkerState.retryTimer = 0;
    renderCommentTimestampMarkers();
  }, delay);
}

function clearCommentMarkerRetryTimer() {
  if (!commentMarkerState.retryTimer) return;
  clearTimeout(commentMarkerState.retryTimer);
  commentMarkerState.retryTimer = 0;
}

function renderCommentTimestampMarkers() {
  const videoNo = getCurrentVideoNo();
  if (!videoNo || commentMarkerState.videoNo !== videoNo) {
    resetCommentTimestampMarkers();
    return;
  }

  const slider = findPlayerSliderProgressWrap();
  if (!slider) {
    retryCommentMarkerRender();
    return;
  }

  const duration = getPlayerDuration(slider);
  if (!duration) {
    retryCommentMarkerRender();
    return;
  }
  commentMarkerState.retryCount = 0;
  if (getComputedStyle(slider).position === "static") {
    slider.style.position = "relative";
  }
  slider.style.overflow = "visible";
  const sliderRoot = slider.closest(".pzp-ui-slider__wrap");
  if (sliderRoot) sliderRoot.style.overflow = "visible";

  const markers = commentMarkerState.markers.filter(
    (marker) =>
      Number.isFinite(Number(marker?.seconds)) &&
      Number(marker.seconds) > 0 &&
      Number(marker.seconds) < duration,
  );
  const signature = [
    videoNo,
    Math.floor(duration),
    markers
      .map((marker) => `${marker.seconds}:${marker.comments?.length || 0}`)
      .join(","),
  ].join("|");

  let layer = slider.querySelector(`.${VIDEO_COMMENT_MARKER_LAYER_CLASS}`);
  if (layer?.dataset.signature === signature) return;
  if (!layer) {
    layer = document.createElement("div");
    layer.className = VIDEO_COMMENT_MARKER_LAYER_CLASS;
    slider.append(layer);
  }

  layer.dataset.signature = signature;
  layer.innerHTML = markers
    .map((marker) => renderCommentMarker(marker, duration))
    .join("");
  layer.querySelectorAll(VIDEO_COMMENT_MARKER_SELECTOR).forEach((marker) => {
    marker.addEventListener("click", handleCommentMarkerClick);
    marker.addEventListener("pointerenter", handleCommentMarkerPreviewShow);
    marker.addEventListener("pointerleave", handleCommentMarkerPreviewHide);
    marker.addEventListener("focus", handleCommentMarkerPreviewShow);
    marker.addEventListener("blur", handleCommentMarkerPreviewHide);
  });
}

function retryCommentMarkerRender() {
  if (commentMarkerState.retryCount >= COMMENT_MARKER_RENDER_RETRY_LIMIT) {
    return;
  }
  commentMarkerState.retryCount += 1;
  scheduleCommentMarkerRender(500);
}

function findPlayerSliderProgressWrap() {
  const wraps = Array.from(
    document.querySelectorAll(
      ".pzp-ui-slider__wrap .pzp-ui-progress__wrap.pzp-ui-slider__wrap-first-child",
    ),
  );
  return (
    wraps.find((wrap) => Number(wrap.getAttribute("max")) > 0) ||
    wraps.find((wrap) => wrap.querySelector(".pzp-ui-progress__played")) ||
    null
  );
}

function getPlayerDuration(slider) {
  const fromSlider = Number(slider?.getAttribute("max") || 0);
  if (Number.isFinite(fromSlider) && fromSlider > 0) return fromSlider;
  const videoDuration = Number(document.querySelector("video")?.duration || 0);
  return Number.isFinite(videoDuration) && videoDuration > 0
    ? videoDuration
    : 0;
}

function renderCommentMarker(marker, duration) {
  const seconds = Number(marker.seconds);
  const percent = Math.max(0, Math.min(100, (seconds / duration) * 100));
  const comments = Array.isArray(marker.comments) ? marker.comments : [];
  const label = marker.timeLabel || formatSeconds(seconds);
  const primaryDescription = comments[0]
    ? getCommentTimestampDescription(comments[0])
    : "댓글 타임스탬프";
  return `
    <button type="button" class="cheese-search-comment-marker" style="left:${percent}%" data-seconds="${escapeAttribute(seconds)}" aria-label="${escapeAttribute(
      `${label} ${primaryDescription}`,
    )}">
      <span class="cheese-search-comment-marker-dot" aria-hidden="true"></span>
    </button>
  `;
}

function handleCommentMarkerPreviewShow(event) {
  const markerElement = event.currentTarget;
  const seconds = markerElement?.dataset?.seconds || "";
  if (!seconds) return;
  commentMarkerState.activePreviewSeconds = seconds;
  removeCommentMarkerPreviewTooltip();
  renderCommentMarkerPreviewTooltip(seconds);
}

function handleCommentMarkerPreviewHide(event) {
  const seconds = event.currentTarget?.dataset?.seconds || "";
  if (commentMarkerState.activePreviewSeconds !== seconds) return;
  commentMarkerState.activePreviewSeconds = "";
  clearCommentMarkerPreviewTooltipTimer();
  removeCommentMarkerPreviewTooltip();
}

function renderCommentMarkerPreviewTooltip(seconds, attempt = 0) {
  clearCommentMarkerPreviewTooltipTimer();
  if (commentMarkerState.activePreviewSeconds !== String(seconds)) return;

  const description = document.querySelector(
    ".pzp-pc__seeking-preview .pzp-seeking-preview__description",
  );
  const timeElement = description?.querySelector(".pzp-seeking-preview__time");
  if (!description || !timeElement) {
    if (attempt < 10) {
      commentMarkerState.previewTooltipTimer = setTimeout(() => {
        renderCommentMarkerPreviewTooltip(seconds, attempt + 1);
      }, 40);
    }
    return;
  }

  const marker = findCommentTimestampMarkerBySeconds(seconds);
  if (!marker) return;

  removeCommentMarkerPreviewTooltip();
  timeElement.insertAdjacentHTML(
    "afterend",
    buildCommentMarkerPreviewHtml(marker),
  );
}

function findCommentTimestampMarkerBySeconds(seconds) {
  const targetSeconds = Number(seconds);
  if (!Number.isFinite(targetSeconds)) return null;
  return commentMarkerState.markers.find(
    (marker) => Math.abs(Number(marker?.seconds) - targetSeconds) < 0.001,
  );
}

function buildCommentMarkerPreviewHtml(marker) {
  const seconds = Number(marker.seconds);
  const comments = Array.isArray(marker.comments) ? marker.comments : [];
  const label = marker.timeLabel || formatSeconds(seconds);
  return `
    <div class="${VIDEO_COMMENT_PREVIEW_TOOLTIP_CLASS}" role="tooltip">
      <strong>${escapeHtml(label)}</strong>
      ${comments
        .slice(0, 4)
        .map(
          (comment) => `
            <span class="cheese-search-comment-preview-tooltip-line">
              ${escapeHtml(getCommentTimestampDescription(comment))}
            </span>
          `,
        )
        .join("")}
      ${
        Number(marker.sourceCount || 0) > comments.length
          ? `<span class="cheese-search-comment-preview-tooltip-more">외 ${Number(marker.sourceCount) - comments.length}개</span>`
          : ""
      }
    </div>
  `;
}

function removeCommentMarkerPreviewTooltip() {
  document
    .querySelectorAll(`.${VIDEO_COMMENT_PREVIEW_TOOLTIP_CLASS}`)
    .forEach((tooltip) => tooltip.remove());
}

function clearCommentMarkerPreviewTooltipTimer() {
  if (!commentMarkerState.previewTooltipTimer) return;
  clearTimeout(commentMarkerState.previewTooltipTimer);
  commentMarkerState.previewTooltipTimer = 0;
}

function getCommentTimestampDescription(comment) {
  return String(comment?.description || "").trim();
}

function handleCommentMarkerClick(event) {
  event.preventDefault();
  event.stopPropagation();
  const seconds = Number(event.currentTarget.dataset.seconds || 0);
  seekVideoToCommentTimestamp(seconds);
}

function seekVideoToCommentTimestamp(seconds) {
  const video = document.querySelector("video");
  if (!video || !Number.isFinite(seconds)) return;
  video.currentTime = seconds;
  video.play?.().catch?.(() => {});
}

function getStudioMakeClipContext() {
  if (location.hostname !== "studio.chzzk.naver.com") return null;
  if (location.hash !== "#MAKECLIP") return null;
  const match = location.pathname.match(/^\/([a-f0-9]{32})\/vod/i);
  if (!match) return null;
  return {
    channelId: match[1],
  };
}

function scheduleStudioMakeClipInit(context) {
  if (observerState.studioMakeClipInitTimer) return;
  observerState.studioMakeClipInitTimer = setTimeout(() => {
    observerState.studioMakeClipInitTimer = 0;
    const currentContext = getStudioMakeClipContext();
    if (!currentContext || currentContext.channelId !== context.channelId) {
      return;
    }
    initStudioMakeClips(currentContext);
  }, STUDIO_MAKE_CLIP_INIT_DELAY_MS);
}

function clearScheduledStudioMakeClipInit() {
  if (!observerState.studioMakeClipInitTimer) return;
  clearTimeout(observerState.studioMakeClipInitTimer);
  observerState.studioMakeClipInitTimer = 0;
}

function initStudioMakeClips(context) {
  const initializedFor = `studio:${context.channelId}:makeClips`;
  const isFreshContext = studioMakeClipState.initializedFor !== initializedFor;
  if (isFreshContext) {
    cleanupStudioMakeClipView({ removeControls: true });
    studioMakeClipState.channelId = context.channelId;
    studioMakeClipState.initializedFor = initializedFor;
    studioMakeClipState.clips = [];
    studioMakeClipState.streamers = [];
    studioMakeClipState.preloaded = false;
    studioMakeClipState.preloadPromise = null;
    studioMakeClipState.preloadError = "";
    studioMakeClipState.hasLoaded = false;
    studioMakeClipState.loading = false;
    studioMakeClipState.error = "";
    studioMakeClipState.query = "";
    studioMakeClipState.dateFrom = "";
    studioMakeClipState.dateTo = "";
    studioMakeClipState.streamer = "all";
    studioMakeClipState.sort = "latest";
    studioMakeClipState.tableSortField = "";
    studioMakeClipState.tableSortDirection = "asc";
    studioMakeClipState.originalRows = [];
    studioMakeClipState.streamerOptionsSignature = "";
    studioMakeClipState.resultSignature = "";
    studioMakeClipState.visibleCount = RESULT_INITIAL_RENDER_COUNT;
    studioMakeClipState.inactive = false;
    studioMakeClipState.deletedClipUIDs = new Set();
  }

  const table = document.getElementById("make_clip_panel");
  if (!table) return;
  studioMakeClipState.inactive = false;
  rememberStudioOriginalRows(table);
  mountStudioHeaderSort(table);
  mountStudioMakeClipControls(table);
  if (studioMakeClipState.loading) {
    renderStudioMakeClipStatus("내가 만든 클립을 불러오는 중입니다.");
  } else if (studioMakeClipState.hasLoaded) {
    renderStudioMakeClipResults();
  }
  void preloadStudioMakeClips();
}

function cleanupStudioMakeClipView({ removeControls = false } = {}) {
  document
    .querySelectorAll(
      ".cheese-search-studio-shell, .cheese-search-studio-summary",
    )
    .forEach((element) => {
      if (removeControls) {
        element.remove();
        return;
      }
      if (element.matches(".cheese-search-studio-shell")) {
        closeFloatingControls(element);
      }
      hideOriginalElement(element);
    });
  closeStudioMenus();
  closeStudioMoreMenus();
  closeStudioDeleteClipDialog();
  restoreStudioOriginalRows();
  clearStudioRenderedRows(document);
  showStudioOriginalView();
}

function hasStudioMakeClipArtifacts() {
  return Boolean(
    document.querySelector(
      ".cheese-search-studio-shell, .cheese-search-studio-summary, [data-cheese-studio-row]",
    ),
  );
}

function cleanupStudioMakeClipViewIfInactive() {
  if (getStudioMakeClipContext()) return false;
  clearScheduledStudioMakeClipInit();
  const hasArtifacts = hasStudioMakeClipArtifacts();
  if (!studioMakeClipState.initializedFor && !hasArtifacts) {
    return false;
  }
  if (
    studioMakeClipState.inactive &&
    !document.querySelector("[data-cheese-studio-row]")
  ) {
    return false;
  }
  cleanupStudioMakeClipView({ removeControls: false });
  studioMakeClipState.inactive = true;
  studioMakeClipState.resultSignature = "";
  studioMakeClipState.visibleCount = RESULT_INITIAL_RENDER_COUNT;
  return true;
}

function mountStudioMakeClipControls(anchor) {
  const existing = document.querySelector(".cheese-search-studio-shell");
  if (existing) {
    if (existing.nextElementSibling !== anchor) {
      anchor.before(existing);
    }
    showOriginalElement(existing);
    updateStudioMakeClipControls(existing);
    return existing;
  }

  const shell = document.createElement("div");
  shell.className = "cheese-search-shell cheese-search-studio-shell";
  shell.innerHTML = `
    <div class="cheese-search-query-column">
      <label class="cheese-search-field _component_14lz7_8 _large_14lz7_44" title="클립 제목과 스트리머를 검색합니다.">
        ${createIcon()}
        <input class="cheese-search-input" type="search" placeholder="클립 제목, 스트리머 검색" autocomplete="off" data-studio-query>
        <button type="reset" class="search_form_button__+3aOm" data-studio-action="query-reset" hidden>
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="16" viewBox="0 0 15 16" fill="none" aria-hidden="true">
            <path fill="currentColor" fill-rule="evenodd" d="M7.5 15.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm2.995-10.495a.7.7 0 0 0-.903-.074l-.087.074L7.5 7.01 5.495 5.005l-.087-.074a.7.7 0 0 0-.903 1.064L6.51 8l-2.005 2.005a.7.7 0 0 0 .903 1.064l.087-.074L7.5 8.99l2.005 2.005.087.074a.7.7 0 0 0 .903-1.064L8.49 8l2.005-2.005a.7.7 0 0 0 0-.99Z" clip-rule="evenodd" opacity="0.5"></path>
          </svg>
          <span class="blind">삭제</span>
        </button>
      </label>
    </div>
    ${createDatePicker("dateFrom", "시작일")}
    ${createDatePicker("dateTo", "종료일")}
    <div class="cheese-search-studio-select" data-studio-select="streamer">
      <button type="button" class="_component_14lz7_8 _large_14lz7_44 cheese-search-studio-select-button" data-studio-action="streamer-toggle" aria-haspopup="listbox" aria-expanded="false">
        <span class="_inner_14lz7_18">
          <span data-studio-streamer-label>스트리머 전체</span>
          ${createStudioChevronIcon()}
        </span>
      </button>
      <ul class="_layer_14lz7_62 cheese-search-studio-menu" role="listbox" aria-label="스트리머별 분류" data-studio-streamer-menu hidden></ul>
    </div>
    <div class="cheese-search-studio-select" data-studio-select="sort">
      <button type="button" class="_component_14lz7_8 _large_14lz7_44 cheese-search-studio-select-button" data-studio-action="sort-toggle" aria-haspopup="listbox" aria-expanded="false">
        <span class="_inner_14lz7_18">
          <span data-studio-sort-label>최신순</span>
          ${createStudioChevronIcon()}
        </span>
      </button>
      <ul class="_layer_14lz7_62 cheese-search-studio-menu" role="listbox" aria-label="정렬" data-studio-sort-menu hidden></ul>
    </div>
    <button type="button" class="cheese-search-control cheese-search-button _component_14lz7_8 _large_14lz7_44" data-studio-action="reset">초기화</button>
  `;

  anchor.before(shell);
  shell
    .querySelector("[data-studio-query]")
    .addEventListener("input", handleStudioQueryInput);
  shell.querySelectorAll("[data-date-picker]").forEach((picker) => {
    picker.addEventListener("click", handleDatePickerClick);
  });
  shell.addEventListener("click", handleStudioControlClick);
  shell.querySelectorAll("[data-date-picker]").forEach(renderCalendar);
  updateStudioMakeClipControls(shell);
  return shell;
}

function updateStudioMakeClipControls(
  shell = document.querySelector(".cheese-search-studio-shell"),
) {
  if (!shell) return;
  const query = shell.querySelector("[data-studio-query]");
  const reset = shell.querySelector('[data-studio-action="query-reset"]');
  const streamerLabel = shell.querySelector("[data-studio-streamer-label]");
  const sortLabel = shell.querySelector("[data-studio-sort-label]");
  if (query) query.value = studioMakeClipState.query;
  if (reset) reset.hidden = !studioMakeClipState.query;
  setDateValue(shell, "dateFrom", studioMakeClipState.dateFrom);
  setDateValue(shell, "dateTo", studioMakeClipState.dateTo);
  updateStudioStreamerMenu(shell);
  updateStudioSortMenu(shell);
  const streamerOption = getStudioStreamerOptions().find(
    (option) => option.value === studioMakeClipState.streamer,
  );
  if (!streamerOption) studioMakeClipState.streamer = "all";
  if (streamerLabel) {
    streamerLabel.textContent =
      streamerOption?.label ||
      getStudioStreamerOptions()[0]?.label ||
      "스트리머 전체";
  }
  if (sortLabel) {
    sortLabel.textContent =
      getStudioSortOptions().find(
        (option) => option.value === studioMakeClipState.sort,
      )?.label || "최신순";
  }
}

function updateStudioStreamerMenu(shell) {
  const menu = shell.querySelector("[data-studio-streamer-menu]");
  if (!menu) return;
  const options = getStudioStreamerOptions();
  const signature = options
    .map((option) => `${option.value}:${option.label}`)
    .join("|");
  if (
    studioMakeClipState.streamerOptionsSignature !== signature ||
    !menu.children.length
  ) {
    menu.innerHTML = options.map(renderStudioMenuOption("streamer")).join("");
    studioMakeClipState.streamerOptionsSignature = signature;
  }
  menu.querySelectorAll("[data-studio-streamer-value]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(
        button.dataset.studioStreamerValue === studioMakeClipState.streamer,
      ),
    );
  });
}

function updateStudioSortMenu(shell) {
  const menu = shell.querySelector("[data-studio-sort-menu]");
  if (!menu) return;
  if (!menu.children.length) {
    menu.innerHTML = getStudioSortOptions()
      .map(renderStudioMenuOption("sort"))
      .join("");
  }
  menu.querySelectorAll("[data-studio-sort-value]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.studioSortValue === studioMakeClipState.sort),
    );
  });
}

function renderStudioMenuOption(type) {
  return (option) =>
    `<li class="_item_14lz7_79" role="presentation"><button type="button" class="_option_14lz7_83" role="option" aria-selected="false" data-studio-${type}-value="${escapeAttribute(option.value)}"><span class="">${escapeHtml(option.label)}</span></button></li>`;
}

function getStudioStreamerOptions() {
  return [
    { value: "all", label: "스트리머 전체" },
    ...studioMakeClipState.streamers,
  ];
}

function setStudioStreamersFromClips(clips) {
  const byId = new Map();
  (Array.isArray(clips) ? clips : []).forEach((clip) => {
    const channelId = String(clip?.makeChannel?.channelId || "").trim();
    const channelName = String(clip?.makeChannel?.channelName || "").trim();
    if (!channelId || !channelName || byId.has(channelId)) return;
    byId.set(channelId, channelName);
  });
  studioMakeClipState.streamers = Array.from(byId, ([value, label]) => ({
    value,
    label,
  })).sort((a, b) => a.label.localeCompare(b.label, "ko-KR"));
  studioMakeClipState.streamerOptionsSignature = "";
  if (
    studioMakeClipState.streamer !== "all" &&
    !studioMakeClipState.streamers.some(
      (streamer) => streamer.value === studioMakeClipState.streamer,
    )
  ) {
    studioMakeClipState.streamer = "all";
  }
}

function applyStudioMakeClipResult(result) {
  studioMakeClipState.clips = Array.isArray(result?.clips) ? result.clips : [];
  setStudioStreamersFromClips(studioMakeClipState.clips);
}

function getStudioMakeClipPayload() {
  return {
    channelId: studioMakeClipState.channelId,
    dateFilter: "ALL",
    orderFilter: "LATEST",
  };
}

function preloadStudioMakeClips() {
  if (
    !studioMakeClipState.channelId ||
    studioMakeClipState.preloaded ||
    studioMakeClipState.preloadPromise
  ) {
    return studioMakeClipState.preloadPromise;
  }

  const channelId = studioMakeClipState.channelId;
  studioMakeClipState.preloadError = "";
  studioMakeClipState.preloadPromise = sendMessage({
    type: "CHEESE_SEARCH_FETCH_MAKE_CLIPS",
    payload: getStudioMakeClipPayload(),
  })
    .then((result) => {
      if (studioMakeClipState.channelId !== channelId) return result;
      applyStudioMakeClipResult(result);
      studioMakeClipState.preloaded = true;
      updateStudioMakeClipControls();
      return result;
    })
    .catch((error) => {
      if (studioMakeClipState.channelId === channelId) {
        studioMakeClipState.preloadError =
          error instanceof Error ? error.message : String(error);
      }
      throw error;
    })
    .finally(() => {
      if (studioMakeClipState.channelId === channelId) {
        studioMakeClipState.preloadPromise = null;
      }
    });

  studioMakeClipState.preloadPromise.catch(() => {
    // 선로딩 실패는 검색 버튼을 누를 때 기존 오류 UI로 다시 안내한다.
  });
  return studioMakeClipState.preloadPromise;
}

async function getStudioMakeClipResultForSearch() {
  if (studioMakeClipState.preloadPromise) {
    try {
      return await studioMakeClipState.preloadPromise;
    } catch {
      // 검색 동작에서는 아래의 직접 호출 결과로 오류를 표시한다.
    }
  }

  if (studioMakeClipState.preloaded) {
    return {
      channelId: studioMakeClipState.channelId,
      contentType: "makeClips",
      totalCount: studioMakeClipState.clips.length,
      totalPages: 1,
      fetchedAt: Date.now(),
      clips: studioMakeClipState.clips,
    };
  }

  return sendMessage({
    type: "CHEESE_SEARCH_FETCH_MAKE_CLIPS",
    payload: getStudioMakeClipPayload(),
  });
}

function getStudioSortOptions() {
  return [
    { value: "latest", label: "최신순" },
    { value: "oldest", label: "오래된순" },
    { value: "popular", label: "조회순" },
    { value: "comments", label: "댓글 많은순" },
  ];
}

function createStudioChevronIcon() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none" class="_icon_arrow_14lz7_35"><path fill="currentColor" fill-rule="evenodd" d="M.21 2.209a.715.715 0 0 1 1.01 0L5 5.983 8.78 2.21a.715.715 0 0 1 1.01 0 .712.712 0 0 1 0 1.008L5 8 .21 3.217a.712.712 0 0 1 0-1.008Z" clip-rule="evenodd"></path></svg>
  `;
}

const scheduleStudioMakeClipSearch = debounce(() => {
  renderOrActivateStudioMakeClipSearch();
}, 180);

function handleStudioQueryInput(event) {
  studioMakeClipState.query = event.currentTarget.value;
  updateStudioMakeClipControls();
  scheduleStudioMakeClipSearch();
}

function handleStudioDateFilterChange(shell) {
  studioMakeClipState.dateFrom = shell.dataset.dateFrom || "";
  studioMakeClipState.dateTo = shell.dataset.dateTo || "";
  updateStudioMakeClipControls(shell);
  renderOrActivateStudioMakeClipSearch();
}

function renderOrActivateStudioMakeClipSearch() {
  if (studioMakeClipState.hasLoaded) {
    resetStudioVisibleResults();
    renderStudioMakeClipResults();
    return;
  }
  void activateStudioMakeClipSearch();
}

function handleStudioControlClick(event) {
  const target = event.target.closest(
    "[data-studio-action], [data-studio-streamer-value], [data-studio-sort-value]",
  );
  if (!target) return;

  if (target.dataset.studioStreamerValue != null) {
    event.preventDefault();
    studioMakeClipState.streamer = target.dataset.studioStreamerValue || "all";
    closeStudioMenus();
    closeStudioMoreMenus();
    updateStudioMakeClipControls();
    renderOrActivateStudioMakeClipSearch();
    return;
  }

  if (target.dataset.studioSortValue != null) {
    event.preventDefault();
    studioMakeClipState.sort = target.dataset.studioSortValue || "latest";
    studioMakeClipState.tableSortField = "";
    closeStudioMenus();
    closeStudioMoreMenus();
    updateStudioMakeClipControls();
    updateStudioHeaderSortState();
    renderOrActivateStudioMakeClipSearch();
    return;
  }

  const action = target.dataset.studioAction;
  if (action === "query-reset") {
    event.preventDefault();
    handleStudioQueryReset();
    return;
  }
  if (action === "streamer-toggle" || action === "sort-toggle") {
    event.preventDefault();
    closeStudioMoreMenus();
    toggleStudioMenu(action === "streamer-toggle" ? "streamer" : "sort");
    return;
  }
  if (action === "reset") {
    event.preventDefault();
    handleStudioReset();
  }
}

function handleStudioDocumentClick(event) {
  const moreToggle = event.target.closest("[data-studio-more-toggle]");
  if (moreToggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleStudioMoreMenu(moreToggle);
    return;
  }

  const moreAction = event.target.closest("[data-studio-more-action]");
  if (moreAction) {
    handleStudioMoreAction(event, moreAction);
    return;
  }

  if (event.target.closest(".cheese-search-studio-more-menu")) return;
  if (event.target.closest(".cheese-search-studio-shell")) {
    closeStudioMoreMenus();
    return;
  }
  closeStudioMenus();
  closeStudioMoreMenus();
}

function handleStudioQueryReset() {
  studioMakeClipState.query = "";
  updateStudioMakeClipControls();
  renderOrActivateStudioMakeClipSearch();
}

function handleStudioReset() {
  studioMakeClipState.query = "";
  studioMakeClipState.dateFrom = "";
  studioMakeClipState.dateTo = "";
  studioMakeClipState.streamer = "all";
  studioMakeClipState.sort = "latest";
  studioMakeClipState.tableSortField = "";
  studioMakeClipState.tableSortDirection = "asc";
  studioMakeClipState.hasLoaded = false;
  studioMakeClipState.loading = false;
  studioMakeClipState.error = "";
  studioMakeClipState.resultSignature = "";
  studioMakeClipState.visibleCount = RESULT_INITIAL_RENDER_COUNT;
  document.querySelector(".cheese-search-studio-summary")?.remove();
  restoreStudioOriginalRows();
  showStudioOriginalView();
  closeStudioMenus();
  updateStudioMakeClipControls();
  updateStudioHeaderSortState();
}

function toggleStudioMenu(type) {
  const shell = document.querySelector(".cheese-search-studio-shell");
  if (!shell) return;
  updateStudioMakeClipControls(shell);
  const select = shell.querySelector(`[data-studio-select="${type}"]`);
  const button = select?.querySelector("button");
  const menu = select?.querySelector(".cheese-search-studio-menu");
  if (!button || !menu) return;
  const willOpen = menu.hidden;
  closeStudioMenus();
  menu.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function closeStudioMenus() {
  document
    .querySelectorAll(".cheese-search-studio-select-button")
    .forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  document.querySelectorAll(".cheese-search-studio-menu").forEach((menu) => {
    menu.hidden = true;
  });
}

function toggleStudioMoreMenu(button) {
  const container = button.closest(".cheese-search-studio-more");
  const menu = container?.querySelector(".cheese-search-studio-more-menu");
  if (!menu) return;
  const willOpen = menu.hidden;
  closeStudioMenus();
  closeStudioMoreMenus();
  menu.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function handleStudioMoreCaptureClick(event) {
  if (!event.target.closest("[data-cheese-studio-row]")) return;

  const moreToggle = event.target.closest("[data-studio-more-toggle]");
  if (moreToggle) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    toggleStudioMoreMenu(moreToggle);
    return;
  }

  const moreAction = event.target.closest("[data-studio-more-action]");
  if (moreAction) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    handleStudioMoreAction(event, moreAction);
    return;
  }

  if (event.target.closest(".cheese-search-studio-more-menu")) {
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }
}

function closeStudioMoreMenus() {
  document.querySelectorAll("[data-studio-more-toggle]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  document
    .querySelectorAll(".cheese-search-studio-more-menu")
    .forEach((menu) => {
      menu.hidden = true;
    });
}

async function handleStudioMoreAction(event, target) {
  event.stopPropagation();
  const action = target.dataset.studioMoreAction;
  if (action === "delete") {
    event.preventDefault();
    closeStudioMoreMenus();
    openStudioDeleteClipDialog({
      clipUID: target.dataset.clipUid,
      title: target.dataset.clipTitle,
      thumbnailUrl: target.dataset.thumbnailUrl,
      duration: target.dataset.duration,
    });
    return;
  }
  event.preventDefault();
  const text =
    action === "copy-link"
      ? target.dataset.clipUrl
      : action === "copy-iframe"
        ? target.dataset.iframe
        : "";
  if (!text) return;
  const successMessage =
    action === "copy-iframe"
      ? "iframe 코드를 복사하였습니다."
      : "URL을 복사하였습니다.";

  try {
    await copyStudioTextToClipboard(text);
    showStudioGlobalToast(successMessage);
  } catch {
    showStudioGlobalToast("복사하지 못했습니다.");
  }
}

async function copyStudioTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

function showStudioGlobalToast(message) {
  document.querySelector("[data-cheese-studio-toast]")?.remove();
  const toast = document.createElement("p");
  toast.className = "_container_1xoov_1 _is_global_1xoov_26";
  toast.dataset.cheeseStudioToast = "1";
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => {
    toast.dataset.hiding = "true";
    setTimeout(() => {
      toast.remove();
    }, 260);
  }, 1900);
}

function openStudioDeleteClipDialog({
  clipUID,
  title,
  thumbnailUrl,
  duration,
}) {
  const normalizedClipUID = String(clipUID || "").trim();
  if (!normalizedClipUID) return;

  document.querySelector(".cheese-search-studio-delete-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "_dimmed_1h6ic_2 cheese-search-studio-delete-modal";
  modal.innerHTML = `
    <div class="_container_1h6ic_15" role="alertdialog" aria-modal="true" style="width: 370px;">
      <strong class="_title_1h6ic_37">클립 삭제하기</strong>
      <div class="_content_1h6ic_30">
        <div class="_inner_1h6ic_31">
          <div class="_area_5ezr8_1">
            <div class="_box_5ezr8_5">
              <div class="_thumbnail_5ezr8_15"${thumbnailUrl ? ` style="background: url('${escapeAttribute(thumbnailUrl)}') center center / cover no-repeat;"` : ""}>
                <em class="_container_ckvt1_1">${escapeHtml(duration || "0:00")}</em>
              </div>
              <p class="_title_5ezr8_37">${escapeHtml(title || " ")}</p>
            </div>
            <div class="_text_5ezr8_52">
              <label for="delete-checkbox" class="_container_pykbt_2">
                <input type="checkbox" class="_input_pykbt_51 blind" name="delete-checkbox" id="delete-checkbox" data-studio-delete-check>
                <i class="_icon_pykbt_26">
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg" class="_check_pykbt_55"><path fill-rule="evenodd" clip-rule="evenodd" d="M9.01008 0.993245C9.40757 1.34657 9.44337 1.95523 9.09005 2.35272L4.94192 7.01937C4.60149 7.40235 4.02077 7.45166 3.62064 7.13156L1.02806 5.05749C0.612777 4.72526 0.545446 4.11928 0.877676 3.70399C1.20991 3.28871 1.81589 3.22137 2.23117 3.5536L4.10986 5.05655L7.6506 1.07321C8.00393 0.675721 8.61259 0.639918 9.01008 0.993245Z" fill="white"></path></svg>
                </i>
                <span class="_label_pykbt_23">삭제된 동영상은 되돌릴 수 없습니다.</span>
              </label>
            </div>
            <p class="cheese-search-studio-delete-error" data-studio-delete-error hidden></p>
          </div>
        </div>
      </div>
      <div class="_footer_1h6ic_129 _default_1h6ic_21">
        <div class="_box_1h6ic_42"><button type="button" class="_container_1rfm5_2 _largest_1rfm5_27 _light_1rfm5_58" data-studio-delete-cancel><span class="_inner_1rfm5_116">취소</span></button></div>
        <div class="_box_1h6ic_42"><button type="button" disabled class="_container_1rfm5_2 _largest_1rfm5_27 _dark_1rfm5_47 _is_disabled_1rfm5_24" data-studio-delete-confirm data-clip-uid="${escapeAttribute(normalizedClipUID)}"><span class="_inner_1rfm5_116">삭제</span></button></div>
      </div>
      <button type="button" class="_button_1h6ic_45" data-studio-delete-cancel>
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" class="_icon_close_1h6ic_169"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.79289 7.79289C8.18342 7.40237 8.81658 7.40237 9.20711 7.79289L22.2071 20.7929C22.5976 21.1834 22.5976 21.8166 22.2071 22.2071C21.8166 22.5976 21.1834 22.5976 20.7929 22.2071L7.79289 9.20711C7.40237 8.81658 7.40237 8.18342 7.79289 7.79289Z" fill="#2E3033"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M7.79289 22.2071C7.40237 21.8166 7.40237 21.1834 7.79289 20.7929L20.7929 7.79289C21.1834 7.40237 21.8166 7.40237 22.2071 7.79289C22.5976 8.18342 22.5976 8.81658 22.2071 9.20711L9.20711 22.2071C8.81658 22.5976 8.18342 22.5976 7.79289 22.2071Z" fill="#2E3033"></path></svg>
        <span class="blind">팝업 닫기</span>
      </button>
    </div>
  `;
  document.body.append(modal);

  const checkbox = modal.querySelector("[data-studio-delete-check]");
  const confirmButton = modal.querySelector("[data-studio-delete-confirm]");
  checkbox?.addEventListener("change", () => {
    const checked = Boolean(checkbox.checked);
    confirmButton.disabled = !checked;
    confirmButton.classList.toggle("_is_disabled_1rfm5_24", !checked);
  });
  modal.querySelectorAll("[data-studio-delete-cancel]").forEach((button) => {
    button.addEventListener("click", closeStudioDeleteClipDialog);
  });
  confirmButton?.addEventListener("click", handleStudioDeleteClipConfirm);
}

function closeStudioDeleteClipDialog() {
  document.querySelector(".cheese-search-studio-delete-modal")?.remove();
}

async function deleteStudioMakeClip({ channelId, clipUID }) {
  try {
    return await deleteStudioMakeClipFromContent({ channelId, clipUID });
  } catch (error) {
    if (error?.status === 403) {
      await warmStudioMakeClipSessionFromContent(channelId);
      await wait(300);
      try {
        return await deleteStudioMakeClipFromContent({ channelId, clipUID });
      } catch (retryError) {
        if (retryError?.status !== 403) throw retryError;
      }
    } else if (error?.status) {
      throw error;
    }
  }

  return sendMessage({
    type: "CHEESE_SEARCH_DELETE_MAKE_CLIP",
    payload: {
      channelId,
      clipUID,
    },
  });
}

async function deleteStudioMakeClipFromContent({ channelId, clipUID }) {
  const normalizedChannelId = String(channelId || "").trim();
  const normalizedClipUID = String(clipUID || "").trim();
  if (!normalizedChannelId) throw new Error("채널 ID를 확인할 수 없습니다.");
  if (!normalizedClipUID) throw new Error("클립 ID를 확인할 수 없습니다.");

  const response = await fetch(
    `${STUDIO_MANAGE_API_BASE}/channels/${encodeURIComponent(normalizedChannelId)}/clips/${encodeURIComponent(normalizedClipUID)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*",
      },
    },
  );
  return readStudioMutationResponse(response, "CHZZK 클립 삭제 요청 실패");
}

async function warmStudioMakeClipSessionFromContent(channelId) {
  const normalizedChannelId = String(channelId || "").trim();
  if (!normalizedChannelId) return;
  const url = new URL(
    `${STUDIO_MANAGE_API_BASE}/channels/${encodeURIComponent(normalizedChannelId)}/clips/make-clips`,
  );
  url.searchParams.set("page", "0");
  url.searchParams.set("size", "1");
  url.searchParams.set("dateFilter", "ALL");
  url.searchParams.set("orderFilter", "LATEST");
  await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  }).catch(() => {});
}

async function readStudioMutationResponse(response, fallbackMessage) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok || (payload && Number(payload.code) !== 200)) {
    const error = new Error(
      payload?.message || `${fallbackMessage}: HTTP ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }
  return payload?.content || {};
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function handleStudioDeleteClipConfirm(event) {
  const button = event.currentTarget;
  const clipUID = String(button.dataset.clipUid || "").trim();
  if (!clipUID || button.disabled) return;
  const modal = button.closest(".cheese-search-studio-delete-modal");
  const error = modal?.querySelector("[data-studio-delete-error]");
  button.disabled = true;
  button.classList.add("_is_disabled_1rfm5_24");
  const label = button.querySelector("._inner_1rfm5_116");
  if (label) label.textContent = "삭제 중";
  if (error) {
    error.hidden = true;
    error.textContent = "";
  }

  try {
    await deleteStudioMakeClip({
      channelId: studioMakeClipState.channelId,
      clipUID,
    });
    applyStudioMakeClipDeletion(clipUID);
    closeStudioDeleteClipDialog();
  } catch (deleteError) {
    if (error) {
      error.textContent =
        deleteError instanceof Error
          ? deleteError.message
          : "클립 삭제에 실패했습니다.";
      error.hidden = false;
    }
    button.disabled = false;
    button.classList.remove("_is_disabled_1rfm5_24");
    if (label) label.textContent = "삭제";
  }
}

function applyStudioMakeClipDeletion(clipUID) {
  const normalizedClipUID = String(clipUID || "").trim();
  if (!normalizedClipUID) return;
  studioMakeClipState.deletedClipUIDs.add(normalizedClipUID);
  studioMakeClipState.clips = studioMakeClipState.clips.filter(
    (clip) => String(clip?.clipUID || "").trim() !== normalizedClipUID,
  );
  setStudioStreamersFromClips(studioMakeClipState.clips);
  resetStudioVisibleResults();
  updateStudioMakeClipControls();
  hideDeletedStudioOriginalRows();
  if (studioMakeClipState.hasLoaded) {
    renderStudioMakeClipResults();
  }
}

async function activateStudioMakeClipSearch() {
  if (!studioMakeClipState.channelId || studioMakeClipState.loading) return;
  studioMakeClipState.loading = true;
  studioMakeClipState.error = "";
  updateStudioMakeClipControls();
  hideStudioPagination();
  renderStudioMakeClipStatus("내가 만든 클립을 불러오는 중입니다.");

  try {
    const result = await getStudioMakeClipResultForSearch();
    applyStudioMakeClipResult(result);
    studioMakeClipState.preloaded = true;
    studioMakeClipState.hasLoaded = true;
    studioMakeClipState.loading = false;
    resetStudioVisibleResults();
    if (!getStudioMakeClipContext()) return;
    updateStudioMakeClipControls();
    renderStudioMakeClipResults();
  } catch (error) {
    studioMakeClipState.loading = false;
    studioMakeClipState.error =
      error instanceof Error ? error.message : String(error);
    if (!getStudioMakeClipContext()) return;
    updateStudioMakeClipControls();
    renderStudioMakeClipStatus(
      `내가 만든 클립을 불러오지 못했습니다. ${studioMakeClipState.error}`,
      true,
    );
  }
}

function hideStudioOriginalView() {
  const table = document.getElementById("make_clip_panel");
  if (table) hideOriginalElement(table);
  hideStudioPagination();
}

function hideStudioPagination() {
  const table = document.getElementById("make_clip_panel");
  const pagination = table?.parentElement
    ?.querySelector('nav[aria-label="pagination"]')
    ?.closest("div");
  if (pagination) hideOriginalElement(pagination);
}

function showStudioOriginalView() {
  const table = document.getElementById("make_clip_panel");
  if (table) showOriginalElement(table);
  showStudioPagination();
}

function showStudioPagination() {
  const table = document.getElementById("make_clip_panel");
  const pagination = table?.parentElement
    ?.querySelector('nav[aria-label="pagination"]')
    ?.closest("div");
  if (pagination) showOriginalElement(pagination);
}

function ensureStudioMakeClipSummary() {
  let result = document.querySelector(".cheese-search-studio-summary");
  const shell = document.querySelector(".cheese-search-studio-shell");
  if (result) {
    if (shell && result.previousElementSibling !== shell) {
      shell.after(result);
    }
    showOriginalElement(result);
    return result;
  }
  result = document.createElement("div");
  result.className = "cheese-search-studio-summary";
  shell?.after(result);
  return result;
}

function renderStudioMakeClipStatus(message, isError = false) {
  showStudioOriginalView();
  hideStudioPagination();
  const summary = ensureStudioMakeClipSummary();
  summary.textContent = "";
  renderStudioTableMessage(message, isError);
}

function renderStudioMakeClipResults() {
  showStudioOriginalView();
  hideStudioPagination();
  const summary = ensureStudioMakeClipSummary();
  const filtered = getFilteredStudioMakeClips();
  const signature = getStudioMakeClipResultSignature();
  if (studioMakeClipState.resultSignature !== signature) {
    studioMakeClipState.resultSignature = signature;
    studioMakeClipState.visibleCount = RESULT_INITIAL_RENDER_COUNT;
  }
  updateStudioMakeClipSummary(summary, filtered);
  if (!filtered.length) {
    renderStudioTableMessage("검색 조건에 맞는 클립이 없습니다.");
    return;
  }

  const table = document.getElementById("make_clip_panel");
  const tbody = table?.tBodies?.[0];
  if (!tbody) return;
  const visible = filtered.slice(0, studioMakeClipState.visibleCount);
  replaceStudioRenderedRows(visible.map(renderStudioMakeClipRow).join(""));
}

function updateStudioMakeClipSummary(summary, filtered) {
  const visibleCount = Math.min(
    filtered.length,
    studioMakeClipState.visibleCount,
  );
  const visibleText =
    visibleCount < filtered.length
      ? ` · ${visibleCount.toLocaleString("ko-KR")}개 표시 중`
      : "";
  summary.textContent = `검색 결과 ${filtered.length.toLocaleString("ko-KR")}개 / 전체 ${studioMakeClipState.clips.length.toLocaleString("ko-KR")}개${visibleText}`;
}

function getStudioMakeClipResultSignature() {
  return [
    studioMakeClipState.query,
    studioMakeClipState.dateFrom,
    studioMakeClipState.dateTo,
    studioMakeClipState.streamer,
    studioMakeClipState.sort,
    studioMakeClipState.tableSortField,
    studioMakeClipState.tableSortDirection,
    studioMakeClipState.clips.length,
  ].join("|");
}

function resetStudioVisibleResults() {
  studioMakeClipState.resultSignature = "";
  studioMakeClipState.visibleCount = RESULT_INITIAL_RENDER_COUNT;
}

function getFilteredStudioMakeClips() {
  const dateFrom = studioMakeClipState.dateFrom
    ? getDayStart(studioMakeClipState.dateFrom)
    : 0;
  const dateTo = studioMakeClipState.dateTo
    ? getDayEnd(studioMakeClipState.dateTo)
    : 0;
  const searchOptions = {
    useTags: false,
    fields: [
      "clipTitle",
      (clip) => clip?.makeChannel?.channelName,
      (clip) => clip?.makeChannel?.channelId,
    ],
    categoryFields: [(clip) => clip?.makeChannel?.channelName],
  };
  return studioMakeClipState.clips
    .filter((clip) => {
      const clipUID = String(clip?.clipUID || "").trim();
      if (clipUID && studioMakeClipState.deletedClipUIDs.has(clipUID)) {
        return false;
      }
      const clipTime = getItemTime(clip);
      if (dateFrom && clipTime < dateFrom) return false;
      if (dateTo && clipTime > dateTo) return false;
      const channelId = String(clip?.makeChannel?.channelId || "").trim();
      if (
        studioMakeClipState.streamer !== "all" &&
        channelId !== studioMakeClipState.streamer
      ) {
        return false;
      }
      return CheeseSearchQuery.matches(
        clip,
        studioMakeClipState.query,
        searchOptions,
      );
    })
    .sort(compareStudioMakeClips);
}

function compareStudioMakeClips(a, b) {
  if (studioMakeClipState.tableSortField === "title") {
    const direction =
      studioMakeClipState.tableSortDirection === "desc" ? -1 : 1;
    return (
      direction * compareStudioText(a?.clipTitle, b?.clipTitle) ||
      compareStudioText(
        a?.makeChannel?.channelName,
        b?.makeChannel?.channelName,
      ) ||
      getItemTime(b) - getItemTime(a)
    );
  }
  if (studioMakeClipState.tableSortField === "channel") {
    const direction =
      studioMakeClipState.tableSortDirection === "desc" ? -1 : 1;
    return (
      direction *
        compareStudioText(
          a?.makeChannel?.channelName,
          b?.makeChannel?.channelName,
        ) ||
      compareStudioText(a?.clipTitle, b?.clipTitle) ||
      getItemTime(b) - getItemTime(a)
    );
  }
  if (studioMakeClipState.sort === "popular") {
    return getViewCount(b) - getViewCount(a) || getItemTime(b) - getItemTime(a);
  }
  if (studioMakeClipState.sort === "comments") {
    return (
      getCommentCount(b) - getCommentCount(a) || getItemTime(b) - getItemTime(a)
    );
  }
  if (studioMakeClipState.sort === "oldest") {
    return getItemTime(a) - getItemTime(b);
  }
  return getItemTime(b) - getItemTime(a);
}

function compareStudioText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "ko-KR", {
    numeric: true,
  });
}

function renderStudioMakeClipRow(clip) {
  const title = String(clip?.clipTitle || "제목 없음");
  const manageUrl = getStudioMakeClipManageUrl(clip);
  const clipUrl = getStudioMakeClipPublicUrl(clip);
  const iframeCode = getStudioMakeClipIframeCode(clip);
  const thumbnailUrl = getStudioMakeClipThumbnailUrl(clip);
  const channelName = String(clip?.makeChannel?.channelName || "-");
  const channelId = String(clip?.makeChannel?.channelId || "").trim();
  const channelUrl = channelId ? `https://chzzk.naver.com/${channelId}` : "";
  const createdDate =
    String(clip?.createdDate || "") || formatClipCreatedDate(clip);
  const readCount = formatCount(clip?.readCount);
  const commentCount = Number(clip?.commentCount || 0);
  return `
    <tr data-cheese-studio-row>
      <td class="_align_left_rynbv_72">
        <div class="_area_1lzgi_1">
          <a rel="noreferrer" class="_link_1lzgi_8" href="${escapeAttribute(manageUrl)}" target="_self"><span class="blind">동영상 관리로 이동</span></a>
          <a type="button" class="_component_rynbv_139" href="${escapeAttribute(manageUrl)}" target="_self">
            <div class="_thumbnail_rynbv_175 _is_large_rynbv_198 _is_clip_rynbv_203"${thumbnailUrl ? ` style="background-image:url('${escapeAttribute(thumbnailUrl)}')"` : ""}>
              <em class="_container_ckvt1_1">${escapeHtml(formatSeconds(clip?.duration))}</em>
            </div>
            <div class="_information_rynbv_243">
              <span class="_text_rynbv_129 _title_1lzgi_4">
                <span class="_ellipsis2_rynbv_257 _break_spaces_rynbv_273">${escapeHtml(title)}</span>
              </span>
              <div class="_lightgray_rynbv_289">
                <div class="_box_1lzgi_20">
                  <div class="_item_1lzgi_29">
                    ${renderStudioCalendarIcon()}
                    <span class="blind">등록일</span>${escapeHtml(createdDate)}
                  </div>
                  <div class="_item_1lzgi_29">
                    ${renderStudioViewIcon()}
                    <span class="blind">조회수</span>${readCount}
                  </div>
                  <div class="_item_1lzgi_29">
                    ${renderStudioCommentIcon()}
                    <span class="blind">댓글</span>${formatCount(commentCount)}
                  </div>
                </div>
              </div>
            </div>
          </a>
        </div>
      </td>
      <td class="">
        ${
          channelUrl
            ? `<a href="${escapeAttribute(channelUrl)}" class="_link_text_1lzgi_16" target="_blank" rel="noreferrer"><span class="_text_rynbv_129"><span class="_ellipsis2_rynbv_257">${escapeHtml(channelName)}</span></span></a>`
            : `<span class="_text_rynbv_129"><span class="_ellipsis2_rynbv_257">${escapeHtml(channelName)}</span></span>`
        }
      </td>
      <td class="_align_right_rynbv_84">
        <div class="_button_box_1lzgi_102">
          <div class="_button_1lzgi_102">
            <a class="_container_1rfm5_2 _small_1rfm5_42 _light_1rfm5_58" href="${escapeAttribute(manageUrl)}" target="_self">
              <span class="_inner_1rfm5_116">관리</span>
            </a>
          </div>
          <div class="_button_1lzgi_102">
            <div class="_container_12tks_2 cheese-search-studio-more">
              <button type="button" class="_component_12tks_8" aria-expanded="false" aria-haspopup="listbox" aria-controls="more-button-listbox" data-studio-more-toggle>
                <i class="_inner_12tks_18"><span></span><span></span><span></span><span class="blind">더보기</span></i>
              </button>
              <ul class="_layer_12tks_62 cheese-search-studio-more-menu" id="more-button-listbox" role="listbox" hidden>
                <li class="_item_12tks_79" role="presentation">
                  <button type="button" class="_option_12tks_83" data-studio-more-action="copy-link" data-clip-url="${escapeAttribute(clipUrl)}">
                    <span>${renderStudioLinkIcon()}<span data-studio-more-label>공유할 링크 복사</span></span>
                  </button>
                </li>
                <li class="_item_12tks_79" role="presentation">
                  <button type="button" class="_option_12tks_83" data-studio-more-action="copy-iframe" data-iframe="${escapeAttribute(iframeCode)}">
                    <span>${renderStudioEmbedIcon()}<span data-studio-more-label>동영상 퍼가기 (iframe)</span></span>
                  </button>
                </li>
                <li class="_item_12tks_79" role="presentation">
                  <button type="button" class="_option_12tks_83 _highlight_12tks_111" data-studio-more-action="delete" data-clip-uid="${escapeAttribute(String(clip?.clipUID || ""))}" data-clip-title="${escapeAttribute(title)}" data-thumbnail-url="${escapeAttribute(thumbnailUrl)}" data-duration="${escapeAttribute(formatSeconds(clip?.duration))}">
                    ${renderStudioDeleteIcon()}<span data-studio-more-label>이 클립 삭제하기</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderStudioCalendarIcon() {
  return `<svg width="13" height="15" viewBox="0 0 13 15" fill="none" xmlns="http://www.w3.org/2000/svg" class="_icon_1lzgi_47"><path fill-rule="evenodd" clip-rule="evenodd" d="M0.5 6C0.5 4.34315 1.84315 3 3.5 3H9.5C11.1569 3 12.5 4.34315 12.5 6V10C12.5 11.6569 11.1569 13 9.5 13H3.5C1.84315 13 0.5 11.6569 0.5 10V6ZM3.5 4C2.39543 4 1.5 4.89543 1.5 6V10C1.5 11.1046 2.39543 12 3.5 12H9.5C10.6046 12 11.5 11.1046 11.5 10V6C11.5 4.89543 10.6046 4 9.5 4H3.5Z" fill="#AEB4C2"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M12 6.5H1V5.5H12V6.5Z" fill="#AEB4C2"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M4 5C3.72386 5 3.5 4.77614 3.5 4.5L3.5 2.5C3.5 2.22386 3.72386 2 4 2C4.27614 2 4.5 2.22386 4.5 2.5L4.5 4.5C4.5 4.77614 4.27614 5 4 5Z" fill="#AEB4C2"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M9 5C8.72386 5 8.5 4.77614 8.5 4.5L8.5 2.5C8.5 2.22386 8.72386 2 9 2C9.27614 2 9.5 2.22386 9.5 2.5L9.5 4.5C9.5 4.77614 9.27614 5 9 5Z" fill="#AEB4C2"></path><circle cx="3.5" cy="8" r="0.5" fill="#AEB4C2"></circle><circle cx="6.5" cy="8" r="0.5" fill="#AEB4C2"></circle><circle cx="9.5" cy="8" r="0.5" fill="#AEB4C2"></circle><circle cx="3.5" cy="10" r="0.5" fill="#AEB4C2"></circle><circle cx="6.5" cy="10" r="0.5" fill="#AEB4C2"></circle><circle cx="9.5" cy="10" r="0.5" fill="#AEB4C2"></circle></svg>`;
}

function renderStudioViewIcon() {
  return `<svg width="10" height="16" viewBox="0 0 10 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="_icon_view_1lzgi_98"><rect y="1.5" width="10" height="14" fill="#D9D9D9" fill-opacity="0.06"></rect><path fill-rule="evenodd" clip-rule="evenodd" d="M8.53998 7.63062C9.15334 8.03518 9.15334 8.96482 8.53998 9.36938L2.52328 13.3378C1.86308 13.7733 1 13.2807 1 12.4684L1 4.53155C1 3.7193 1.86308 3.22672 2.52328 3.66218L8.53998 7.63062ZM8.00835 8.5L1.99165 4.53155L1.99165 12.4684L8.00835 8.5Z" fill="#AEB4C2"></path></svg>`;
}

function renderStudioCommentIcon() {
  return `<svg width="13" height="15" viewBox="0 0 13 15" fill="none" xmlns="http://www.w3.org/2000/svg" class="_icon_1lzgi_47"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.95675 2.44516C3.35646 2.44516 1.26865 4.49537 1.26865 6.99993C1.26865 9.50448 3.35646 11.5547 5.95675 11.5547H10.7282L9.62411 10.4793C9.45717 10.3167 9.44386 10.0529 9.59359 9.87429C10.2518 9.08919 10.6448 8.08912 10.6448 6.99993C10.6448 4.49537 8.55703 2.44516 5.95675 2.44516ZM0.378174 6.99993C0.378174 3.98163 2.8869 1.55469 5.95675 1.55469C9.02659 1.55469 11.5353 3.98163 11.5353 6.99993C11.5353 8.16051 11.163 9.23616 10.5302 10.1188L12.1341 11.681C12.2638 11.8074 12.3041 11.9998 12.2359 12.1676C12.1677 12.3354 12.0046 12.4452 11.8234 12.4452H5.95675C2.8869 12.4452 0.378174 10.0182 0.378174 6.99993Z" fill="#AEB4C2"></path><path d="M4.4901 7.13299C4.4901 7.538 4.16178 7.86632 3.75677 7.86632C3.35176 7.86632 3.02344 7.538 3.02344 7.13299C3.02344 6.72798 3.35176 6.39966 3.75677 6.39966C4.16178 6.39966 4.4901 6.72798 4.4901 7.13299Z" fill="#AEB4C2"></path><path d="M6.6903 7.13299C6.6903 7.538 6.36197 7.86632 5.95697 7.86632C5.55196 7.86632 5.22363 7.538 5.22363 7.13299C5.22363 6.72798 5.55196 6.39966 5.95697 6.39966C6.36197 6.39966 6.6903 6.72798 6.6903 7.13299Z" fill="#AEB4C2"></path><path d="M8.89025 7.13299C8.89025 7.538 8.56193 7.86632 8.15692 7.86632C7.75191 7.86632 7.42358 7.538 7.42358 7.13299C7.42358 6.72798 7.75191 6.39966 8.15692 6.39966C8.56193 6.39966 8.89025 6.72798 8.89025 7.13299Z" fill="#AEB4C2"></path></svg>`;
}

function renderStudioLinkIcon() {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.1014 8.17786C9.08605 7.1625 7.43983 7.1625 6.42446 8.17786L3.73746 10.8649C2.72209 11.8802 2.72209 13.5265 3.73746 14.5418C4.75282 15.5572 6.39905 15.5572 7.41441 14.5418L8.75791 13.1983" stroke="#525662" stroke-width="1.4" stroke-linecap="round"></path><path d="M8.11318 10.2024C9.12855 11.2178 10.7748 11.2178 11.7901 10.2024L14.4771 7.51544C15.4925 6.50008 15.4925 4.85385 14.4771 3.83849C13.4618 2.82312 11.8156 2.82312 10.8002 3.83848L9.45669 5.18199" stroke="#525662" stroke-width="1.4" stroke-linecap="round"></path></svg>`;
}

function renderStudioEmbedIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" aria-hidden="true"><rect width="13.8" height="11.925" x="1.6" y="4.1" stroke="#525662" stroke-width="1.2" rx="1.9"></rect><path fill="#525662" d="M1.938 7.25h13.125v1.2H1.938z"></path><path stroke="#525662" stroke-width="1.2" d="m4.976 7.763 3.75-3.75M9.951 7.763l3.75-3.75"></path><path fill="#525662" fill-rule="evenodd" d="M10.042 11.147a.631.631 0 0 1 0 1.113l-1.7.983c-.472.273-1.084-.041-1.084-.556V10.72c0-.516.612-.83 1.084-.557l1.7.984Z" clip-rule="evenodd"></path></svg>`;
}

function renderStudioDeleteIcon() {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.00768 12.4086L3.3042 6.0773L4.69564 5.9227L5.39911 12.254C5.52854 13.4188 6.51308 14.3 7.68505 14.3H10.3148C11.4868 14.3 12.4713 13.4188 12.6007 12.254L13.3042 5.9227L14.6956 6.0773L13.9922 12.4086C13.784 14.2824 12.2001 15.7 10.3148 15.7H7.68505C5.79971 15.7 4.21588 14.2824 4.00768 12.4086Z" fill="#FF393E"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M9.00005 3.69999C8.28208 3.69999 7.70005 4.28202 7.70005 4.99999V5.99999H6.30005V4.99999C6.30005 3.50882 7.50888 2.29999 9.00005 2.29999C10.4912 2.29999 11.7 3.50882 11.7 4.99999V5.99999H10.3V4.99999C10.3 4.28202 9.71802 3.69999 9.00005 3.69999Z" fill="#FF393E"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M1.30005 5.99999C1.30005 5.61339 1.61345 5.29999 2.00005 5.29999H16C16.3866 5.29999 16.7 5.61339 16.7 5.99999C16.7 6.38659 16.3866 6.69999 16 6.69999H2.00005C1.61345 6.69999 1.30005 6.38659 1.30005 5.99999Z" fill="#FF393E"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M6.99995 12L6.99995 8L8.19995 8L8.19995 12L6.99995 12Z" fill="#FF393E"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M9.99995 12L9.99995 8L11.2 8L11.2 12L9.99995 12Z" fill="#FF393E"></path></svg>`;
}

function renderStudioTableMessage(message, isError = false) {
  const table = document.getElementById("make_clip_panel");
  const tbody = table?.tBodies?.[0];
  if (!tbody) return;
  const columnCount = Math.max(1, table.tHead?.rows?.[0]?.cells?.length || 3);
  replaceStudioRenderedRows(`
    <tr data-cheese-studio-row>
      <td colspan="${columnCount}">
        <p class="cheese-search-studio-status${isError ? " is-error" : ""}">${escapeHtml(message)}</p>
      </td>
    </tr>
  `);
}

function rememberStudioOriginalRows(table) {
  const tbody = table?.tBodies?.[0];
  if (!tbody || studioMakeClipState.originalRows.length) return;
  studioMakeClipState.originalRows = getStudioNativeRows(tbody);
}

function restoreStudioOriginalRows() {
  const table = document.getElementById("make_clip_panel");
  const tbody = table?.tBodies?.[0];
  if (!tbody) return;
  clearStudioRenderedRows(tbody);
  showStudioOriginalRows(tbody);
}

function replaceStudioRenderedRows(html) {
  const table = document.getElementById("make_clip_panel");
  const tbody = table?.tBodies?.[0];
  if (!tbody) return;
  hideStudioOriginalRows(tbody);
  clearStudioRenderedRows(tbody);
  tbody.insertAdjacentHTML("beforeend", html);
}

function clearStudioRenderedRows(
  tbody = document.getElementById("make_clip_panel")?.tBodies?.[0],
) {
  const scope = tbody || document;
  scope.querySelectorAll("[data-cheese-studio-row]").forEach((row) => {
    row.remove();
  });
}

function getStudioNativeRows(tbody) {
  return Array.from(tbody?.rows || []).filter(
    (row) => !row.matches("[data-cheese-studio-row]"),
  );
}

function hideStudioOriginalRows(tbody) {
  const rows = getConnectedStudioOriginalRows(tbody);
  rows.forEach(hideOriginalElement);
}

function showStudioOriginalRows(
  tbody = document.getElementById("make_clip_panel")?.tBodies?.[0],
) {
  const rows = getConnectedStudioOriginalRows(tbody);
  rows.forEach((row) => {
    const clipUID = getStudioRowClipUID(row);
    if (clipUID && studioMakeClipState.deletedClipUIDs.has(clipUID)) {
      hideOriginalElement(row);
      return;
    }
    showOriginalElement(row);
  });
}

function hideDeletedStudioOriginalRows() {
  const table = document.getElementById("make_clip_panel");
  const tbody = table?.tBodies?.[0];
  if (!tbody) return;
  getConnectedStudioOriginalRows(tbody).forEach((row) => {
    const clipUID = getStudioRowClipUID(row);
    if (clipUID && studioMakeClipState.deletedClipUIDs.has(clipUID)) {
      hideOriginalElement(row);
    }
  });
}

function getStudioRowClipUID(row) {
  const href = row
    ?.querySelector('a[href*="/clip/manage"][href*="clipUID="]')
    ?.getAttribute("href");
  if (!href) return "";
  try {
    const url = new URL(href, location.origin);
    return String(url.searchParams.get("clipUID") || "").trim();
  } catch {
    return "";
  }
}

function getConnectedStudioOriginalRows(tbody) {
  const rememberedRows = studioMakeClipState.originalRows.filter(
    (row) => row.isConnected && row.parentElement === tbody,
  );
  if (rememberedRows.length) return rememberedRows;
  const rows = getStudioNativeRows(tbody);
  studioMakeClipState.originalRows = rows;
  return rows;
}

function mountStudioHeaderSort(table) {
  const headers = Array.from(table?.tHead?.rows?.[0]?.cells || []);
  const pairs = [
    [headers[0], "title"],
    [headers[1], "channel"],
  ];
  pairs.forEach(([header, field]) => {
    if (!header || header.dataset.cheeseStudioSortable) return;
    header.dataset.cheeseStudioSortable = "1";
    header.dataset.studioSortField = field;
    header.tabIndex = 0;
    header.addEventListener("click", handleStudioHeaderSort);
    header.addEventListener("keydown", handleStudioHeaderSortKeydown);
  });
  updateStudioHeaderSortState();
}

function handleStudioHeaderSort(event) {
  const header = event.currentTarget;
  const field = header?.dataset?.studioSortField;
  if (!field) return;
  if (studioMakeClipState.tableSortField === field) {
    if (studioMakeClipState.tableSortDirection === "asc") {
      studioMakeClipState.tableSortDirection = "desc";
    } else {
      studioMakeClipState.tableSortField = "";
      studioMakeClipState.tableSortDirection = "asc";
    }
  } else {
    studioMakeClipState.tableSortField = field;
    studioMakeClipState.tableSortDirection = "asc";
  }
  updateStudioHeaderSortState();
  renderOrActivateStudioMakeClipSearch();
}

function handleStudioHeaderSortKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  handleStudioHeaderSort(event);
}

function updateStudioHeaderSortState() {
  const table = document.getElementById("make_clip_panel");
  table?.querySelectorAll("[data-studio-sort-field]").forEach((header) => {
    const isActive =
      header.dataset.studioSortField === studioMakeClipState.tableSortField;
    header.classList.add("cheese-search-studio-sortable");
    header.dataset.sortDir = isActive
      ? studioMakeClipState.tableSortDirection
      : "";
    header.setAttribute(
      "aria-sort",
      isActive
        ? studioMakeClipState.tableSortDirection === "asc"
          ? "ascending"
          : "descending"
        : "none",
    );
  });
}

function getStudioMakeClipManageUrl(clip) {
  const clipUID = encodeURIComponent(String(clip?.clipUID || ""));
  return `/${studioMakeClipState.channelId}/clip/manage?clipUID=${clipUID}`;
}

function getStudioMakeClipPublicUrl(clip) {
  const clipUID = String(clip?.clipUID || "").trim();
  if (!clipUID) return "";
  return `https://chzzk.naver.com/clips/${encodeURIComponent(clipUID)}`;
}

function getStudioMakeClipIframeCode(clip) {
  const clipUrl = getStudioMakeClipPublicUrl(clip);
  if (!clipUrl) return "";
  return `<iframe src="${clipUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;
}

function getStudioMakeClipThumbnailUrl(clip) {
  const thumbnailUrl = String(clip?.thumbnailImageUrl || "").trim();
  if (!thumbnailUrl) return "";
  try {
    const url = new URL(thumbnailUrl);
    if (!url.searchParams.has("type")) {
      url.searchParams.set("type", "o500x280_blur");
    }
    return url.toString();
  } catch {
    return thumbnailUrl;
  }
}

function formatSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

function init() {
  initCommentTimestampMarkers();

  cleanupStudioMakeClipViewIfInactive();

  const studioContext = getStudioMakeClipContext();
  if (studioContext) {
    if (state.initializedFor) {
      restoreOriginalView();
      document
        .querySelector(".cheese-search-shell:not(.cheese-search-studio-shell)")
        ?.remove();
      document.querySelector(".cheese-search-result-header")?.remove();
      document.querySelector(".cheese-search-results-list")?.remove();
      state.initializedFor = "";
      state.channelId = null;
    }
    scheduleStudioMakeClipInit(studioContext);
    return;
  }

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

  if (isClipSearch) {
    const restoreState = await readLastAutoRestoreState({ isClipSearch });
    if (
      restoreState &&
      (await hydrateFromSessionCache({ isClipSearch, controls, restoreState }))
    ) {
      return;
    }
  }

  const isCurrentRestoreDisabled = await isAutoRestoreDisabled({
    isClipSearch,
    controls,
  });
  const hydrated = isCurrentRestoreDisabled
    ? false
    : await hydrateFromSessionCache({ isClipSearch, controls });
  if (hydrated || !isClipSearch) return;
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
    sort: controls?.sort || "latest",
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
  if (
    getStudioMakeClipContext() &&
    studioMakeClipState.hasLoaded &&
    !studioMakeClipState.loading &&
    isNearBottom()
  ) {
    revealMoreStudioMakeClipResults();
  }
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

function revealMoreStudioMakeClipResults() {
  const table = document.getElementById("make_clip_panel");
  const tbody = table?.tBodies?.[0];
  const summary = document.querySelector(".cheese-search-studio-summary");
  if (!tbody || !summary) return;

  const filtered = getFilteredStudioMakeClips();
  const nextVisibleCount = Math.min(
    filtered.length,
    studioMakeClipState.visibleCount + RESULT_RENDER_STEP_COUNT,
  );
  if (nextVisibleCount <= studioMakeClipState.visibleCount) return;

  const nextResults = filtered.slice(
    studioMakeClipState.visibleCount,
    nextVisibleCount,
  );
  studioMakeClipState.visibleCount = nextVisibleCount;
  tbody.insertAdjacentHTML(
    "beforeend",
    nextResults.map(renderStudioMakeClipRow).join(""),
  );
  updateStudioMakeClipSummary(summary, filtered);
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

function scheduleInitFromMutations(mutations) {
  if (cleanupStudioMakeClipViewIfInactive()) {
    return;
  }
  if (mutations?.length && mutations.every(isCheeseSearchOnlyMutation)) {
    return;
  }
  if (observerState.initTimer) return;
  observerState.initTimer = setTimeout(() => {
    observerState.initTimer = 0;
    init();
  }, 120);
}

function isCheeseSearchOnlyMutation(mutation) {
  if (isCheeseSearchOwnedNode(mutation.target)) return true;
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  if (!nodes.length) return false;
  return nodes.every(isCheeseSearchOwnedNode);
}

function isCheeseSearchOwnedNode(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return true;
  if (node.matches(CHEESE_SEARCH_MUTATION_IGNORE_SELECTOR)) return true;
  if (node.closest?.(CHEESE_SEARCH_MUTATION_IGNORE_SELECTOR)) return true;
  return Boolean(node.querySelector?.(CHEESE_SEARCH_MUTATION_IGNORE_SELECTOR));
}

const observer = new MutationObserver(scheduleInitFromMutations);
observer.observe(document.documentElement, { childList: true, subtree: true });
ensureScrollTopButton();
window.addEventListener("scroll", debounce(handleWindowScroll, 120), {
  passive: true,
});
window.addEventListener("hashchange", () => {
  cleanupStudioMakeClipViewIfInactive();
  init();
});
window.addEventListener(
  "resize",
  debounce(repositionOpenCommentTimestampPanel, 120),
  { passive: true },
);
document.addEventListener("click", handleCategoryFilterClick);
document.addEventListener("click", handleCategoryResetDocumentClick);
document.addEventListener("click", handleCommentTimestampDocumentClick);
document.addEventListener("click", handleStudioMoreCaptureClick, true);
document.addEventListener("click", handleStudioDocumentClick);
document.addEventListener("keydown", handleCommentTimestampKeydown);

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
  if (needsSortMetricRefreshForCurrentResults()) {
    void loadVideos({ forceRefresh: false });
    return;
  }
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
        sort: controls?.sort || "latest",
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
