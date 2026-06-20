// 치즈 서치 - 오디오 믹서 (MAIN world content script)
// 치지직 라이브 <video>에 Web Audio 그래프를 연결해 컴프레서/노멀라이저/EQ를
// 적용한다. content script(격리 월드)에서는 페이지 <video>의
// MediaElementSource를 만들 수 없으므로 manifest에서 "world": "MAIN"으로 주입된다.
// 설정 저장은 MAIN world에서 chrome.storage 접근이 불가하므로 window.postMessage로
// 일반 content script(src/content.js)에 위임한다.
(() => {
  "use strict";

  if (window.__cheeseAudioMixerLoaded) return;
  window.__cheeseAudioMixerLoaded = true;

  const PANEL_ID = "cheese-audio-mixer-panel";
  const BUTTON_CLASS = "cheese-audio-mixer-button";
  const STATS_PANEL_ID = "cheese-stream-stats-panel";
  const STATS_BUTTON_CLASS = "cheese-stream-stats-button";
  const STATS_REFRESH_MS = 1000;
  // 라이브 싱크 따라잡기 관련
  const SYNC_BUTTON_CLASS = "cheese-live-sync-button";
  const SYNC_CHECK_MS = 1000; // 버튼 활성/비활성 갱신 주기
  const SYNC_ENABLE_LATENCY_S = 3; // 이 지연(초) 이상이면 버튼 활성화
  const SYNC_TARGET_LATENCY_S = 1.8; // 따라잡기 목표 지연(초)
  const SYNC_RATE = 1.5; // 따라잡기 배속
  const SYNC_MAX_DURATION_MS = 30000; // 안전: 최대 따라잡기 시간
  const PANEL_RIGHT_PX = 16;
  const PANEL_BOTTOM_PX = 64;
  const PANEL_TOP_GAP_PX = 12;
  const PANEL_MAX_HEIGHT_PX = 520;
  const PANEL_MIN_HEIGHT_PX = 160;
  const PANEL_ANCHOR_CHECK_MS = 250;
  const PANEL_AUTO_CLOSE_DELAY_MS = 4000;
  const CUSTOM_PRESET_NAME_MAX_LENGTH = 7;
  const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  // 고급 슬라이더(저음/선명도/고음)가 함께 움직이는 EQ 밴드 그룹과 밴드별 가중치.
  // 단일 밴드만 움직이던 방식보다 자연스러운 쉘프 형태가 된다.
  const EQ_GROUPS = {
    bass: { bands: [0, 1, 2], weights: [1, 0.8, 0.5] },
    clarity: { bands: [3, 4, 5], weights: [0.6, 1, 0.7] },
    treble: { bands: [6, 7, 8, 9], weights: [0.5, 0.8, 1, 1] },
  };

  // 고급 슬라이더·전문가 모드 각 항목의 역할/조절 효과 설명(info 아이콘 클릭 시 표시).
  const INFO_TEXT = {
    gain: "전체 음량(볼륨) 배율입니다. 1.0이 원음이며, 높이면 전체가 커지고 낮추면 작아집니다. 너무 높이면 소리가 찢어질 수 있어요.",
    bass: "저음(베이스) 대역을 올리거나 내립니다. 올리면 묵직하고 풍부해지고, 내리면 웅웅거림이 줄어 깔끔해집니다.",
    treble:
      "고음(트레블) 대역을 올리거나 내립니다. 올리면 선명하고 또렷해지지만 과하면 쉬익 소리가 거슬릴 수 있어요.",
    clarity:
      "사람 목소리 대역(중음)을 강조합니다. 올리면 말소리가 또렷하게 앞으로 나오고, 내리면 배경에 묻힙니다.",
    normalizer:
      "음량 균일화. 작은 소리는 키우고 큰 소리는 줄여 전체 음량을 일정하게 맞춥니다. 방송·구간마다 볼륨이 들쭉날쭉할 때 켜면 편합니다.",
    comp: "다이내믹 압축(컴프레서). 큰 소리를 눌러 작은 소리와의 차이를 줄입니다. 갑작스러운 큰 소리를 부드럽게 만들어 듣기 편해집니다.",
    limiter:
      "최대 음량 제한(리미터). 설정한 한계를 넘는 소리를 강하게 막아 갑작스러운 폭발음·고함으로부터 귀를 보호합니다.",
    "comp-threshold":
      "컴프레서가 작동하기 시작하는 음량 기준(dB)입니다. 낮출수록(왼쪽) 더 작은 소리부터 압축이 걸려 효과가 강해집니다.",
    "comp-knee":
      "임계점 부근에서 압축이 얼마나 부드럽게 시작되는지 결정합니다. 값이 클수록 자연스럽게, 작을수록 또렷하게 압축이 걸립니다.",
    "comp-ratio":
      "압축 비율입니다. 기준을 넘은 소리를 얼마나 줄일지 정합니다. 높일수록(예: 12:1) 큰 소리가 강하게 눌립니다.",
    "comp-attack":
      "큰 소리가 들어온 뒤 압축이 걸리기까지의 시간(초)입니다. 짧으면 즉각 반응해 강하게, 길면 초반 타격감을 살립니다.",
    "comp-release":
      "소리가 작아진 뒤 압축이 풀리기까지의 시간(초)입니다. 짧으면 빠르게 원래대로, 길면 부드럽게 돌아옵니다.",
    "comp-makeup":
      "메이크업 게인(dB)입니다. 컴프레서가 큰 소리를 눌러 전체 음량이 작아진 만큼을 다시 키워 원래 체감 음량으로 보정합니다. 컴프를 강하게 걸수록 올려주면 좋습니다.",
    "limiter-threshold":
      "리미터가 막기 시작하는 최대 음량(dB)입니다. 낮출수록 더 일찍 막아 전체 음량이 안정되지만 너무 낮추면 답답해질 수 있어요.",
    "normalizer-target":
      "음량 균일화의 목표 레벨입니다. 높일수록 전체 음량을 더 크게 끌어올려 평준화하고, 낮추면 더 조용한 기준으로 맞춥니다.",
    // 전문가 모드 그룹 제목용 개념 설명
    "group-eq":
      "이퀄라이저(EQ). 소리를 주파수 대역(저음~고음)으로 나눠 각 대역을 키우거나 줄여 음색을 조절합니다. 10개 밴드는 왼쪽이 저음(60Hz), 오른쪽이 고음(16kHz)입니다.",
    "group-gain":
      "음량(게인). 모든 처리를 거치기 전 입력 신호의 전체 크기를 조절합니다. 기본 볼륨이 너무 작거나 클 때 여기서 맞춥니다.",
    "group-comp":
      "컴프레서. 큰 소리를 자동으로 눌러 작은 소리와의 음량 차이(다이내믹 레인지)를 줄입니다. 갑작스러운 큰 소리를 부드럽게 만들어 오래 들어도 편안합니다. 아래 값들로 작동 강도와 반응 속도를 세밀하게 조절합니다.",
    "group-limiter":
      "리미터. 설정한 한계를 넘는 소리를 강하게 막아 그 이상 커지지 않게 합니다. 컴프레서보다 더 강력한 '천장' 역할로, 폭발음·고함 같은 순간적인 큰 소리로부터 귀를 보호합니다.",
    "group-normalizer":
      "노멀라이저(음량 균일화). 실시간으로 소리 크기를 분석해 작은 소리는 키우고 큰 소리는 줄여, 방송이나 구간이 바뀌어도 체감 음량을 일정하게 유지합니다.",
  };

  // 아래 공간이 부족한(패널 하단 근처) 항목은 팝오버를 아이콘 위쪽에 띄운다.
  const INFO_ABOVE = new Set([
    "normalizer",
    "normalizer-target",
    "group-normalizer",
    "comp",
    "limiter",
    "comp-release",
    "limiter-threshold",
  ]);

  function infoIcon(key) {
    return `<button type="button" class="cheese-mixer-info" data-info="${key}" aria-label="설명 보기" tabindex="0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"></circle>
        <path d="M12 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        <circle cx="12" cy="7.5" r="1.2" fill="currentColor"></circle>
      </svg>
    </button>`;
  }

  // 스트리머별 프리셋 정의. 값 단위:
  // - gain: 배율(1 = 원음), eq: 밴드별 dB, comp: WebAudio DynamicsCompressor 파라미터
  // - targetLevel: 노멀라이저 목표 RMS, limiter: 리미터 threshold(dB)
  const PRESETS = {
    default: {
      label: "기본",
      gain: 1,
      eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      normalizer: true,
      targetLevel: 0.12,
      comp: {
        enabled: true,
        threshold: -24,
        knee: 30,
        ratio: 3,
        attack: 0.003,
        release: 0.25,
        makeup: 0,
      },
      limiter: -1,
    },
    voice: {
      // 저챗·라디오: 말소리는 앞으로 두되, 배경음악이 너무 얇아지지 않게
      // 중고역을 완만하게 강조하고 노멀라이저로 방송별 음량 차이를 줄인다.
      label: "저챗·라디오",
      gain: 1,
      eq: [-2, -1.5, -0.5, 1.5, 2, 2.5, 2, 1, 0, -1],
      normalizer: true,
      targetLevel: 0.1,
      comp: {
        enabled: true,
        threshold: -22,
        knee: 30,
        ratio: 3,
        attack: 0.005,
        release: 0.2,
        makeup: 1.5,
      },
      limiter: -1,
    },
    game: {
      // 효과음/총성 다이내믹 압축 + 채팅·게임 음량차 평준화(노멀라이저).
      label: "게임 방송",
      gain: 1,
      eq: [2, 1.6, 1, 0, 1, 2, 2, 1.6, 1, 0.5],
      normalizer: true,
      targetLevel: 0.11,
      comp: {
        enabled: true,
        threshold: -22,
        knee: 24,
        ratio: 6,
        attack: 0.003,
        release: 0.18,
        makeup: 4,
      },
      limiter: -1,
    },
    outdoor: {
      // 야외방송: 바람·잡음 환경 → 저역 컷(웅웅거림/바람소리), 음성 명료도 부스트,
      // 컴프로 음량 안정 + 노멀라이저 강하게.
      label: "야외방송",
      gain: 1.1,
      eq: [-4, -3, -1.5, 1, 3, 2.5, 1.5, 0.5, -0.5, -1],
      normalizer: true,
      targetLevel: 0.13,
      comp: {
        enabled: true,
        threshold: -28,
        knee: 28,
        ratio: 6,
        attack: 0.004,
        release: 0.22,
        makeup: 5,
      },
      limiter: -1,
    },
    music: {
      // 음악 다이내믹은 보존(컴프 약하게), 곡 간 음량차는 노멀라이저로 평준화.
      label: "노래 방송",
      gain: 1,
      eq: [3, 2.4, 1.5, -0.5, 0, 1, 2, 3, 2.4, 1.5],
      normalizer: true,
      targetLevel: 0.09,
      comp: {
        enabled: false,
        threshold: -18,
        knee: 20,
        ratio: 3,
        attack: 0.01,
        release: 0.25,
        makeup: 0,
      },
      limiter: -0.8,
    },
    classical: {
      // 클래식·재즈: 자연스러운 음색과 다이내믹 보존(컴프 약하게), 저역 따뜻함과
      // 고역 공기감만 살짝. 악장·곡 간 음량차는 노멀라이저로 완화.
      label: "클래식·재즈",
      gain: 1,
      eq: [1.5, 1, 0.5, 0, 0, 0.5, 1, 2, 1.5, 1],
      normalizer: true,
      targetLevel: 0.08,
      comp: {
        enabled: false,
        threshold: -18,
        knee: 24,
        ratio: 2,
        attack: 0.02,
        release: 0.4,
        makeup: 0,
      },
      limiter: -1.5,
    },
    movie: {
      // 대사 명료도 위해 중역 보강 + 컴프, 조용한 대사/큰 효과음 차이 완화(노멀라이저).
      label: "영화·드라마",
      gain: 1.1,
      eq: [3, 2, 1, 1.5, 2, 1.5, 1, 1.6, 1, 0.5],
      normalizer: true,
      targetLevel: 0.12,
      comp: {
        enabled: true,
        threshold: -28,
        knee: 30,
        ratio: 6,
        attack: 0.004,
        release: 0.3,
        makeup: 4,
      },
      limiter: -1,
    },
    anime: {
      // 애니: 대사·효과음·BGM 균형. 중역 명료도 보강 + 가벼운 컴프, 노멀라이저로
      // 장면 전환 음량차 완화.
      label: "애니",
      gain: 1.05,
      eq: [1, 0.5, 0, 1, 2, 1.5, 1, 1.5, 1.5, 1],
      normalizer: true,
      targetLevel: 0.11,
      comp: {
        enabled: true,
        threshold: -26,
        knee: 28,
        ratio: 4,
        attack: 0.005,
        release: 0.25,
        makeup: 3,
      },
      limiter: -1,
    },
    sports: {
      // 스포츠: 중계 음성 명료도 + 함성·효과음 다이내믹 압축. 노멀라이저로 평준화.
      label: "스포츠",
      gain: 1,
      eq: [0.5, 0, 0, 1.5, 2.5, 2, 1.5, 1, 0.5, 0],
      normalizer: true,
      targetLevel: 0.12,
      comp: {
        enabled: true,
        threshold: -24,
        knee: 26,
        ratio: 6,
        attack: 0.003,
        release: 0.2,
        makeup: 4,
      },
      limiter: -1,
    },
    asmr: {
      // 작은 소리 증폭(노멀라이저 + 컴프), 고역 디테일 부스트.
      label: "ASMR",
      gain: 1.3,
      eq: [-3, -2.4, -1, 1, 2, 3, 4, 4.8, 4, 3],
      normalizer: true,
      targetLevel: 0.07,
      comp: {
        enabled: true,
        threshold: -36,
        knee: 36,
        ratio: 8,
        attack: 0.006,
        release: 0.25,
        makeup: 6,
      },
      limiter: -1.5,
    },
  };

  const DEFAULT_STATE = () => ({
    enabled: false,
    preset: "default",
    gain: 1,
    eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    comp: { ...PRESETS.default.comp },
    limiter: { enabled: true, threshold: -1 },
    normalizer: { enabled: true, target: 0.12 },
    customPresets: [],
  });

  // ── 오디오 그래프 ────────────────────────────────────────────────────────
  const audio = {
    ctx: null,
    source: null,
    inputGain: null,
    analyser: null, // 노멀라이저용 RMS 측정 탭
    normGain: null, // 노멀라이저가 조정하는 자동 게인
    eqFilters: [],
    comp: null,
    limiter: null,
    outputGain: null,
    video: null,
    connected: false,
    normTimer: 0, // 노멀라이저 분석 루프(rAF) id
  };
  const mediaSourceCache = new WeakMap();

  let state = DEFAULT_STATE();
  let currentPageKey = null; // 현재 페이지 raw 키(live:<id>|video:<no>)
  let currentMediaId = null; // 해석된 채널id(설정 저장/복원 키)
  let activeTab = "presets";
  let customDraft = null;
  let customCreatorOpen = false;
  let customDialog = null;
  // 프리셋(내장/커스텀) 적용 후 값을 수정해 벗어난 상태인지. true면 head에
  // "프리셋 추가" 빠른 저장 버튼이 나타난다.
  let presetDirty = false;
  // 수정이 일어난 탭(advanced/expert). 빠른 저장 시 프리셋 mode로 쓴다.
  let dirtyMode = "advanced";
  // head의 인라인 이름 입력창 열림 여부.
  let quickSaveOpen = false;
  let graphRetryBlock = {
    video: null,
    pageKey: "",
    until: 0,
  };

  // 페이지 식별: 라이브(/live/<channelId>)·다시보기(/video/<videoNo>)에서 URL로
  // 즉시 얻는 raw 키. 채널id 해석(resolveChannelId)의 입력으로 쓴다.
  function getPageKey() {
    const live = location.pathname.match(/^\/live\/([0-9a-f]{32})/i);
    if (live) return `live:${live[1]}`;
    const vod = location.pathname.match(/^\/video\/(\d+)/);
    if (vod) return `video:${vod[1]}`;
    return null;
  }

  // 설정은 채널id로 통일 저장한다(라이브·다시보기 공유). 다시보기 URL엔 채널id가
  // 없는데, 페이지 DOM엔 추천 채널 링크가 섞여 있어 DOM 추출은 신뢰할 수 없다.
  // 따라서 video API로 본 영상의 채널id를 확보한다(videoNo당 1회 캐시).
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

  // pageKey(live:<id> | video:<no>)를 실제 채널id로 해석한다. 라이브는 URL에서
  // 즉시, 다시보기는 video API로. 실패 시 null.
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

  // 그래프: source → inputGain → normGain → [EQ peaking ×10] → comp → limiter → outputGain → destination
  //         analyser는 normGain 입력(inputGain 출력)에서 RMS를 측정해 normGain을 자동 조정한다.
  function buildGraph(video) {
    if (audio.connected && audio.video === video) return true;
    if (isGraphRetryBlocked(video)) return false;
    if (!canStartAudioContext()) return false;
    try {
      audio.ctx ||= new AudioContext();
      if (audio.ctx.state === "suspended") {
        audio.ctx.resume().catch(() => {});
      }

      teardownGraph();

      // createMediaElementSource는 video당 1회만 가능하다. SPA 이동 후 같은
      // video 엘리먼트가 재사용될 수 있으므로 WeakMap으로 source를 재사용한다.
      audio.source = getMediaElementSource(video);
      audio.video = video;

      audio.inputGain = audio.ctx.createGain();
      audio.normGain = audio.ctx.createGain();
      audio.analyser = audio.ctx.createAnalyser();
      audio.analyser.fftSize = 1024;
      audio.analyser.smoothingTimeConstant = 0.8;
      audio.eqFilters = EQ_BANDS.map((freq) => {
        const f = audio.ctx.createBiquadFilter();
        f.type = "peaking";
        f.frequency.value = freq;
        f.Q.value = 1.1;
        f.gain.value = 0;
        return f;
      });
      audio.comp = audio.ctx.createDynamicsCompressor();
      // 리미터도 DynamicsCompressor로 구현(높은 ratio + 빠른 attack)
      audio.limiter = audio.ctx.createDynamicsCompressor();
      audio.limiter.ratio.value = 20;
      audio.limiter.knee.value = 0;
      audio.limiter.attack.value = 0.001;
      audio.limiter.release.value = 0.1;
      audio.outputGain = audio.ctx.createGain();

      // 체인 연결
      let node = audio.source;
      node.disconnect();
      node.connect(audio.inputGain);
      audio.inputGain.connect(audio.normGain);
      audio.inputGain.connect(audio.analyser); // 측정 탭(소리 경로엔 영향 없음)
      node = audio.normGain;
      audio.eqFilters.forEach((f) => {
        node.connect(f);
        node = f;
      });
      node.connect(audio.comp);
      audio.comp.connect(audio.limiter);
      audio.limiter.connect(audio.outputGain);
      audio.outputGain.connect(audio.ctx.destination);

      audio.connected = true;
      applyState();
      startNormalizerLoop();
      clearGraphRetryBlock(video);
      return true;
    } catch (err) {
      console.warn("[치즈 서치 오디오 믹서] 그래프 구성 실패:", err);
      handleGraphBuildFailure(video);
      return false;
    }
  }

  function getMediaElementSource(video) {
    const cached = mediaSourceCache.get(video);
    if (cached) return cached;
    const source = audio.ctx.createMediaElementSource(video);
    mediaSourceCache.set(video, source);
    return source;
  }

  function canStartAudioContext() {
    if (audio.ctx && audio.ctx.state === "running") return true;
    return Boolean(navigator.userActivation?.isActive);
  }

  function isGraphRetryBlocked(video) {
    if (!video) return false;
    if (graphRetryBlock.video !== video) return false;
    if (graphRetryBlock.pageKey !== currentPageKey) return false;
    if (Date.now() < graphRetryBlock.until) return true;
    graphRetryBlock.video = null;
    graphRetryBlock.pageKey = "";
    graphRetryBlock.until = 0;
    return false;
  }

  function clearGraphRetryBlock(video = null) {
    if (video && graphRetryBlock.video !== video) return;
    graphRetryBlock.video = null;
    graphRetryBlock.pageKey = "";
    graphRetryBlock.until = 0;
  }

  function handleGraphBuildFailure(video) {
    stopNormalizerLoop();
    restoreSourceToDestination();
    audio.connected = false;
    audio.video = video || null;
    graphRetryBlock = {
      video,
      pageKey: currentPageKey || "",
      until: Number.POSITIVE_INFINITY,
    };
  }

  function teardownGraph() {
    if (!audio.connected) return;
    stopNormalizerLoop();
    restoreSourceToDestination();
    audio.connected = false;
  }

  function restoreSourceToDestination() {
    try {
      if (!audio.source || !audio.ctx) return;
      audio.source.disconnect();
      audio.source.connect(audio.ctx.destination); // 원음 복구
    } catch {}
  }

  // 노멀라이저: AnalyserNode로 입력 RMS를 측정해 목표 레벨에 맞도록 normGain을
  // 부드럽게(setTargetAtTime) 조정한다. 느린 스무딩으로 펌핑을 방지한다.
  const NORM_TARGET_RMS = 0.12; // 목표 RMS(대략 -18 dBFS 부근)
  const NORM_MAX_GAIN = 4; // 과증폭 방지 상한
  const NORM_MIN_GAIN = 0.25;
  const NORM_SMOOTH = 0.6; // setTargetAtTime 시간상수(초) — 클수록 더 천천히

  function startNormalizerLoop() {
    stopNormalizerLoop();
    const buf = new Float32Array(audio.analyser.fftSize);
    const loop = () => {
      if (!audio.connected) return;
      if (!state.normalizer?.enabled) {
        // 꺼져 있으면 게인 1로 복귀시키고 루프만 유지
        audio.normGain.gain.setTargetAtTime(1, audio.ctx.currentTime, 0.2);
        audio.normTimer = requestAnimationFrame(loop);
        return;
      }
      audio.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (rms > 0.0008) {
        // 무음 구간은 건드리지 않음(노이즈 과증폭 방지)
        const target = state.normalizer.target ?? NORM_TARGET_RMS;
        let desired = target / rms;
        desired = Math.min(NORM_MAX_GAIN, Math.max(NORM_MIN_GAIN, desired));
        audio.normGain.gain.setTargetAtTime(
          desired,
          audio.ctx.currentTime,
          NORM_SMOOTH,
        );
      }
      audio.normTimer = requestAnimationFrame(loop);
    };
    audio.normTimer = requestAnimationFrame(loop);
  }

  function stopNormalizerLoop() {
    if (audio.normTimer) {
      cancelAnimationFrame(audio.normTimer);
      audio.normTimer = 0;
    }
    if (audio.normGain && audio.ctx) {
      try {
        audio.normGain.gain.setTargetAtTime(1, audio.ctx.currentTime, 0.1);
      } catch {}
    }
  }

  function applyState() {
    if (!audio.connected) return;
    audio.inputGain.gain.value = state.gain;
    state.eq.forEach((db, i) => {
      if (audio.eqFilters[i]) audio.eqFilters[i].gain.value = db;
    });
    const c = state.comp;
    // 컴프레서 OFF면 사실상 무압축(threshold 0, ratio 1)
    audio.comp.threshold.value = c.enabled ? c.threshold : 0;
    audio.comp.knee.value = c.knee;
    audio.comp.ratio.value = c.enabled ? c.ratio : 1;
    audio.comp.attack.value = c.attack;
    audio.comp.release.value = c.release;
    // Makeup gain: 컴프로 줄어든 음량을 컴프 뒤(outputGain)에서 보정. dB→배율.
    // 컴프 OFF면 보정하지 않는다(1배).
    const makeupDb = c.enabled ? (c.makeup ?? 0) : 0;
    audio.outputGain.gain.value = Math.pow(10, makeupDb / 20);
    audio.limiter.threshold.value = state.limiter.enabled
      ? state.limiter.threshold
      : 0;
    audio.limiter.ratio.value = state.limiter.enabled ? 20 : 1;
  }

  function setEnabled(enabled) {
    state.enabled = enabled;
    if (enabled) {
      clearGraphRetryBlock();
      const video = findVideo();
      if (!video) {
        state.enabled = false;
        syncUI();
        return;
      }
      buildGraph(video);
    } else {
      teardownGraph();
    }
    saveState();
    syncUI();
  }

  function ensureEnabledGraph() {
    if (!state.enabled || audio.connected) return;
    const video = findVideo();
    if (!video) return;
    buildGraph(video);
    syncUI();
  }

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    const defaultState = DEFAULT_STATE();
    state.preset = key;
    state.gain = p.gain;
    state.eq = [...p.eq];
    state.comp = { ...p.comp };
    state.normalizer = {
      ...defaultState.normalizer,
      enabled: Boolean(p.normalizer),
      target: readFiniteNumber(p.targetLevel, defaultState.normalizer.target),
    };
    state.limiter = normalizePresetLimiter(p.limiter, defaultState.limiter);
    clearPresetDirty();
    applyState();
    saveState();
    syncUI();
  }

  function readFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizePresetLimiter(limiter, fallback) {
    if (limiter === false) {
      return { ...fallback, enabled: false };
    }
    if (typeof limiter === "number") {
      return {
        ...fallback,
        enabled: true,
        threshold: readFiniteNumber(limiter, fallback.threshold),
      };
    }
    if (limiter && typeof limiter === "object") {
      return {
        ...fallback,
        enabled:
          typeof limiter.enabled === "boolean"
            ? limiter.enabled
            : fallback.enabled,
        threshold: readFiniteNumber(limiter.threshold, fallback.threshold),
      };
    }
    return { ...fallback };
  }

  // state.preset이 실제 프리셋(내장 키 또는 커스텀 id)인지. "custom"/빈 값은
  // '아무 프리셋도 아님'을 뜻한다.
  function isRealPreset(key) {
    if (!key || key === "custom") return false;
    if (PRESETS[key]) return true;
    return normalizeCustomPresets(state.customPresets).some(
      (preset) => preset.id === key,
    );
  }

  // 슬라이더/EQ/토글 수정으로 프리셋에서 벗어날 때 호출. 직전이 실제 프리셋이면
  // dirty로 표시해 head에 "프리셋 추가" 버튼을 띄운다.
  function enterCustomFromEdit() {
    if (isRealPreset(state.preset)) presetDirty = true;
    // 저장 mode 판정: 전문가 탭에서 수정한 적이 한 번이라도 있으면 expert로
    // 승격(sticky)하고, 그 외(고급에서만 수정)는 advanced로 둔다. dirtyMode는
    // 프리셋 적용/clear 시 advanced로 리셋된다.
    if (activeTab === "expert") dirtyMode = "expert";
    state.preset = "custom";
  }

  function clearPresetDirty() {
    presetDirty = false;
    quickSaveOpen = false;
    dirtyMode = "advanced";
  }

  function createMixerSnapshot() {
    return {
      gain: state.gain,
      eq: [...state.eq],
      comp: { ...state.comp },
      limiter: { ...state.limiter },
      normalizer: { ...state.normalizer },
    };
  }

  function cloneMixerSnapshot(snapshot) {
    return {
      gain: Number.isFinite(snapshot?.gain) ? snapshot.gain : 1,
      eq: Array.isArray(snapshot?.eq)
        ? [...DEFAULT_STATE().eq].map((value, index) =>
            Number.isFinite(snapshot.eq[index]) ? snapshot.eq[index] : value,
          )
        : [...DEFAULT_STATE().eq],
      comp: { ...DEFAULT_STATE().comp, ...(snapshot?.comp || {}) },
      limiter: { ...DEFAULT_STATE().limiter, ...(snapshot?.limiter || {}) },
      normalizer: {
        ...DEFAULT_STATE().normalizer,
        ...(snapshot?.normalizer || {}),
      },
    };
  }

  function normalizeCustomPresets(value) {
    if (Array.isArray(value)) {
      return value.map(normalizeCustomPreset).filter(Boolean);
    }

    // 1.0.5 개발 중 잠깐 사용했던 advanced/expert 단일 슬롯 구조 마이그레이션.
    if (value && typeof value === "object") {
      return ["advanced", "expert"]
        .filter((mode) => value[mode])
        .map((mode) =>
          normalizeCustomPreset({
            id: createPresetId(),
            name: mode === "advanced" ? "고급 커스텀" : "전문가 커스텀",
            mode,
            snapshot: value[mode],
          }),
        )
        .filter(Boolean);
    }
    return [];
  }

  function normalizeCustomPreset(preset) {
    if (!preset || typeof preset !== "object") return null;
    const mode = preset.mode === "expert" ? "expert" : "advanced";
    const name = normalizePresetName(preset.name);
    if (!name) return null;
    return {
      id: String(preset.id || createPresetId()),
      name,
      mode,
      snapshot: cloneMixerSnapshot(preset.snapshot || preset),
    };
  }

  function createPresetId() {
    return `custom-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  function normalizePresetName(value) {
    return String(value || "")
      .trim()
      .slice(0, CUSTOM_PRESET_NAME_MAX_LENGTH);
  }

  function beginCustomPreset(mode, preset = null) {
    const name = normalizePresetName(preset?.name);
    customDraft = {
      id: preset?.id || createPresetId(),
      name,
      mode: mode === "expert" ? "expert" : "advanced",
      editing: Boolean(preset),
    };
    if (preset) applyCustomPreset(preset.id, { keepDraft: true });
    activeTab = customDraft.mode;
    refreshPanelContent();
  }

  function saveCustomDraft() {
    if (!customDraft) return;
    const name = normalizePresetName(customDraft.name);
    if (!name) return;
    const nextPreset = {
      id: customDraft.id || createPresetId(),
      name,
      mode: customDraft.mode === "expert" ? "expert" : "advanced",
      snapshot: createMixerSnapshot(),
    };
    const presets = normalizeCustomPresets(state.customPresets);
    const index = presets.findIndex((preset) => preset.id === nextPreset.id);
    if (index >= 0) presets[index] = nextPreset;
    else presets.push(nextPreset);
    state.customPresets = presets;
    state.preset = nextPreset.id;
    customDraft = null;
    saveState();
    activeTab = "custom";
    refreshPanelContent();
  }

  function cancelCustomDraft() {
    customDraft = null;
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

  // "프리셋 추가" 빠른 저장: 현재 설정을 그대로 커스텀 프리셋으로 등록한다.
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
      mode: dirtyMode === "expert" ? "expert" : "advanced",
      snapshot: createMixerSnapshot(),
    };
    const presets = normalizeCustomPresets(state.customPresets);
    presets.push(nextPreset);
    state.customPresets = presets;
    state.preset = nextPreset.id;
    quickSaveOpen = false;
    presetDirty = false;
    saveState();
    // 저장된 프리셋이 적용된 상태로 표시 갱신(탭은 그대로 유지).
    refreshPanelContent();
  }

  function applyCustomPreset(id, options = {}) {
    const saved = normalizeCustomPresets(state.customPresets).find(
      (preset) => preset.id === id,
    );
    if (!saved) return;
    const snapshot = cloneMixerSnapshot(saved.snapshot);
    state.gain = snapshot.gain;
    state.eq = snapshot.eq;
    state.comp = snapshot.comp;
    state.limiter = snapshot.limiter;
    state.normalizer = snapshot.normalizer;
    state.preset = saved.id;
    clearPresetDirty();
    applyState();
    if (!options.keepDraft) saveState();
    syncUI();
  }

  function deleteCustomPreset(id) {
    state.customPresets = normalizeCustomPresets(state.customPresets).filter(
      (preset) => preset.id !== id,
    );
    if (state.preset === id) state.preset = "custom";
    if (customDraft?.id === id) customDraft = null;
    saveState();
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
    beginCustomPreset(preset.mode, { ...preset, name });
  }

  function startCustomPresetFromForm(panel) {
    const name = panel.querySelector("[data-custom-new-name]")?.value || "";
    const mode =
      panel.querySelector(".cheese-mixer-mode-option.is-active")?.dataset
        .customNewMode || "advanced";
    const trimmedName = normalizePresetName(name);
    if (!trimmedName) return;
    customDraft = {
      id: createPresetId(),
      name: trimmedName,
      mode: mode === "expert" ? "expert" : "advanced",
      editing: false,
    };
    customCreatorOpen = false;
    activeTab = customDraft.mode;
    refreshPanelContent();
  }

  // ── 설정 저장/복원 (content script에 위임) ───────────────────────────────
  // 채널id 확보 전에 사용자가 설정을 바꿨는지. true면 뒤늦게 도착한 저장 설정을
  // 로드해 현재 변경을 덮어쓰지 않는다.
  let pendingUserEdit = false;

  function saveState() {
    if (!currentMediaId) {
      // 채널id 확보 전 변경 — 확보되면 그때 저장한다.
      pendingUserEdit = true;
      return;
    }
    window.postMessage(
      {
        source: "cheese-audio-mixer",
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
      gain: state.gain,
      eq: [...state.eq],
      comp: { ...state.comp },
      limiter: { ...state.limiter },
      normalizer: { ...state.normalizer },
      customPresets: normalizeCustomPresets(state.customPresets),
    };
  }

  function requestState(mediaId) {
    window.postMessage(
      { source: "cheese-audio-mixer", type: "load", channelId: mediaId },
      location.origin,
    );
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "cheese-audio-mixer-content")
      return;
    if (e.data.type === "loaded" && e.data.channelId === currentMediaId) {
      const saved = e.data.state;
      if (saved && typeof saved === "object") {
        state = {
          ...DEFAULT_STATE(),
          ...saved,
          comp: { ...DEFAULT_STATE().comp, ...(saved.comp || {}) },
          limiter: { ...DEFAULT_STATE().limiter, ...(saved.limiter || {}) },
          normalizer: {
            ...DEFAULT_STATE().normalizer,
            ...(saved.normalizer || {}),
          },
          customPresets: normalizeCustomPresets(saved.customPresets),
        };
        if (state.enabled) ensureEnabledGraph();
        else applyState();
        syncUI();
      }
    }
  });

  // ── UI ──────────────────────────────────────────────────────────────────
  let ui = null;
  let panelAnchorTimer = 0;
  let panelAnchorCloseTimer = 0;

  function mixerIcon() {
    return `
      <svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <circle class="cheese-audio-mixer-active-dot" cx="28" cy="25" r="3"/>
        <path d="M12 9v8m0 4v6M18 9v13m0 4v1M24 9v4m0 4v10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
        <circle cx="12" cy="19" r="2.5" fill="currentColor"/>
        <circle cx="18" cy="24" r="2.5" fill="currentColor"/>
        <circle cx="24" cy="15" r="2.5" fill="currentColor"/>
      </svg>`;
  }

  function createButton() {
    const btn = document.createElement("button");
    // 댓글 타임스탬프 버튼과 동일하게 native 클래스를 사용한다. 이렇게 해야
    // 재생 중 bottom-buttons가 자동으로 숨겨질 때 믹서 버튼도 함께 사라진다.
    btn.className = `${BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    btn.setAttribute("aria-label", "오디오 믹서");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">오디오 믹서</span><span class="pzp-ui-icon">${mixerIcon()}</span>`;
    // 클릭은 document 레벨 이벤트 위임으로 처리한다(아래 참고). 라이브 플레이어가
    // 컨트롤 DOM을 재렌더링하며 버튼을 옮기거나 복제해도 클릭이 끊기지 않는다.
    return btn;
  }

  function ensureButton() {
    // native 왼쪽 컨트롤 그룹에 넣어 자동 숨김/표시에 함께 묶이도록 한다.
    const controls =
      document.querySelector(".pzp-pc__bottom-buttons-left") ||
      findPlayer()?.querySelector(".pzp-pc__bottom-buttons-left");
    if (!controls) return;
    let btn = document.querySelector(`.${BUTTON_CLASS}`);
    if (!btn) {
      btn = createButton();
    }
    const volumeControl = controls.querySelector(".pzp-pc__volume-control");
    if (volumeControl) {
      if (btn.previousElementSibling === volumeControl) return;
      volumeControl.insertAdjacentElement("afterend", btn);
    } else {
      if (btn.parentElement === controls) return;
      controls.insertBefore(btn, controls.firstChild);
    }
    syncUI();
  }

  function removeButton() {
    document
      .querySelectorAll(`.${BUTTON_CLASS}`)
      .forEach((button) => button.remove());
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
    // 이름 입력창은 닫힌 상태로 시작한다(dirty 상태/버튼 표시는 유지).
    quickSaveOpen = false;
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    const root = getPanelRoot(button) || findPlayer();
    if (!root) {
      // 플레이어가 아직 준비되지 않았으면 잠시 후 한 번 더 시도한다.
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
    panel.className = "cheese-audio-mixer-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "오디오 믹서");
    panel.innerHTML = renderPanel();
    // 패널을 플레이어 내부에 absolute로 마운트 → 페이지 스크롤과 무관하게
    // 플레이어 기준으로 고정되고, 전체화면에서도 함께 보인다.
    root.appendChild(panel);
    ui = { panel, root };
    // 패널이 열린 동안 native 컨트롤이 자동으로 숨겨지지 않도록 유지한다.
    keepControlsVisible(root, "mixer");
    bindPanelEvents(panel);
    positionPanel(panel, root);
    startPanelAnchorMonitor();
    button?.setAttribute("aria-expanded", "true");
    syncUI();
  }

  function closePanel() {
    stopPanelAnchorMonitor();
    closeInfoPopover(ui?.panel);
    releaseControlsVisible("mixer");
    document.getElementById(PANEL_ID)?.remove();
    document
      .querySelector(`.${BUTTON_CLASS}`)
      ?.setAttribute("aria-expanded", "false");
    ui = null;
  }

  // 치지직은 마우스 비활성 시 플레이어 루트(.pzp-pc)에서 `pzp-pc--controls`
  // 클래스를 제거해 하단 컨트롤을 숨긴다. 패널이 열린 동안 이 클래스를 강제로
  // 유지하면 native 표시 로직을 그대로 활용해 어떤 숨김 방식이든 막을 수 있다.
  const CONTROLS_CLASS = "pzp-pc--controls";
  let controlsObserver = null;
  let controlsRoot = null;
  // 컨트롤 유지를 요청한 사유들(오디오 패널/스트림 패널/따라잡기 등). 하나라도
  // 있으면 유지하고, 모두 비워지면 해제한다(서로의 유지를 끊지 않도록).
  const controlsHolders = new Set();

  function keepControlsVisible(root, reason = "panel") {
    controlsHolders.add(reason);
    // 루트가 바뀌었거나 observer가 없으면 (재)설정.
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
    if (controlsHolders.size > 0) return; // 아직 유지를 원하는 사유가 남음
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
    bindPanelEvents(panel);
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
    // 버튼이 잠시 숨겨져도(컨트롤 자동 숨김) 패널은 닫지 않는다. 버튼이 DOM에
    // 존재하고 영상이 렌더 중이면 유지한다. (패널 열림 동안엔 컨트롤을 강제
    // 표시하므로 버튼도 보이지만, 전체화면 전환 등 일시적 깜빡임에 대비.)
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

  // head 영역. 프리셋에서 벗어나 수정된 상태(presetDirty)면 "프리셋 추가" 버튼을
  // 보여준다(클릭 시 패널 위 모달로 이름 입력 — renderQuickSaveModal 참고).
  function renderHeadInner() {
    return `
      <strong>오디오 믹서</strong>
      ${
        presetDirty
          ? `<button type="button" class="cheese-mixer-quicksave-button" data-action="quicksave-open">+ 프리셋 추가</button>`
          : ""
      }
      <label class="cheese-mixer-power">
        <input type="checkbox" data-action="power" ${state.enabled ? "checked" : ""}>
        <i aria-hidden="true"></i>
        <span>켜기</span>
      </label>
      <button type="button" class="cheese-mixer-close" data-action="close" aria-label="닫기">✕</button>`;
  }

  // head만 다시 그린다(슬라이더 드래그 중 전체 재렌더를 피하기 위함).
  function syncHead() {
    const head = ui?.panel?.querySelector(".cheese-mixer-head");
    if (!head) return;
    head.innerHTML = renderHeadInner();
  }

  function renderPanel() {
    const presetButtons = Object.entries(PRESETS)
      .map(
        ([key, p]) =>
          `<button type="button" class="cheese-mixer-preset" data-preset="${key}">${p.label}</button>`,
      )
      .join("");
    const eqSliders = EQ_BANDS.map(
      (freq, i) => `
      <div class="cheese-mixer-eq-band">
        <output class="cheese-mixer-eq-value" data-eq-output="${i}">${fmtDb(state.eq[i])}</output>
        <input type="range" min="-12" max="12" step="0.1" value="${state.eq[i]}" data-eq="${i}" orient="vertical">
        <span>${freq >= 1000 ? `${freq / 1000}k` : freq}</span>
      </div>`,
    ).join("");

    return `
      <div class="cheese-mixer-head">
        ${renderHeadInner()}
      </div>
      <div class="cheese-mixer-tabs" role="tablist">
        <button type="button" class="cheese-mixer-tab ${activeTab === "presets" ? "is-active" : ""}" data-tab="presets">프리셋</button>
        <button type="button" class="cheese-mixer-tab ${activeTab === "custom" ? "is-active" : ""}" data-tab="custom">커스텀</button>
        <button type="button" class="cheese-mixer-tab ${activeTab === "advanced" ? "is-active" : ""}" data-tab="advanced">고급</button>
        <button type="button" class="cheese-mixer-tab ${activeTab === "expert" ? "is-active" : ""}" data-tab="expert">전문가</button>
      </div>
      <div class="cheese-mixer-body">
        <section class="cheese-mixer-pane ${activeTab === "presets" ? "is-active" : ""}" data-pane="presets">
          <p class="cheese-mixer-hint">방송 유형에 맞는 음향 프리셋을 선택하세요.</p>
          <div class="cheese-mixer-presets">${presetButtons}</div>
        </section>
        <section class="cheese-mixer-pane ${activeTab === "custom" ? "is-active" : ""}" data-pane="custom">
          ${renderCustomPresetPane()}
        </section>
        <section class="cheese-mixer-pane ${activeTab === "advanced" ? "is-active" : ""}" data-pane="advanced">
          ${renderCustomDraftBar("advanced")}
          ${renderAdvancedRow("음량 (게인)", "gain", 0.5, 2, 0.05, state.gain)}
          ${renderAdvancedRow("저음", "bass", -12, 12, 0.1, state.eq[0])}
          ${renderAdvancedRow("고음", "treble", -12, 12, 0.1, state.eq[8])}
          ${renderAdvancedRow("음성 선명도", "clarity", -12, 12, 0.1, state.eq[4])}
          ${renderToggleRow("음량 균일화 (노멀라이저)", "normalizer", "normalizer-toggle", state.normalizer.enabled)}
          ${renderToggleRow("다이내믹 압축 (컴프레서)", "comp", "comp-toggle", state.comp.enabled)}
          ${renderToggleRow("최대 음량 제한 (리미터)", "limiter", "limiter-toggle", state.limiter.enabled)}
        </section>
        <section class="cheese-mixer-pane ${activeTab === "expert" ? "is-active" : ""}" data-pane="expert">
          ${renderCustomDraftBar("expert")}
          ${groupHeading("이퀄라이저 (10밴드)", "group-eq")}
          <div class="cheese-mixer-eq">${eqSliders}</div>

          ${groupHeading("음량", "group-gain")}
          <div class="cheese-mixer-expert-group">
            ${renderAdvancedRow("음량 (게인)", "gain", 0.5, 2, 0.05, state.gain)}
          </div>

          ${groupHeading("컴프레서", "group-comp")}
          <div class="cheese-mixer-expert-group">
            ${renderAdvancedRow("Threshold (dB)", "comp-threshold", -100, 0, 0.1, state.comp.threshold)}
            ${renderAdvancedRow("Knee (dB)", "comp-knee", 0, 40, 0.1, state.comp.knee)}
            ${renderAdvancedRow("Ratio", "comp-ratio", 1, 20, 0.1, state.comp.ratio)}
            ${renderAdvancedRow("Attack (s)", "comp-attack", 0, 1, 0.001, state.comp.attack)}
            ${renderAdvancedRow("Release (s)", "comp-release", 0, 1, 0.01, state.comp.release)}
            ${renderAdvancedRow("Makeup (dB)", "comp-makeup", 0, 24, 0.1, state.comp.makeup ?? 0)}
          </div>

          ${groupHeading("리미터", "group-limiter")}
          <div class="cheese-mixer-expert-group">
            ${renderAdvancedRow("Limiter (dB)", "limiter-threshold", -20, 0, 0.1, state.limiter.threshold)}
          </div>

          ${groupHeading("노멀라이저", "group-normalizer")}
          <div class="cheese-mixer-expert-group">
            ${renderAdvancedRow("목표 레벨", "normalizer-target", 0.04, 0.3, 0.01, state.normalizer.target)}
          </div>
        </section>
      </div>
      ${renderQuickSaveModal()}`;
  }

  // "프리셋 추가" 클릭 시 패널 위에 뜨는 이름 입력 모달.
  function renderQuickSaveModal() {
    if (!quickSaveOpen) return "";
    return `
      <div class="cheese-mixer-modal-backdrop" data-action="quicksave-cancel">
        <div class="cheese-mixer-modal" role="dialog" aria-label="프리셋 저장" data-modal-stop>
          <strong>커스텀 프리셋 저장</strong>
          <input type="text" data-quicksave-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" placeholder="프리셋 이름" autocomplete="off">
          <div class="cheese-mixer-modal-actions">
            <button type="button" class="cheese-mixer-custom-button is-primary" data-action="quicksave-confirm">저장</button>
            <button type="button" class="cheese-mixer-custom-button" data-action="quicksave-cancel">취소</button>
          </div>
        </div>
      </div>`;
  }

  function renderCustomPresetPane() {
    const presets = normalizeCustomPresets(state.customPresets);
    const list = presets.length
      ? presets.map(renderCustomPresetItem).join("")
      : `<p class="cheese-mixer-empty">저장된 커스텀 프리셋이 없습니다.</p>`;
    return `
      <div class="cheese-mixer-custom-head">
        <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-new">프리셋 추가</button>
      </div>
      ${customCreatorOpen ? renderCustomPresetCreator() : ""}
      ${customDialog ? renderCustomDialog() : ""}
      <div class="cheese-mixer-custom-list">${list}</div>`;
  }

  function renderCustomPresetCreator() {
    return `
      <div class="cheese-mixer-custom-creator">
        <input type="text" data-custom-new-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" placeholder="프리셋 이름">
        <div class="cheese-mixer-mode-picker" role="radiogroup" aria-label="설정 모드">
          <button type="button" class="cheese-mixer-mode-option is-active" data-action="custom-mode-select" data-custom-new-mode="advanced" role="radio" aria-checked="true">고급 슬라이더</button>
          <button type="button" class="cheese-mixer-mode-option" data-action="custom-mode-select" data-custom-new-mode="expert" role="radio" aria-checked="false">전문가 모드</button>
        </div>
        <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-create-start">설정 시작</button>
        <button type="button" class="cheese-mixer-custom-button" data-action="custom-create-cancel">취소</button>
      </div>`;
  }

  function renderCustomDialog() {
    const preset = normalizeCustomPresets(state.customPresets).find(
      (item) => item.id === customDialog.id,
    );
    if (!preset) return "";
    if (customDialog.type === "edit") {
      return `
        <div class="cheese-mixer-custom-dialog">
          <strong>프리셋 이름 수정</strong>
          <input type="text" data-custom-edit-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" value="${escapeAttribute(preset.name)}">
          <div class="cheese-mixer-custom-dialog-actions">
            <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-edit-confirm" data-custom-id="${escapeAttribute(preset.id)}">확인</button>
            <button type="button" class="cheese-mixer-custom-button" data-action="custom-dialog-cancel">취소</button>
          </div>
        </div>`;
    }
    return `
      <div class="cheese-mixer-custom-dialog">
        <strong>프리셋 삭제</strong>
        <p>${escapeHtml(preset.name)} 프리셋을 삭제할까요?</p>
        <div class="cheese-mixer-custom-dialog-actions">
          <button type="button" class="cheese-mixer-custom-button is-danger" data-action="custom-delete-confirm" data-custom-id="${escapeAttribute(preset.id)}">삭제</button>
          <button type="button" class="cheese-mixer-custom-button" data-action="custom-dialog-cancel">취소</button>
        </div>
      </div>`;
  }

  function renderCustomPresetItem(preset) {
    const modeLabel = preset.mode === "expert" ? "전문가" : "고급";
    return `
      <div class="cheese-mixer-custom-item">
        <div class="cheese-mixer-custom-select ${state.preset === preset.id ? "is-active" : ""}">
          <button type="button" class="cheese-mixer-custom-apply" data-action="custom-apply" data-custom-id="${escapeAttribute(preset.id)}">
            <strong>${escapeHtml(preset.name)}</strong>
            <span>${modeLabel}</span>
          </button>
          <div class="cheese-mixer-custom-actions">
            <button type="button" class="cheese-mixer-custom-icon-button" data-action="custom-edit" data-custom-id="${escapeAttribute(preset.id)}" aria-label="수정">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="m13.7 6.1 4.2 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <button type="button" class="cheese-mixer-custom-icon-button is-danger" data-action="custom-delete" data-custom-id="${escapeAttribute(preset.id)}" aria-label="삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3M7 7l1 13h8l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  function renderCustomDraftBar(mode) {
    if (!customDraft || customDraft.mode !== mode) return "";
    return `
      <div class="cheese-mixer-draft-bar">
        <div>
          <strong>${escapeHtml(customDraft.name)}</strong>
          <span>${customDraft.editing ? "프리셋 수정 중" : "새 프리셋 설정 중"}</span>
        </div>
        <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-draft-save">저장</button>
        <button type="button" class="cheese-mixer-custom-button" data-action="custom-draft-cancel">취소</button>
      </div>`;
  }

  function renderAdvancedRow(label, key, min, max, step, value) {
    const info = INFO_TEXT[key] ? infoIcon(key) : "";
    return `
      <div class="cheese-mixer-row">
        <label class="cheese-mixer-row-label">${label}${info}</label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-slider="${key}">
        <output data-output="${key}">${fmtNum(value)}</output>
      </div>`;
  }

  // 슬라이더 표시값 정리: 0.1/0.001 step 등에서 생기는 부동소수점 오차를 없애고
  // 불필요한 끝자리 0을 제거한다(예: 0.30000004 → "0.3", 1.50 → "1.5").
  function fmtNum(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return String(Math.round(n * 1000) / 1000);
  }

  // 토글 행: info 아이콘을 label 바깥에 두어 체크박스 토글과 분리한다.
  function renderToggleRow(label, infoKey, action, checked) {
    const info = INFO_TEXT[infoKey] ? infoIcon(infoKey) : "";
    return `
      <div class="cheese-mixer-toggle-row">
        <span class="cheese-mixer-toggle-label">${label}${info}</span>
        <label class="cheese-mixer-switch">
          <input type="checkbox" data-action="${action}" ${checked ? "checked" : ""}>
          <i aria-hidden="true"></i>
        </label>
      </div>`;
  }

  function groupHeading(label, infoKey) {
    const info = infoKey && INFO_TEXT[infoKey] ? infoIcon(infoKey) : "";
    return `<h4 class="cheese-mixer-group-heading">${label}${info}</h4>`;
  }

  // EQ 값 표시: +가 붙는 부호 + 소수 한 자리(0은 "0")
  function fmtDb(db) {
    const v = Math.round(db * 10) / 10;
    if (v === 0) return "0";
    return `${v > 0 ? "+" : ""}${v}`;
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
    // close/power는 head가 syncHead로 재렌더되므로 위임으로 처리한다(아래
    // 위임 click/change 핸들러 참고).
    panel
      .querySelector(".cheese-mixer-body")
      ?.addEventListener("scroll", () => closeInfoPopover(panel), {
        passive: true,
      });

    panel.addEventListener(
      "keydown",
      (e) => {
        if (isEditableMixerTarget(e.target)) e.stopPropagation();
        // 빠른 저장 이름 입력: Enter로 저장, Esc로 취소
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
        if (isEditableMixerTarget(e.target)) e.stopPropagation();
      },
      true,
    );
    panel.addEventListener(
      "keypress",
      (e) => {
        if (isEditableMixerTarget(e.target)) e.stopPropagation();
      },
      true,
    );

    panel.querySelectorAll(".cheese-mixer-tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(panel, tab.dataset.tab));
    });
    panel.querySelectorAll(".cheese-mixer-preset").forEach((b) => {
      b.addEventListener("click", () => applyPreset(b.dataset.preset));
    });

    // info 아이콘 클릭 → 설명 팝오버 토글
    panel.addEventListener("click", (e) => {
      // 클릭으로 처리하는 버튼형 액션(체크박스 토글 power/*-toggle은 change에서
      // 처리하므로 제외). 매칭되면 항상 전파를 막아, 패널 재렌더로 e.target이
      // 분리돼 document 바깥클릭 닫기 핸들러가 패널을 닫는 문제를 방지한다.
      const actionButton = e.target.closest(
        "[data-action]:not([type='checkbox'])",
      );
      if (actionButton) {
        const action = actionButton.dataset.action;
        // backdrop의 quicksave-cancel은 모달 내부 클릭에는 적용하지 않는다.
        if (
          action === "quicksave-cancel" &&
          actionButton.classList.contains("cheese-mixer-modal-backdrop") &&
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

      const info = e.target.closest(".cheese-mixer-info");
      if (info) {
        e.preventDefault();
        e.stopPropagation();
        toggleInfoPopover(panel, info);
      } else if (!e.target.closest(".cheese-mixer-info-popover")) {
        closeInfoPopover(panel);
      }
    });

    panel.addEventListener("input", (e) => {
      const t = e.target;
      if (
        t.matches?.(
          "[data-custom-new-name], [data-custom-edit-name], [data-quicksave-name]",
        )
      ) {
        t.value = t.value.slice(0, CUSTOM_PRESET_NAME_MAX_LENGTH);
      } else if (t.dataset.slider) {
        handleSlider(t.dataset.slider, parseFloat(t.value));
        // 같은 행의 output만 갱신한다. gain처럼 같은 key가 두 탭에 중복
        // 존재해도 querySelector가 엉뚱한(숨겨진) output을 잡지 않도록 한다.
        const out = t
          .closest(".cheese-mixer-row")
          ?.querySelector("[data-output]");
        if (out) out.textContent = fmtNum(t.value);
      } else if (t.dataset.eq != null) {
        const idx = parseInt(t.dataset.eq, 10);
        handleEqBand(idx, parseFloat(t.value));
        const out = panel.querySelector(`[data-eq-output="${idx}"]`);
        if (out) out.textContent = fmtDb(parseFloat(t.value));
      }
    });
    panel.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.action === "power") {
        setEnabled(t.checked);
      } else if (t.dataset.action === "comp-toggle") {
        state.comp.enabled = t.checked;
        enterCustomFromEdit();
        applyState();
        saveState();
        syncUI();
      } else if (t.dataset.action === "limiter-toggle") {
        state.limiter.enabled = t.checked;
        enterCustomFromEdit();
        applyState();
        saveState();
        syncUI();
      } else if (t.dataset.action === "normalizer-toggle") {
        state.normalizer.enabled = t.checked;
        enterCustomFromEdit();
        // 노멀라이저는 rAF 루프가 normGain을 조정한다(applyState 불필요).
        saveState();
        syncUI();
      }
    });
  }

  function isEditableMixerTarget(target) {
    return Boolean(
      target?.closest?.(
        ".cheese-audio-mixer-panel input, .cheese-audio-mixer-panel textarea, .cheese-audio-mixer-panel select",
      ),
    );
  }

  function stopMixerEditableShortcutLeak(e) {
    if (!isEditableMixerTarget(e.target)) return;
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
    if (action === "custom-mode-select") {
      const picker = button.closest(".cheese-mixer-mode-picker");
      picker
        ?.querySelectorAll(".cheese-mixer-mode-option")
        .forEach((option) => {
          const selected = option === button;
          option.classList.toggle("is-active", selected);
          option.setAttribute("aria-checked", String(selected));
        });
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

  // info 아이콘 설명 팝오버 ───────────────────────────────────────────────
  // 팝오버는 body에 fixed로 띄워 패널 overflow에 잘리지 않게 한다.
  function toggleInfoPopover(panel, infoBtn) {
    const key = infoBtn.dataset.info;
    const existing = document.querySelector(".cheese-mixer-info-popover");
    // 같은 아이콘을 다시 누르면 닫기(토글)
    if (existing && existing.dataset.for === key) {
      closeInfoPopover(panel);
      return;
    }
    closeInfoPopover(panel);
    const text = INFO_TEXT[key];
    if (!text) return;

    const pop = document.createElement("div");
    pop.className = "cheese-mixer-info-popover";
    pop.dataset.for = key;
    pop.textContent = text;
    document.body.appendChild(pop);

    // 플레이어 패널 overflow에 잘리지 않도록 body에 fixed로 띄운다.
    const iconRect = infoBtn.getBoundingClientRect();
    let left = iconRect.left;
    const maxLeft = window.innerWidth - pop.offsetWidth - 12;
    left = Math.max(8, Math.min(left, Math.max(8, maxLeft)));
    pop.style.left = `${left}px`;

    const spaceBelow = window.innerHeight - iconRect.bottom;
    const above = INFO_ABOVE.has(key) || spaceBelow < pop.offsetHeight + 12;
    if (above) {
      const top = iconRect.top - pop.offsetHeight - 6;
      pop.style.top = `${top}px`;
      pop.classList.add("is-above");
    } else {
      const top = iconRect.bottom + 6;
      pop.style.top = `${top}px`;
    }
    infoBtn.setAttribute("aria-expanded", "true");
  }

  function closeInfoPopover(panel) {
    const pop = document.querySelector(".cheese-mixer-info-popover");
    if (pop) {
      panel
        ?.querySelector(`.cheese-mixer-info[data-info="${pop.dataset.for}"]`)
        ?.setAttribute("aria-expanded", "false");
      document
        .querySelector(`.cheese-mixer-info[data-info="${pop.dataset.for}"]`)
        ?.setAttribute("aria-expanded", "false");
      pop.remove();
    }
  }

  // 고급 그룹 슬라이더 값을 밴드별 가중치로 EQ에 반영한다.
  function applyEqGroup(groupKey, value) {
    const g = EQ_GROUPS[groupKey];
    if (!g) return;
    g.bands.forEach((band, i) => {
      state.eq[band] = Math.round(value * g.weights[i] * 10) / 10;
    });
  }

  function handleSlider(key, value) {
    switch (key) {
      case "gain":
        state.gain = value;
        break;
      case "bass":
        applyEqGroup("bass", value);
        break;
      case "treble":
        applyEqGroup("treble", value);
        break;
      case "clarity":
        applyEqGroup("clarity", value);
        break;
      case "comp-threshold":
        state.comp.threshold = value;
        break;
      case "comp-knee":
        state.comp.knee = value;
        break;
      case "comp-ratio":
        state.comp.ratio = value;
        break;
      case "comp-attack":
        state.comp.attack = value;
        break;
      case "comp-release":
        state.comp.release = value;
        break;
      case "comp-makeup":
        state.comp.makeup = value;
        break;
      case "limiter-threshold":
        state.limiter.threshold = value;
        break;
      case "normalizer-target":
        state.normalizer.target = value;
        break;
      default:
        return;
    }
    enterCustomFromEdit();
    applyState();
    syncPresetSelection();
    syncHead();
    saveState();
  }

  function handleEqBand(index, value) {
    state.eq[index] = value;
    enterCustomFromEdit();
    applyState();
    syncPresetSelection();
    syncHead();
    saveState();
  }

  function switchTab(panel, name) {
    if (!panel || !name) return;
    activeTab = name;
    customDialog = null;
    closeInfoPopover(panel);
    panel
      .querySelectorAll(".cheese-mixer-tab")
      .forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
    panel
      .querySelectorAll(".cheese-mixer-pane")
      .forEach((p) => p.classList.toggle("is-active", p.dataset.pane === name));
    syncUI();
  }

  // 슬라이더 key → 현재 state 값. handleSlider와 짝을 이룬다.
  function sliderValue(key) {
    switch (key) {
      case "gain":
        return state.gain;
      // 그룹의 대표 밴드(가중치 1.0)를 표시값으로 쓴다.
      case "bass":
        return state.eq[0];
      case "treble":
        return state.eq[8];
      case "clarity":
        return state.eq[4];
      case "comp-threshold":
        return state.comp.threshold;
      case "comp-knee":
        return state.comp.knee;
      case "comp-ratio":
        return state.comp.ratio;
      case "comp-attack":
        return state.comp.attack;
      case "comp-release":
        return state.comp.release;
      case "comp-makeup":
        return state.comp.makeup ?? 0;
      case "limiter-threshold":
        return state.limiter.threshold;
      case "normalizer-target":
        return state.normalizer.target;
      default:
        return null;
    }
  }

  // 내장·커스텀 프리셋의 선택 표시만 가볍게 갱신한다. 슬라이더 드래그 중에도
  // 부를 수 있도록 슬라이더/EQ는 건드리지 않는다(값 튐 방지).
  function syncPresetSelection() {
    const panel = ui?.panel;
    if (!panel) return;
    panel
      .querySelectorAll(".cheese-mixer-preset")
      .forEach((b) =>
        b.classList.toggle("is-active", b.dataset.preset === state.preset),
      );
    // 커스텀 프리셋의 활성 표시는 .cheese-mixer-custom-select에 걸린다(CSS도
    // 이 요소를 스타일링). 내부 custom-apply 버튼의 custom-id로 현재 프리셋과
    // 비교한다.
    panel.querySelectorAll(".cheese-mixer-custom-select").forEach((el) => {
      const id = el.querySelector("[data-action='custom-apply']")?.dataset
        .customId;
      el.classList.toggle("is-active", Boolean(id) && id === state.preset);
    });
  }

  function syncUI() {
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    button?.classList.toggle("is-active", state.enabled);
    button?.setAttribute("aria-pressed", String(state.enabled));

    const panel = ui?.panel;
    if (!panel) return;

    // head(프리셋 추가 버튼/전원 토글 포함)를 현재 상태로 갱신.
    syncHead();

    syncPresetSelection();

    // 고급/전문가 슬라이더와 output을 현재 state로 갱신(프리셋·복원 반영).
    // output은 같은 행에서만 찾는다(gain 등 중복 key가 두 탭에 있어도 안전).
    panel.querySelectorAll("[data-slider]").forEach((input) => {
      const v = sliderValue(input.dataset.slider);
      if (v == null) return;
      input.value = v;
      const out = input
        .closest(".cheese-mixer-row")
        ?.querySelector("[data-output]");
      if (out) out.textContent = fmtNum(v);
    });

    // 전문가 EQ 슬라이더 + 값 표시 갱신
    panel.querySelectorAll("[data-eq]").forEach((input) => {
      const i = parseInt(input.dataset.eq, 10);
      if (Number.isInteger(i) && state.eq[i] != null) {
        input.value = state.eq[i];
        const out = panel.querySelector(`[data-eq-output="${i}"]`);
        if (out) out.textContent = fmtDb(state.eq[i]);
      }
    });

    // 노멀라이저/컴프레서/리미터 토글 갱신
    const normToggle = panel.querySelector('[data-action="normalizer-toggle"]');
    if (normToggle) normToggle.checked = state.normalizer.enabled;
    const compToggle = panel.querySelector('[data-action="comp-toggle"]');
    if (compToggle) compToggle.checked = state.comp.enabled;
    const limiterToggle = panel.querySelector('[data-action="limiter-toggle"]');
    if (limiterToggle) limiterToggle.checked = state.limiter.enabled;
  }

  // 믹서 버튼 클릭을 document 레벨 위임으로 처리한다. 라이브 플레이어가 컨트롤
  // DOM을 재렌더링하며 버튼을 옮기거나 복제해도(첫 로드 시 클릭이 안 먹던 원인)
  // 항상 토글이 동작한다.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(`.${BUTTON_CLASS}`);
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
      return;
    }
    // 패널이 열려 있고, 버튼·패널 바깥을 클릭하면 닫는다.
    const panel = ui?.panel;
    if (panel && !e.target.closest?.(`#${PANEL_ID}`)) {
      closePanel();
    }
  });

  function handleUserGestureForAudioContext() {
    if (!state.enabled || audio.connected) return;
    window.setTimeout(() => ensureEnabledGraph(), 0);
  }

  document.addEventListener(
    "pointerdown",
    handleUserGestureForAudioContext,
    true,
  );
  document.addEventListener("keydown", handleUserGestureForAudioContext, true);
  window.addEventListener("keydown", stopMixerEditableShortcutLeak, true);
  window.addEventListener("keyup", stopMixerEditableShortcutLeak, true);
  window.addEventListener("keypress", stopMixerEditableShortcutLeak, true);
  window.addEventListener("scroll", () => closeInfoPopover(ui?.panel), true);

  // ══ 스트림 정보 (비디오/오디오 통계) ═══════════════════════════════════════
  // 재생바 우측 버튼 앞에 정보 아이콘을 두고, 클릭 시 해상도/FPS/비트레이트/코덱/
  // 레이턴시(라이브)와 오디오 정보를 보여준다. 값은 치지직 내부 플레이어 객체
  // (React fiber의 _corePlayer)에서 얻는다.
  function getReactFiber(node) {
    if (!node) return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    return key ? node[key] : null;
  }

  function findCorePlayer() {
    const node =
      document.getElementById("live_player_layout") ||
      document.getElementById("player_layout") ||
      findPlayer();
    let fiber = getReactFiber(node);
    if (!fiber) return null;
    fiber = fiber.return;
    let guard = 0;
    while (fiber && guard++ < 2000) {
      let state = fiber.memoizedState;
      while (state) {
        let value = state.memoizedState;
        if (state.queue?.pending?.hasEagerState) {
          value = state.queue.pending.eagerState;
        } else if (state.baseQueue?.hasEagerState) {
          value = state.baseQueue.eagerState;
        }
        if (value && value._corePlayer) return value._corePlayer;
        state = state.next;
      }
      fiber = fiber.return;
    }
    return null;
  }

  // 라이브 지연(초). _getLiveLatency()는 ms를 반환한다. core를 받으면 재사용.
  function getLiveLatencySeconds(core = null) {
    try {
      const c = core || findCorePlayer();
      const ms = c?.srcObject?._getLiveLatency?.();
      return Number.isFinite(ms) ? ms / 1000 : null;
    } catch {
      return null;
    }
  }

  // 코덱 문자열에서 사람이 읽기 쉬운 이름 추출(예: avc1.4d401f → H.264, mp4a.40.2 → AAC).
  function prettyCodec(codec) {
    if (!codec) return null;
    const c = String(codec).toLowerCase();
    if (c.startsWith("avc1") || c.startsWith("avc3")) return "H.264 (AVC)";
    if (c.startsWith("hev1") || c.startsWith("hvc1")) return "H.265 (HEVC)";
    if (c.startsWith("av01")) return "AV1";
    if (c.startsWith("vp9") || c.startsWith("vp09")) return "VP9";
    if (c.startsWith("vp8")) return "VP8";
    if (c.startsWith("mp4a")) return "AAC";
    if (c.startsWith("opus")) return "Opus";
    if (c.startsWith("ac-3")) return "AC-3";
    return codec;
  }

  // 객체에서 여러 후보 키 중 첫 유효 값을 숫자로(문자열 "60"도 60으로) 반환.
  function pickNum(obj, ...keys) {
    if (!obj) return null;
    for (const k of keys) {
      const n = Number(obj[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  function pickStr(obj, ...keys) {
    if (!obj) return null;
    for (const k of keys) {
      const v = obj[k];
      if (v != null && v !== "") return v;
    }
    return null;
  }

  // 비트레이트 값을 kbps로 정규화: 100000 이상이면 bps로 보고 1000으로 나눔.
  function toKbps(n) {
    if (!Number.isFinite(n) || n <= 0) return null;
    return n >= 100000 ? Math.round(n / 1000) : Math.round(n);
  }

  // DASH MPD(srcObject._mpd)에서 현재 재생 해상도(video.videoHeight)에 가장
  // 가까운 비디오 Representation을 찾는다. 다시보기 ABR의 비트레이트/FPS 보강용.
  function findMpdRepresentation(core, video) {
    try {
      const mpd = (core._srcObject || core.srcObject)?._mpd;
      if (!mpd) return null;
      const periods = Array.isArray(mpd.Period) ? mpd.Period : [mpd.Period];
      const reps = [];
      for (const period of periods) {
        if (!period) continue;
        const asets = Array.isArray(period.AdaptationSet)
          ? period.AdaptationSet
          : [period.AdaptationSet];
        for (const as of asets) {
          if (!as) continue;
          const list = Array.isArray(as.Representation)
            ? as.Representation
            : [as.Representation];
          for (const r of list) {
            if (!r || !r["@width"]) continue; // 비디오 표현만(@width 존재)
            reps.push({
              width: Number(r["@width"]),
              height: Number(r["@height"]),
              bandwidth: r["@bandwidth"],
              frameRate: r["@frameRate"],
              codecs: r["@codecs"],
            });
          }
        }
      }
      if (!reps.length) return null;
      const targetH = video?.videoHeight || 0;
      // 현재 해상도와 height 차이가 가장 작은 표현 선택.
      return reps.reduce((best, r) =>
        Math.abs(r.height - targetH) < Math.abs(best.height - targetH)
          ? r
          : best,
      );
    } catch {
      return null;
    }
  }

  // 실제 height를 표준 화질 등급(예: 1080→"1080p")으로 매핑한다. 표준 등급에서
  // ±32px 이내면 그 등급으로 본다(인코딩 편차 흡수).
  function heightToGrade(h) {
    if (!Number.isFinite(h) || h <= 0) return null;
    const grades = [144, 240, 360, 480, 720, 1080, 1440, 2160];
    for (const g of grades) {
      if (Math.abs(h - g) <= 32) return `${g}p`;
    }
    return `${h}p`;
  }

  function collectStreamInfo() {
    const video = findVideo();
    const info = {
      resolution: null,
      fps: null,
      videoBitrate: null,
      videoCodec: null,
      latency: null,
      audioBitrate: null,
      audioCodec: null,
      audioChannels: null,
      audioSampleRate: null,
      isLive: location.pathname.startsWith("/live/"),
    };

    // 1) <video> 표준 API 폴백
    if (video?.videoWidth && video?.videoHeight) {
      info.resolution = `${video.videoWidth}×${video.videoHeight}`;
    }

    // 2) 치지직 내부 플레이어에서 상세 정보
    try {
      const core = findCorePlayer();
      if (core) {
        const selected =
          Array.from(core.videoTracks || []).find((t) => t.selected) ||
          Array.from(core.videoTracks || []).find((t) => t._selected);
        // 라이브는 selected.dataset에 정밀한 값들이 들어있다.
        const ds = selected?.dataset || {};

        if (selected) {
          // 해상도: width×height를 기본으로, 깨끗한 화질 등급(예: 1080p)을 병기.
          // label("1080pavc1.64002a")엔 코덱이 섞여 있으니 토큰만 추출하고,
          // 다시보기 ABR("Auto")처럼 등급을 못 얻으면 실제 height에서 도출한다.
          const w =
            pickNum(selected, "width", "_width") || pickNum(ds, "videoWidth");
          const h =
            pickNum(selected, "height", "_height") ||
            pickNum(ds, "videoHeight") ||
            video?.videoHeight ||
            null;
          // 화질 등급 원본(고정이면 "1080p", 자동이면 "Auto").
          const rawQuality =
            pickStr(selected, "_videoQuality", "encodingOptionID") ||
            pickStr(selected, "label") ||
            "";
          const isAbr = /^auto$|^abr$/i.test(rawQuality.trim());
          // 표시용 등급: 고정이면 그 등급, 자동이면 실제 height에서 도출.
          let grade = String(rawQuality).match(/\d{3,4}p/)?.[0] || null;
          if (!grade) grade = heightToGrade(h);
          // 자동이면 "자동 · 1080p", 고정이면 "1080p"로 병기.
          const tag = grade
            ? isAbr
              ? `자동 · ${grade}`
              : grade
            : isAbr
              ? "자동"
              : null;
          if (w && h) {
            info.resolution = tag ? `${w}×${h} (${tag})` : `${w}×${h}`;
          } else if (!info.resolution && tag) {
            info.resolution = tag;
          }

          // FPS: 문자열 "60"도 처리(언더스코어/dataset 포함)
          const fps =
            pickNum(selected, "videoFrameRate", "_videoFrameRate") ||
            pickNum(ds, "videoFrameRate");
          if (fps) info.fps = `${Math.round(fps)} fps`;

          // 비디오 비트레이트(kbps 정규화)
          const vbr =
            pickNum(selected, "videoBitrate", "_videoBitrate") ||
            pickNum(ds, "videoBitRate");
          info.videoBitrate = toKbps(vbr)
            ? `${numberFormat(toKbps(vbr))} kbps`
            : null;

          // 오디오 비트레이트
          const abr =
            pickNum(selected, "audioBitrate", "_audioBitrate") ||
            pickNum(ds, "audioBitRate");
          info.audioBitrate = toKbps(abr)
            ? `${numberFormat(toKbps(abr))} kbps`
            : null;

          // 오디오 채널/샘플속도: dataset 우선
          const ch = pickNum(ds, "audioChannel");
          if (ch) info.audioChannels = `${ch}ch`;
          const sr = pickNum(ds, "audioSamplingRate");
          if (sr) info.audioSampleRate = `${(sr / 1000).toFixed(1)} kHz`;

          // 코덱: track의 codec 필드 우선
          info.videoCodec =
            prettyCodec(pickStr(selected, "videoCodec", "_videoCodec")) ||
            info.videoCodec;
          info.audioCodec =
            prettyCodec(pickStr(selected, "audioCodec", "_audioCodec")) ||
            info.audioCodec;
        }

        // _currentCodecs 폴백 + 채널 보강
        const codecs = core._currentCodecs;
        if (codecs) {
          info.videoCodec = info.videoCodec || prettyCodec(codecs.video);
          info.audioCodec = info.audioCodec || prettyCodec(codecs.audio);
          const ch = pickNum(codecs, "audioChannel");
          if (!info.audioChannels && ch) info.audioChannels = `${ch}ch`;
        }

        if (
          info.isLive &&
          typeof core.srcObject?._getLiveLatency === "function"
        ) {
          const lat = core.srcObject._getLiveLatency();
          if (Number.isFinite(lat))
            info.latency = `${numberFormat(Math.floor(lat))} ms`;
        }

        // 다시보기(ABR)는 트랙에 비트레이트/FPS가 없다 → DASH MPD에서 현재 재생
        // 해상도에 맞는 Representation을 찾아 채운다.
        if (!info.videoBitrate || !info.fps) {
          const rep = findMpdRepresentation(core, video);
          if (rep) {
            if (!info.fps && pickNum(rep, "frameRate"))
              info.fps = `${Math.round(pickNum(rep, "frameRate"))} fps`;
            const bw = pickNum(rep, "bandwidth");
            if (!info.videoBitrate && toKbps(bw))
              info.videoBitrate = `${numberFormat(toKbps(bw))} kbps`;
            // muxed Representation의 codecs는 "video,audio" 형태
            const repCodecs = String(rep.codecs || "").split(",");
            if (!info.videoCodec && repCodecs[0])
              info.videoCodec = prettyCodec(repCodecs[0].trim());
            if (!info.audioCodec && repCodecs[1])
              info.audioCodec = prettyCodec(repCodecs[1].trim());
          }
        }
      }
    } catch {}

    // 3) 폴백 — 샘플속도: AudioContext, 채널: AudioContext 그래프
    if (!info.audioSampleRate && audio.ctx?.sampleRate) {
      info.audioSampleRate = `${(audio.ctx.sampleRate / 1000).toFixed(1)} kHz`;
    }
    try {
      if (!info.audioChannels && audio.source?.channelCount)
        info.audioChannels = `${audio.source.channelCount}ch`;
    } catch {}

    return info;
  }

  function numberFormat(n) {
    return Number(n).toLocaleString("ko-KR");
  }

  function statsIcon() {
    return `<svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <circle cx="18" cy="18" r="9.5" stroke="currentColor" stroke-width="2"></circle>
      <path d="M18 16.4v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <circle cx="18" cy="13" r="1.3" fill="currentColor"></circle>
    </svg>`;
  }

  function createStatsButton() {
    const btn = document.createElement("button");
    btn.className = `${STATS_BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    btn.setAttribute("aria-label", "스트림 정보");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">스트림 정보</span><span class="pzp-ui-icon">${statsIcon()}</span>`;
    return btn;
  }

  function ensureStatsButton() {
    const player = findPlayer();
    if (!player) return;
    const controls = player.querySelector(".pzp-pc__bottom-buttons-right");
    if (!controls || controls.querySelector(`.${STATS_BUTTON_CLASS}`)) return;
    const btn = createStatsButton();
    // 라이브: 클립 만들기 버튼 앞 / 다시보기: 댓글 타임스탬프 버튼 앞.
    // 둘 다 없으면 우측 컨트롤 그룹 맨 앞에 둔다.
    const anchor =
      controls.querySelector(".custom__clip-button") ||
      controls.querySelector(".cheese-search-comment-timestamp-button") ||
      controls.firstChild;
    controls.insertBefore(btn, anchor);
  }

  function removeStatsButton() {
    document
      .querySelectorAll(`.${STATS_BUTTON_CLASS}`)
      .forEach((b) => b.remove());
  }

  let statsTimer = 0;

  function toggleStatsPanel() {
    if (document.getElementById(STATS_PANEL_ID)) closeStatsPanel();
    else openStatsPanel();
  }

  function openStatsPanel() {
    closeStatsPanel();
    const button = document.querySelector(`.${STATS_BUTTON_CLASS}`);
    const root = getPanelRoot(button) || findPlayer();
    if (!root) return;
    if (getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    root.style.overflow = "visible";
    const panel = document.createElement("div");
    panel.id = STATS_PANEL_ID;
    panel.className = "cheese-stream-stats-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "스트림 정보");
    root.appendChild(panel);
    keepControlsVisible(root, "stats");
    renderStatsPanel(panel);
    button?.setAttribute("aria-expanded", "true");
    statsTimer = window.setInterval(() => {
      const p = document.getElementById(STATS_PANEL_ID);
      if (!p || !isElementRendered(findVideo())) {
        closeStatsPanel();
        return;
      }
      renderStatsPanel(p);
    }, STATS_REFRESH_MS);
  }

  function closeStatsPanel() {
    if (statsTimer) {
      window.clearInterval(statsTimer);
      statsTimer = 0;
    }
    releaseControlsVisible("stats");
    document.getElementById(STATS_PANEL_ID)?.remove();
    document
      .querySelector(`.${STATS_BUTTON_CLASS}`)
      ?.setAttribute("aria-expanded", "false");
  }

  function statsRow(label, value) {
    return `<div class="cheese-stats-row"><span>${label}</span><strong>${value ?? "—"}</strong></div>`;
  }

  function renderStatsPanel(panel) {
    const i = collectStreamInfo();
    panel.innerHTML = `
      <div class="cheese-stats-head">
        <strong>스트림 정보</strong>
        <button type="button" class="cheese-mixer-close" data-stats-close aria-label="닫기">✕</button>
      </div>
      <div class="cheese-stats-body">
        <div class="cheese-stats-group-title">비디오</div>
        ${statsRow("해상도", i.resolution)}
        ${statsRow("FPS", i.fps)}
        ${statsRow("비트레이트", i.videoBitrate)}
        ${statsRow("코덱", i.videoCodec)}
        ${i.isLive ? statsRow("레이턴시", i.latency) : ""}
        <div class="cheese-stats-group-title">오디오</div>
        ${statsRow("비트레이트", i.audioBitrate)}
        ${statsRow("코덱", i.audioCodec)}
        ${statsRow("채널", i.audioChannels)}
        ${statsRow("샘플 속도", i.audioSampleRate)}
      </div>`;
    panel
      .querySelector("[data-stats-close]")
      ?.addEventListener("click", closeStatsPanel);
    positionStatsPanel(panel);
  }

  function positionStatsPanel(panel) {
    panel.style.right = `${PANEL_RIGHT_PX}px`;
    panel.style.bottom = `${PANEL_BOTTOM_PX}px`;
  }

  // 스트림 정보 버튼/패널 클릭 위임(오디오 믹서와 동일하게 document 레벨).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(`.${STATS_BUTTON_CLASS}`);
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      toggleStatsPanel();
      return;
    }
    const panel = document.getElementById(STATS_PANEL_ID);
    if (panel && !e.target.closest?.(`#${STATS_PANEL_ID}`)) {
      closeStatsPanel();
    }
  });

  // ══ 라이브 싱크 따라잡기 ════════════════════════════════════════════════════
  // 지연이 크면 버튼이 활성화되고, 클릭 시 2배속으로 라이브 엣지까지 따라잡은 뒤
  // 1배속으로 복귀한다. 라이브에서만 동작한다.
  let syncCheckTimer = 0;
  let syncCatchUp = null; // { core, raf, startedAt, originalRate }

  function syncIcon() {
    // 빨리감기(▷▷) 아이콘
    return `<svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M11 12.5v11l8-5.5-8-5.5Z" fill="currentColor"></path>
      <path d="M19 12.5v11l8-5.5-8-5.5Z" fill="currentColor"></path>
    </svg>`;
  }

  function createSyncButton() {
    const btn = document.createElement("button");
    btn.className = `${SYNC_BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    btn.disabled = true;
    btn.setAttribute("aria-label", "실시간 따라잡기");
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">실시간 따라잡기</span><span class="pzp-ui-icon">${syncIcon()}</span>`;
    return btn;
  }

  function ensureSyncButton() {
    // 라이브에서만 표시한다.
    if (!location.pathname.startsWith("/live/")) {
      removeSyncButton();
      return;
    }
    const player = findPlayer();
    if (!player) return;
    const controls = player.querySelector(".pzp-pc__bottom-buttons-right");
    if (!controls || controls.querySelector(`.${SYNC_BUTTON_CLASS}`)) {
      startSyncCheck();
      return;
    }
    const btn = createSyncButton();
    // 스트림 정보 버튼 앞(클립 만들기 앞쪽)에 둔다.
    const anchor =
      controls.querySelector(`.${STATS_BUTTON_CLASS}`) ||
      controls.querySelector(".custom__clip-button") ||
      controls.firstChild;
    controls.insertBefore(btn, anchor);
    startSyncCheck();
  }

  function removeSyncButton() {
    stopSyncCheck();
    document
      .querySelectorAll(`.${SYNC_BUTTON_CLASS}`)
      .forEach((b) => b.remove());
  }

  // 주기적으로 지연을 측정해 버튼 활성/비활성 + 툴팁 갱신.
  function startSyncCheck() {
    if (syncCheckTimer) return;
    syncCheckTimer = window.setInterval(updateSyncButtonState, SYNC_CHECK_MS);
    updateSyncButtonState();
  }

  function stopSyncCheck() {
    if (syncCheckTimer) {
      window.clearInterval(syncCheckTimer);
      syncCheckTimer = 0;
    }
  }

  // 버튼 툴팁 텍스트 갱신(지연 숫자 표시). 따라잡는 중엔 rAF 루프가 자주 호출해
  // 호버 상태에서 숫자가 실시간으로 줄어드는 걸 볼 수 있다.
  function setSyncTooltip(btn, lat, { catching = false } = {}) {
    const tip = btn?.querySelector(".pzp-button__tooltip");
    if (!tip) return;
    if (catching) {
      tip.textContent = Number.isFinite(lat)
        ? `따라잡는 중… (지연 ${lat.toFixed(1)}초)`
        : "따라잡는 중…";
    } else {
      tip.textContent = Number.isFinite(lat)
        ? `실시간 따라잡기 (지연 ${lat.toFixed(1)}초)`
        : "실시간 따라잡기";
    }
  }

  function updateSyncButtonState() {
    const btn = document.querySelector(`.${SYNC_BUTTON_CLASS}`);
    if (!btn) return;
    if (syncCatchUp) {
      // 따라잡는 중엔 항상 활성(클릭 시 중단). 툴팁은 rAF 루프가 갱신한다.
      btn.disabled = false;
      btn.classList.add("is-active");
      return;
    }
    const lat = getLiveLatencySeconds();
    const enabled = Number.isFinite(lat) && lat >= SYNC_ENABLE_LATENCY_S;
    // 활성화(클릭 가능)면 민트색, 비활성화면 흐리게(클릭 불가).
    btn.disabled = !enabled;
    btn.classList.toggle("is-active", enabled);
    setSyncTooltip(btn, enabled ? lat : null);
  }

  function toggleSyncCatchUp() {
    if (syncCatchUp) {
      stopSyncCatchUp();
    } else {
      startSyncCatchUp();
    }
  }

  // 배속 설정: video와 corePlayer 둘 다 시도(LLHLS는 corePlayer.playbackRate를
  // 쓰는 경우가 있다). 적용된 배속을 반환.
  function setPlaybackRate(core, video, rate) {
    try {
      if (video) video.playbackRate = rate;
    } catch {}
    try {
      if (core && "playbackRate" in core) core.playbackRate = rate;
    } catch {}
    return video?.playbackRate ?? rate;
  }

  function startSyncCatchUp() {
    const core = findCorePlayer();
    const video = findVideo();
    if (!core || !video) return;
    const lat = getLiveLatencySeconds(core);
    if (!Number.isFinite(lat) || lat < SYNC_ENABLE_LATENCY_S) return;

    const originalRate = video.playbackRate || 1;
    setPlaybackRate(core, video, SYNC_RATE);
    if (video.playbackRate !== SYNC_RATE) return; // 배속 적용 실패
    syncCatchUp = { core, originalRate, startedAt: Date.now(), video };
    // 따라잡는 동안 재생바가 사라지지 않게 유지(지연 숫자 호버 확인 가능).
    const player = findPlayer();
    if (player) keepControlsVisible(player, "sync");
    updateSyncButtonState();

    const loop = () => {
      if (!syncCatchUp) return;
      const cur = getLiveLatencySeconds(syncCatchUp.core);
      const elapsed = Date.now() - syncCatchUp.startedAt;
      // 목표 지연 도달 / 측정 불가 / 안전 시간 초과 / 사용자가 속도 변경 시 종료.
      if (
        cur == null ||
        cur <= SYNC_TARGET_LATENCY_S ||
        elapsed > SYNC_MAX_DURATION_MS ||
        syncCatchUp.video.playbackRate !== SYNC_RATE
      ) {
        stopSyncCatchUp();
        return;
      }
      // 호버 중 실시간 지연을 보여줘 숫자가 줄어드는 게 보이게 한다.
      const btn = document.querySelector(`.${SYNC_BUTTON_CLASS}`);
      setSyncTooltip(btn, cur, { catching: true });
      syncCatchUp.raf = requestAnimationFrame(loop);
    };
    syncCatchUp.raf = requestAnimationFrame(loop);
  }

  function stopSyncCatchUp() {
    if (!syncCatchUp) return;
    if (syncCatchUp.raf) cancelAnimationFrame(syncCatchUp.raf);
    // 우리가 바꾼 2배속일 때만 원복(사용자가 그새 바꿨으면 건드리지 않음).
    if (syncCatchUp.video.playbackRate === SYNC_RATE) {
      setPlaybackRate(
        syncCatchUp.core,
        syncCatchUp.video,
        syncCatchUp.originalRate || 1,
      );
    }
    syncCatchUp = null;
    releaseControlsVisible("sync"); // 따라잡기 끝 → 컨트롤 자동 숨김 복구
    updateSyncButtonState();
  }

  // 따라잡기 버튼 클릭 위임.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(`.${SYNC_BUTTON_CLASS}`);
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;
    toggleSyncCatchUp();
  });

  // ── 부트스트랩 ────────────────────────────────────────────────────────────
  function tick() {
    const pageKey = getPageKey();
    if (!pageKey) {
      // 라이브/다시보기 페이지를 벗어남
      if (currentPageKey) {
        teardownGraph();
        closePanel();
        removeButton();
        closeStatsPanel();
        removeStatsButton();
        stopSyncCatchUp();
        removeSyncButton();
        clearGraphRetryBlock();
        currentPageKey = null;
        currentMediaId = null;
      }
      return;
    }
    if (pageKey !== currentPageKey) {
      currentPageKey = pageKey;
      currentMediaId = null; // 채널id는 아래에서 비동기로 해석
      pendingUserEdit = false;
      state = DEFAULT_STATE();
      customDraft = null;
      clearPresetDirty();
      teardownGraph();
      stopSyncCatchUp(); // 미디어 전환 시 따라잡기 중단
      audio.source = null; // 미디어 전환 시 새 video
      audio.video = null;
      clearGraphRetryBlock();
      resolveAndLoadChannel(pageKey);
    }
    ensureButton();
    ensureStatsButton();
    ensureSyncButton();
    ensureEnabledGraph();
  }

  // 페이지의 채널id를 비동기로 확보한 뒤 해당 채널 설정을 로드한다. 해석 도중
  // 페이지가 바뀌면(currentPageKey 변경) 결과를 버린다(race 방지).
  async function resolveAndLoadChannel(pageKey) {
    const channelId = await resolveChannelId(pageKey);
    if (currentPageKey !== pageKey) return; // 그새 페이지가 바뀜
    if (!channelId) return; // 채널id 확보 실패 — 기본 설정으로 동작
    currentMediaId = channelId;
    if (pendingUserEdit) {
      // 채널id 확보 전 사용자가 바꾼 설정이 있으면 로드 대신 저장한다(덮어쓰기 방지).
      pendingUserEdit = false;
      saveState();
    } else {
      requestState(channelId);
    }
  }

  const observer = new MutationObserver(() => tick());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  tick();
})();
