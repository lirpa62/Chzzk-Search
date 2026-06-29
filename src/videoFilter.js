// 치즈 서치 - 비디오 필터 (MAIN world content script)
// 치지직 라이브/다시보기 <video>에 화면 보정 필터(밝기/노출/대비/채도/색온도/색조/
// 감마/선명도/그림자/하이라이트)를 적용한다. 오디오 믹서(src/audioMixer.js)와 동일한
// 구조로, 버튼은 오디오 믹서 버튼 옆에 두고 클릭하면 팝오버가 나타난다.
//
// 필터는 두 방식을 조합한다:
//  - CSS filter 함수(brightness/contrast/saturate): 단순 곱연산 보정
//  - SVG filter(feColorMatrix/feComponentTransfer/feConvolveMatrix): 색온도/색조/
//    감마/그림자/하이라이트/선명도처럼 CSS 함수로 표현할 수 없는 보정
// 두 결과를 `filter: <css funcs> url(#svgId)` 형태로 video에 함께 건다.
//
// 설정 저장은 MAIN world에서 chrome.storage 접근이 불가하므로 window.postMessage로
// 일반 content script(src/content.js)에 위임한다(오디오 믹서 브릿지와 동일 패턴).
(() => {
  "use strict";

  if (window.__cheeseVideoFilterLoaded) return;
  window.__cheeseVideoFilterLoaded = true;

  // 팝업 기능 표시/숨김 플래그(content.js가 chrome.storage에서 읽어 postMessage로 전달).
  const featureFlags = { videoFilter: false };
  // 비디오 필터 항상 켜기(전역). 켜져 있으면 채널 설정 로드 후 자동 활성화한다.
  let videoFilterAlwaysOn = false;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "cheese-feature-flags") return;
    featureFlags.videoFilter = e.data.flags?.videoFilter === true;
    videoFilterAlwaysOn = e.data.videoFilterAlwaysOn === true;
    if (typeof tick === "function") tick();
    if (typeof maybeAutoEnableFilter === "function") maybeAutoEnableFilter();
  });
  window.postMessage(
    { source: "cheese-feature-flags-request" },
    location.origin,
  );

  const PANEL_ID = "cheese-video-filter-panel";
  const BUTTON_CLASS = "cheese-video-filter-button";
  const CONTROL_CLASS = "cheese-video-filter-control";
  const SVG_FILTER_ID = "cheese-vf-svg";
  const STYLE_ID = "cheese-vf-applied-style";
  const PANEL_RIGHT_PX = 16;
  const PANEL_BOTTOM_PX = 64;
  const PANEL_TOP_GAP_PX = 12;
  const PANEL_MAX_HEIGHT_PX = 520;
  const PANEL_MIN_HEIGHT_PX = 160;
  const PANEL_ANCHOR_CHECK_MS = 250;
  const PANEL_AUTO_CLOSE_DELAY_MS = 4000;
  const CUSTOM_PRESET_NAME_MAX_LENGTH = 7;
  const PRESET_SHARE_TYPE = "cheese-video-filter-presets";
  const PRESET_SHARE_VERSION = 1;
  // 선명도가 이 값 이상이면 "무거울 수 있음"으로 보고 하드웨어 가속 안내 토스트를 띄운다.
  const SHARPEN_HEAVY_THRESHOLD = 30;
  const TOAST_ID = "cheese-vf-toast";
  const TOAST_DURATION_MS = 7000;
  const SETTINGS_URL = "chrome://settings/system";
  // 선명도 자동 조절(전역 설정, localStorage). 기본 OFF.
  const AUTO_SHARPEN_KEY = "cheeseVideoFilter.autoSharpen";
  // 프레임 드롭 감지 파라미터.
  const FRAME_SAMPLE = 30; // 이 프레임 수 동안의 평균 간격으로 판단
  const FRAME_BUDGET_MS = 22; // 약 45fps 미만이면 느린 것으로 간주
  const FRAME_RECOVER_MS = 17; // 약 59fps 이상이면 회복으로 간주
  const AUTO_STEP = 0.25; // 한 번에 줄이거나 늘리는 effective 배율 폭
  const AUTO_MIN_SCALE = 0; // 최저(선명도 사실상 0까지 감소 허용)
  const AUTO_ADJUST_COOLDOWN_MS = 2500; // 조절 간 최소 간격(진동 방지)

  // 필터 파라미터 정의. 각 항목은 슬라이더 범위와 기본값(중립). neutral은 "보정 없음".
  // 단위 설명:
  //  - brightness/exposure/contrast/saturation: 1.0 = 원본(배율)
  //  - temperature/tint: -100~100 (0 = 중립). 색온도는 따뜻함(+)/차가움(-)
  //  - gamma: 0.5~2.0 (1.0 = 중립). 낮으면 밝게, 높으면 어둡게(중간톤)
  //  - sharpness: 0~100 (0 = 없음)
  //  - shadows/highlights: -100~100 (0 = 중립). 어두운/밝은 영역을 올리고 내림
  const PARAMS = {
    brightness: { label: "밝기", min: 0.3, max: 1.7, step: 0.01, neutral: 1 },
    exposure: { label: "노출", min: 0.3, max: 1.7, step: 0.01, neutral: 1 },
    contrast: { label: "대비", min: 0.3, max: 1.7, step: 0.01, neutral: 1 },
    saturation: { label: "채도", min: 0, max: 2, step: 0.01, neutral: 1 },
    temperature: { label: "색온도", min: -100, max: 100, step: 1, neutral: 0 },
    tint: { label: "색조", min: -100, max: 100, step: 1, neutral: 0 },
    gamma: { label: "감마", min: 0.4, max: 2.2, step: 0.01, neutral: 1 },
    sharpness: { label: "선명도", min: 0, max: 100, step: 1, neutral: 0 },
    shadows: { label: "그림자", min: -100, max: 100, step: 1, neutral: 0 },
    highlights: {
      label: "하이라이트",
      min: -100,
      max: 100,
      step: 1,
      neutral: 0,
    },
  };
  const PARAM_KEYS = Object.keys(PARAMS);

  // 슬라이더 옆 info 아이콘에 띄울 항목 설명.
  const INFO_TEXT = {
    brightness:
      "화면 전체의 밝기입니다. 올리면 영상이 환해지고 내리면 어두워집니다. 너무 올리면 밝은 부분이 하얗게 날아갈 수 있어요.",
    exposure:
      "노출(빛의 양) 보정입니다. 밝기와 비슷하지만 전반적인 빛의 세기를 미세하게 더하거나 빼서 어두운 방송을 살릴 때 유용합니다.",
    contrast:
      "밝은 곳과 어두운 곳의 차이입니다. 올리면 또렷하고 강렬해지고, 내리면 부드럽고 평평해집니다.",
    saturation:
      "색의 진하기(채도)입니다. 올리면 색이 선명하고 화려해지고, 0으로 내리면 흑백이 됩니다.",
    temperature:
      "색온도입니다. 오른쪽(+)으로 갈수록 따뜻한 주황빛, 왼쪽(-)으로 갈수록 차가운 푸른빛이 됩니다. 화이트밸런스 보정에 쓰세요.",
    tint: "색조(틴트)입니다. 초록빛(-)과 자홍빛(+) 사이를 조절해 색온도로 잡히지 않는 색 치우침을 보정합니다.",
    gamma:
      "중간톤의 밝기 곡선입니다. 낮추면 중간 어두운 부분이 밝아지고, 올리면 어두워집니다. 밝기·대비를 건드리지 않고 톤만 조절합니다.",
    sharpness:
      "선명도(샤픈)입니다. 가장자리를 또렷하게 만들어 디테일을 살립니다. 과하면 노이즈와 경계선이 거칠어질 수 있어요. 켰을 때 영상이 버벅이면 브라우저 설정에서 '하드웨어 가속'을 켜 주세요(chrome://settings/system).",
    shadows:
      "어두운 영역의 밝기입니다. 올리면 그림자 속 디테일이 살아나고, 내리면 더 깊고 진한 그림자가 됩니다.",
    highlights:
      "밝은 영역의 밝기입니다. 내리면 하얗게 날아간 밝은 부분을 되살리고, 올리면 더 화사해집니다.",
    "auto-sharpen":
      "영상이 끊기는 게 감지되면 선명도를 자동으로 잠깐 낮추고, 부드러워지면 다시 원래대로 올립니다. 선명도가 높을 때만 동작하며, 끊김이 줄어드는 대신 선명도가 잠깐 약해질 수 있어요.",
  };

  // 아래 공간이 부족한(패널 하단 근처) 항목은 팝오버를 아이콘 위쪽에 띄운다.
  const INFO_ABOVE = new Set([
    "sharpness",
    "shadows",
    "highlights",
    "gamma",
    "auto-sharpen",
  ]);

  function infoIcon(key) {
    return `<button type="button" class="cheese-vf-info" data-info="${key}" aria-label="설명 보기" tabindex="0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"></circle>
        <path d="M12 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        <circle cx="12" cy="7.5" r="1.2" fill="currentColor"></circle>
      </svg>
    </button>`;
  }

  // 중립(보정 없음) 필터 값.
  function neutralFilters() {
    const out = {};
    for (const key of PARAM_KEYS) out[key] = PARAMS[key].neutral;
    return out;
  }

  // 프리셋 정의. 방송 장르별 화면 보정 위주로 구성한다. filters는 PARAMS 키의
  // 부분집합이며, 빠진 키는 중립값으로 채워진다.
  const PRESETS = {
    // 모든 값이 중립(보정 없음)인 원본 상태. 켜도 화면 변화가 없는 게 정상이며,
    // 다른 프리셋에서 보정 없는 상태로 되돌리는 기준점이다.
    default: { label: "원본", filters: {} },
    fps: {
      // FPS 게임: 어두운 구석의 적 식별이 핵심. 그림자를 끌어올리고 감마를 낮춰
      // 암부 디테일을 살리고, 선명도·대비로 윤곽을 또렷하게.
      label: "FPS 게임",
      filters: {
        shadows: 38,
        gamma: 0.8,
        contrast: 1.08,
        sharpness: 45,
        saturation: 1.05,
      },
    },
    moba: {
      // 롤·AOS: 화려한 스킬 이펙트와 UI. 채도·선명도로 색을 살리고 대비로
      // 미니맵·체력바 가독성을 높인다.
      label: "롤·AOS",
      filters: {
        saturation: 1.22,
        contrast: 1.08,
        sharpness: 35,
        brightness: 1.03,
      },
    },
    game: {
      // 일반 게임: 무난하게 생생한 화질. 채도·대비·선명도를 고르게 부스트.
      label: "게임 일반",
      filters: {
        saturation: 1.15,
        contrast: 1.06,
        sharpness: 28,
        brightness: 1.02,
      },
    },
    horror: {
      // 공포 게임: 어두운 화면에서 적·단서 식별이 핵심. 그림자를 강하게 끌어올리고
      // 감마를 낮춰 암부 디테일을 살리되, 분위기 유지를 위해 밝기는 과하지 않게.
      // 선명도로 디테일을, 약간의 대비로 평평해지는 것을 막는다.
      label: "공포 게임",
      filters: {
        shadows: 50,
        gamma: 0.7,
        brightness: 1.06,
        sharpness: 25,
        contrast: 1.05,
      },
    },
    outdoor: {
      // 야외방송: 역광·하늘 날아감 보정. 하이라이트를 내려 밝은 부분을 되살리고
      // 그림자를 올려 어두운 인물을 살린다. 채도로 풍경을 생생하게.
      label: "야외방송",
      filters: {
        highlights: -28,
        shadows: 26,
        saturation: 1.12,
        contrast: 1.04,
        sharpness: 20,
      },
    },
    sports: {
      // 스포츠 중계: 빠른 움직임 + 잔디·유니폼 색. 채도·선명도·대비로 또렷하게,
      // 색온도는 살짝 시원하게 잡아 중계 화면 느낌.
      label: "스포츠",
      filters: {
        saturation: 1.18,
        contrast: 1.1,
        sharpness: 40,
        temperature: -8,
      },
    },
    food: {
      // 먹방·쿡방: 음식이 먹음직스럽게. 따뜻한 색온도 + 채도로 식감을 살리고
      // 밝기를 살짝 올려 화사하게.
      label: "먹방·쿡방",
      filters: {
        temperature: 28,
        saturation: 1.2,
        brightness: 1.05,
        contrast: 1.04,
      },
    },
    cam: {
      // 캠방송(인물): 피부톤이 자연스럽게. 과한 채도·대비를 피하고 살짝 따뜻하게,
      // 그림자를 약간 띄워 얼굴이 부드럽게 보이도록.
      label: "캠방송",
      filters: {
        saturation: 1.06,
        contrast: 0.97,
        temperature: 12,
        shadows: 14,
        highlights: -8,
      },
    },
    vtuber: {
      // 버츄얼 방송: 라이브2D/3D 아바타 색을 자연스럽게 살리되, 쨍하고 밝은 느낌은
      // 피하고 차분하게. 채도·선명도를 과하지 않게 두고 밝기는 원본 유지, 대비를
      // 살짝 낮춰 부드러운 톤으로.
      label: "버츄얼",
      filters: {
        saturation: 1.06,
        sharpness: 12,
        temperature: 6,
        contrast: 0.99,
      },
    },
    night: {
      // 야간 시청: 밝기·대비를 낮추고 색온도를 따뜻하게 해 눈 피로를 줄인다.
      label: "야간 시청",
      filters: {
        brightness: 0.85,
        contrast: 0.95,
        temperature: 28,
        highlights: -20,
      },
    },
    cinema: {
      // 시네마틱: 대비를 올리고 채도를 약간 낮춰 영화 같은 톤. 그림자를 진하게.
      label: "시네마틱",
      filters: {
        contrast: 1.18,
        saturation: 0.9,
        shadows: -18,
        highlights: -10,
        temperature: 12,
      },
    },
  };

  const DEFAULT_STATE = () => ({
    enabled: false,
    preset: "default",
    filters: neutralFilters(),
    customPresets: [],
    userDisabled: false, // 이 채널에서 사용자가 직접 끔(항상 켜기 opt-out)
  });

  let state = DEFAULT_STATE();
  let currentPageKey = null;
  let currentMediaId = null;
  let activeTab = "presets";
  let appliedVideo = null; // 현재 필터가 걸린 video(전환 감지용)

  // 하드웨어 가속 안내 토스트를 이번 세션에 이미 띄웠는지.
  let hwToastShown = false;
  // 선명도 자동 조절(전역, localStorage). 켜면 프레임 드롭 시 effectiveScale를 낮춘다.
  let autoSharpenEnabled = loadAutoSharpen();
  // 자동 조절이 곱하는 선명도 배율(1=원래대로, 0=선명도 없음). 사용자가 설정한
  // state.filters.sharpness는 건드리지 않고, 적용 단계에서만 이 배율을 곱한다.
  let autoSharpenScale = 1;
  // 프레임 간격 측정 상태.
  let frameMon = { raf: 0, last: 0, acc: 0, count: 0, lastAdjustAt: 0 };

  function loadAutoSharpen() {
    try {
      return window.localStorage.getItem(AUTO_SHARPEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  // ── 커스텀 프리셋/공유 상태 ────────────────────────────────────────────────
  let customDraft = null; // { id, name, editing }
  let draftBackup = null; // 드래프트 진입 직전 상태(취소 복원용)
  let customCreatorOpen = false;
  let customDialog = null; // { type:"edit"|"delete", id }
  let customExportOpen = false;
  let customImportOpen = false;
  let customExportSelected = new Set();
  let customImportText = "";
  let customShareMsg = null; // { kind, text }

  // 프리셋에서 벗어나 수정된 상태인지(head에 "프리셋 추가"/"초기화" 표시).
  let presetDirty = false;
  let dirtyFromName = "";
  let dirtyFromKey = "";
  let quickSaveOpen = false;

  // ── 페이지 식별 / 채널id 해석 (오디오 믹서와 동일) ────────────────────────
  function getPageKey() {
    const live = location.pathname.match(/^\/live\/([0-9a-f]{32})/i);
    if (live) return `live:${live[1]}`;
    const vod = location.pathname.match(/^\/video\/(\d+)/);
    if (vod) return `video:${vod[1]}`;
    return null;
  }

  const videoChannelCache = new Map();

  async function fetchChannelIdFromApi(videoNo) {
    try {
      const res = await fetch(
        `https://api.chzzk.naver.com/service/v2/videos/${videoNo}`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!res.ok) return null;
      const json = await res.json();
      const id = json?.content?.channel?.channelId;
      return typeof id === "string" && /^[0-9a-f]{32}$/i.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  async function resolveChannelId(pageKey) {
    if (!pageKey) return null;
    if (pageKey.startsWith("live:")) return pageKey.slice(5);
    if (pageKey.startsWith("video:")) {
      const videoNo = pageKey.slice(6);
      if (videoChannelCache.has(videoNo)) return videoChannelCache.get(videoNo);
      const fromApi = await fetchChannelIdFromApi(videoNo);
      if (fromApi) videoChannelCache.set(videoNo, fromApi);
      return fromApi;
    }
    return null;
  }

  function findPlayer() {
    return (
      document.querySelector(".pzp-pc") ||
      document.querySelector(".webplayer-internal-core") ||
      document
        .querySelector("video")
        ?.closest(".pzp-pc, .webplayer-internal-core, [class*='player']")
    );
  }

  function findVideo() {
    const player = findPlayer();
    return player?.querySelector("video") || document.querySelector("video");
  }

  // ── 필터 적용 ──────────────────────────────────────────────────────────────
  // 색온도/색조 → feColorMatrix의 RGB 채널 곱. 따뜻함은 R↑·B↓, 차가움은 반대.
  // 색조는 G(초록)↔R·B(자홍) 균형. 강도는 ±100을 약 ±0.3 배율 변화로 매핑.
  function temperatureMatrix(temp, tint) {
    const t = temp / 100; // -1..1
    const g = tint / 100; // -1..1
    const rMul = 1 + 0.3 * t - 0.1 * g;
    const gMul = 1 + 0.15 * g;
    const bMul = 1 - 0.3 * t - 0.1 * g;
    // feColorMatrix(type=matrix) 4x5 행렬. 대각선에 채널 배율만 둔다.
    return [
      rMul,
      0,
      0,
      0,
      0,
      0,
      gMul,
      0,
      0,
      0,
      0,
      0,
      bMul,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
    ].join(" ");
  }

  // 그림자/하이라이트 → feComponentTransfer(type=table)의 톤 곡선 제어점.
  // shadows는 곡선의 하단(어두운 입력)을, highlights는 상단(밝은 입력)을 올리고 내린다.
  function toneTable(shadows, highlights) {
    const s = shadows / 100; // -1..1
    const h = highlights / 100; // -1..1
    // 5점 곡선(0, .25, .5, .75, 1)의 y값. 양 끝(0,1)은 고정, 중간을 보정.
    const p1 = clamp01(0.25 + 0.22 * s);
    const p2 = clamp01(0.5 + 0.12 * s + 0.12 * h);
    const p3 = clamp01(0.75 + 0.22 * h);
    return `0 ${round3(p1)} ${round3(p2)} ${round3(p3)} 1`;
  }

  function clamp01(n) {
    return Math.max(0, Math.min(1, n));
  }
  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  // 선명도(언샤프) → feConvolveMatrix 3x3 커널. 강도에 따라 중심/주변 가중 조정.
  function sharpenKernel(amount) {
    const a = amount / 100; // 0..1
    const center = 1 + 4 * a;
    const side = -a;
    return `0 ${round3(side)} 0 ${round3(side)} ${round3(center)} ${round3(side)} 0 ${round3(side)} 0`;
  }

  // 실제 적용할 선명도 = 사용자 설정 × 자동 조절 배율. 자동 조절이 꺼져 있으면
  // autoSharpenScale가 1로 고정되어 사용자 설정 그대로다.
  function effectiveSharpness() {
    return state.filters.sharpness * autoSharpenScale;
  }

  function ensureSvgFilter() {
    let svg = document.getElementById(SVG_FILTER_ID + "-root");
    if (svg) return svg;
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = SVG_FILTER_ID + "-root";
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    svg.style.pointerEvents = "none";
    svg.innerHTML = `<defs><filter id="${SVG_FILTER_ID}" color-interpolation-filters="sRGB"></filter></defs>`;
    document.body.appendChild(svg);
    return svg;
  }

  // 마지막으로 구성한 SVG 필터 내부 마크업(동일하면 재구성 생략 → 불필요한 리플로우 방지).
  let lastSvgInner = "";

  // SVG 필터를 "중립이 아닌 primitive만" 담아 구성한다(색온도/색조/감마/톤/선명도).
  // 선명도는 feConvolveMatrix로 처리한다 — 브라우저 하드웨어 가속이 켜져 있으면 GPU로
  // 돌아 충분히 빠르다(꺼져 있으면 무거우므로 패널에서 안내). canvas 오버레이는 전체화면
  // ·비율 문제를 일으켜 쓰지 않는다.
  function updateSvgFilter() {
    const filter = ensureSvgFilter().querySelector(`#${SVG_FILTER_ID}`);
    if (!filter) return;
    const f = state.filters;
    let inner = "";

    if (f.temperature !== 0 || f.tint !== 0) {
      inner += `<feColorMatrix type="matrix" values="${temperatureMatrix(f.temperature, f.tint)}"></feColorMatrix>`;
    }
    if (f.gamma !== 1) {
      const exp = round3(f.gamma);
      inner += `<feComponentTransfer><feFuncR type="gamma" exponent="${exp}"></feFuncR><feFuncG type="gamma" exponent="${exp}"></feFuncG><feFuncB type="gamma" exponent="${exp}"></feFuncB></feComponentTransfer>`;
    }
    if (f.shadows !== 0 || f.highlights !== 0) {
      const table = toneTable(f.shadows, f.highlights);
      inner += `<feComponentTransfer><feFuncR type="table" tableValues="${table}"></feFuncR><feFuncG type="table" tableValues="${table}"></feFuncG><feFuncB type="table" tableValues="${table}"></feFuncB></feComponentTransfer>`;
    }
    const sharp = effectiveSharpness();
    if (sharp > 0) {
      inner += `<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="${sharpenKernel(sharp)}"></feConvolveMatrix>`;
    }

    if (inner !== lastSvgInner) {
      filter.innerHTML = inner;
      lastSvgInner = inner;
    }
  }

  // CSS filter 함수 문자열. brightness는 밝기·노출을 곱해 합산한다. SVG 보정이
  // 필요하면 url() 필터를 덧붙인다.
  function buildCssFilter() {
    const f = state.filters;
    const brightness = round3(f.brightness * f.exposure);
    const parts = [
      `brightness(${brightness})`,
      `contrast(${round3(f.contrast)})`,
      `saturate(${round3(f.saturation)})`,
    ];
    if (needsSvgFilter()) parts.push(`url(#${SVG_FILTER_ID})`);
    return parts.join(" ");
  }

  // 색온도/색조/감마/톤/선명도 중 하나라도 중립이 아니면 SVG 필터가 필요하다.
  function needsSvgFilter() {
    const f = state.filters;
    return (
      f.temperature !== 0 ||
      f.tint !== 0 ||
      f.gamma !== 1 ||
      f.shadows !== 0 ||
      f.highlights !== 0 ||
      effectiveSharpness() > 0
    );
  }

  // 필터를 video에 적용한다. 모든 보정을 video에 직접 CSS(밝기/대비/채도) + SVG
  // (색온도/색조/감마/톤/선명도)로 건다. canvas 오버레이를 쓰지 않으므로 전체화면·
  // 비율·컨트롤에 영향을 주지 않는다.
  function applyState() {
    const video = findVideo();
    if (!video) return;
    if (!state.enabled) {
      clearFilter(video);
      return;
    }
    // SVG 보정(색온도/감마/톤/선명도)이 필요할 때만 필터를 구성한다(불필요하면 비움).
    if (needsSvgFilter()) updateSvgFilter();
    else clearSvgFilter();
    const css = buildCssFilter();
    video.style.setProperty("filter", css, "important");
    video.classList.add("cheese-vf-target");
    ensureStyleRule(css);
    appliedVideo = video;

    // 선명도가 무거울 수 있는 수준이면 하드웨어 가속 안내(세션 1회) + 자동 조절 모니터.
    if (state.filters.sharpness >= SHARPEN_HEAVY_THRESHOLD) {
      maybeShowHwToast();
      if (autoSharpenEnabled) startFrameMonitor();
      else stopFrameMonitor();
    } else {
      stopFrameMonitor();
      autoSharpenScale = 1; // 무거운 설정이 아니면 자동 감소분 원복
    }
  }

  // SVG 필터 내부를 비운다(primitive 패스 제거 + 캐시 리셋).
  function clearSvgFilter() {
    if (lastSvgInner === "") return;
    const filter = document.querySelector(`#${SVG_FILTER_ID}`);
    if (filter) filter.innerHTML = "";
    lastSvgInner = "";
  }

  // 클래스 셀렉터 규칙으로도 video에 필터를 적용(인라인 style이 지워질 때 대비).
  // 내용이 같으면 textContent를 재대입하지 않는다 — 매 tick 재대입하면 그 DOM
  // 변경이 전역 MutationObserver를 깨워 tick 무한 루프가 된다.
  function ensureStyleRule(css) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    const rule = `video.cheese-vf-target { filter: ${css} !important; }`;
    if (style.textContent !== rule) style.textContent = rule;
  }

  function clearFilter(video) {
    const v = video || appliedVideo || findVideo();
    if (v) {
      v.style.removeProperty("filter");
      v.classList.remove("cheese-vf-target");
    }
    const style = document.getElementById(STYLE_ID);
    if (style) style.textContent = "";
    clearSvgFilter();
    stopFrameMonitor();
    autoSharpenScale = 1;
    appliedVideo = null;
  }

  // ── 하드웨어 가속 안내 토스트 ───────────────────────────────────────────────
  // 선명도가 무거울 수 있는 설정일 때 세션당 1회, 플레이어 위에 안내를 띄운다.
  function maybeShowHwToast() {
    if (hwToastShown) return;
    hwToastShown = true;
    showHwToast();
  }

  function showHwToast() {
    document.getElementById(TOAST_ID)?.remove();
    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "cheese-vf-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `
      <div class="cheese-vf-toast-body">
        <strong>선명도가 높은 필터예요</strong>
        <span>영상이 버벅이면 브라우저 하드웨어 가속을 켜 주세요.<br><code>${SETTINGS_URL}</code></span>
      </div>
      <div class="cheese-vf-toast-actions">
        <button type="button" data-vf-toast-copy>주소 복사</button>
        <button type="button" data-vf-toast-close aria-label="닫기">✕</button>
      </div>`;
    const root = findPlayer() || document.body;
    if (getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    root.appendChild(toast);
    const remove = () => toast.remove();
    toast
      .querySelector("[data-vf-toast-close]")
      ?.addEventListener("click", remove);
    toast.querySelector("[data-vf-toast-copy]")?.addEventListener("click", (e) => {
      copyText(SETTINGS_URL);
      const btn = e.currentTarget;
      btn.textContent = "복사됨!";
      setTimeout(remove, 800);
    });
    window.setTimeout(remove, TOAST_DURATION_MS);
  }

  function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      } else {
        fallbackCopy(text);
      }
    } catch {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    } catch {}
  }

  // ── 선명도 자동 조절(프레임 드롭 감지) ──────────────────────────────────────
  // 브라우저 확장은 CPU 사용률을 직접 못 읽으므로, rAF 프레임 간격으로 버벅임을
  // 추정한다. 느린 상태가 이어지면 autoSharpenScale을 낮춰 선명도를 줄이고, 회복되면
  // 다시 올린다. 사용자가 설정한 state.filters.sharpness는 그대로 둔다.
  function setAutoSharpen(enabled) {
    autoSharpenEnabled = Boolean(enabled);
    try {
      window.localStorage.setItem(AUTO_SHARPEN_KEY, enabled ? "1" : "0");
    } catch {}
    if (!autoSharpenEnabled) {
      autoSharpenScale = 1;
      stopFrameMonitor();
      applyState(); // 원래 선명도로 복원
    } else if (
      state.enabled &&
      state.filters.sharpness >= SHARPEN_HEAVY_THRESHOLD
    ) {
      startFrameMonitor();
    }
    syncUI();
  }

  function startFrameMonitor() {
    if (frameMon.raf) return;
    frameMon.last = 0;
    frameMon.acc = 0;
    frameMon.count = 0;
    const tick = (ts) => {
      frameMon.raf = requestAnimationFrame(tick);
      if (!frameMon.last) {
        frameMon.last = ts;
        return;
      }
      const dt = ts - frameMon.last;
      frameMon.last = ts;
      // 탭 비활성 등으로 생기는 비정상적 큰 간격은 무시(오탐 방지).
      if (dt > 200) return;
      frameMon.acc += dt;
      frameMon.count += 1;
      if (frameMon.count < FRAME_SAMPLE) return;
      const avg = frameMon.acc / frameMon.count;
      frameMon.acc = 0;
      frameMon.count = 0;
      evaluateFrameAvg(avg);
    };
    frameMon.raf = requestAnimationFrame(tick);
  }

  function stopFrameMonitor() {
    if (frameMon.raf) {
      cancelAnimationFrame(frameMon.raf);
      frameMon.raf = 0;
    }
  }

  function evaluateFrameAvg(avg) {
    const now = Date.now();
    if (now - frameMon.lastAdjustAt < AUTO_ADJUST_COOLDOWN_MS) return;
    if (avg > FRAME_BUDGET_MS && autoSharpenScale > AUTO_MIN_SCALE) {
      // 느림 → 선명도를 한 단계 줄인다.
      autoSharpenScale = Math.max(AUTO_MIN_SCALE, autoSharpenScale - AUTO_STEP);
      frameMon.lastAdjustAt = now;
      reapplySharpenOnly();
    } else if (avg < FRAME_RECOVER_MS && autoSharpenScale < 1) {
      // 회복 → 선명도를 한 단계 되돌린다.
      autoSharpenScale = Math.min(1, autoSharpenScale + AUTO_STEP);
      frameMon.lastAdjustAt = now;
      reapplySharpenOnly();
    }
  }

  // 자동 조절로 선명도만 바뀔 때 호출. 전체 applyState 대신 SVG/CSS만 갱신해 가볍게.
  function reapplySharpenOnly() {
    if (!state.enabled) return;
    const video = appliedVideo || findVideo();
    if (!video) return;
    if (needsSvgFilter()) updateSvgFilter();
    else clearSvgFilter();
    const css = buildCssFilter();
    video.style.setProperty("filter", css, "important");
    ensureStyleRule(css);
  }

  function setEnabled(enabled) {
    state.enabled = enabled;
    if (enabled) applyState();
    else clearFilter();
    saveState();
    syncUI();
  }

  // 필터가 활성인데 video가 바뀌었으면(SPA 이동 등) 새 video에 다시 적용.
  function ensureAppliedFilter() {
    if (!state.enabled) return;
    const video = findVideo();
    if (!video) return;
    if (
      video !== appliedVideo ||
      !video.classList.contains("cheese-vf-target")
    ) {
      applyState();
    }
  }

  // 값 조정 시 꺼져 있으면 자동으로 켠다(오디오 믹서 ensureMixerEnabled와 동일 의도).
  function ensureFilterEnabled() {
    if (state.enabled) return;
    state.enabled = true;
    applyState();
  }

  // '항상 켜기'(전역) 자동 활성화. 채널 설정 로드 후/플래그 수신/페이지 전환 시 시도.
  // 사용자가 이 채널에서 직접 끈 경우(userDisabled)는 존중한다. 비디오 필터는
  // CSS/SVG 기반이라 오디오처럼 제스처/AudioContext 게이트가 필요 없다.
  function maybeAutoEnableFilter() {
    if (!videoFilterAlwaysOn) return;
    if (featureFlags.videoFilter) return; // 기능 숨김 상태면 자동 활성 안 함
    if (state.userDisabled) return; // 이 채널은 사용자가 직접 끔(opt-out)
    if (state.enabled) return; // 이미 켜짐
    if (!findVideo()) return; // video 준비 전이면 다음 기회
    setEnabled(true);
  }

  // ── 프리셋 적용/dirty 관리 ─────────────────────────────────────────────────
  function presetSnapshot(p) {
    return { ...neutralFilters(), ...(p?.filters || {}) };
  }

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    ensureFilterEnabled();
    state.preset = key;
    state.filters = presetSnapshot(p);
    clearPresetDirty();
    applyState();
    saveState();
    syncUI();
  }

  function resetToBasePreset() {
    if (!presetDirty || !dirtyFromKey) return;
    const key = dirtyFromKey;
    if (PRESETS[key]) {
      applyPreset(key);
    } else if (isRealPreset(key)) {
      applyCustomPreset(key);
    } else {
      return;
    }
    refreshPanelContent();
  }

  function isRealPreset(key) {
    if (!key || key === "custom") return false;
    if (PRESETS[key]) return true;
    return normalizeCustomPresets(state.customPresets).some(
      (p) => p.id === key,
    );
  }

  function presetDisplayName(key) {
    if (!key || key === "custom") return "";
    if (PRESETS[key]) return PRESETS[key].label;
    const custom = normalizeCustomPresets(state.customPresets).find(
      (p) => p.id === key,
    );
    return custom ? custom.name : "";
  }

  function enterCustomFromEdit() {
    ensureFilterEnabled();
    if (isRealPreset(state.preset)) {
      presetDirty = true;
      dirtyFromKey = state.preset;
      dirtyFromName = presetDisplayName(state.preset);
    }
    state.preset = "custom";
  }

  function clearPresetDirty() {
    presetDirty = false;
    dirtyFromName = "";
    dirtyFromKey = "";
    quickSaveOpen = false;
  }

  function createFiltersSnapshot() {
    return { ...state.filters };
  }

  function baseSnapshotForDirty() {
    if (!dirtyFromKey) return null;
    if (PRESETS[dirtyFromKey]) return presetSnapshot(PRESETS[dirtyFromKey]);
    const custom = normalizeCustomPresets(state.customPresets).find(
      (p) => p.id === dirtyFromKey,
    );
    return custom ? cloneFilters(custom.filters) : null;
  }

  function filtersEqual(a, b) {
    if (!a || !b) return false;
    const EPS = 1e-4;
    for (const key of PARAM_KEYS) {
      if (Math.abs((a[key] ?? 0) - (b[key] ?? 0)) > EPS) return false;
    }
    return true;
  }

  // 수정 후 값이 베이스 프리셋과 같아지면 dirty 해제.
  function reconcileDirtyAgainstBase() {
    if (!presetDirty || !dirtyFromKey) return false;
    const base = baseSnapshotForDirty();
    if (!base || !filtersEqual(createFiltersSnapshot(), base)) return false;
    state.preset = dirtyFromKey;
    clearPresetDirty();
    return true;
  }

  function cloneFilters(filters) {
    const out = neutralFilters();
    for (const key of PARAM_KEYS) {
      const n = Number(filters?.[key]);
      if (Number.isFinite(n)) out[key] = clampParam(key, n);
    }
    return out;
  }

  function clampParam(key, value) {
    const p = PARAMS[key];
    if (!p) return value;
    return Math.max(p.min, Math.min(p.max, value));
  }

  // ── 커스텀 프리셋 ──────────────────────────────────────────────────────────
  function normalizeCustomPresets(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeCustomPreset).filter(Boolean);
  }

  function normalizeCustomPreset(preset) {
    if (!preset || typeof preset !== "object") return null;
    const name = normalizePresetName(preset.name);
    if (!name) return null;
    return {
      id: String(preset.id || createPresetId()),
      name,
      filters: cloneFilters(preset.filters || preset),
    };
  }

  function createPresetId() {
    return `vf-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  function normalizePresetName(value) {
    return String(value || "")
      .trim()
      .slice(0, CUSTOM_PRESET_NAME_MAX_LENGTH);
  }

  function captureDraftBackup() {
    draftBackup = {
      filters: createFiltersSnapshot(),
      preset: state.preset,
      presetDirty,
      dirtyFromName,
      dirtyFromKey,
    };
  }

  function restoreDraftBackup() {
    if (!draftBackup) return;
    state.filters = { ...draftBackup.filters };
    state.preset = draftBackup.preset;
    presetDirty = draftBackup.presetDirty;
    dirtyFromName = draftBackup.dirtyFromName;
    dirtyFromKey = draftBackup.dirtyFromKey;
    draftBackup = null;
    applyState();
  }

  function saveCustomDraft() {
    if (!customDraft) return;
    const name = normalizePresetName(customDraft.name);
    if (!name) return;
    const nextPreset = {
      id: customDraft.id || createPresetId(),
      name,
      filters: createFiltersSnapshot(),
    };
    const presets = normalizeCustomPresets(state.customPresets);
    const index = presets.findIndex((p) => p.id === nextPreset.id);
    if (index >= 0) presets[index] = nextPreset;
    else presets.push(nextPreset);
    state.customPresets = presets;
    state.preset = nextPreset.id;
    customDraft = null;
    draftBackup = null;
    saveState();
    activeTab = "custom";
    refreshPanelContent();
  }

  function cancelCustomDraft() {
    customDraft = null;
    restoreDraftBackup();
    activeTab = "custom";
    refreshPanelContent();
  }

  function openQuickSaveModal() {
    quickSaveOpen = true;
    refreshPanelContent();
    ui?.panel?.querySelector("[data-quicksave-name]")?.focus();
  }

  function closeQuickSaveModal() {
    quickSaveOpen = false;
    refreshPanelContent();
  }

  function confirmQuickSave(panel) {
    const input = panel.querySelector("[data-quicksave-name]");
    const name = normalizePresetName(input?.value);
    if (!name) {
      input?.focus();
      return;
    }
    const nextPreset = {
      id: createPresetId(),
      name,
      filters: createFiltersSnapshot(),
    };
    const presets = normalizeCustomPresets(state.customPresets);
    presets.push(nextPreset);
    state.customPresets = presets;
    state.preset = nextPreset.id;
    quickSaveOpen = false;
    presetDirty = false;
    dirtyFromName = "";
    dirtyFromKey = "";
    saveState();
    refreshPanelContent();
  }

  function applyCustomPreset(id, options = {}) {
    const saved = normalizeCustomPresets(state.customPresets).find(
      (p) => p.id === id,
    );
    if (!saved) return;
    if (!options.keepDraft) ensureFilterEnabled();
    state.filters = cloneFilters(saved.filters);
    state.preset = saved.id;
    clearPresetDirty();
    applyState();
    if (!options.keepDraft) saveState();
    syncUI();
  }

  function deleteCustomPreset(id) {
    state.customPresets = normalizeCustomPresets(state.customPresets).filter(
      (p) => p.id !== id,
    );
    const wasActive = state.preset === id;
    if (customDraft?.id === id) {
      customDraft = null;
      draftBackup = null;
    }
    if (wasActive) {
      // 적용 중이던 커스텀이 삭제됨 → '아무 프리셋도 아닌' 상태로 두면 값 조정 시
      // 추가/초기화 버튼이 안 뜬다. 기본 프리셋으로 되돌려 다시 dirty 추적이 되게 한다.
      applyPreset("default");
    } else {
      saveState();
    }
    refreshPanelContent();
  }

  function openCustomPresetCreator() {
    customCreatorOpen = true;
    refreshPanelContent();
  }

  function closeCustomPresetCreator() {
    customCreatorOpen = false;
    refreshPanelContent();
  }

  function openCustomDialog(type, id) {
    customCreatorOpen = false;
    customDialog = { type, id };
    refreshPanelContent();
  }

  function closeCustomDialog() {
    customDialog = null;
    refreshPanelContent();
  }

  function beginCustomPreset(preset = null) {
    captureDraftBackup();
    const name = normalizePresetName(preset?.name);
    customDraft = {
      id: preset?.id || createPresetId(),
      name,
      editing: Boolean(preset),
    };
    if (preset) applyCustomPreset(preset.id, { keepDraft: true });
    activeTab = "adjust";
    refreshPanelContent();
  }

  function confirmCustomPresetEdit(panel, id) {
    const preset = normalizeCustomPresets(state.customPresets).find(
      (item) => item.id === id,
    );
    if (!preset) return;
    const name = normalizePresetName(
      panel.querySelector("[data-custom-edit-name]")?.value,
    );
    if (!name) return;
    customDialog = null;
    beginCustomPreset({ ...preset, name });
  }

  function startCustomPresetFromForm(panel) {
    const name = panel.querySelector("[data-custom-new-name]")?.value || "";
    const trimmedName = normalizePresetName(name);
    if (!trimmedName) return;
    captureDraftBackup();
    customDraft = {
      id: createPresetId(),
      name: trimmedName,
      editing: false,
    };
    customCreatorOpen = false;
    activeTab = "adjust";
    refreshPanelContent();
  }

  // ── 내보내기/불러오기 ──────────────────────────────────────────────────────
  function openCustomExport() {
    customImportOpen = false;
    customCreatorOpen = false;
    customDialog = null;
    customShareMsg = null;
    customExportSelected = new Set(
      normalizeCustomPresets(state.customPresets).map((p) => p.id),
    );
    customExportOpen = true;
    refreshPanelContent();
  }

  function openCustomImport() {
    customExportOpen = false;
    customCreatorOpen = false;
    customDialog = null;
    customShareMsg = null;
    customImportText = "";
    customImportOpen = true;
    refreshPanelContent();
  }

  function closeCustomShare() {
    customExportOpen = false;
    customImportOpen = false;
    customShareMsg = null;
    refreshPanelContent();
  }

  function toggleExportPick(id, picked) {
    if (picked) customExportSelected.add(id);
    else customExportSelected.delete(id);
    customShareMsg = null;
    refreshPanelContent();
  }

  function toggleExportSelectAll() {
    const presets = normalizeCustomPresets(state.customPresets);
    if (customExportSelected.size === presets.length) {
      customExportSelected = new Set();
    } else {
      customExportSelected = new Set(presets.map((p) => p.id));
    }
    customShareMsg = null;
    refreshPanelContent();
  }

  function buildExportJson() {
    const selected = normalizeCustomPresets(state.customPresets).filter((p) =>
      customExportSelected.has(p.id),
    );
    return JSON.stringify(
      {
        type: PRESET_SHARE_TYPE,
        version: PRESET_SHARE_VERSION,
        presets: selected.map((p) => ({ name: p.name, filters: p.filters })),
      },
      null,
      2,
    );
  }

  async function copyExportJson() {
    if (!customExportSelected.size) return;
    try {
      await copyShareText(buildExportJson());
      customShareMsg = {
        kind: "ok",
        text: `${customExportSelected.size}개 프리셋을 복사했어요. 공유할 곳에 붙여넣으세요.`,
      };
    } catch {
      customShareMsg = {
        kind: "error",
        text: "복사에 실패했어요. 다시 시도해 주세요.",
      };
    }
    refreshPanelContent();
  }

  async function copyShareText(text) {
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

  function confirmCustomImport(panel) {
    const raw = (
      panel.querySelector("[data-import-text]")?.value ?? customImportText
    ).trim();
    customImportText = raw;
    if (!raw) {
      customShareMsg = { kind: "error", text: "붙여넣은 JSON이 비어 있어요." };
      refreshPanelContent();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      customShareMsg = { kind: "error", text: "JSON 형식이 올바르지 않아요." };
      refreshPanelContent();
      return;
    }
    let rawPresets;
    if (Array.isArray(parsed)) {
      rawPresets = parsed;
    } else if (parsed && Array.isArray(parsed.presets)) {
      if (parsed.type && parsed.type !== PRESET_SHARE_TYPE) {
        customShareMsg = {
          kind: "error",
          text: "비디오 필터 프리셋 형식이 아니에요.",
        };
        refreshPanelContent();
        return;
      }
      rawPresets = parsed.presets;
    } else if (parsed && typeof parsed === "object") {
      rawPresets = [parsed];
    } else {
      customShareMsg = { kind: "error", text: "프리셋을 찾을 수 없어요." };
      refreshPanelContent();
      return;
    }
    const valid = rawPresets
      .map((p) =>
        normalizeCustomPreset(
          p && typeof p === "object" ? { ...p, id: createPresetId() } : p,
        ),
      )
      .filter(Boolean);
    if (!valid.length) {
      customShareMsg = {
        kind: "error",
        text: "유효한 프리셋이 없어요. JSON을 다시 확인해 주세요.",
      };
      refreshPanelContent();
      return;
    }
    const existing = normalizeCustomPresets(state.customPresets);
    state.customPresets = [...existing, ...valid];
    saveState();
    customImportOpen = false;
    customImportText = "";
    customShareMsg = {
      kind: "ok",
      text: `${valid.length}개 프리셋을 추가했어요.`,
    };
    refreshPanelContent();
  }

  // ── 설정 저장/복원 (content script에 위임) ───────────────────────────────
  let pendingUserEdit = false;

  function saveState() {
    if (!currentMediaId) {
      pendingUserEdit = true;
      return;
    }
    window.postMessage(
      {
        source: "cheese-video-filter",
        type: "save",
        channelId: currentMediaId,
        state: serializeState(),
      },
      location.origin,
    );
  }

  function serializeState() {
    return {
      enabled: state.enabled,
      preset: state.preset,
      filters: { ...state.filters },
      customPresets: normalizeCustomPresets(state.customPresets),
      userDisabled: state.userDisabled === true,
    };
  }

  function requestState(mediaId) {
    window.postMessage(
      { source: "cheese-video-filter", type: "load", channelId: mediaId },
      location.origin,
    );
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "cheese-video-filter-content")
      return;
    if (e.data.type === "loaded" && e.data.channelId === currentMediaId) {
      const saved = e.data.state;
      if (saved && typeof saved === "object") {
        state = {
          ...DEFAULT_STATE(),
          ...saved,
          filters: cloneFilters(saved.filters),
          customPresets: normalizeCustomPresets(saved.customPresets),
        };
        if (state.enabled) applyState();
        else clearFilter();
        syncUI();
        // 저장된 enabled가 false여도 '항상 켜기'면 자동 활성화(opt-out 채널 제외).
        maybeAutoEnableFilter();
      }
    }
  });

  // ── UI ──────────────────────────────────────────────────────────────────
  let ui = null;
  let panelAnchorTimer = 0;
  let panelAnchorCloseTimer = 0;

  function closeIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path></svg>`;
  }

  function filterIcon() {
    return `
      <svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <circle class="cheese-video-filter-active-dot" cx="28" cy="25" r="3"/>
        <circle cx="15" cy="14" r="6" stroke="currentColor" stroke-width="2.2"/>
        <circle cx="22" cy="20" r="6" stroke="currentColor" stroke-width="2.2"/>
        <path d="M9 26h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      </svg>`;
  }

  function createButtonControl() {
    // 오디오 믹서는 게인 슬라이더가 있어 native 볼륨 컨트롤(.pzp-pc__volume-control)
    // 구조를 쓰지만, 비디오 필터는 슬라이더가 없으므로 스트림 정보 버튼과 같은
    // 단순 설정 버튼(.pzp-pc__setting-button) 구조를 쓴다. 슬라이더 없이
    // volume-control 구조를 쓰면 native CSS가 폭을 0으로 만들어 버튼이 안 보인다.
    // CONTROL_CLASS와 BUTTON_CLASS를 한 요소에 함께 둬 기존 셀렉터들이 그대로
    // 동작하게 한다.
    const btn = document.createElement("button");
    btn.className = `${CONTROL_CLASS} ${BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    btn.setAttribute("aria-label", "비디오 필터");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">비디오 필터</span><span class="pzp-ui-icon">${filterIcon()}</span>`;
    return btn;
  }

  function ensureButton() {
    const controls =
      document.querySelector(".pzp-pc__bottom-buttons-left") ||
      findPlayer()?.querySelector(".pzp-pc__bottom-buttons-left");
    if (!controls) return;
    let wrap = document.querySelector(`.${CONTROL_CLASS}`);
    if (!wrap) {
      wrap = createButtonControl();
    }
    // 오디오 믹서 버튼 바로 뒤(옆)에 둔다. 믹서가 아직 없으면 native 볼륨 뒤,
    // 그것도 없으면 컨트롤 맨 앞.
    const mixerControl = controls.querySelector(".cheese-audio-mixer-control");
    // tick이 매 프레임 부르므로 패널 head를 재생성하는 syncUI 대신 버튼만
    // 가볍게 갱신하는 syncButton을 쓴다(전원 토글 클릭이 삼켜지는 것 방지).
    if (mixerControl) {
      if (wrap.previousElementSibling === mixerControl) {
        syncButton();
        return;
      }
      mixerControl.insertAdjacentElement("afterend", wrap);
    } else {
      const nativeVolume = Array.from(
        controls.querySelectorAll(".pzp-pc__volume-control"),
      ).find(
        (el) =>
          !el.classList.contains(CONTROL_CLASS) &&
          !el.classList.contains("cheese-audio-mixer-control"),
      );
      if (nativeVolume) {
        if (wrap.previousElementSibling === nativeVolume) {
          syncButton();
          return;
        }
        nativeVolume.insertAdjacentElement("afterend", wrap);
      } else {
        if (wrap.parentElement === controls) {
          syncButton();
          return;
        }
        controls.insertBefore(wrap, controls.firstChild);
      }
    }
    syncButton();
  }

  function removeButton() {
    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((el) => el.remove());
  }

  function togglePanel() {
    if (ui?.panel && document.body.contains(ui.panel)) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    closePanel();
    activeTab = "presets";
    customCreatorOpen = false;
    customDialog = null;
    customExportOpen = false;
    customImportOpen = false;
    customShareMsg = null;
    quickSaveOpen = false;
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    const root = getPanelRoot(button) || findPlayer();
    if (!root) {
      setTimeout(() => {
        if (!document.getElementById(PANEL_ID) && getPageKey()) openPanel();
      }, 200);
      return;
    }
    if (getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    root.style.overflow = "visible";
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "cheese-video-filter-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "비디오 필터");
    panel.innerHTML = renderPanel();
    root.appendChild(panel);
    ui = { panel, root };
    keepControlsVisible(root, "vfilter");
    bindPanelEvents(panel);
    positionPanel(panel, root);
    startPanelAnchorMonitor();
    button?.setAttribute("aria-expanded", "true");
    syncUI();
  }

  function closePanel() {
    stopPanelAnchorMonitor();
    closeInfoPopover(ui?.panel);
    releaseControlsVisible("vfilter");
    document.getElementById(PANEL_ID)?.remove();
    document
      .querySelector(`.${BUTTON_CLASS}`)
      ?.setAttribute("aria-expanded", "false");
    ui = null;
  }

  // 컨트롤 자동 숨김 방지 — 오디오 믹서와 같은 클래스를 공유하면 충돌하므로
  // 우리 own observer를 둔다.
  const CONTROLS_CLASS = "pzp-pc--controls";
  let controlsObserver = null;
  let controlsRoot = null;
  const controlsHolders = new Set();

  function keepControlsVisible(root, reason = "panel") {
    controlsHolders.add(reason);
    if (controlsRoot !== root || !controlsObserver) {
      if (controlsObserver) controlsObserver.disconnect();
      controlsRoot = root;
      controlsObserver = new MutationObserver(() => {
        if (controlsRoot && !controlsRoot.classList.contains(CONTROLS_CLASS)) {
          controlsRoot.classList.add(CONTROLS_CLASS);
        }
      });
      controlsObserver.observe(root, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    if (!root.classList.contains(CONTROLS_CLASS)) {
      root.classList.add(CONTROLS_CLASS);
    }
  }

  function releaseControlsVisible(reason = "panel") {
    controlsHolders.delete(reason);
    if (controlsHolders.size > 0) return;
    if (controlsObserver) {
      controlsObserver.disconnect();
      controlsObserver = null;
    }
    controlsRoot = null;
  }

  function refreshPanelContent() {
    const panel = ui?.panel;
    if (!panel) return;
    panel.innerHTML = renderPanel();
    syncUI();
    repositionOpenPanel();
  }

  function getPanelRoot(anchor) {
    return (
      anchor?.closest(".pzp-pc") ||
      anchor?.closest(".webplayer-internal-core") ||
      anchor?.closest("[class*='player']") ||
      findPlayer()
    );
  }

  function startPanelAnchorMonitor() {
    stopPanelAnchorMonitor();
    panelAnchorTimer = window.setInterval(() => {
      if (!isPanelAnchorAvailable()) {
        schedulePanelAnchorClose();
        return;
      }
      clearPanelAnchorCloseTimer();
      repositionOpenPanel();
    }, PANEL_ANCHOR_CHECK_MS);
  }

  function stopPanelAnchorMonitor() {
    if (!panelAnchorTimer) return;
    window.clearInterval(panelAnchorTimer);
    panelAnchorTimer = 0;
    clearPanelAnchorCloseTimer();
  }

  function schedulePanelAnchorClose() {
    if (panelAnchorCloseTimer) return;
    panelAnchorCloseTimer = window.setTimeout(() => {
      panelAnchorCloseTimer = 0;
      if (isPanelAnchorAvailable()) return;
      closePanel();
    }, PANEL_AUTO_CLOSE_DELAY_MS);
  }

  function clearPanelAnchorCloseTimer() {
    if (!panelAnchorCloseTimer) return;
    window.clearTimeout(panelAnchorCloseTimer);
    panelAnchorCloseTimer = 0;
  }

  function isPanelAnchorAvailable() {
    const panel = document.getElementById(PANEL_ID);
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    return (
      Boolean(panel) &&
      button instanceof HTMLElement &&
      document.documentElement.contains(button) &&
      isElementRendered(findVideo())
    );
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

  function positionPanel(panel, root) {
    if (!panel || !root) return;
    const rootRect = root.getBoundingClientRect();
    const viewportAvailableHeight =
      window.innerHeight -
      Math.max(PANEL_TOP_GAP_PX, rootRect.top) -
      PANEL_BOTTOM_PX -
      PANEL_TOP_GAP_PX;
    const rootAvailableHeight =
      rootRect.height - PANEL_BOTTOM_PX - PANEL_TOP_GAP_PX;
    const maxHeight = Math.max(
      PANEL_MIN_HEIGHT_PX,
      Math.min(
        PANEL_MAX_HEIGHT_PX,
        viewportAvailableHeight,
        rootAvailableHeight,
      ),
    );
    panel.style.left = `${PANEL_RIGHT_PX}px`;
    panel.style.bottom = `${PANEL_BOTTOM_PX}px`;
    panel.style.maxHeight = `${Math.floor(maxHeight)}px`;
  }

  function repositionOpenPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const root = getPanelRoot(document.querySelector(`.${BUTTON_CLASS}`));
    if (!root) return;
    positionPanel(panel, root);
  }

  function renderHeadInner() {
    const canReset = presetDirty && Boolean(dirtyFromKey);
    return `
      <strong>비디오 필터</strong>
      ${
        canReset
          ? `<button type="button" class="cheese-vf-reset-button" data-action="preset-reset" title="${escapeAttribute(presetDisplayName(dirtyFromKey))} 값으로 되돌리기">↺ 초기화</button>`
          : ""
      }
      ${
        presetDirty
          ? `<button type="button" class="cheese-vf-quicksave-button" data-action="quicksave-open">+ 프리셋 추가</button>`
          : ""
      }
      <label class="cheese-vf-power" data-tooltip="${state.enabled ? "끄기" : "켜기"}" aria-label="${state.enabled ? "끄기" : "켜기"}">
        <input type="checkbox" data-action="power" ${state.enabled ? "checked" : ""}>
        <i aria-hidden="true"></i>
      </label>
      <button type="button" class="cheese-vf-close" data-action="close" aria-label="닫기">${closeIcon()}</button>`;
  }

  function syncHead() {
    const head = ui?.panel?.querySelector(".cheese-vf-head");
    if (!head) return;
    head.innerHTML = renderHeadInner();
  }

  function renderPanel() {
    const presetButtons = Object.entries(PRESETS)
      .map(
        ([key, p]) =>
          `<button type="button" class="cheese-vf-preset" data-preset="${key}">${p.label}</button>`,
      )
      .join("");

    return `
      <div class="cheese-vf-head">
        ${renderHeadInner()}
      </div>
      <div class="cheese-vf-tabs" role="tablist">
        <button type="button" class="cheese-vf-tab ${activeTab === "presets" ? "is-active" : ""}" data-tab="presets">프리셋</button>
        <button type="button" class="cheese-vf-tab ${activeTab === "custom" ? "is-active" : ""}" data-tab="custom">커스텀</button>
        <button type="button" class="cheese-vf-tab ${activeTab === "adjust" ? "is-active" : ""}" data-tab="adjust">조정</button>
      </div>
      <div class="cheese-vf-body">
        <section class="cheese-vf-pane ${activeTab === "presets" ? "is-active" : ""}" data-pane="presets">
          <p class="cheese-vf-hint">화면 보정 프리셋을 선택하세요.</p>
          <div class="cheese-vf-presets">${presetButtons}</div>
        </section>
        <section class="cheese-vf-pane ${activeTab === "custom" ? "is-active" : ""}" data-pane="custom">
          ${renderCustomPresetPane()}
        </section>
        <section class="cheese-vf-pane ${activeTab === "adjust" ? "is-active" : ""}" data-pane="adjust">
          ${renderCustomDraftBar()}
          ${PARAM_KEYS.map(renderParamRow).join("")}
          <div class="cheese-vf-auto-row">
            <span class="cheese-vf-auto-label">선명도 자동 조절${INFO_TEXT["auto-sharpen"] ? infoIcon("auto-sharpen") : ""}</span>
            <label class="cheese-vf-switch">
              <input type="checkbox" data-action="auto-sharpen-toggle" ${autoSharpenEnabled ? "checked" : ""}>
              <i aria-hidden="true"></i>
            </label>
          </div>
          <button type="button" class="cheese-vf-custom-button cheese-vf-reset-all" data-action="reset-all">모든 값 초기화</button>
        </section>
      </div>
      ${renderQuickSaveModal()}`;
  }

  function renderParamRow(key) {
    const p = PARAMS[key];
    const value = state.filters[key];
    const info = INFO_TEXT[key] ? infoIcon(key) : "";
    return `
      <div class="cheese-vf-row">
        <label class="cheese-vf-row-label">${p.label}${info}</label>
        <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${value}" data-slider="${key}">
        <output data-output="${key}">${fmtParam(key, value)}</output>
      </div>`;
  }

  // 배율형(1.0 중립)은 ×표기, ±형(0 중립)은 부호표기로 보여준다.
  function fmtParam(key, value) {
    const p = PARAMS[key];
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    if (p.neutral === 1) {
      // 배율: 1.00 → "100%"
      return `${Math.round(n * 100)}%`;
    }
    if (p.neutral === 0) {
      const v = Math.round(n);
      return v > 0 ? `+${v}` : String(v);
    }
    return String(Math.round(n * 1000) / 1000);
  }

  function renderQuickSaveModal() {
    if (!quickSaveOpen) return "";
    return `
      <div class="cheese-vf-modal-backdrop" data-action="quicksave-cancel">
        <div class="cheese-vf-modal" role="dialog" aria-label="프리셋 저장" data-modal-stop>
          <strong>커스텀 프리셋 저장</strong>
          <input type="text" data-quicksave-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" placeholder="프리셋 이름" autocomplete="off">
          <div class="cheese-vf-modal-actions">
            <button type="button" class="cheese-vf-custom-button is-primary" data-action="quicksave-confirm">저장</button>
            <button type="button" class="cheese-vf-custom-button" data-action="quicksave-cancel">취소</button>
          </div>
        </div>
      </div>`;
  }

  function renderCustomPresetPane() {
    const presets = normalizeCustomPresets(state.customPresets);
    const list = presets.length
      ? presets.map(renderCustomPresetItem).join("")
      : `<p class="cheese-vf-empty">저장된 커스텀 프리셋이 없습니다.</p>`;
    const hasPresets = presets.length > 0;
    return `
      <div class="cheese-vf-custom-head">
        <button type="button" class="cheese-vf-custom-button is-primary" data-action="custom-new">프리셋 추가</button>
        <button type="button" class="cheese-vf-custom-button" data-action="custom-export-open" ${hasPresets ? "" : "disabled"} title="${hasPresets ? "선택한 프리셋을 JSON으로 복사" : "내보낼 프리셋이 없습니다"}">내보내기</button>
        <button type="button" class="cheese-vf-custom-button" data-action="custom-import-open" title="공유받은 JSON으로 프리셋 추가">불러오기</button>
      </div>
      ${customCreatorOpen ? renderCustomPresetCreator() : ""}
      ${customExportOpen ? renderCustomExport() : ""}
      ${customImportOpen ? renderCustomImport() : ""}
      ${customDialog ? renderCustomDialog() : ""}
      <div class="cheese-vf-custom-list">${list}</div>`;
  }

  function renderCustomExport() {
    const presets = normalizeCustomPresets(state.customPresets);
    const rows = presets
      .map((preset) => {
        const checked = customExportSelected.has(preset.id) ? "checked" : "";
        return `
          <label class="cheese-vf-share-row">
            <input type="checkbox" data-export-pick="${escapeAttribute(preset.id)}" ${checked}>
            <span class="cheese-vf-share-row-name">${escapeHtml(preset.name)}</span>
          </label>`;
      })
      .join("");
    const count = customExportSelected.size;
    return `
      <div class="cheese-vf-share" role="group" aria-label="프리셋 내보내기">
        <div class="cheese-vf-share-head">
          <strong>내보내기</strong>
          <button type="button" class="cheese-vf-share-selectall" data-action="custom-export-selectall">${count === presets.length ? "선택 해제" : "전체 선택"}</button>
        </div>
        <div class="cheese-vf-share-list">${rows}</div>
        ${customShareMsg ? renderShareMsg() : ""}
        <div class="cheese-vf-share-actions">
          <button type="button" class="cheese-vf-custom-button is-primary" data-action="custom-export-copy" ${count ? "" : "disabled"}>JSON 복사 (${count})</button>
          <button type="button" class="cheese-vf-custom-button" data-action="custom-share-close">닫기</button>
        </div>
      </div>`;
  }

  function renderCustomImport() {
    return `
      <div class="cheese-vf-share" role="group" aria-label="프리셋 불러오기">
        <div class="cheese-vf-share-head">
          <strong>불러오기</strong>
        </div>
        <textarea class="cheese-vf-share-input" data-import-text placeholder="공유받은 프리셋 JSON을 붙여넣으세요.">${escapeHtml(customImportText)}</textarea>
        ${customShareMsg ? renderShareMsg() : ""}
        <div class="cheese-vf-share-actions">
          <button type="button" class="cheese-vf-custom-button is-primary" data-action="custom-import-confirm">불러오기</button>
          <button type="button" class="cheese-vf-custom-button" data-action="custom-share-close">닫기</button>
        </div>
      </div>`;
  }

  function renderShareMsg() {
    if (!customShareMsg) return "";
    const cls = customShareMsg.kind === "error" ? "is-error" : "is-ok";
    return `<p class="cheese-vf-share-msg ${cls}">${escapeHtml(customShareMsg.text)}</p>`;
  }

  function renderCustomPresetCreator() {
    return `
      <div class="cheese-vf-custom-creator">
        <input type="text" data-custom-new-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" placeholder="프리셋 이름">
        <button type="button" class="cheese-vf-custom-button is-primary" data-action="custom-create-start">설정 시작</button>
        <button type="button" class="cheese-vf-custom-button" data-action="custom-create-cancel">취소</button>
      </div>`;
  }

  function renderCustomDialog() {
    const preset = normalizeCustomPresets(state.customPresets).find(
      (item) => item.id === customDialog.id,
    );
    if (!preset) return "";
    if (customDialog.type === "edit") {
      return `
        <div class="cheese-vf-custom-dialog">
          <strong>프리셋 이름 수정</strong>
          <input type="text" data-custom-edit-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" value="${escapeAttribute(preset.name)}">
          <div class="cheese-vf-custom-dialog-actions">
            <button type="button" class="cheese-vf-custom-button is-primary" data-action="custom-edit-confirm" data-custom-id="${escapeAttribute(preset.id)}">확인</button>
            <button type="button" class="cheese-vf-custom-button" data-action="custom-dialog-cancel">취소</button>
          </div>
        </div>`;
    }
    return `
      <div class="cheese-vf-custom-dialog">
        <strong>프리셋 삭제</strong>
        <p>${escapeHtml(preset.name)} 프리셋을 삭제할까요?</p>
        <div class="cheese-vf-custom-dialog-actions">
          <button type="button" class="cheese-vf-custom-button is-danger" data-action="custom-delete-confirm" data-custom-id="${escapeAttribute(preset.id)}">삭제</button>
          <button type="button" class="cheese-vf-custom-button" data-action="custom-dialog-cancel">취소</button>
        </div>
      </div>`;
  }

  function renderCustomPresetItem(preset) {
    return `
      <div class="cheese-vf-custom-item">
        <div class="cheese-vf-custom-select ${state.preset === preset.id ? "is-active" : ""}">
          <button type="button" class="cheese-vf-custom-apply" data-action="custom-apply" data-custom-id="${escapeAttribute(preset.id)}">
            <strong>${escapeHtml(preset.name)}</strong>
          </button>
          <div class="cheese-vf-custom-actions">
            <button type="button" class="cheese-vf-custom-icon-button" data-action="custom-edit" data-custom-id="${escapeAttribute(preset.id)}" aria-label="수정">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="m13.7 6.1 4.2 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <button type="button" class="cheese-vf-custom-icon-button is-danger" data-action="custom-delete" data-custom-id="${escapeAttribute(preset.id)}" aria-label="삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3M7 7l1 13h8l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  function renderCustomDraftBar() {
    if (!customDraft) return "";
    return `
      <div class="cheese-vf-draft-bar">
        <div>
          <strong>${escapeHtml(customDraft.name)}</strong>
          <span>${customDraft.editing ? "프리셋 수정 중" : "새 프리셋 설정 중"}</span>
        </div>
        <button type="button" class="cheese-vf-custom-button is-primary" data-action="custom-draft-save">저장</button>
        <button type="button" class="cheese-vf-custom-button" data-action="custom-draft-cancel">취소</button>
      </div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function bindPanelEvents(panel) {
    if (panel.dataset.eventsBound === "1") return;
    panel.dataset.eventsBound = "1";

    panel.addEventListener(
      "scroll",
      (e) => {
        if (e.target.classList?.contains("cheese-vf-body")) {
          closeInfoPopover(panel);
        }
      },
      { passive: true, capture: true },
    );

    panel.addEventListener(
      "keydown",
      (e) => {
        if (isEditableTarget(e.target)) e.stopPropagation();
        if (e.target.matches?.("[data-quicksave-name]")) {
          if (e.key === "Enter") {
            e.preventDefault();
            confirmQuickSave(panel);
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeQuickSaveModal();
          }
        }
      },
      true,
    );
    panel.addEventListener(
      "keyup",
      (e) => {
        if (isEditableTarget(e.target)) e.stopPropagation();
      },
      true,
    );
    panel.addEventListener(
      "keypress",
      (e) => {
        if (isEditableTarget(e.target)) e.stopPropagation();
      },
      true,
    );

    panel.addEventListener("click", (e) => {
      const tab = e.target.closest(".cheese-vf-tab");
      if (tab) {
        switchTab(panel, tab.dataset.tab);
        return;
      }
      const presetBtn = e.target.closest(".cheese-vf-preset");
      if (presetBtn) {
        applyPreset(presetBtn.dataset.preset);
        return;
      }
      const actionButton = e.target.closest(
        "[data-action]:not([type='checkbox'])",
      );
      if (actionButton) {
        const action = actionButton.dataset.action;
        if (
          action === "quicksave-cancel" &&
          actionButton.classList.contains("cheese-vf-modal-backdrop") &&
          e.target.closest("[data-modal-stop]")
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (action === "close") {
          closePanel();
          return;
        }
        if (action === "preset-reset") {
          resetToBasePreset();
          return;
        }
        if (action === "reset-all") {
          resetAllParams();
          return;
        }
        if (action === "quicksave-open") {
          openQuickSaveModal();
          return;
        }
        if (action === "quicksave-confirm") {
          confirmQuickSave(panel);
          return;
        }
        if (action === "quicksave-cancel") {
          closeQuickSaveModal();
          return;
        }
        if (handleCustomPresetAction(panel, actionButton)) {
          return;
        }
      }

      const info = e.target.closest(".cheese-vf-info");
      if (info) {
        e.preventDefault();
        e.stopPropagation();
        toggleInfoPopover(panel, info);
      } else if (!e.target.closest(".cheese-vf-info-popover")) {
        closeInfoPopover(panel);
      }
    });

    panel.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.importText != null) {
        customImportText = t.value;
      } else if (
        t.matches?.(
          "[data-custom-new-name], [data-custom-edit-name], [data-quicksave-name]",
        )
      ) {
        t.value = t.value.slice(0, CUSTOM_PRESET_NAME_MAX_LENGTH);
      } else if (t.dataset.slider) {
        handleSlider(t.dataset.slider, parseFloat(t.value));
        const out = t.closest(".cheese-vf-row")?.querySelector("[data-output]");
        if (out) out.textContent = fmtParam(t.dataset.slider, t.value);
      }
    });

    panel.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.exportPick) {
        toggleExportPick(t.dataset.exportPick, t.checked);
        return;
      }
      if (t.dataset.action === "power") {
        // 사용자가 직접 끄면 이 채널은 '항상 켜기'에서 opt-out(다시 안 켜짐).
        // 다시 켜면 opt-out 해제. setEnabled가 saveState로 함께 저장한다.
        state.userDisabled = !t.checked;
        setEnabled(t.checked);
      } else if (t.dataset.action === "auto-sharpen-toggle") {
        setAutoSharpen(t.checked);
      }
    });
  }

  function isEditableTarget(target) {
    return Boolean(
      target?.closest?.(
        ".cheese-video-filter-panel input, .cheese-video-filter-panel textarea, .cheese-video-filter-panel select",
      ),
    );
  }

  function stopEditableShortcutLeak(e) {
    if (!isEditableTarget(e.target)) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function handleCustomPresetAction(panel, button) {
    const action = button.dataset.action;
    if (!action?.startsWith("custom-")) return false;
    const id = button.dataset.customId;
    if (action === "custom-new") {
      openCustomPresetCreator();
      return true;
    }
    if (action === "custom-export-open") {
      openCustomExport();
      return true;
    }
    if (action === "custom-import-open") {
      openCustomImport();
      return true;
    }
    if (action === "custom-share-close") {
      closeCustomShare();
      return true;
    }
    if (action === "custom-export-selectall") {
      toggleExportSelectAll();
      return true;
    }
    if (action === "custom-export-copy") {
      copyExportJson();
      return true;
    }
    if (action === "custom-import-confirm") {
      confirmCustomImport(panel);
      return true;
    }
    if (action === "custom-create-start") {
      startCustomPresetFromForm(panel);
      return true;
    }
    if (action === "custom-create-cancel") {
      closeCustomPresetCreator();
      return true;
    }
    if (action === "custom-apply" && id) {
      applyCustomPreset(id);
      return true;
    }
    if (action === "custom-edit" && id) {
      openCustomDialog("edit", id);
      return true;
    }
    if (action === "custom-delete" && id) {
      openCustomDialog("delete", id);
      return true;
    }
    if (action === "custom-edit-confirm" && id) {
      confirmCustomPresetEdit(panel, id);
      return true;
    }
    if (action === "custom-delete-confirm" && id) {
      customDialog = null;
      deleteCustomPreset(id);
      return true;
    }
    if (action === "custom-dialog-cancel") {
      closeCustomDialog();
      return true;
    }
    if (action === "custom-draft-save") {
      saveCustomDraft();
      return true;
    }
    if (action === "custom-draft-cancel") {
      cancelCustomDraft();
      return true;
    }
    return false;
  }

  // info 팝오버 ───────────────────────────────────────────────────────────────
  function toggleInfoPopover(panel, infoBtn) {
    const key = infoBtn.dataset.info;
    const existing = document.querySelector(".cheese-vf-info-popover");
    if (existing && existing.dataset.for === key) {
      closeInfoPopover(panel);
      return;
    }
    closeInfoPopover(panel);
    const text = INFO_TEXT[key];
    if (!text) return;

    const pop = document.createElement("div");
    pop.className = "cheese-vf-info-popover";
    pop.dataset.for = key;
    pop.textContent = text;
    document.body.appendChild(pop);

    const iconRect = infoBtn.getBoundingClientRect();
    let left = iconRect.left;
    const maxLeft = window.innerWidth - pop.offsetWidth - 12;
    left = Math.max(8, Math.min(left, Math.max(8, maxLeft)));
    pop.style.left = `${left}px`;

    const spaceBelow = window.innerHeight - iconRect.bottom;
    const above = INFO_ABOVE.has(key) || spaceBelow < pop.offsetHeight + 12;
    if (above) {
      pop.style.top = `${iconRect.top - pop.offsetHeight - 6}px`;
      pop.classList.add("is-above");
    } else {
      pop.style.top = `${iconRect.bottom + 6}px`;
    }
    infoBtn.setAttribute("aria-expanded", "true");
  }

  function closeInfoPopover(panel) {
    const pop = document.querySelector(".cheese-vf-info-popover");
    if (pop) {
      panel
        ?.querySelector(`.cheese-vf-info[data-info="${pop.dataset.for}"]`)
        ?.setAttribute("aria-expanded", "false");
      document
        .querySelector(`.cheese-vf-info[data-info="${pop.dataset.for}"]`)
        ?.setAttribute("aria-expanded", "false");
      pop.remove();
    }
  }

  function handleSlider(key, value) {
    if (!PARAMS[key] || !Number.isFinite(value)) return;
    state.filters[key] = clampParam(key, value);
    // 사용자가 선명도를 직접 조절하면 자동 감소분을 초기화해 설정값을 그대로 반영한다
    // (이후에도 느리면 자동 조절이 다시 줄인다).
    if (key === "sharpness") autoSharpenScale = 1;
    enterCustomFromEdit();
    reconcileDirtyAgainstBase();
    applyState();
    syncPresetSelection();
    syncHead();
    saveState();
  }

  function resetAllParams() {
    state.filters = neutralFilters();
    enterCustomFromEdit();
    reconcileDirtyAgainstBase();
    applyState();
    saveState();
    syncUI();
  }

  function switchTab(panel, name) {
    if (!panel || !name) return;
    activeTab = name;
    customDialog = null;
    customExportOpen = false;
    customImportOpen = false;
    customShareMsg = null;
    closeInfoPopover(panel);
    panel
      .querySelectorAll(".cheese-vf-tab")
      .forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
    panel
      .querySelectorAll(".cheese-vf-pane")
      .forEach((p) => p.classList.toggle("is-active", p.dataset.pane === name));
    syncUI();
  }

  function syncPresetSelection() {
    const panel = ui?.panel;
    if (!panel) return;
    panel
      .querySelectorAll(".cheese-vf-preset")
      .forEach((b) =>
        b.classList.toggle("is-active", b.dataset.preset === state.preset),
      );
    panel.querySelectorAll(".cheese-vf-custom-select").forEach((el) => {
      const id = el.querySelector("[data-action='custom-apply']")?.dataset
        .customId;
      el.classList.toggle("is-active", Boolean(id) && id === state.preset);
    });
  }

  function filterButtonLabel() {
    const base = "비디오 필터";
    if (!state.enabled) return base;
    if (presetDirty) {
      return dirtyFromName
        ? `${base} (수정된 ${dirtyFromName})`
        : `${base} (사용자 설정)`;
    }
    const name = presetDisplayName(state.preset);
    if (name) return `${base} (${name})`;
    return `${base} (사용자 설정)`;
  }

  function syncButtonLabel() {
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    if (!button) return;
    const label = filterButtonLabel();
    // 값이 같으면 쓰지 않는다. ensureButton이 매 프레임(tick) 부르는데, 동일 값을
    // 재대입하면 그 DOM 변경이 documentElement subtree를 보는 모든 MutationObserver
    // (이 확장 + 다른 확장)를 깨워 tick 자가발화 루프 → 재생 버벅임을 만든다.
    if (button.getAttribute("aria-label") !== label) {
      button.setAttribute("aria-label", label);
    }
    const tip = button.querySelector(".pzp-button__tooltip");
    if (tip && tip.textContent !== label) tip.textContent = label;
  }

  // 버튼(플레이어 하단)만 가볍게 동기화. ensureButton이 매 tick 호출하므로
  // 패널 head를 재생성하면(syncHead) 사용자의 전원 토글 클릭이 click→change
  // 2단계 사이에 head가 갈아엎히며 삼켜진다 → 끄기가 동작하지 않는다. 그래서
  // tick 경로에서는 이 함수만 부르고, 패널 갱신(syncUI)은 상태 변경 시에만 부른다.
  function syncButton() {
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    if (!button) return;
    const active = String(state.enabled);
    // 동일 값 재대입 금지(멱등) — 매 tick 무조건 쓰면 옵저버가 깨어나 자가발화한다.
    if (button.classList.contains("is-active") !== state.enabled) {
      button.classList.toggle("is-active", state.enabled);
    }
    if (button.getAttribute("aria-pressed") !== active) {
      button.setAttribute("aria-pressed", active);
    }
    syncButtonLabel();
  }

  function syncUI() {
    syncButton();

    const panel = ui?.panel;
    if (!panel) return;

    syncHead();
    syncPresetSelection();

    panel.querySelectorAll("[data-slider]").forEach((input) => {
      const key = input.dataset.slider;
      const v = state.filters[key];
      if (v == null) return;
      input.value = v;
      const out = input
        .closest(".cheese-vf-row")
        ?.querySelector("[data-output]");
      if (out) out.textContent = fmtParam(key, v);
    });

    const autoToggle = panel.querySelector("[data-action='auto-sharpen-toggle']");
    if (autoToggle) autoToggle.checked = autoSharpenEnabled;
  }

  // 버튼 클릭 위임(document 레벨).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(`.${BUTTON_CLASS}`);
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
      return;
    }
    const panel = ui?.panel;
    if (panel && !e.target.closest?.(`#${PANEL_ID}`)) {
      closePanel();
    }
  });

  window.addEventListener("keydown", stopEditableShortcutLeak, true);
  window.addEventListener("keyup", stopEditableShortcutLeak, true);
  window.addEventListener("keypress", stopEditableShortcutLeak, true);
  window.addEventListener("scroll", () => closeInfoPopover(ui?.panel), true);

  // ── 부트스트랩 ────────────────────────────────────────────────────────────
  function tick() {
    const pageKey = getPageKey();
    if (!pageKey) {
      if (currentPageKey) {
        clearFilter();
        closePanel();
        removeButton();
        currentPageKey = null;
        currentMediaId = null;
      }
      return;
    }
    if (pageKey !== currentPageKey) {
      currentPageKey = pageKey;
      currentMediaId = null;
      pendingUserEdit = false;
      clearFilter();
      state = DEFAULT_STATE();
      customDraft = null;
      draftBackup = null;
      clearPresetDirty();
      resolveAndLoadChannel(pageKey);
    }
    // 팝업 기능 숨김 플래그 반영. 숨김이면 버튼 제거 + 효과 off(state.enabled는 유지).
    if (featureFlags.videoFilter) {
      closePanel();
      removeButton();
      clearFilter();
    } else {
      ensureButton();
      ensureAppliedFilter();
      // video가 늦게 떠도 '항상 켜기'를 시도(채널 로드 후 한 번 + 매 tick 보강).
      maybeAutoEnableFilter();
    }
  }

  async function resolveAndLoadChannel(pageKey) {
    const channelId = await resolveChannelId(pageKey);
    if (currentPageKey !== pageKey) return;
    if (!channelId) return;
    currentMediaId = channelId;
    if (pendingUserEdit) {
      pendingUserEdit = false;
      saveState();
    } else {
      requestState(channelId);
    }
  }

  // observer 콜백에서 tick을 직접 부르면, tick이 일으킨 DOM 변경(버튼 삽입/
  // <style>·<svg> 추가 등)이 다시 콜백을 깨워 동기적으로 폭주할 수 있다. rAF로
  // 디바운스해 프레임당 한 번만 돌게 한다.
  let tickScheduled = false;
  function scheduleTick() {
    if (tickScheduled) return;
    tickScheduled = true;
    requestAnimationFrame(() => {
      tickScheduled = false;
      tick();
    });
  }

  const observer = new MutationObserver(scheduleTick);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  tick();
})();
