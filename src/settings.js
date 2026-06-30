// 치즈 서치 - 기능 설정 팝업
// 확장 아이콘 클릭 시 뜨는 전용 설정 페이지. 8개 기능의 표시/숨김을 전역
// (chrome.storage.local `cheeseFeatureHidden`)으로 저장한다. content.js가
// storage.onChanged로 즉시 반영하므로 열린 치지직 탭에 바로 적용된다.
(() => {
  "use strict";

  // ── 테마(검색 팝업과 localStorage 키 공유) ────────────────────────────────
  const THEME_STORAGE_KEY = "cheeseSearchTheme";
  const themeToggle = document.getElementById("themeToggleButton");

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle?.setAttribute("aria-pressed", String(isDark));
    themeToggle?.setAttribute(
      "aria-label",
      isDark ? "라이트 모드로 전환" : "다크 모드로 전환",
    );
  }

  function toggleTheme() {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
    applyTheme(next);
  }

  applyTheme(
    localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light",
  );
  themeToggle?.addEventListener("click", toggleTheme);

  // ── 카테고리 탭(좌측 탭 → 우측 패널 전환) ─────────────────────────────────
  // 팝업을 열 때마다 항상 첫 탭('전체')에서 시작한다(설정 팝업은 예측 가능성이
  // 직전 탭 기억보다 중요 → 마지막 탭을 저장하지 않는다).
  const tabButtons = Array.from(document.querySelectorAll(".settings-tab"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  const panelsScroll = document.querySelector(".settings-panels");

  function selectTab(tab) {
    const valid = tabButtons.some((b) => b.dataset.tab === tab);
    const active = valid ? tab : "all";
    tabButtons.forEach((btn) => {
      const on = btn.dataset.tab === active;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    panels.forEach((panel) => {
      // '전체'는 모든 패널 표시. 그 외엔 일치하는 패널만.
      panel.hidden = active !== "all" && panel.dataset.panel !== active;
    });
    // 탭 전환 시 우측 패널 스크롤을 최상단으로(이전 위치 잔류 방지).
    if (panelsScroll) panelsScroll.scrollTop = 0;
  }

  tabButtons.forEach((btn) =>
    btn.addEventListener("click", () => selectTab(btn.dataset.tab)),
  );
  selectTab("all");

  const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
  // 미설정 시 기본 체크(숨김)인 항목. clipLiveButton은 기본적으로 숨긴다.
  const DEFAULT_HIDDEN = new Set(["clipLiveButton"]);
  const inputs = Array.from(document.querySelectorAll("[data-feature]"));

  async function load() {
    let saved = {};
    try {
      const data = await chrome.storage?.local?.get(FEATURE_HIDDEN_KEY);
      const value = data?.[FEATURE_HIDDEN_KEY];
      if (value && typeof value === "object") saved = value;
    } catch {
      // 로드 실패 시 기본값으로 둔다.
    }
    inputs.forEach((input) => {
      const key = input.dataset.feature;
      const v = saved[key];
      input.checked = typeof v === "boolean" ? v : DEFAULT_HIDDEN.has(key);
    });
  }

  function save() {
    const flags = {};
    inputs.forEach((input) => {
      flags[input.dataset.feature] = input.checked;
    });
    try {
      chrome.storage?.local?.set({ [FEATURE_HIDDEN_KEY]: flags });
    } catch {
      // 저장 실패는 무시(다음 변경 때 재시도됨).
    }
  }

  inputs.forEach((input) => input.addEventListener("change", save));
  load();

  // ── 채팅 폰트 크기: 커스텀 팝오버 드롭다운(0.8~2, 기본 1) ──────────────────
  const CHAT_FONT_SCALE_KEY = "cheeseChatFontScale";
  // 입력은 퍼센트(80~200), 저장값은 배율(0.8~2.0).
  const chatFontScaleInput = document.querySelector("[data-chat-font-scale]");
  function clampChatFontPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 100;
    return Math.min(200, Math.max(80, Math.round(n / 5) * 5));
  }
  if (chatFontScaleInput) {
    (async () => {
      try {
        const d = await chrome.storage?.local?.get(CHAT_FONT_SCALE_KEY);
        const scale = Number(d?.[CHAT_FONT_SCALE_KEY]);
        const pct = Number.isFinite(scale) && scale > 0 ? scale * 100 : 100;
        chatFontScaleInput.value = String(clampChatFontPct(pct));
      } catch {
        chatFontScaleInput.value = "100";
      }
    })();
    const saveChatFontScale = () => {
      const pct = clampChatFontPct(chatFontScaleInput.value);
      chatFontScaleInput.value = String(pct);
      try {
        chrome.storage?.local?.set({ [CHAT_FONT_SCALE_KEY]: pct / 100 });
      } catch {}
    };
    chatFontScaleInput.addEventListener("change", saveChatFontScale);
    chatFontScaleInput.addEventListener("blur", saveChatFontScale);
  }

  // ── 채팅 기능: 배지 모아 챗이 제어 중이면 해당 토글/셀렉트를 비활성화 ─────────
  // content.js가 페이지에서 moa 제어 상태를 cheeseChatMoaActive(배열)로 기록한다.
  const CHAT_MOA_ACTIVE_KEY = "cheeseChatMoaActive";
  function applyChatMoaLock(activeKeys) {
    const locked = new Set(Array.isArray(activeKeys) ? activeKeys : []);
    inputs.forEach((input) => {
      const key = input.dataset.feature;
      if (!key || !key.startsWith("chat")) return;
      const item = input.closest(".settings-item");
      if (locked.has(key)) {
        input.disabled = true;
        item?.classList.add("is-locked");
        item?.setAttribute("title", "배지 모아 챗이 이 기능을 제어 중입니다");
      } else {
        input.disabled = false;
        item?.classList.remove("is-locked");
        item?.removeAttribute("title");
      }
    });
    // 폰트 크기 입력도 moa가 폰트 스케일을 제어 중이면 잠근다.
    if (chatFontScaleInput) {
      const item = chatFontScaleInput.closest(".settings-item");
      if (locked.has("chatFontScale")) {
        chatFontScaleInput.disabled = true;
        item?.classList.add("is-locked");
        item?.setAttribute("title", "배지 모아 챗이 이 기능을 제어 중입니다");
      } else {
        chatFontScaleInput.disabled = false;
        item?.classList.remove("is-locked");
        item?.removeAttribute("title");
      }
    }
  }
  (async () => {
    try {
      const d = await chrome.storage?.local?.get(CHAT_MOA_ACTIVE_KEY);
      applyChatMoaLock(d?.[CHAT_MOA_ACTIVE_KEY]);
    } catch {}
  })();
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[CHAT_MOA_ACTIVE_KEY]) {
      applyChatMoaLock(changes[CHAT_MOA_ACTIVE_KEY].newValue);
    }
  });

  // ── 헤더 바로가기(사이드바 숨김 시 헤더 미니 네비 표시 항목) ───────────────
  // data-feature와 의미가 반대: 체크=표시. 미설정 시 기본 표시 항목은 아래 집합.
  const HEADER_NAV_KEY = "cheeseHeaderNav";
  const HEADER_NAV_DEFAULT_SHOWN = new Set([
    "hdrLives",
    "hdrClips",
    "hdrCategory",
    "hdrFollowing",
  ]);
  const headerNavInputs = Array.from(
    document.querySelectorAll("[data-header-nav]"),
  );

  async function loadHeaderNav() {
    let saved = {};
    try {
      const data = await chrome.storage?.local?.get(HEADER_NAV_KEY);
      const value = data?.[HEADER_NAV_KEY];
      if (value && typeof value === "object") saved = value;
    } catch {}
    headerNavInputs.forEach((input) => {
      const key = input.dataset.headerNav;
      const v = saved[key];
      input.checked =
        typeof v === "boolean" ? v : HEADER_NAV_DEFAULT_SHOWN.has(key);
    });
  }

  function saveHeaderNav() {
    const cfg = {};
    headerNavInputs.forEach((input) => {
      cfg[input.dataset.headerNav] = input.checked;
    });
    try {
      chrome.storage?.local?.set({ [HEADER_NAV_KEY]: cfg });
    } catch {}
  }

  headerNavInputs.forEach((input) =>
    input.addEventListener("change", saveHeaderNav),
  );
  loadHeaderNav();

  // ── 오디오 믹서 항상 켜기(전역) ───────────────────────────────────────────
  // data-feature와 별개 키. 체크=항상 켜기(첫 제스처 후 자동 활성화).
  const MIXER_ALWAYS_ON_KEY = "cheeseMixerAlwaysOn";
  const mixerAlwaysOnInput = document.querySelector("[data-mixer-always-on]");

  async function loadMixerAlwaysOn() {
    let on = false;
    try {
      const data = await chrome.storage?.local?.get(MIXER_ALWAYS_ON_KEY);
      on = data?.[MIXER_ALWAYS_ON_KEY] === true;
    } catch {}
    if (mixerAlwaysOnInput) mixerAlwaysOnInput.checked = on;
  }

  mixerAlwaysOnInput?.addEventListener("change", () => {
    try {
      chrome.storage?.local?.set({
        [MIXER_ALWAYS_ON_KEY]: mixerAlwaysOnInput.checked,
      });
    } catch {}
  });
  loadMixerAlwaysOn();

  // ── 비디오 필터 항상 켜기(전역) ───────────────────────────────────────────
  // 체크=항상 켜기(채널 진입 시 자동 활성화). 채널별로 직접 끄면 그 채널은 유지.
  const VIDEO_FILTER_ALWAYS_ON_KEY = "cheeseVideoFilterAlwaysOn";
  const videoFilterAlwaysOnInput = document.querySelector(
    "[data-video-filter-always-on]",
  );

  async function loadVideoFilterAlwaysOn() {
    let on = false;
    try {
      const data = await chrome.storage?.local?.get(
        VIDEO_FILTER_ALWAYS_ON_KEY,
      );
      on = data?.[VIDEO_FILTER_ALWAYS_ON_KEY] === true;
    } catch {}
    if (videoFilterAlwaysOnInput) videoFilterAlwaysOnInput.checked = on;
  }

  videoFilterAlwaysOnInput?.addEventListener("change", () => {
    try {
      chrome.storage?.local?.set({
        [VIDEO_FILTER_ALWAYS_ON_KEY]: videoFilterAlwaysOnInput.checked,
      });
    } catch {}
  });
  loadVideoFilterAlwaysOn();

  // ── 되감기·앞으로 간격(1~60초, 기본 10) ──────────────────────────────────
  const SEEK_STEP_KEY = "cheeseSeekStepS";
  const seekStepInput = document.querySelector("[data-seek-step]");
  function clampSeekStep(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 10;
    return Math.min(60, Math.max(1, Math.round(n)));
  }
  if (seekStepInput) {
    (async () => {
      try {
        const d = await chrome.storage?.local?.get(SEEK_STEP_KEY);
        seekStepInput.value = String(clampSeekStep(d?.[SEEK_STEP_KEY] ?? 10));
      } catch {
        seekStepInput.value = "10";
      }
    })();
    const save = () => {
      const v = clampSeekStep(seekStepInput.value);
      seekStepInput.value = String(v); // 범위 밖 입력 보정
      try {
        chrome.storage?.local?.set({ [SEEK_STEP_KEY]: v });
      } catch {}
    };
    seekStepInput.addEventListener("change", save);
    seekStepInput.addEventListener("blur", save);
  }

  // ── 채널 라이브 바로가기 버튼(전역, 기본 ON) ──────────────────────────────
  // 체크=표시. 미설정이면 표시(true)가 기본.
  const CHANNEL_LIVE_BUTTON_KEY = "cheeseChannelLiveButton";
  const channelLiveButtonInput = document.querySelector(
    "[data-channel-live-button]",
  );

  async function loadChannelLiveButton() {
    let on = true;
    try {
      const data = await chrome.storage?.local?.get(CHANNEL_LIVE_BUTTON_KEY);
      on = data?.[CHANNEL_LIVE_BUTTON_KEY] !== false; // 미설정/true=표시
    } catch {}
    if (channelLiveButtonInput) channelLiveButtonInput.checked = on;
  }

  channelLiveButtonInput?.addEventListener("change", () => {
    try {
      chrome.storage?.local?.set({
        [CHANNEL_LIVE_BUTTON_KEY]: channelLiveButtonInput.checked,
      });
    } catch {}
  });
  loadChannelLiveButton();

  // 라이브 바로가기 버튼 배치(끝/탭 뒤). 기본 ON(끝).
  const CHANNEL_LIVE_BUTTON_END_KEY = "cheeseChannelLiveButtonEnd";
  const channelLiveButtonEndInput = document.querySelector(
    "[data-channel-live-button-end]",
  );

  async function loadChannelLiveButtonEnd() {
    let on = true;
    try {
      const data = await chrome.storage?.local?.get(
        CHANNEL_LIVE_BUTTON_END_KEY,
      );
      on = data?.[CHANNEL_LIVE_BUTTON_END_KEY] !== false; // 미설정/true=끝
    } catch {}
    if (channelLiveButtonEndInput) channelLiveButtonEndInput.checked = on;
  }

  channelLiveButtonEndInput?.addEventListener("change", () => {
    try {
      chrome.storage?.local?.set({
        [CHANNEL_LIVE_BUTTON_END_KEY]: channelLiveButtonEndInput.checked,
      });
    } catch {}
  });
  loadChannelLiveButtonEnd();

  // ── 팔로잉 라이브 미리보기(전역, 기본 ON) ─────────────────────────────────
  const FOLLOW_PREVIEW_KEY = "cheeseFollowPreview";
  const followPreviewInput = document.querySelector("[data-follow-preview]");

  async function loadFollowPreview() {
    let on = true;
    try {
      const data = await chrome.storage?.local?.get(FOLLOW_PREVIEW_KEY);
      on = data?.[FOLLOW_PREVIEW_KEY] !== false; // 미설정/true=표시
    } catch {}
    if (followPreviewInput) followPreviewInput.checked = on;
  }

  followPreviewInput?.addEventListener("change", () => {
    try {
      chrome.storage?.local?.set({
        [FOLLOW_PREVIEW_KEY]: followPreviewInput.checked,
      });
    } catch {}
  });
  loadFollowPreview();

  // ── 미리보기 음소거 고정(체크=항상 음소거, 해제=항상 소리 켬) ───────────────
  const FOLLOW_PREVIEW_MUTED_KEY = "cheeseFollowPreviewMuted";
  const followPreviewMutedInput = document.querySelector(
    "[data-follow-preview-muted]",
  );
  async function loadFollowPreviewMuted() {
    let muted = true; // 기본 음소거
    try {
      const data = await chrome.storage?.local?.get(FOLLOW_PREVIEW_MUTED_KEY);
      muted = data?.[FOLLOW_PREVIEW_MUTED_KEY] !== false;
    } catch {}
    if (followPreviewMutedInput) followPreviewMutedInput.checked = muted;
  }
  followPreviewMutedInput?.addEventListener("change", () => {
    try {
      chrome.storage?.local?.set({
        [FOLLOW_PREVIEW_MUTED_KEY]: followPreviewMutedInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewMuted();

  // ── 미리보기 썸네일로만 보기(체크=영상 대신 썸네일 이미지) ─────────────────
  const FOLLOW_PREVIEW_THUMB_KEY = "cheeseFollowPreviewThumbOnly";
  const followPreviewThumbInput = document.querySelector(
    "[data-follow-preview-thumb]",
  );
  async function loadFollowPreviewThumb() {
    let on = false; // 기본 영상
    try {
      const data = await chrome.storage?.local?.get(FOLLOW_PREVIEW_THUMB_KEY);
      on = data?.[FOLLOW_PREVIEW_THUMB_KEY] === true;
    } catch {}
    if (followPreviewThumbInput) followPreviewThumbInput.checked = on;
  }
  followPreviewThumbInput?.addEventListener("change", () => {
    try {
      chrome.storage?.local?.set({
        [FOLLOW_PREVIEW_THUMB_KEY]: followPreviewThumbInput.checked,
      });
    } catch {}
  });
  loadFollowPreviewThumb();

  // ── 미리보기 헤더 폰트 크기(입력 80~200%, 저장 배율 0.8~2.0) ────────────────
  const FOLLOW_PREVIEW_HEADER_FONT_KEY = "cheeseFollowPreviewHeaderFont";
  const followHeaderFontInput = document.querySelector(
    "[data-follow-header-font]",
  );
  function clampHeaderFontPct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 100;
    return Math.min(200, Math.max(80, Math.round(n / 5) * 5));
  }
  if (followHeaderFontInput) {
    (async () => {
      try {
        const d = await chrome.storage?.local?.get(FOLLOW_PREVIEW_HEADER_FONT_KEY);
        const scale = Number(d?.[FOLLOW_PREVIEW_HEADER_FONT_KEY]);
        const pct = Number.isFinite(scale) && scale > 0 ? scale * 100 : 100;
        followHeaderFontInput.value = String(clampHeaderFontPct(pct));
      } catch {
        followHeaderFontInput.value = "100";
      }
    })();
    const saveHeaderFont = () => {
      const pct = clampHeaderFontPct(followHeaderFontInput.value);
      followHeaderFontInput.value = String(pct);
      try {
        chrome.storage?.local?.set({
          [FOLLOW_PREVIEW_HEADER_FONT_KEY]: pct / 100,
        });
      } catch {}
    };
    followHeaderFontInput.addEventListener("change", saveHeaderFont);
    followHeaderFontInput.addEventListener("blur", saveHeaderFont);
  }

  // ── 미리보기 자동 종료 시간(30/60/120/180/300초, 상한 5분) ─────────────────
  const FOLLOW_PREVIEW_MAXLIFE_KEY = "cheeseFollowPreviewMaxLifeSec";
  const FOLLOW_PREVIEW_MAXLIFE_ALLOWED = [30, 60, 120, 180, 300];
  const FOLLOW_PREVIEW_MAXLIFE_DEFAULT = 120;
  // 3분 이상은 '장시간 시청' 소지가 있어 고지(차단은 안 함).
  const FOLLOW_PREVIEW_MAXLIFE_NOTICE_AT = 180;
  const maxLifeButtons = Array.from(
    document.querySelectorAll("[data-follow-maxlife]"),
  );
  const maxLifeGroup = document.getElementById("followPreviewMaxLife");

  function showMaxLifeNotice(sec) {
    let el = document.getElementById("followPreviewMaxLifeNotice");
    if (sec < FOLLOW_PREVIEW_MAXLIFE_NOTICE_AT) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("p");
      el.id = "followPreviewMaxLifeNotice";
      el.className = "settings-notice";
      maxLifeGroup?.insertAdjacentElement("afterend", el);
    }
    const min = Math.round(sec / 60);
    el.textContent = `미리보기는 짧은 확인용입니다. ${min}분처럼 길게 두면 본방 시청 대체가 될 수 있으니 오래 보려면 라이브 채널을 이용해 주세요.`;
  }

  function reflectMaxLife(sec) {
    const v = FOLLOW_PREVIEW_MAXLIFE_ALLOWED.includes(Number(sec))
      ? Number(sec)
      : FOLLOW_PREVIEW_MAXLIFE_DEFAULT;
    maxLifeButtons.forEach((btn) => {
      const active = Number(btn.dataset.followMaxlife) === v;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    showMaxLifeNotice(v);
  }

  async function loadMaxLife() {
    let sec = FOLLOW_PREVIEW_MAXLIFE_DEFAULT;
    try {
      const data = await chrome.storage?.local?.get(FOLLOW_PREVIEW_MAXLIFE_KEY);
      const v = Number(data?.[FOLLOW_PREVIEW_MAXLIFE_KEY]);
      if (FOLLOW_PREVIEW_MAXLIFE_ALLOWED.includes(v)) sec = v;
    } catch {}
    reflectMaxLife(sec);
  }

  maxLifeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = Number(btn.dataset.followMaxlife);
      reflectMaxLife(sec);
      try {
        chrome.storage?.local?.set({ [FOLLOW_PREVIEW_MAXLIFE_KEY]: sec });
      } catch {}
    });
  });
  loadMaxLife();

  // ── 카드 미리보기 음량(라이브 탐색 카드 호버 video, 전역 기본 ON) ──────────
  const CARD_PREVIEW_AUDIO_KEY = "cheeseCardPreviewAudio";
  const cardPreviewAudioInput = document.querySelector(
    "[data-card-preview-audio]",
  );

  async function loadCardPreviewAudio() {
    let on = true;
    try {
      const data = await chrome.storage?.local?.get(CARD_PREVIEW_AUDIO_KEY);
      on = data?.[CARD_PREVIEW_AUDIO_KEY] !== false; // 미설정/true=표시
    } catch {}
    if (cardPreviewAudioInput) cardPreviewAudioInput.checked = on;
  }

  cardPreviewAudioInput?.addEventListener("change", () => {
    try {
      chrome.storage?.local?.set({
        [CARD_PREVIEW_AUDIO_KEY]: cardPreviewAudioInput.checked,
      });
    } catch {}
  });
  loadCardPreviewAudio();

  // ── 실시간 따라잡기 민감도 프리셋(low/normal/high/custom) ──────────────────
  const SYNC_PRESET_KEY = "cheeseSyncPreset";
  const SYNC_CUSTOM_KEY = "cheeseSyncCustom"; // {enable, target}
  const SYNC_CUSTOM_DEFAULT = { enable: 3, target: 2 };
  const syncButtons = Array.from(
    document.querySelectorAll("[data-sync-preset]"),
  );
  const syncCustomRow = document.getElementById("syncCustomRow");
  const syncCustomEnable = document.getElementById("syncCustomEnable");
  const syncCustomTarget = document.getElementById("syncCustomTarget");

  const clamp = (n, min, max, fallback) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  };

  function reflectSyncPreset(value) {
    const preset =
      value === "low" ||
      value === "normal" ||
      value === "high" ||
      value === "custom"
        ? value
        : "normal";
    syncButtons.forEach((btn) => {
      const active = btn.dataset.syncPreset === preset;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    if (syncCustomRow) syncCustomRow.hidden = preset !== "custom";
  }

  // 커스텀 입력값을 정규화(목표 1~10, 시작 2~30, 시작 > 목표)하고 저장.
  function saveSyncCustom() {
    let target = clamp(
      syncCustomTarget?.value,
      1,
      10,
      SYNC_CUSTOM_DEFAULT.target,
    );
    let enable = clamp(
      syncCustomEnable?.value,
      2,
      30,
      SYNC_CUSTOM_DEFAULT.enable,
    );
    if (enable <= target) enable = Math.min(30, target + 0.5);
    if (syncCustomTarget) syncCustomTarget.value = String(target);
    if (syncCustomEnable) syncCustomEnable.value = String(enable);
    try {
      chrome.storage?.local?.set({ [SYNC_CUSTOM_KEY]: { enable, target } });
    } catch {}
  }

  async function loadSyncPreset() {
    let value = "normal";
    let custom = { ...SYNC_CUSTOM_DEFAULT };
    try {
      const data = await chrome.storage?.local?.get([
        SYNC_PRESET_KEY,
        SYNC_CUSTOM_KEY,
      ]);
      if (data?.[SYNC_PRESET_KEY]) value = data[SYNC_PRESET_KEY];
      const c = data?.[SYNC_CUSTOM_KEY];
      if (c && typeof c === "object") {
        custom = {
          enable: clamp(c.enable, 2, 30, SYNC_CUSTOM_DEFAULT.enable),
          target: clamp(c.target, 1, 10, SYNC_CUSTOM_DEFAULT.target),
        };
      }
    } catch {}
    if (syncCustomEnable) syncCustomEnable.value = String(custom.enable);
    if (syncCustomTarget) syncCustomTarget.value = String(custom.target);
    reflectSyncPreset(value);
  }

  syncButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.syncPreset;
      reflectSyncPreset(value);
      try {
        chrome.storage?.local?.set({ [SYNC_PRESET_KEY]: value });
      } catch {}
      // 커스텀 선택 시 현재 입력값도 함께 저장(이전 값이 없으면 기본값 기록).
      if (value === "custom") saveSyncCustom();
    });
  });
  // 커스텀 입력 변경은 즉시 정규화 후 저장(blur/change 시).
  [syncCustomEnable, syncCustomTarget].forEach((el) =>
    el?.addEventListener("change", saveSyncCustom),
  );
  loadSyncPreset();

  // ── 팔로우 채널 자동 갱신(0=끔/30/60초 프리셋 + 커스텀 3~600초) ────────────
  const FOLLOW_REFRESH_KEY = "cheeseFollowRefreshSec";
  const FOLLOW_PRESETS = [0, 30, 60];
  const FOLLOW_CUSTOM_DEFAULT = 5;
  const followRefreshButtons = Array.from(
    document.querySelectorAll("[data-follow-refresh]"),
  );
  const followCustomRow = document.getElementById("followCustomRow");
  const followCustomSec = document.getElementById("followCustomSec");

  // 저장된 초 값(0 또는 3~600)을 보고 어떤 버튼이 활성인지 결정한다. 프리셋 값과
  // 정확히 같으면 그 프리셋, 아니면(끔 제외) 커스텀.
  function reflectFollowRefresh(secRaw) {
    let sec = Number(secRaw);
    if (!Number.isFinite(sec) || sec <= 0) sec = 0;
    const isPreset = FOLLOW_PRESETS.includes(sec);
    const activeKey = sec === 0 ? "0" : isPreset ? String(sec) : "custom";
    followRefreshButtons.forEach((btn) => {
      const active = btn.dataset.followRefresh === activeKey;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    if (followCustomRow) followCustomRow.hidden = activeKey !== "custom";
  }

  function saveFollowCustom() {
    let sec = clamp(followCustomSec?.value, 3, 600, FOLLOW_CUSTOM_DEFAULT);
    sec = Math.round(sec);
    if (followCustomSec) followCustomSec.value = String(sec);
    try {
      chrome.storage?.local?.set({ [FOLLOW_REFRESH_KEY]: sec });
    } catch {}
  }

  async function loadFollowRefresh() {
    let sec = 0;
    try {
      const data = await chrome.storage?.local?.get(FOLLOW_REFRESH_KEY);
      if (data?.[FOLLOW_REFRESH_KEY] != null) sec = data[FOLLOW_REFRESH_KEY];
    } catch {}
    // 커스텀 입력칸 초기값: 저장값이 커스텀 범위면 그 값, 아니면 기본.
    const n = Number(sec);
    const customInit =
      Number.isFinite(n) && n >= 3 && n <= 600 && !FOLLOW_PRESETS.includes(n)
        ? Math.round(n)
        : FOLLOW_CUSTOM_DEFAULT;
    if (followCustomSec) followCustomSec.value = String(customInit);
    reflectFollowRefresh(sec);
  }

  followRefreshButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.followRefresh;
      if (key === "custom") {
        reflectFollowRefresh(
          Number(followCustomSec?.value) || FOLLOW_CUSTOM_DEFAULT,
        );
        saveFollowCustom();
      } else {
        const sec = Number(key);
        reflectFollowRefresh(sec);
        try {
          chrome.storage?.local?.set({ [FOLLOW_REFRESH_KEY]: sec });
        } catch {}
      }
    });
  });
  followCustomSec?.addEventListener("change", saveFollowCustom);
  loadFollowRefresh();

  // ── 헤더 팔로우 표시 개수(사이드바+주제 탭 숨김 시 헤더 캐러셀) ────────────
  const HEADER_FOLLOW_COUNT_KEY = "cheeseHeaderFollowCount";
  const HEADER_FOLLOW_COUNT_PRESETS = [3, 5, 7];
  const HEADER_FOLLOW_COUNT_DEFAULT = 5;
  const headerFollowCountButtons = Array.from(
    document.querySelectorAll("[data-header-follow-count]"),
  );
  const headerFollowCountCustomRow = document.getElementById(
    "headerFollowCountCustomRow",
  );
  const headerFollowCountCustom = document.getElementById(
    "headerFollowCountCustom",
  );

  function reflectHeaderFollowCount(countRaw) {
    let count = clamp(countRaw, 1, 10, HEADER_FOLLOW_COUNT_DEFAULT);
    count = Math.round(count);
    const isPreset = HEADER_FOLLOW_COUNT_PRESETS.includes(count);
    const activeKey = isPreset ? String(count) : "custom";
    headerFollowCountButtons.forEach((btn) => {
      const active = btn.dataset.headerFollowCount === activeKey;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    });
    if (headerFollowCountCustomRow) {
      headerFollowCountCustomRow.hidden = activeKey !== "custom";
    }
  }

  function saveHeaderFollowCountCustom() {
    let count = clamp(
      headerFollowCountCustom?.value,
      1,
      10,
      HEADER_FOLLOW_COUNT_DEFAULT,
    );
    count = Math.round(count);
    if (headerFollowCountCustom) headerFollowCountCustom.value = String(count);
    try {
      chrome.storage?.local?.set({ [HEADER_FOLLOW_COUNT_KEY]: count });
    } catch {}
  }

  async function loadHeaderFollowCount() {
    let count = HEADER_FOLLOW_COUNT_DEFAULT;
    try {
      const data = await chrome.storage?.local?.get(HEADER_FOLLOW_COUNT_KEY);
      if (data?.[HEADER_FOLLOW_COUNT_KEY] != null) {
        count = data[HEADER_FOLLOW_COUNT_KEY];
      }
    } catch {}
    const normalized = clamp(count, 1, 10, HEADER_FOLLOW_COUNT_DEFAULT);
    const customInit = HEADER_FOLLOW_COUNT_PRESETS.includes(normalized)
      ? HEADER_FOLLOW_COUNT_DEFAULT
      : Math.round(normalized);
    if (headerFollowCountCustom) {
      headerFollowCountCustom.value = String(customInit);
    }
    reflectHeaderFollowCount(normalized);
  }

  headerFollowCountButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.headerFollowCount;
      if (key === "custom") {
        reflectHeaderFollowCount(
          Number(headerFollowCountCustom?.value) || HEADER_FOLLOW_COUNT_DEFAULT,
        );
        saveHeaderFollowCountCustom();
      } else {
        const count = Number(key);
        reflectHeaderFollowCount(count);
        try {
          chrome.storage?.local?.set({ [HEADER_FOLLOW_COUNT_KEY]: count });
        } catch {}
      }
    });
  });
  headerFollowCountCustom?.addEventListener("change", () => {
    saveHeaderFollowCountCustom();
    reflectHeaderFollowCount(headerFollowCountCustom.value);
  });
  loadHeaderFollowCount();
})();
