const SELECTORS = {
  tabList: '[role="tablist"][class*="tab_list__"][class*="channel_area__"]',
  header: '[class*="channel_component_header__"], [class*="_header_16glw_"]',
  list: '[class*="channel_component_list__"], ul[class*="_list_16glw_"]',
  noContent: '[class*="no_content_container__"]',
  pagination: '[class*="pagination_container__"], [class*="_container_pvn19_"]',
};

const CONTENT_CONFIG = {
  videos: {
    contentType: "videos",
    panelId: "videos-PANEL",
    itemSelector:
      '[class*="channel_vod_item__"], .cheese-search-card, a[href^="/video/"], a[href*="chzzk.naver.com/video/"]',
    emptyPattern: /등록된\s*동영상이\s*없습니다/,
    title: "다시보기",
    inputTitle: "제목, 태그, 카테고리를 검색합니다.",
    inputPlaceholder: "제목, #태그, @카테고리 검색",
  },
  clips: {
    contentType: "clips",
    panelId: "clips-PANEL",
    itemSelector:
      '[class*="channel_clip_item__"], .cheese-search-card, a[href^="/clips/"], a[href*="chzzk.naver.com/clips/"]',
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
// ── seek preview 실제 방송 시각 병기 ────────────────────────────────────────
// 다시보기 재생바 호버 시 뜨는 seek preview의 시간(.pzp-seeking-preview__time) 아래에
// 라이브 시작 시각(liveOpenDate) + preview 시간으로 계산한 "실제 그 당시 시각"을 병기.
const SEEK_PREVIEW_TIME_SELECTOR = ".pzp-seeking-preview__time";
const SEEK_PREVIEW_REALTIME_CLASS = "cheese-search-seek-realtime";
// 영상 정보 영역의 등록일/라이브 시작일 툴팁(._label_..._77) 교체 대상.
const VIDEO_INFO_LABEL_SELECTOR = '[class*="_label_"]';
// 라이브 상세 영역의 시청자/스트리밍 시간 메타에 붙이는 라이브 시작일 툴팁.
const LIVE_DETAIL_START_TOOLTIP_CLASS = "cheese-live-start-tooltip";
const LIVE_DETAIL_START_TARGET_CLASS = "cheese-live-start-tooltip-target";
const seekPreviewState = {
  videoNo: "",
  liveOpenAt: 0, // 라이브 시작 시각(ms). 0이면 미확보/없음
  publishAt: 0, // 등록일(ms). 0이면 미확보/없음
  fetching: false,
  observer: null,
};
const liveDetailState = {
  channelId: "",
  liveOpenAt: 0,
  fetching: false,
};
// ── 기능 표시/숨김 전역 설정(확장 팝업 패널) ────────────────────────────────
// 키 cheeseFeatureHidden = { <feature>: true(숨김)/false(표시) }. 미설정/false=표시.
// content.js가 chrome.storage에서 읽어 자기 기능 게이트에 쓰고, MAIN world
// (audioMixer/videoFilter/clipButtonHide)에는 postMessage로 전달한다.
const FEATURE_HIDDEN_KEY = "cheeseFeatureHidden";
const FEATURE_FLAGS_MESSAGE = "cheese-feature-flags";
// 실시간 따라잡기 민감도 프리셋(low/normal/high/custom). audioMixer(MAIN world)에 전달.
const SYNC_PRESET_KEY = "cheeseSyncPreset";
const SYNC_CUSTOM_KEY = "cheeseSyncCustom"; // {enable,target} (preset=custom일 때)
let syncPresetValue = "normal";
let syncCustomValue = null; // {enable, target} 또는 null
// 오디오 믹서 '항상 켜기'(전역). MAIN world(audioMixer)에 함께 전달.
const MIXER_ALWAYS_ON_KEY = "cheeseMixerAlwaysOn";
let mixerAlwaysOn = false;
// 채널 홈 탭리스트 끝에 라이브 바로가기 버튼 표시(전역, 기본 ON). content.js 전용.
const CHANNEL_LIVE_BUTTON_KEY = "cheeseChannelLiveButton";
let channelLiveButtonOn = true;
// 라이브 바로가기 버튼을 탭리스트 '끝(우측)'에 둘지(true) 탭들 바로 뒤(false)에 둘지.
const CHANNEL_LIVE_BUTTON_END_KEY = "cheeseChannelLiveButtonEnd";
let channelLiveButtonEnd = true;
// 사이드바 팔로잉 채널 호버 시 라이브 영상 미리보기(전역, 기본 ON). content.js 전용.
const FOLLOW_PREVIEW_KEY = "cheeseFollowPreview";
const FOLLOW_PREVIEW_SIZE_KEY = "cheeseFollowPreviewSize"; // {w} (height는 16:9)
let followPreviewOn = true;
// 라이브 탐색 카드 호버 미리보기(치지직 자체 video)에 음량 버튼/우클릭 음소거 토글
// 오버레이(전역, 기본 ON). content.js 전용.
const CARD_PREVIEW_AUDIO_KEY = "cheeseCardPreviewAudio";
let cardPreviewAudioOn = true;
const featureFlags = {
  audioMixer: false,
  videoFilter: false,
  liveSync: false,
  streamStats: false,
  tabMute: false, // 플레이어 우측 컨트롤의 '탭 음소거' 버튼 숨김
  commentTimestamp: false,
  searchVideos: false,
  searchClips: false,
  sidebar: false,
  sidebarRight: false, // 사이드바를 오른쪽에 배치
  headerStudio: false, // 헤더의 '스튜디오' 버튼 숨김
  headerTopicTabs: false, // 헤더의 주제 탭(게임/e스포츠/스포츠/엔터+) 숨김
  headerAutoHide: false, // 헤더 자동 숨김(상단 호버 시 슬라이드 표시)
  seekPreviewRealtime: false, // 다시보기 seek preview 실제 시각 병기 숨김
  // 사이드바 메뉴 항목별 숨김(첫 nav 섹션의 개별 메뉴)
  sbLives: false, // 전체 방송
  sbClips: false, // 인기 클립
  sbCategory: false, // 카테고리
  sbSchedule: false, // 편성표
  sbFollowing: false, // 팔로잉
  sbCheezefarm: false, // 치즈팜
  // 사이드바 섹션별 숨김(제목 섹션 통째로)
  sbFollow: false, // 팔로우
  sbPopularCategory: false, // 인기 카테고리
  sbBroadcastSchedule: false, // 방송 일정
  sbPartner: false, // 파트너
  sbServices: false, // 서비스 바로가기(게임/e스포츠/오리지널/PC게임/라운지)
  sbFollowOffline: false, // 팔로잉 섹션의 오프라인 채널 숨김
};
// 사이드바(aside#sidebar) 숨김용 CSS를 토글하는 <style> id.
const SIDEBAR_HIDE_STYLE_ID = "cheese-sidebar-hide-style";

// ── 헤더 미니 네비(사이드바 숨김 시 헤더에 SVG 아이콘 메뉴 주입) ──────────────
// 사이드바를 숨기면 전체 방송/인기 클립/카테고리/편성표/팔로잉/치즈팜로 가는 길이
// 사라진다 → 헤더 스튜디오 버튼 앞에 아이콘만 있는 미니 네비를 넣어 이동 가능하게.
// 표시 여부는 settings에서 항목별 토글(전역 저장). chrome.storage 키:
//   cheeseHeaderNav = { hdrLives, hdrClips, hdrCategory, hdrSchedule, hdrFollowing, hdrCheezefarm }
// (각 true=표시). 미설정 시 기본 표시 항목은 HEADER_NAV_DEFAULT_SHOWN.
const HEADER_NAV_KEY = "cheeseHeaderNav";
const HEADER_NAV_CONTAINER_ID = "cheese-header-nav";
const HEADER_FOLLOW_CONTAINER_ID = "cheese-header-follow";
const FOLLOWING_LIVE_API_URL =
  "https://api.chzzk.naver.com/service/v1/channels/followings/live";
const HEADER_FOLLOW_COUNT_KEY = "cheeseHeaderFollowCount";
const HEADER_FOLLOW_DEFAULT_COUNT = 5;
const HEADER_FOLLOW_MIN_COUNT = 1;
const HEADER_FOLLOW_MAX_COUNT = 10;
const ACHIEVEMENT_BADGE_URL_MAP = Object.freeze({
  "2025chzzkcup_1":
    "https://nng-phinf.pstatic.net/MjAyNTEyMzBfMjU4/MDAxNzY3MDgxODczNjA2.WSIGn-NlCjbGAKomslHWdyPOADmnaX5cvBfCskSwEsQg.dZDFrMbTTVAPZBBOE6sUOGAk6D_DYvL-dsQK9wKdZbQg.PNG/%EC%9A%B0%EC%8A%B9%ED%8C%80.png",
  "2025chzzkcup_2":
    "https://nng-phinf.pstatic.net/MjAyNTEyMzBfMTc2/MDAxNzY3MDgyMDEyNDAw.DmMhs-TROPuxmXoT-fur1EUdbl74UsFGaG4D_0TN9NMg.gaAhW1wR3LsotwdAIn3K8Bx5-7pwZ_-UO39gWYO4NLEg.PNG/2%EC%9C%84.png",
  "2025chzzkcup_3":
    "https://nng-phinf.pstatic.net/MjAyNTEyMzBfMjg0/MDAxNzY3MDgyMTQxMjkw.yqUbAh_oHqq4ERj59MXoLakFSNSOL9ov7oN5HG0O9N4g.vDSQBKar0DZ0uxDtQ-4JM_U_xD9t1iaEy6JVxxUHizQg.PNG/3%EC%9C%84.png",
  chistival_overcooked:
    "https://nng-phinf.pstatic.net/MjAyNTA4MjVfMjkx/MDAxNzU2MDk4MDg5MTYz.OB6AzJj3XW235D3_RoL-RCc0RIQyMl5HbZmRWJTBwdwg.p2TicS08K052ZCv_VosAn4seKuMu7cNLInBpZJU9jlAg.PNG/%EC%B9%98%EC%8A%A4%ED%8B%B0%EB%B2%8C_5%ED%9A%8C%EC%B0%A8_%EC%98%A4%EB%B2%84%EC%BF%A1%EB%93%9C2_128px.png",
  chstival_pubg_1:
    "https://nng-phinf.pstatic.net/MjAyNDEyMjBfMTA1/MDAxNzM0NjY1NTgzOTY4.I-aSeAhhOOvI0dK73_lOpxHr3jVGU2gJvBLO62q89kUg.kEwySFgJnPpyMpT27jNvh0ScEkTI-7l7OkMsEI0L_VAg.PNG/%EC%B9%98%EC%8A%A4%ED%8B%B0%EB%B2%8C_3%ED%9A%8C%EC%B0%A8.png",
  chstival_head_1:
    "https://nng-phinf.pstatic.net/MjAyNTA0MDFfMTEw/MDAxNzQzNDk5MzA4Njk4.i5A4Yl4pBKtezupKxWw4sWXKs-IJAi23zE_di9D8lfEg.SGOtQXxQH6LQ78pQlsDEVJOMPSDvrzz9vOvSXuyvvUAg.PNG/%EC%B9%98%EC%8A%A4%ED%8B%B0%EB%B2%8C_4%ED%9A%8C%EC%B0%A8.png",
  chstival_party_1:
    "https://nng-phinf.pstatic.net/MjAyNDEyMjBfMTg0/MDAxNzM0NjY1NTI2Mzk4.1--5ZJYhgS5dD6DRZn5RaIIYJ4oNFhNmO8lB5dEDyy0g.SDZuY8dP9egGD0-kiZiLzuZ8wKhUAoOPoxErvvOBh60g.PNG/%EC%B9%98%EC%8A%A4%ED%8B%B0%EB%B2%8C_2%ED%9A%8C%EC%B0%A8.png",
  chstival_fall_1:
    "https://nng-phinf.pstatic.net/MjAyNDEyMjBfMTEx/MDAxNzM0NjY1NDc3Njg1.YaC7hHZb0CzgcMgNpLjpRJgqjMHHAWV16_V8plcXf7sg.sEWIiMWzrNV6C2kBUSCPJwBlFjjqs-Ue7npiN27GG5Eg.PNG/%EC%B9%98%EC%8A%A4%ED%8B%B0%EB%B2%8C_1%ED%9A%8C%EC%B0%A8.png",
  chistival_sonicracingcrossworld:
    "https://nng-phinf.pstatic.net/MjAyNjAyMDNfMTMw/MDAxNzcwMDkxMTM1NTQ2.9l3zJeubb3WfOm2a243pWy304a1TN4I0Ss6iPOWM5wIg.GaSsvEn7BqwLkc7C-tVumzF_ImRuLNsApz26y_xxaiEg.PNG/%EC%B9%98%EC%8A%A4%ED%8B%B0%EB%B2%8C_%EC%9A%B0%EC%8A%B9_%EB%B0%B0%EC%A7%80_6%ED%9A%8C%EC%B0%A8_128px.png",
  fco_teammaster:
    "https://nng-phinf.pstatic.net/MjAyNTA2MjhfMTYy/MDAxNzUxMDkyNDQ2NDUz.2AyKLN4E3LGHikzPJ1NSP40ZOqAE67wQvDR9WaaPb8sg.gS3TfMGN2ReP3wwbhYb9T75G3Ikwq0zX5Vpdx7rT1jQg.PNG/FCO_%EC%9A%B0%EB%8B%B9%ED%83%95_%EC%B6%95%EA%B5%AC%EB%8B%A8_%EB%B0%B0%EC%A7%80_128px.png",
  chraksil_dd_1_128:
    "https://nng-phinf.pstatic.net/MjAyNDEwMzBfNDAg/MDAxNzMwMjc3OTY4NTQw.sjD5L1OayJsWNmL6s903rqcqHWTDeNHWCbgZsElP6Ckg.Va3FHdP1-ZH4DMKf3TyHPJo71HgXr5KLJIHsZOYzazgg.PNG/DD_1%EB%93%B1_h128.png",
  chraksil_dd_2_128:
    "https://nng-phinf.pstatic.net/MjAyNDEwMzBfMTM4/MDAxNzMwMjc3OTgzNzYy.RLDp2VQdZ87PHPZL4GkfeL_LCO63LWuBm8Z7z-jUA_0g.031CDAFmE-JaVlyh362zhEkPQXfwwtYDl8mIVuZvWPgg.PNG/DD_2%EB%93%B1_h128.png",
  chraksil_dd_3_128:
    "https://nng-phinf.pstatic.net/MjAyNDEwMzBfNDYg/MDAxNzMwMjc4MzEwNDIx.s9sEEWQwOBQoi6UQHzy3arqUjLIXUbZ8I7goGidrLuog.Jh2Ws30-ibxDQYe49K8Euuc-qvYX4X-uEVKLRG4Mve0g.PNG/DD_3%EB%93%B1_h128.png",
  chraksil_dd_4_128:
    "https://nng-phinf.pstatic.net/MjAyNDEwMzBfMjIg/MDAxNzMwMjc4Mzk1OTM0.6XPdGEI-VStDumkzDZoo62Dm31wE7jFDf64J4LQmWGgg.pkJnwxoxvjJLk89MQ3eRsbx81y7kYfgSwnQlbsLFTeMg.PNG/DD_4%EB%93%B1-10%EB%93%B1_h128.png",
  chraksil_dd_5_128:
    "https://nng-phinf.pstatic.net/MjAyNDEwMzBfMjA4/MDAxNzMwMjc4NDI4MzE3.R3ZswKy5mvqZb5OUmEGFEt2lSxCAXzDWfEjhsmslU7Qg.T88VDfi-M6JKqcwVI-hWyaQMpczIZcWrgCl2vMFygNgg.PNG/DD_%EC%B0%B8%EA%B0%80%EC%83%81_h128.png",
  chraksil_snowbros_1:
    "https://nng-phinf.pstatic.net/MjAyNTExMDdfMzAw/MDAxNzYyNTA5MDcyMDQy.T-YnO75xMoS3EFMN2xP2N5oBVayBjzUVhibX8nKl8UAg.dq0jBmfqB_2pMj4A-ZdmDOc0Y05AVcwyt6_yeJoyJVEg.PNG/1%EB%93%B1.png",
  chraksil_snowbros_2:
    "https://nng-phinf.pstatic.net/MjAyNTExMDdfMTgg/MDAxNzYyNTA5MDk2Nzcw.ShEg68UNdcykxIEakEocMWTd96rqcIg4j2yyBiILPOgg.H5ZXJzQj-z7rDN-nJcz-zLIi0F4qW38IAxhwKnVwaLwg.PNG/2%EB%93%B1.png",
  chraksil_snowbros_3:
    "https://nng-phinf.pstatic.net/MjAyNTExMDdfNDMg/MDAxNzYyNTA5MTE2NzM5.R_vXQmdOQi7y9EhwzpcDOqAUvPAxN_QW4i0GeuVyc_cg.KNvJEnrCaUnb6EFERedTu42wbZEUQoQnvmy-0_Sq-pAg.PNG/3%EB%93%B1.png",
  chraksil_snowbros_4:
    "https://nng-phinf.pstatic.net/MjAyNTExMDdfMTU1/MDAxNzYyNTA5MTQyNDI2.4RF6Z72g7l3QAEvI1T7DR_qFhuSDbjE3GAjdD_4OSM4g.s97HxPGhxDoKIYyhYt6zu_Kidct79-Y0mRY8hNXLvuMg.PNG/4%EB%93%B1-10%EB%93%B1.png",
  chraksil_snowbros_5:
    "https://nng-phinf.pstatic.net/MjAyNTExMDdfODMg/MDAxNzYyNTA5MTg0NDM0.kGhGOxxutQBbG686OlWm4PouUj14U9e8TwmbkiiSiuYg.FkLaSf7uWY9siO1MxJ098sPGH725VOpFfEpqf2agijog.PNG/%EC%B0%B8%EA%B0%80%EC%83%81.png",
  chraksil_pacman_1_128:
    "https://nng-phinf.pstatic.net/MjAyNTAyMTNfMTM0/MDAxNzM5NDU4NjQxMzIw.i6wn8EZPCETxBA8BZJ1trQoCkFYcsUFSNsoz5ixOH1cg.TD3kefULabiF92ii7r2NdqZr2AbCuAEIHMbcgRoNCa8g.PNG/chraksil_pacman_1_128.png",
  chraksil_pacman_2_128:
    "https://nng-phinf.pstatic.net/MjAyNTAyMTNfMjk1/MDAxNzM5NDU4NzU1ODIw.VQ3Bv3KKu7sRIwskRJstz5ibpNAgDKrY0Ex6hn7j7N8g.w3SXOkyJt6VDz9PK7ln2Qg8JnBh-r79lSd817wBBruMg.PNG/chraksil_pacman_2_128.png",
  chraksil_pacman_3_128:
    "https://nng-phinf.pstatic.net/MjAyNTAyMTRfODUg/MDAxNzM5NDU4ODMyNzIz.YIIBQ5WfjLW6MQRgFwKnBd_mRiuLdSL7LprSEhfk5awg.T8ViM2p0EGgp3WHDAMLegPf66etjLUqm4-QNJUh70R0g.PNG/chraksil_pacman_3_128.png",
  chraksil_pacman_4_128:
    "https://nng-phinf.pstatic.net/MjAyNTAyMTRfMTM5/MDAxNzM5NDU4ODc5NDcx.SLyfXq52ne1bQWC3Q_sOT3Iy8wMswkeRvBPsEOlY5z8g.Tlj3EAxaKXGbYoMw-EBq6XgczMTgN5UceH_vNNVe_9og.PNG/chraksil_pacman_4_128.png",
  chraksil_pacman_5_128:
    "https://nng-phinf.pstatic.net/MjAyNTAyMTRfMTI5/MDAxNzM5NDU4OTc0OTY1.0C_uz2pQWiXXY-KYhrb8BMA5dx6sV5W1PIvma7mDyiYg.65ed25-goXCeZCi06wUlSENrC9QmKeM-Rabi2neWuv8g.PNG/chraksil_pacman_5_128.png",
  chraksil_tengai_1_128:
    "https://nng-phinf.pstatic.net/MjAyNTA3MDRfNTMg/MDAxNzUxNjIxNjMyOTk0.MrNhd7e6Gqnbh5bWL5t7Gma3q8blc0q31Df7bdZ7Ra0g.rN5VoZPCg-xdMi0PZV6B_Q_RF_UhsLWkt2w83rgvl5Ig.PNG/%ED%85%90%EA%B0%80%EC%9D%B4_1%EB%93%B1_128px.png",
  chraksil_tengai_2_128:
    "https://nng-phinf.pstatic.net/MjAyNTA3MDRfMTUg/MDAxNzUxNjIxNjgxNjc4.uQyCT3BJwSYOl2rf-9j88OAyiyJwXX8Gd3e15oLU-x8g.JjAesrBJVkWlvsGtUrcTTh4-XniEY6VocCdIR6q4nn4g.PNG/%ED%85%90%EA%B0%80%EC%9D%B4_2%EB%93%B1_128px.png",
  chraksil_tengai_3_128:
    "https://nng-phinf.pstatic.net/MjAyNTA3MDRfMzIg/MDAxNzUxNjIxNzEwODA0.EVqMa4g8ekgTMId_aCtf3GBbZ13z8q27Ku1qKw351sYg._vjZqxkCAi97oFs0_M7AvSD2JztPU8enhMlyGYcsWEcg.PNG/%ED%85%90%EA%B0%80%EC%9D%B4_3%EB%93%B1_128px.png",
  chraksil_tengai_4_128:
    "https://nng-phinf.pstatic.net/MjAyNTA3MDRfNyAg/MDAxNzUxNjIxNzY1MTU0.W6IT_o0OMLZ8qgf1xE7u_QZWdiho3ti3VJkapgaHw30g.Oq8UpqNYE1et7IVgIjsoBtCvyHkQ30IOTCj70oNOXH0g.PNG/%ED%85%90%EA%B0%80%EC%9D%B4_410%EB%93%B1_128px.png",
  chraksil_tengai_5_128:
    "https://nng-phinf.pstatic.net/MjAyNTA3MDRfMjc4/MDAxNzUxNjIxNzk1NjUz.3qqlqb86KvS1bIletC1eMjZ67teJjse-AiVFleZvvWIg.zoiwYobtKUygxwxSewrt4Nn3W-R29uu7LAyM0mBNcaog.PNG/%ED%85%90%EA%B0%80%EC%9D%B4_%EC%B0%B8%EA%B0%80%EC%83%81_128px.png",
});
// 미설정 시 기본 표시(전체 방송/인기 클립/카테고리/팔로잉). 편성표·치즈팜은 기본 off.
const HEADER_NAV_DEFAULT_SHOWN = new Set([
  "hdrLives",
  "hdrClips",
  "hdrCategory",
  "hdrFollowing",
]);
// 각 항목: key(저장/식별) · href(이동) · label(aria/title) · svg(인라인, 클래스 해시 무관).
const HEADER_NAV_ITEMS = [
  {
    key: "hdrLives",
    href: "/lives",
    label: "전체 방송",
    svg: '<path d="M12.6355 11.5509C12.9372 11.7251 12.9372 12.1606 12.6355 12.3347L8.90216 14.4901C8.60048 14.6642 8.22339 14.4465 8.22339 14.0982V9.78748C8.22339 9.43914 8.60048 9.22142 8.90216 9.39559L12.6355 11.5509Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M2 8.21023C2 5.71105 4.026 3.68506 6.52519 3.68506H13.3134C15.5104 3.68506 17.3417 5.25072 17.7524 7.32717L20.885 6.31147C21.1438 6.22757 21.427 6.27257 21.647 6.43252C21.867 6.59246 21.9972 6.84803 21.9972 7.12003V16.9334C21.9972 17.2054 21.867 17.461 21.647 17.6209C21.427 17.7809 21.1438 17.8259 20.885 17.742L17.7422 16.7229C17.312 18.7743 15.4925 20.3146 13.3134 20.3146H6.52519C4.026 20.3146 2 18.2887 2 15.7895V8.21023ZM6.52519 5.38506H13.3134C14.8737 5.38506 16.1385 6.64993 16.1385 8.21023V15.7895C16.1385 17.3498 14.8737 18.6146 13.3134 18.6146H6.52519C4.96488 18.6146 3.70001 17.3498 3.70001 15.7895V8.21023C3.70001 6.64993 4.96488 5.38506 6.52519 5.38506ZM17.87 14.9773V9.07618L20.2972 8.28919V15.7642L17.87 14.9773Z" fill="currentColor"></path>',
  },
  {
    key: "hdrClips",
    href: "/clips",
    label: "인기 클립",
    svg: '<path fill-rule="evenodd" clip-rule="evenodd" d="M18.7019 10.4388C20.3302 9.56907 21.0119 7.567 20.2223 5.87372C19.4054 4.12183 17.3229 3.36389 15.5711 4.18081C13.8192 4.99773 13.0612 7.08016 13.8782 8.83205C14.1565 9.42892 14.5817 9.91041 15.0907 10.2536L13.3554 11.0628L4.65669 7.00648C4.23123 6.80808 3.7255 6.99215 3.52711 7.41761C3.32871 7.84307 3.51278 8.34881 3.93824 8.5472L11.3441 12.0006L3.93824 15.4541C3.51278 15.6525 3.32871 16.1582 3.52711 16.5837C3.7255 17.0091 4.23123 17.1932 4.65669 16.9948L13.3554 12.9385L15.0919 13.7482C14.5832 14.0914 14.1583 14.5727 13.8801 15.1692C13.0632 16.9211 13.8211 19.0035 15.573 19.8205C17.3249 20.6374 19.4073 19.8794 20.2242 18.1275C21.0141 16.4337 20.3317 14.4309 18.7022 13.5617L18.5494 13.4848C18.5434 13.4819 18.5374 13.4791 18.5313 13.4763C18.5253 13.4735 18.5193 13.4707 18.5132 13.4679L15.3666 12.0006L18.7019 10.4388ZM18.6816 6.59218C19.1017 7.49315 18.7119 8.56411 17.8109 8.98424C16.91 9.40436 15.839 9.01457 15.4189 8.1136C14.9988 7.21262 15.3886 6.14166 16.2895 5.72153C17.1905 5.30141 18.2614 5.6912 18.6816 6.59218ZM17.7999 15.011L17.8258 15.0231C18.7176 15.4474 19.1016 16.5124 18.6835 17.4091C18.2634 18.3101 17.1924 18.6999 16.2915 18.2797C15.3905 17.8596 15.0007 16.7886 15.4208 15.8877C15.839 14.991 16.9017 14.6007 17.7999 15.011Z" fill="currentColor"></path>',
  },
  {
    key: "hdrCategory",
    href: "/category",
    label: "카테고리",
    svg: '<path fill-rule="evenodd" clip-rule="evenodd" d="M2.99805 4.96288C2.99805 3.87827 3.87729 2.99902 4.96189 2.99902H8.88977C9.97437 2.99902 10.8536 3.87827 10.8536 4.96288V8.89047C10.8536 9.97507 9.97437 10.8543 8.88977 10.8543H4.96189C3.87729 10.8543 2.99805 9.97507 2.99805 8.89046V4.96288ZM4.96189 4.69902H8.88977C9.03549 4.69902 9.15362 4.81716 9.15362 4.96288V8.89047C9.15362 9.03619 9.03549 9.15432 8.88977 9.15432H4.96189C4.81617 9.15432 4.69804 9.03619 4.69804 8.89046V4.96288C4.69804 4.81716 4.81617 4.69902 4.96189 4.69902Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M13.1425 4.96288C13.1425 3.87827 14.0218 2.99902 15.1064 2.99902H19.0342C20.1188 2.99902 20.9981 3.87827 20.9981 4.96288V8.89047C20.9981 9.97507 20.1188 10.8543 19.0342 10.8543H15.1064C14.0218 10.8543 13.1425 9.97507 13.1425 8.89046V4.96288ZM15.1064 4.69902H19.0342C19.18 4.69902 19.2981 4.81716 19.2981 4.96288V8.89047C19.2981 9.03619 19.18 9.15432 19.0342 9.15432H15.1064C14.9606 9.15432 14.8425 9.03619 14.8425 8.89046V4.96288C14.8425 4.81716 14.9606 4.69902 15.1064 4.69902Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M15.1064 13.1445C14.0218 13.1445 13.1425 14.0238 13.1425 15.1084V19.036C13.1425 20.1206 14.0218 20.9998 15.1064 20.9998H19.0342C20.1188 20.9998 20.9981 20.1206 20.9981 19.036V15.1084C20.9981 14.0238 20.1188 13.1445 19.0342 13.1445H15.1064ZM19.0342 14.8445H15.1064C14.9606 14.8445 14.8425 14.9627 14.8425 15.1084V19.036C14.8425 19.1817 14.9606 19.2998 15.1064 19.2998H19.0342C19.18 19.2998 19.2981 19.1817 19.2981 19.036V15.1084C19.2981 14.9627 19.18 14.8445 19.0342 14.8445Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M2.99805 15.1084C2.99805 14.0238 3.87729 13.1445 4.96189 13.1445H8.88977C9.97437 13.1445 10.8536 14.0238 10.8536 15.1084V19.036C10.8536 20.1206 9.97437 20.9998 8.88977 20.9998H4.96189C3.87729 20.9998 2.99805 20.1206 2.99805 19.036V15.1084ZM4.96189 14.8445H8.88977C9.03549 14.8445 9.15362 14.9627 9.15362 15.1084V19.036C9.15362 19.1817 9.03549 19.2998 8.88977 19.2998H4.96189C4.81617 19.2998 4.69804 19.1817 4.69804 19.036V15.1084C4.69804 14.9627 4.81617 14.8445 4.96189 14.8445Z" fill="currentColor"></path>',
  },
  {
    key: "hdrSchedule",
    href: "/schedule",
    label: "편성표",
    svg: '<rect x="3.85037" y="5.85" width="16.3" height="14.3" rx="3.15" stroke="currentColor" stroke-width="1.7"></rect><path d="M4.00037 10H20.0004" stroke="currentColor" stroke-width="1.7"></path><path d="M8.00037 4V7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path><path d="M16.0004 4V7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>',
  },
  {
    key: "hdrFollowing",
    href: "/following",
    label: "팔로잉",
    svg: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12.0253 5.3322C10.7848 3.94896 8.72606 3.48266 6.93814 3.81809C5.77468 4.03637 4.6373 4.5982 3.78632 5.54266C2.92677 6.49664 2.40039 7.79641 2.40039 9.4033C2.40039 12.4934 4.6905 16.1966 10.4761 19.8404C10.6682 19.9614 11.2673 20.284 11.9971 20.2868C12.7246 20.2897 13.2969 19.9835 13.4784 19.8696C19.2984 16.2161 21.6005 12.5015 21.6005 9.4033C21.6005 6.13381 19.4375 4.2731 17.0962 3.82271C15.3137 3.47979 13.263 3.9427 12.0253 5.3322ZM5.04927 6.68062C4.48981 7.30154 4.10038 8.18784 4.10038 9.4033C4.10038 11.6179 5.77948 14.8734 11.3821 18.402C11.3998 18.4131 11.4875 18.4637 11.6146 18.5098C11.7417 18.5559 11.8777 18.5863 12.0038 18.5868C12.1335 18.5873 12.2636 18.5587 12.3779 18.5185C12.4335 18.4989 12.4808 18.4782 12.5167 18.4606C12.5345 18.4519 12.5489 18.4443 12.5592 18.4386C12.57 18.4326 12.5751 18.4294 12.5746 18.4297C18.2123 14.8908 19.9005 11.6238 19.9005 9.4033C19.9005 7.06057 18.4309 5.81064 16.7751 5.4921C15.0312 5.15663 13.3512 5.8753 12.8194 7.24439C12.6925 7.57126 12.3778 7.78661 12.0272 7.78663C11.6765 7.78666 11.3618 7.57134 11.2348 7.24449C10.7077 5.888 9.01516 5.15808 7.2516 5.48894C6.40218 5.6483 5.61731 6.05018 5.04927 6.68062Z" fill="currentColor"></path>',
  },
  {
    key: "hdrCheezefarm",
    href: "/cheezefarm",
    label: "치즈팜",
    svg: '<path d="M7.54671 8.31941C7.79368 8.122 8.12469 8.07586 8.42464 8.17586L13.5047 9.87019C13.7995 9.96868 14.0314 10.2003 14.1297 10.4952L15.8221 15.5743C15.9221 15.8742 15.8759 16.2043 15.6785 16.4512C13.8267 18.7678 9.40527 22.2398 4.03303 20.5518C3.78937 20.4751 3.59078 20.2973 3.48616 20.0675L3.4471 19.9659C1.75912 14.5937 5.23024 10.1714 7.54671 8.31941ZM8.28303 9.92098C6.29355 11.6585 3.92805 15.0765 4.951 19.047C8.92227 20.0708 12.3394 17.7039 14.077 15.7139L12.6287 11.3692L8.28303 9.92098Z" fill="currentColor"></path><path d="M17.3371 3.28879C17.7228 2.90341 18.3478 2.90341 18.7335 3.28879L20.7101 5.26535C21.0959 5.65118 21.0959 6.27698 20.7101 6.66281L17.047 10.3259C16.6612 10.7117 16.0354 10.7117 15.6496 10.3259L13.673 8.34934C13.2876 7.96359 13.2876 7.3386 13.673 6.95285L17.3371 3.28879ZM15.379 7.6511L16.3478 8.61985L19.004 5.9636L18.0353 4.99485L15.379 7.6511Z" fill="currentColor"></path><path d="M15.9171 9.28511L9.30776 15.8925C8.97575 16.224 8.4374 16.2234 8.10561 15.8916C7.77417 15.5595 7.77479 15.0221 8.10659 14.6904L14.715 8.08198L15.9171 9.28511Z" fill="currentColor"></path>',
  },
];
// 헤더 미니 네비 표시 설정(전역). 미설정 항목은 HEADER_NAV_DEFAULT_SHOWN로 판정.
let headerNavConfig = {};
// 사이드바 항목/섹션 숨김 마커 클래스(JS가 식별해 부여, CSS가 숨김).
const SIDEBAR_HIDE_ITEM_CLASS = "cheese-sb-hide";
// 재생바 댓글 타임스탬프 마커 표시 on/off(전역, chrome.storage 저장). 디폴트 ON.
const COMMENT_MARKERS_ENABLED_KEY = "cheeseCommentMarkersEnabled";
// 댓글 타임스탬프 기능 전체 on/off(버튼 우클릭 메뉴로 토글, 전역 저장). 디폴트 ON.
// off면 버튼 비활성(opacity)+좌클릭 무효+마커 미표시, 우클릭만 가능.
const COMMENT_FEATURE_ENABLED_KEY = "cheeseCommentFeatureEnabled";
const COMMENT_FEATURE_OFF_CLASS = "comment-timestamp-feature-off";
const COMMENT_FEATURE_MENU_CLASS = "cheese-search-comment-feature-menu";
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
  `.${LIVE_DETAIL_START_TOOLTIP_CLASS}`,
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
  keepControlsObserver: null,
  keepControlsRoot: null,
  panelTimeUpdateVideo: null,
  panelTimeUpdateHandler: null,
  currentPanelMarkerSeconds: "",
  // 재생바 마커 표시 여부(전역 설정 캐시). 디폴트 ON. 시작 시 storage에서 로드.
  markersEnabled: true,
  // 댓글 타임스탬프 기능 전체 활성 여부(우클릭 메뉴 토글, 전역 설정 캐시). 디폴트 ON.
  featureEnabled: true,
};

// 치지직은 마우스 비활성 시 플레이어 루트(.pzp-pc)에서 `pzp-pc--controls`
// 클래스를 제거해 하단 컨트롤을 숨긴다. 패널이 열린 동안 이 클래스를 강제로
// 유지하면 native 표시 로직을 그대로 활용해 컨트롤이 사라지지 않게 한다.
const PZP_CONTROLS_CLASS = "pzp-pc--controls";

function keepCommentPanelControlsVisible(root) {
  releaseCommentPanelControlsVisible();
  if (!root) return;
  commentMarkerState.keepControlsRoot = root;
  if (!root.classList.contains(PZP_CONTROLS_CLASS)) {
    root.classList.add(PZP_CONTROLS_CLASS);
  }
  commentMarkerState.keepControlsObserver = new MutationObserver(() => {
    const r = commentMarkerState.keepControlsRoot;
    if (r && !r.classList.contains(PZP_CONTROLS_CLASS)) {
      r.classList.add(PZP_CONTROLS_CLASS);
    }
  });
  commentMarkerState.keepControlsObserver.observe(root, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

function releaseCommentPanelControlsVisible() {
  if (commentMarkerState.keepControlsObserver) {
    commentMarkerState.keepControlsObserver.disconnect();
    commentMarkerState.keepControlsObserver = null;
  }
  commentMarkerState.keepControlsRoot = null;
}

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
  needsRefreshBeforeSearch: false,
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
const STUDIO_DELETE_VERIFY_ATTEMPTS = 4;
const STUDIO_DELETE_VERIFY_INTERVAL_MS = 700;
const STUDIO_DELETE_VERIFY_PAGE_SIZE = 50;
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
    panel?.querySelector(":scope > header") ||
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
    findPaginationByCurrentPage(panel) ||
    document.querySelector(SELECTORS.pagination) ||
    findPaginationByCurrentPage(document) ||
    state.originalPaginationElement ||
    null
  );
}

function findPaginationByCurrentPage(root) {
  const currentPage = root?.querySelector?.('button[aria-current="page"]');
  if (!currentPage) return null;
  return (
    currentPage.closest('[class*="_container_pvn19_"]') ||
    currentPage.closest("nav") ||
    currentPage.closest("div")
  );
}

function getNativeContentList(panel) {
  const lists = Array.from(panel?.querySelectorAll(SELECTORS.list) || []);
  return (
    lists.find(
      (list) => !list.classList.contains("cheese-search-results-list"),
    ) ||
    findContentListByItemLinks(panel) ||
    null
  );
}

function findContentListByItemLinks(root) {
  if (!root) return null;
  const itemLinks = Array.from(root.querySelectorAll(getContentItemSelector()))
    .filter((element) => element.closest(".cheese-search-shell") == null)
    .filter(
      (element) => element.closest(".cheese-search-results-list") == null,
    );
  if (!itemLinks.length) return null;

  const candidates = new Map();
  itemLinks.forEach((link) => {
    const container = findContentListContainer(link, root);
    if (!container || container === root) return;
    candidates.set(
      container,
      (candidates.get(container) || 0) + countContentItems(container),
    );
  });

  return (
    Array.from(candidates.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([container]) => container)[0] || null
  );
}

function getContentItemSelector() {
  return isClipContent()
    ? 'a[href^="/clips/"], a[href*="chzzk.naver.com/clips/"]'
    : 'a[href^="/video/"], a[href*="chzzk.naver.com/video/"]';
}

function findContentListContainer(link, root) {
  const item = link.closest('li, article, [role="listitem"]');
  if (item?.parentElement && root.contains(item.parentElement)) {
    return item.parentElement;
  }

  const requiredChildCount = Math.min(
    2,
    root.querySelectorAll(getContentItemSelector()).length,
  );
  let current = link.parentElement;
  while (current && current !== root && root.contains(current)) {
    if (countContentItemChildren(current) >= requiredChildCount) {
      return current;
    }
    current = current.parentElement;
  }
  return link.parentElement;
}

function countContentItemChildren(container) {
  return Array.from(container?.children || []).filter((child) =>
    child.querySelector(getContentItemSelector()),
  ).length;
}

function countContentItems(container) {
  return container?.querySelectorAll(getContentItemSelector()).length || 0;
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
  // 결과 리스트는 전적으로 자체 CSS(.cheese-search-results-list + data-content-type)
  // 로 그리드/카드를 스타일링한다. 치지직 네이티브 리스트 클래스를 복사하면
  // 빌드마다 바뀌는 네이티브 CSS가 우리 그리드와 충돌하므로 붙이지 않는다.
  searchList.className = "cheese-search-results-list";
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
  harvestNativeCardClasses();
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

// 치지직 카드의 CSS 모듈 클래스는 빌드마다 해시가 바뀐다. 카드에는 항상 우리
// 고정 클래스(video_card_*/clip_card_* — content.css의 fallback 훅)를 부여하고,
// 추가로 페이지의 실제 네이티브 카드에서 슬롯별 현재 클래스를 채집해 함께 붙인다.
// → 치지직 네이티브 CSS를 1차 상속받고, 끊기면 우리 CSS가 그대로 받친다.
// 클립 카드는 우리 자체 디자인(세로 배경+그라데이션 오버레이)이 완결형이라
// 네이티브 클래스를 붙이지 않는다. 따라서 채집은 동영상(videos)에만 적용한다.
const nativeCardClassCache = { videos: null };

function harvestNativeCardClasses() {
  const type = getContentConfig().contentType;
  if (type !== "videos" || nativeCardClassCache[type]) return;
  const { panel } = getPanelElements();
  const nativeList = getNativeContentList(panel);
  const item = nativeList?.querySelector(
    ":scope > li:not(.cheese-search-card)",
  );
  if (!item) return;
  const harvested = harvestVideoCardClasses(item);
  if (harvested) nativeCardClassCache[type] = harvested;
}

function readClassName(element) {
  if (!element) return "";
  const raw =
    typeof element.className === "string"
      ? element.className
      : (element.getAttribute?.("class") ?? "");
  return String(raw || "").trim();
}

function harvestVideoCardClasses(item) {
  const container = item.querySelector(":scope > div");
  const thumbnail = container?.querySelector(":scope > a");
  const image = thumbnail?.querySelector(":scope > img");
  const description = thumbnail?.querySelector(":scope > div");
  const badge = description?.querySelector(":scope > em");
  const time = thumbnail?.querySelector(":scope > span:not(.blind)");
  const wrapper = container?.querySelector(":scope > div:nth-child(2)");
  const area = wrapper?.querySelector(":scope > div:first-child");
  const title = area?.querySelector(":scope > a");
  const information = area?.querySelector(":scope > div");
  const infoItem = information?.querySelector(":scope > span");
  const category = item.querySelector(
    'a[href*="tags="] span, span[class*="_category_"], span[class*="_tag_"]',
  );
  const layer = wrapper?.querySelector(":scope > div:last-child");
  const moreButton = layer?.querySelector("button");

  return {
    item: readClassName(item),
    container: readClassName(container),
    thumbnail: readClassName(thumbnail),
    image: readClassName(image),
    description: readClassName(description),
    badge: readClassName(badge),
    time: readClassName(time),
    wrapper: readClassName(wrapper),
    area: readClassName(area),
    title: readClassName(title),
    information: readClassName(information),
    infoItem: readClassName(infoItem),
    category: readClassName(category),
    layer: readClassName(layer),
    moreButton: readClassName(moreButton),
  };
}

// 현재 콘텐츠 타입의 채집된 네이티브 클래스(없으면 빈 문자열)를 반환한다.
function nativeCls(slot) {
  const type = getContentConfig().contentType;
  return nativeCardClassCache[type]?.[slot] || "";
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
    nativeCls("badge"),
    isUploadVideo ? "cheese-search-upload-badge" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const thumbnailClasses = [
    "video_card_thumbnail__QXYT8",
    nativeCls("thumbnail"),
    isAdult ? "video_card_is_adult__f3RBL" : "",
    isAdult && !showThumbnail ? "video_card_is_dimmed__9YEzr" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const categoryUrl = getCategoryUrl(video);
  const nativeCategoryCls = nativeCls("category");
  const categoryHtml = video.videoCategoryValue
    ? categoryUrl
      ? `<a href="${escapeAttribute(categoryUrl)}" target="_blank" rel="noreferrer" data-cheese-category-filter="${escapeAttribute(video.videoCategoryValue)}"><span class="video_card_category__xQ15T ${nativeCategoryCls}">${escapeHtml(video.videoCategoryValue)}</span></a>`
      : `<span class="video_card_category__xQ15T ${nativeCategoryCls}">${escapeHtml(video.videoCategoryValue)}</span>`
    : "";
  const tagHtml = tags
    .map((tag) => {
      const safeTag = escapeHtml(tag);
      return `<a href="${escapeAttribute(getTagUrl(tag))}" target="_blank" rel="noreferrer"><span class="video_card_category__xQ15T video_card_tag__4NF6R ${nativeCategoryCls}">${safeTag}</span></a>`;
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

  const infoItemCls = nativeCls("infoItem");
  return `
    <li class="cheese-search-card channel_vod_item__PhCKQ ${nativeCls("item")}">
      <div class="video_card_container__urjO6 video_card_vertical__+gTMT ${nativeCls("container")}">
        <a class="${thumbnailClasses}" href="${getVideoUrl(video)}" target="_blank" rel="noreferrer" title="${escapeAttribute(isAdult ? "" : video.videoTitle || "")}">
          ${isAdult ? `<span class="blind">19 연령 제한</span>` : ""}
          ${showThumbnail && thumbnailImageUrl ? `<img width="100%" height="100%" alt="" src="${escapeAttribute(thumbnailImageUrl)}" class="video_card_image__yHXqv ${nativeCls("image")}" loading="lazy">` : ""}
          <div class="video_card_description__2sUfw ${nativeCls("description")}">
            <em class="${videoTypeBadgeClasses}">${videoTypeLabel}</em>
            ${livePvBadge}
          </div>
          <span class="video_card_time__NAWm6 ${nativeCls("time")}">${formatDuration(video.duration)}</span>
          ${watchTimelineBar}
          <span class="blind">${escapeHtml(video.channel?.channelName || "")}동영상 엔드로 이동</span>
        </a>
        <div class="video_card_wrapper__M6XT7 ${nativeCls("wrapper")}">
          <div class="video_card_area__FtMQV ${nativeCls("area")}">
            <a class="video_card_title__Amjk2 ${nativeCls("title")}" href="${getVideoUrl(video)}" target="_blank" rel="noreferrer">${escapeHtml(video.videoTitle || "제목 없음")}<span class="blind">동영상 엔드로 이동</span></a>
            <div class="video_card_information__1w2l- ${nativeCls("information")}">
              <span class="video_card_item__lOC8Y ${infoItemCls}">조회수 ${formatCount(video.readCount)}회</span>
              ${commentCountHtml}
              <div class="video_card_time_info">
                <span class="video_card_item__lOC8Y ${infoItemCls}">${escapeHtml(formatLiveStartDateTime(video))}</span>
                <span class="video_card_item__lOC8Y ${infoItemCls}">${escapeHtml(formatPublishDateTime(video))}</span>
              </div>
            </div>
            ${categoryHtml || tagHtml ? `<div class="video_card_information__1w2l- video_card_link__XSQ6l ${nativeCls("information")}">${categoryHtml}${tagHtml}</div>` : ""}
          </div>
          <div class="video_card_layer__WHTbQ ${nativeCls("layer")}">
            <div>
              <button type="button" class="video_card_more_button__yXWHm ${nativeCls("moreButton")}" aria-haspopup="true" aria-expanded="false">
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

// 마커 표시 설정을 storage에서 1회 로드해 메모리에 캐시한다(없으면 디폴트 ON 유지).
let commentMarkersEnabledLoaded = false;
async function loadCommentMarkersEnabled() {
  if (commentMarkersEnabledLoaded) return;
  commentMarkersEnabledLoaded = true;
  if (!chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get(COMMENT_MARKERS_ENABLED_KEY);
    const value = data?.[COMMENT_MARKERS_ENABLED_KEY];
    // 저장값이 명시적으로 false일 때만 끈다(미설정/true는 ON).
    if (value === false) {
      commentMarkerState.markersEnabled = false;
      // 로드 시점에 이미 마커가 그려졌다면 즉시 반영.
      applyCommentMarkersEnabled();
    }
  } catch {
    // 설정 로드 실패 시 디폴트(ON) 유지.
  }
}

function setCommentMarkersEnabled(enabled) {
  commentMarkerState.markersEnabled = Boolean(enabled);
  if (chrome.storage?.local) {
    try {
      chrome.storage.local.set({
        [COMMENT_MARKERS_ENABLED_KEY]: commentMarkerState.markersEnabled,
      });
    } catch {
      // 저장 실패해도 이번 세션 동작엔 영향 없음.
    }
  }
  applyCommentMarkersEnabled();
}

// 현재 설정을 재생바 마커에 반영한다. 끄면 레이어 제거, 켜면 다시 렌더.
// 패널이 열려 있으면 토글 스위치 상태도 갱신한다.
function applyCommentMarkersEnabled() {
  if (commentMarkerState.markersEnabled) {
    scheduleCommentMarkerRender(0);
  } else {
    document
      .querySelectorAll(`.${VIDEO_COMMENT_MARKER_LAYER_CLASS}`)
      .forEach((layer) => layer.remove());
    removeCommentMarkerPreviewTooltip();
  }
  syncCommentMarkersToggle();
}

function syncCommentMarkersToggle() {
  const input = document.querySelector("[data-comment-markers-toggle]");
  if (input) input.checked = commentMarkerState.markersEnabled;
}

// ── 댓글 타임스탬프 기능 전체 on/off (버튼 우클릭 메뉴) ──────────────────────
let commentFeatureEnabledLoaded = false;
async function loadCommentFeatureEnabled() {
  if (commentFeatureEnabledLoaded) return;
  commentFeatureEnabledLoaded = true;
  if (!chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get(COMMENT_FEATURE_ENABLED_KEY);
    if (data?.[COMMENT_FEATURE_ENABLED_KEY] === false) {
      commentMarkerState.featureEnabled = false;
      applyCommentFeatureEnabled();
    }
  } catch {
    // 로드 실패 시 디폴트(ON) 유지.
  }
}

function setCommentFeatureEnabled(enabled) {
  commentMarkerState.featureEnabled = Boolean(enabled);
  if (chrome.storage?.local) {
    try {
      chrome.storage.local.set({
        [COMMENT_FEATURE_ENABLED_KEY]: commentMarkerState.featureEnabled,
      });
    } catch {
      // 저장 실패해도 이번 세션 동작엔 영향 없음.
    }
  }
  applyCommentFeatureEnabled();
}

// 기능 off면 열린 패널을 닫고 마커를 제거한다. 버튼 비활성 표시/마커는
// updateCommentTimestampButton·renderCommentTimestampMarkers가 처리한다.
function applyCommentFeatureEnabled() {
  if (!commentMarkerState.featureEnabled) {
    closeCommentTimestampPanel();
    document
      .querySelectorAll(`.${VIDEO_COMMENT_MARKER_LAYER_CLASS}`)
      .forEach((layer) => layer.remove());
    removeCommentMarkerPreviewTooltip();
  } else {
    if (commentMarkerState.markersEnabled) scheduleCommentMarkerRender(0);
  }
  updateCommentTimestampButton();
}

function toggleCommentFeatureEnabled() {
  setCommentFeatureEnabled(!commentMarkerState.featureEnabled);
}

function initCommentTimestampMarkers() {
  // 팝업에서 댓글 타임스탬프를 숨김 처리하면 버튼/마커/패널을 모두 제거하고 끝낸다.
  if (featureFlags.commentTimestamp) {
    closeCommentTimestampPanel();
    resetCommentTimestampMarkers();
    document
      .querySelectorAll(`.${VIDEO_COMMENT_BUTTON_CLASS}`)
      .forEach((b) => b.remove());
    return;
  }
  void loadCommentMarkersEnabled();
  void loadCommentFeatureEnabled();
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

// ── seek preview 실제 방송 시각 병기 ────────────────────────────────────────
// 다시보기 진입 시 호출. 새 영상이면 liveOpenDate를 확보하고 seek preview 옵저버를
// (재)설정한다. 다시보기가 아니면 정리.
function initSeekPreviewRealtime() {
  const videoNo = getCurrentVideoNo();
  if (!videoNo) {
    teardownSeekPreviewObserver();
    seekPreviewState.videoNo = "";
    seekPreviewState.liveOpenAt = 0;
    seekPreviewState.publishAt = 0;
    return;
  }
  if (seekPreviewState.videoNo !== videoNo) {
    seekPreviewState.videoNo = videoNo;
    seekPreviewState.liveOpenAt = 0;
    seekPreviewState.publishAt = 0;
    void fetchVideoDates(videoNo);
  }
  startSeekPreviewObserver();
}

async function fetchVideoDates(videoNo) {
  if (seekPreviewState.fetching) return;
  seekPreviewState.fetching = true;
  try {
    const res = await fetch(
      `https://api.chzzk.naver.com/service/v2/videos/${videoNo}`,
      { credentials: "include", headers: { accept: "application/json" } },
    );
    if (!res.ok) return;
    const json = await res.json();
    if (seekPreviewState.videoNo !== videoNo) return; // 그새 영상 전환됨
    const c = json?.content || {};
    // 라이브 다시보기는 liveOpenDate 보유, 업로드 영상은 publishDate만.
    seekPreviewState.liveOpenAt = parsePublishDate(c.liveOpenDate) || 0;
    seekPreviewState.publishAt = parsePublishDate(c.publishDate) || 0;
    // 이미 떠 있는 seek preview / 정보 툴팁에 즉시 반영.
    updateSeekPreviewRealtime();
    updateVideoInfoLabel();
  } catch {
    // 실패 시 교체 생략(원래 표기 유지).
  } finally {
    seekPreviewState.fetching = false;
  }
}

function startSeekPreviewObserver() {
  if (seekPreviewState.observer) return;
  // 문서 전체를 보는 옵저버라 라이브/다시보기에서 매우 자주 깨어난다. rAF로 묶어
  // 프레임당 1회만 갱신해 비용을 줄인다(갱신 자체는 querySelector 1회로 가볍다).
  let scheduled = false;
  const obs = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      updateSeekPreviewRealtime();
      updateVideoInfoLabel();
    });
  });
  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  seekPreviewState.observer = obs;
}

function teardownSeekPreviewObserver() {
  if (seekPreviewState.observer) {
    seekPreviewState.observer.disconnect();
    seekPreviewState.observer = null;
  }
}

// "3:50:59" / "27:38" → 초. 실패 시 NaN.
function parseClockToSeconds(text) {
  const parts = String(text || "")
    .trim()
    .split(":")
    .map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// ms → "26.06.22. 오후 1:49:59" (12시간제, YY.MM.DD.)
function formatKstClock(ms) {
  const d = new Date(ms);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const h24 = d.getHours();
  const ampm = h24 < 12 ? "오전" : "오후";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");
  return `${yy}.${mm}.${dd}. ${ampm} ${h12}:${min}:${sec}`;
}

// liveOpenAt(ms) + 초 → "26.06.22. 오후 1:49:59"
function formatBroadcastClock(baseMs, offsetSeconds) {
  return `${formatKstClock(baseMs + offsetSeconds * 1000)}`;
}

// 현재 떠 있는 seek preview의 시간 아래에 실제 방송 시각을 병기/갱신한다.
function updateSeekPreviewRealtime() {
  // 팝업에서 숨김 처리하면 이미 붙은 병기 줄을 제거하고 끝낸다.
  if (featureFlags.seekPreviewRealtime) {
    document
      .querySelectorAll(`.${SEEK_PREVIEW_REALTIME_CLASS}`)
      .forEach((el) => el.remove());
    return;
  }
  if (!seekPreviewState.liveOpenAt) return;
  const timeEl = document.querySelector(SEEK_PREVIEW_TIME_SELECTOR);
  if (!timeEl) return;
  // 우리가 추가한 줄(있으면)을 제외한 순수 시간 텍스트만 파싱.
  const existing = timeEl.querySelector(`.${SEEK_PREVIEW_REALTIME_CLASS}`);
  const baseText = existing
    ? timeEl.textContent.replace(existing.textContent, "")
    : timeEl.textContent;
  const seconds = parseClockToSeconds(baseText);
  if (!Number.isFinite(seconds)) return;
  const label = formatBroadcastClock(seekPreviewState.liveOpenAt, seconds);
  if (existing) {
    if (existing.textContent !== label) existing.textContent = label;
    return;
  }
  const span = document.createElement("span");
  span.className = SEEK_PREVIEW_REALTIME_CLASS;
  span.textContent = label;
  timeEl.appendChild(span);
}

// 영상 정보 영역의 등록일/라이브 시작일 툴팁(._label_..._77)을 전체 날짜·시각으로
// 교체한다. "등록일 : <publishDate>", 라이브 다시보기면 "<br>라이브 시작일 :
// <liveOpenDate>"를 덧붙인다. 업로드 영상(liveOpenAt 없음)은 등록일만 둔다.
function updateVideoInfoLabel() {
  if (!seekPreviewState.publishAt && !seekPreviewState.liveOpenAt) return;
  // 영상 페이지의 라벨만 대상으로 한다('등록일'을 포함한 _label).
  const labels = document.querySelectorAll(VIDEO_INFO_LABEL_SELECTOR);
  labels.forEach((label) => {
    if (!label.textContent.includes("등록일")) return;
    const parts = [];
    if (seekPreviewState.publishAt) {
      parts.push(`등록일 : ${formatKstClock(seekPreviewState.publishAt)}`);
    }
    if (seekPreviewState.liveOpenAt) {
      parts.push(
        `라이브 시작일 : ${formatKstClock(seekPreviewState.liveOpenAt)}`,
      );
    }
    if (!parts.length) return;
    const html = parts.join("<br>");
    // 이미 우리가 쓴 내용과 같으면 건너뛴다(옵저버 루프/불필요한 리플로우 방지).
    // 치지직이 다시 "06.20"으로 되돌리면 innerHTML이 달라지므로 재적용된다.
    if (label.innerHTML === html) return;
    label.innerHTML = html;
  });
}

function getCurrentLiveChannelId() {
  const match = location.pathname.match(/^\/live\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function initLiveDetailStartTooltip() {
  const channelId = getCurrentLiveChannelId();
  if (!channelId) {
    liveDetailState.channelId = "";
    liveDetailState.liveOpenAt = 0;
    return;
  }

  if (liveDetailState.channelId !== channelId) {
    liveDetailState.channelId = channelId;
    liveDetailState.liveOpenAt = 0;
    liveDetailState.fetching = false;
    void fetchLiveDetailStartDate(channelId);
    return;
  }

  if (!liveDetailState.liveOpenAt && !liveDetailState.fetching) {
    void fetchLiveDetailStartDate(channelId);
    return;
  }
  updateLiveDetailStartTooltip();
}

async function fetchLiveDetailStartDate(channelId) {
  if (liveDetailState.fetching) return;
  liveDetailState.fetching = true;
  try {
    const res = await fetch(
      `https://api.chzzk.naver.com/polling/v3.1/channels/${encodeURIComponent(channelId)}/live-status`,
      { credentials: "include", headers: { accept: "application/json" } },
    );
    if (!res.ok) return;
    const json = await res.json();
    if (liveDetailState.channelId !== channelId) return;
    const openAt = parsePublishDate(json?.content?.openDate);
    liveDetailState.liveOpenAt = Number.isFinite(openAt) ? openAt : 0;
    updateLiveDetailStartTooltip();
  } catch {
    // 실패 시 원본 표시 유지.
  } finally {
    liveDetailState.fetching = false;
  }
}

function updateLiveDetailStartTooltip() {
  if (!liveDetailState.liveOpenAt) return;
  const data = findLiveDetailDataElement();
  if (!data) return;
  data.classList.add(LIVE_DETAIL_START_TARGET_CLASS);

  const text = `라이브 시작 시간 : ${formatKstClock(liveDetailState.liveOpenAt)}`;
  let label = data.querySelector(`.${LIVE_DETAIL_START_TOOLTIP_CLASS}`);
  if (!label) {
    label = document.createElement("span");
    label.className = LIVE_DETAIL_START_TOOLTIP_CLASS;
    data.appendChild(label);
  }
  if (label.textContent !== text) label.textContent = text;
}

function findLiveDetailDataElement() {
  const main = document.querySelector("div#layout-body main");
  if (!main) return null;
  const candidates = main.querySelectorAll('div[class*="_data_"]');
  for (const el of candidates) {
    const text = String(el.textContent || "");
    if (text.includes("시청 중") && text.includes("스트리밍 중")) return el;
  }
  return null;
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
    button.addEventListener(
      "contextmenu",
      handleCommentTimestampButtonContextMenu,
    );
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
  const featureOff = !commentMarkerState.featureEnabled;
  const count = commentMarkerState.markers.length;
  const isLoading =
    commentMarkerState.loadingVideoNo &&
    commentMarkerState.loadingVideoNo === getCurrentVideoNo();
  // 기능이 꺼져 있으면 마커 수와 무관하게 비활성(좌클릭 무효, opacity 적용).
  const isDisabled = featureOff || (!isLoading && count === 0);
  button.classList.toggle("is-loading", Boolean(isLoading) && !featureOff);
  button.classList.toggle("has-markers", count > 0 && !featureOff);
  button.classList.toggle(COMMENT_FEATURE_OFF_CLASS, featureOff);
  button.classList.toggle(VIDEO_COMMENT_BUTTON_DISABLED_CLASS, isDisabled);
  button.setAttribute("aria-disabled", isDisabled ? "true" : "false");
  button.setAttribute(
    "aria-label",
    featureOff
      ? "댓글 타임스탬프 꺼짐 (우클릭으로 켜기)"
      : isLoading
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
  // 기능이 꺼져 있으면 좌클릭은 무효(우클릭 메뉴로만 다시 켤 수 있다).
  if (!commentMarkerState.featureEnabled) return;
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

// 우클릭 → 기능 켜기/끄기 팝오버. 기능 off 상태에서도 항상 동작한다.
function handleCommentTimestampButtonContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  toggleCommentFeatureMenu(event.currentTarget);
}

function toggleCommentFeatureMenu(anchor) {
  const existing = document.querySelector(`.${COMMENT_FEATURE_MENU_CLASS}`);
  if (existing) {
    closeCommentFeatureMenu();
    return;
  }
  openCommentFeatureMenu(anchor);
}

function openCommentFeatureMenu(anchor) {
  closeCommentFeatureMenu();
  const root = getCommentTimestampPanelRoot(anchor);
  if (!root) return;
  if (getComputedStyle(root).position === "static") {
    root.style.position = "relative";
  }
  root.style.overflow = "visible";
  const on = commentMarkerState.featureEnabled;
  const menu = document.createElement("div");
  menu.className = COMMENT_FEATURE_MENU_CLASS;
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" class="cheese-search-comment-feature-item" data-comment-feature-toggle role="menuitemcheckbox" aria-checked="${on}">
      <span class="cheese-search-comment-feature-check" aria-hidden="true">${on ? "✓" : ""}</span>
      <span>댓글 타임스탬프 ${on ? "켜짐" : "꺼짐"}</span>
    </button>
    <p class="cheese-search-comment-feature-hint">끄면 재생바 마커와 목록이 숨겨지고 아이콘이 비활성화됩니다.</p>`;
  root.append(menu);
  keepCommentPanelControlsVisible(root);
  positionCommentFeatureMenu(menu, anchor, root);
}

function positionCommentFeatureMenu(menu, anchor, root) {
  const rootRect = root.getBoundingClientRect();
  const btnRect = (anchor || menu).getBoundingClientRect();
  menu.style.bottom = `${rootRect.bottom - btnRect.top + 12}px`;
  let right = rootRect.right - btnRect.right - 40;
  right = Math.max(8, Math.min(right, root.clientWidth - menu.offsetWidth - 8));
  menu.style.right = `${right}px`;
}

function closeCommentFeatureMenu() {
  const menu = document.querySelector(`.${COMMENT_FEATURE_MENU_CLASS}`);
  if (!menu) return;
  menu.remove();
  // 패널이 닫혀 있으면 컨트롤 유지 해제(패널이 잡고 있으면 그대로 둠).
  if (!document.querySelector(`.${VIDEO_COMMENT_PANEL_CLASS}`)) {
    releaseCommentPanelControlsVisible();
  }
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
  // 패널이 열린 동안 native 하단 컨트롤이 자동으로 숨겨지지 않도록 유지한다.
  keepCommentPanelControlsVisible(root);
  renderCommentTimestampPanel(panel);
  positionCommentTimestampPanel(panel, root);
  startCommentTimestampPanelTimeTracker();
  updateCommentTimestampPanelCurrentMarker({ scroll: true });
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
  stopCommentTimestampPanelTimeTracker();
  stopCommentTimestampPanelAnchorMonitor();
  releaseCommentPanelControlsVisible();
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
      <label class="cheese-search-comment-markers-switch" data-tooltip="${commentMarkerState.markersEnabled ? "재생바 표시 끄기" : "재생바 표시 켜기"}">
        <input type="checkbox" data-comment-markers-toggle ${commentMarkerState.markersEnabled ? "checked" : ""} aria-label="재생바에 댓글 마커 표시">
        <i aria-hidden="true"></i>
      </label>
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
  panel
    .querySelector("[data-comment-markers-toggle]")
    ?.addEventListener("change", (e) => {
      setCommentMarkersEnabled(e.currentTarget.checked);
      // 스위치 라벨 툴팁 갱신.
      const label = e.currentTarget.closest(
        ".cheese-search-comment-markers-switch",
      );
      if (label) {
        label.setAttribute(
          "data-tooltip",
          commentMarkerState.markersEnabled
            ? "재생바 표시 끄기"
            : "재생바 표시 켜기",
        );
      }
    });
  panel.querySelectorAll("[data-comment-marker-seek]").forEach((button) => {
    button.addEventListener("click", handleCommentTimestampPanelSeek);
  });
  updateCommentTimestampPanelCurrentMarker({ scroll: false });
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

function startCommentTimestampPanelTimeTracker() {
  stopCommentTimestampPanelTimeTracker();
  const video = document.querySelector("video");
  if (!video) return;
  const handler = () => updateCommentTimestampPanelCurrentMarker();
  commentMarkerState.panelTimeUpdateVideo = video;
  commentMarkerState.panelTimeUpdateHandler = handler;
  video.addEventListener("timeupdate", handler);
  video.addEventListener("seeked", handler);
}

function stopCommentTimestampPanelTimeTracker() {
  const video = commentMarkerState.panelTimeUpdateVideo;
  const handler = commentMarkerState.panelTimeUpdateHandler;
  if (video && handler) {
    video.removeEventListener("timeupdate", handler);
    video.removeEventListener("seeked", handler);
  }
  commentMarkerState.panelTimeUpdateVideo = null;
  commentMarkerState.panelTimeUpdateHandler = null;
  commentMarkerState.currentPanelMarkerSeconds = "";
}

function updateCommentTimestampPanelCurrentMarker({ scroll = false } = {}) {
  const panel = document.querySelector(`.${VIDEO_COMMENT_PANEL_CLASS}`);
  if (!panel) return;
  const marker = findCurrentCommentTimestampMarker();
  const markerSeconds = marker ? String(Number(marker.seconds)) : "";
  const previousMarkerSeconds = commentMarkerState.currentPanelMarkerSeconds;
  if (!scroll && markerSeconds === previousMarkerSeconds) {
    return;
  }
  commentMarkerState.currentPanelMarkerSeconds = markerSeconds;
  const shouldScroll =
    Boolean(markerSeconds) &&
    (scroll || markerSeconds !== previousMarkerSeconds);

  panel.querySelectorAll("[data-comment-marker-seek]").forEach((button) => {
    const isCurrent =
      markerSeconds &&
      Math.abs(
        Number(button.dataset.commentMarkerSeek) - Number(markerSeconds),
      ) < 0.001;
    button.classList.toggle("is-current", Boolean(isCurrent));
    if (isCurrent) {
      button.setAttribute("aria-current", "true");
      if (shouldScroll) {
        // scrollIntoView는 패널뿐 아니라 페이지 전체를 스크롤시켜(팝오버가 화면 밖
        // 으로 인식됨) 페이지가 아래로 튄다. 패널 목록 컨테이너의 scrollTop만 직접
        // 조정해 페이지는 건드리지 않는다.
        scrollPanelListToButton(panel, button);
      }
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

// 댓글 패널 목록(.cheese-search-comment-panel-list) 안에서만 현재 항목이 가운데
// 오도록 scrollTop을 조정한다(getBoundingClientRect 기준이라 offsetParent와 무관,
// 페이지 스크롤 영향 없음).
function scrollPanelListToButton(panel, button) {
  const list = panel.querySelector(".cheese-search-comment-panel-list");
  if (!list) return;
  const item = button.closest("li") || button;
  const listRect = list.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  // 항목 중앙이 리스트 중앙에 오도록 현재 scrollTop에서 보정.
  const delta =
    itemRect.top - listRect.top - (list.clientHeight - itemRect.height) / 2;
  const max = list.scrollHeight - list.clientHeight;
  list.scrollTop = Math.max(0, Math.min(list.scrollTop + delta, max));
}

function findCurrentCommentTimestampMarker() {
  const currentTime = Number(document.querySelector("video")?.currentTime);
  if (!Number.isFinite(currentTime)) return null;
  const markers = commentMarkerState.markers
    .filter((marker) => Number.isFinite(Number(marker?.seconds)))
    .sort((a, b) => Number(a.seconds) - Number(b.seconds));
  let currentMarker = null;
  for (const marker of markers) {
    if (Number(marker.seconds) > currentTime) break;
    currentMarker = marker;
  }
  return currentMarker;
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
  // 기능 켜기/끄기 메뉴 항목 클릭 → 토글.
  const featureToggle = event.target.closest("[data-comment-feature-toggle]");
  if (featureToggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleCommentFeatureEnabled();
    closeCommentFeatureMenu();
    return;
  }
  // 메뉴 바깥 클릭 → 메뉴 닫기(버튼 클릭은 자체 핸들러가 처리).
  const menu = event.target.closest(`.${COMMENT_FEATURE_MENU_CLASS}`);
  const button = event.target.closest(`.${VIDEO_COMMENT_BUTTON_CLASS}`);
  if (!menu && !button) closeCommentFeatureMenu();

  const panel = event.target.closest(`.${VIDEO_COMMENT_PANEL_CLASS}`);
  if (panel || button) return;
  closeCommentTimestampPanel();
}

function handleCommentTimestampKeydown(event) {
  if (event.key !== "Escape") return;
  closeCommentFeatureMenu();
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
  // 기능 자체가 꺼졌거나(우클릭 토글) 마커 표시가 꺼져 있으면 재생바 마커를
  // 그리지 않는다. (기능 off는 목록까지 막지만, 여기선 마커 레이어만 정리)
  if (
    !commentMarkerState.featureEnabled ||
    !commentMarkerState.markersEnabled
  ) {
    document
      .querySelectorAll(`.${VIDEO_COMMENT_MARKER_LAYER_CLASS}`)
      .forEach((layer) => layer.remove());
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
    studioMakeClipState.needsRefreshBeforeSearch = false;
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
  closeStudioErrorDialog();
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
      if (studioMakeClipState.needsRefreshBeforeSearch) return result;
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
  if (
    !studioMakeClipState.needsRefreshBeforeSearch &&
    studioMakeClipState.preloadPromise
  ) {
    try {
      return await studioMakeClipState.preloadPromise;
    } catch {
      // 검색 동작에서는 아래의 직접 호출 결과로 오류를 표시한다.
    }
  }

  if (
    !studioMakeClipState.needsRefreshBeforeSearch &&
    studioMakeClipState.preloaded
  ) {
    return {
      channelId: studioMakeClipState.channelId,
      contentType: "makeClips",
      totalCount: studioMakeClipState.clips.length,
      totalPages: 1,
      fetchedAt: Date.now(),
      clips: studioMakeClipState.clips,
    };
  }

  const result = await sendMessage({
    type: "CHEESE_SEARCH_FETCH_MAKE_CLIPS",
    payload: getStudioMakeClipPayload(),
  });
  studioMakeClipState.needsRefreshBeforeSearch = false;
  return result;
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
  closeStudioDatePickersFromOutside(event);

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

function closeStudioDatePickersFromOutside(event) {
  const shell = document.querySelector(".cheese-search-studio-shell");
  if (!shell) return;
  if (!shell.contains(event.target)) {
    closeAllDatePickers(shell);
    return;
  }
  shell.querySelectorAll("[data-date-picker]").forEach((picker) => {
    if (!picker.contains(event.target)) closeDatePicker(picker);
  });
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
  studioMakeClipState.needsRefreshBeforeSearch = true;
  studioMakeClipState.originalRows = [];
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

function openStudioErrorDialog(
  message = "앗, 요청에 실패했습니다.\n잠시 후 다시 시도해주세요.",
) {
  document.querySelector(".cheese-search-studio-error-modal")?.remove();
  const modal = document.createElement("div");
  modal.className = "_dimmed_1h6ic_2 cheese-search-studio-error-modal";
  const lines = String(message || "")
    .split(/\r?\n/)
    .map((line) => escapeHtml(line))
    .join("<br>");
  modal.innerHTML = `
    <div class="_container_1h6ic_15" role="alertdialog" aria-modal="true" style="width: 370px;">
      <strong class="_title_1h6ic_37">안내</strong>
      <div class="_content_1h6ic_30">
        <div class="_inner_1h6ic_31">
          <p class="_text_1h6ic_97">${lines}<br></p>
        </div>
      </div>
      <div class="_footer_1h6ic_129 _default_1h6ic_21">
        <div class="_box_1h6ic_42"><button type="button" class="_container_1rfm5_2 _largest_1rfm5_27 _dark_1rfm5_47" data-studio-error-close><span class="_inner_1rfm5_116">확인</span></button></div>
      </div>
      <button type="button" class="_button_1h6ic_45" data-studio-error-close>
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg" class="_icon_close_1h6ic_169"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.79289 7.79289C8.18342 7.40237 8.81658 7.40237 9.20711 7.79289L22.2071 20.7929C22.5976 21.1834 22.5976 21.8166 22.2071 22.2071C21.8166 22.5976 21.1834 22.5976 20.7929 22.2071L7.79289 9.20711C7.40237 8.81658 7.40237 8.18342 7.79289 7.79289Z" fill="#2E3033"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M7.79289 22.2071C7.40237 21.8166 7.40237 21.1834 7.79289 20.7929L20.7929 7.79289C21.1834 7.40237 21.8166 7.40237 22.2071 7.79289C22.5976 8.18342 22.5976 8.81658 22.2071 9.20711L9.20711 22.2071C8.81658 22.5976 8.18342 22.5976 7.79289 22.2071Z" fill="#2E3033"></path></svg>
        <span class="blind">팝업 닫기</span>
      </button>
    </div>
  `;
  document.body.append(modal);
  modal.querySelectorAll("[data-studio-error-close]").forEach((button) => {
    button.addEventListener("click", closeStudioErrorDialog);
  });
}

function closeStudioErrorDialog() {
  document.querySelector(".cheese-search-studio-error-modal")?.remove();
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

async function confirmStudioMakeClipDeleted({ channelId, clipUID }) {
  for (let attempt = 0; attempt < STUDIO_DELETE_VERIFY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await wait(STUDIO_DELETE_VERIFY_INTERVAL_MS);
    }

    try {
      const exists = await fetchStudioMakeClipExists({ channelId, clipUID });
      if (!exists) return true;
    } catch {
      // 확인 요청 자체가 실패하면 원래 삭제 오류를 그대로 안내한다.
    }
  }
  return false;
}

async function fetchStudioMakeClipExists({ channelId, clipUID }) {
  const normalizedChannelId = String(channelId || "").trim();
  const normalizedClipUID = String(clipUID || "").trim();
  if (!normalizedChannelId || !normalizedClipUID) return true;

  let page = 0;
  let totalPages = 1;
  while (page < totalPages) {
    const content = await fetchStudioMakeClipVerifyPage({
      channelId: normalizedChannelId,
      page,
    });
    const clips = Array.isArray(content?.data) ? content.data : [];
    if (
      clips.some(
        (clip) => String(clip?.clipUID || "").trim() === normalizedClipUID,
      )
    ) {
      return true;
    }
    totalPages = Math.max(1, Number(content?.totalPages) || 1);
    page += 1;
  }

  return false;
}

async function fetchStudioMakeClipVerifyPage({ channelId, page }) {
  const url = new URL(
    `${STUDIO_MANAGE_API_BASE}/channels/${encodeURIComponent(channelId)}/clips/make-clips`,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(STUDIO_DELETE_VERIFY_PAGE_SIZE));
  url.searchParams.set("dateFilter", "ALL");
  url.searchParams.set("orderFilter", "LATEST");

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) {
    throw new Error(`CHZZK 클립 삭제 확인 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (Number(payload?.code) !== 200 || !payload.content) {
    throw new Error(
      payload?.message || "CHZZK 클립 삭제 확인 응답을 읽을 수 없습니다.",
    );
  }
  return payload.content;
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
  button.disabled = true;
  button.classList.add("_is_disabled_1rfm5_24");
  const label = button.querySelector("._inner_1rfm5_116");
  if (label) label.textContent = "삭제 중";

  try {
    await deleteStudioMakeClip({
      channelId: studioMakeClipState.channelId,
      clipUID,
    });
    applyStudioMakeClipDeletion(clipUID);
    closeStudioDeleteClipDialog();
    showStudioGlobalToast("삭제되었습니다.");
  } catch (deleteError) {
    if (label) label.textContent = "삭제 확인 중";
    const deletionConfirmed = await confirmStudioMakeClipDeleted({
      channelId: studioMakeClipState.channelId,
      clipUID,
    });
    if (deletionConfirmed) {
      applyStudioMakeClipDeletion(clipUID);
      closeStudioDeleteClipDialog();
      showStudioGlobalToast("삭제되었습니다.");
      return;
    }

    closeStudioDeleteClipDialog();
    const message =
      deleteError instanceof Error
        ? deleteError.message
        : "앗, 요청에 실패했습니다.\n잠시 후 다시 시도해주세요.";
    openStudioErrorDialog(message);
  }
}

function applyStudioMakeClipDeletion(clipUID) {
  const normalizedClipUID = String(clipUID || "").trim();
  if (!normalizedClipUID) return;
  studioMakeClipState.deletedClipUIDs.add(normalizedClipUID);
  studioMakeClipState.clips = studioMakeClipState.clips.filter(
    (clip) => String(clip?.clipUID || "").trim() !== normalizedClipUID,
  );
  studioMakeClipState.preloaded = false;
  studioMakeClipState.needsRefreshBeforeSearch = true;
  studioMakeClipState.resultSignature = "";
  setStudioStreamersFromClips(studioMakeClipState.clips);
  resetStudioVisibleResults();
  updateStudioMakeClipControls();
  hideDeletedStudioOriginalRows();
  if (studioMakeClipState.hasLoaded) {
    renderStudioMakeClipResults();
  }
}

function handleExternalStudioMakeClipDeletion(payload) {
  const channelId = String(payload?.channelId || "").trim();
  const clipUID = String(payload?.clipUID || "").trim();
  if (!clipUID) return;
  if (
    studioMakeClipState.channelId &&
    channelId &&
    studioMakeClipState.channelId !== channelId
  ) {
    return;
  }

  studioMakeClipState.needsRefreshBeforeSearch = true;
  studioMakeClipState.preloaded = false;
  studioMakeClipState.resultSignature = "";
  applyStudioMakeClipDeletion(clipUID);
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
  let visibleOriginalRowCount = 0;
  rows.forEach((row) => {
    const clipUID = getStudioRowClipUID(row);
    if (clipUID && studioMakeClipState.deletedClipUIDs.has(clipUID)) {
      hideOriginalElement(row);
      return;
    }
    showOriginalElement(row);
    visibleOriginalRowCount += 1;
  });
  if (!visibleOriginalRowCount) {
    ensureStudioOriginalEmptyRow(tbody);
  } else {
    clearStudioSyntheticEmptyRows(tbody);
  }
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
  const rows = getStudioNativeRows(tbody);
  const rememberedRows = studioMakeClipState.originalRows.filter(
    (row) => row.isConnected && row.parentElement === tbody,
  );
  const shouldRefreshRows =
    !rememberedRows.length ||
    rows.length !== rememberedRows.length ||
    rows.some((row) => !rememberedRows.includes(row));

  if (!shouldRefreshRows) return rememberedRows;
  studioMakeClipState.originalRows = rows;
  return rows;
}

function ensureStudioOriginalEmptyRow(tbody) {
  if (!tbody) return;
  if (tbody.querySelector("[data-cheese-studio-empty-row]")) return;
  const table = tbody.closest("table");
  const columnCount = Math.max(1, table?.tHead?.rows?.[0]?.cells?.length || 3);
  tbody.insertAdjacentHTML(
    "beforeend",
    `
      <tr class="_empty_rynbv_49" data-cheese-studio-row data-cheese-studio-empty-row>
        <td colspan="${columnCount}">
          <p class="_text_2e7iu_1">클립이 없습니다.<br>원하는 라이브를 보면서, 지금 클립을 만들어보세요.</p>
          <a class="_container_1rfm5_2 _large_1rfm5_27 _dark_1rfm5_47" href="https://chzzk.naver.com" target="_self" style="border-radius: 20px;">
            <span class="_inner_1rfm5_116">라이브 둘러보기</span>
          </a>
        </td>
      </tr>
    `,
  );
}

function clearStudioSyntheticEmptyRows(tbody) {
  tbody
    ?.querySelectorAll("[data-cheese-studio-empty-row]")
    .forEach((row) => row.remove());
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

// ── 기능 표시/숨김 플래그 로드 + MAIN world 전달 ────────────────────────────
// 저장값에 명시된 boolean이면 그 값, 없으면 false(표시)가 기본.
function applyFeatureFlags(value) {
  const obj = value && typeof value === "object" ? value : {};
  for (const k of Object.keys(featureFlags)) {
    featureFlags[k] = obj[k] === true;
  }
  // MAIN world 스크립트(오디오믹서/비디오필터)에 전달.
  broadcastFeatureFlags();
  applySidebarHidden();
  applyHeaderAutoHide();
  // seek preview 병기 토글 즉시 반영(이미 떠 있는 preview에 추가/제거).
  updateSeekPreviewRealtime();
  // 격리 월드 기능 즉시 반영(검색 게이트 + 댓글 타임스탬프; init이 후자도 호출).
  init();
}

// 사이드바 숨김(전체 + 항목/섹션별)을 <style> 규칙으로 토글한다. CSS라 SPA
// 재렌더에도 유지되고 레이아웃 폭도 함께 회수된다.
function applySidebarHidden() {
  let style = document.getElementById(SIDEBAR_HIDE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = SIDEBAR_HIDE_STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  const rules = [];
  if (featureFlags.sidebar) {
    // 사이드바 전체를 숨기고, 콘텐츠(div#layout-body) 패딩을 0으로(공간 회수).
    rules.push(
      `aside#sidebar { display: none !important; } div#layout-body { padding-left: 0 !important; padding-right: 0 !important; }`,
      `header#header button[aria-controls="navigation"] { display: none !important; }`,
    );
  } else {
    if (featureFlags.sidebarRight) {
      rules.push(
        `aside#sidebar { left: auto !important; right: 0 !important; }`,
        `div#layout-body { padding-left: 0 !important; padding-right: 80px !important; }`,
        `aside#sidebar [class*="_tooltip_"] {
  left: initial !important;
  right: 100% !important;
  padding-left: 0 !important;
  padding-right: 16px !important;
}`,
        `aside#sidebar [class*="_tooltip_inner_"] {
  padding-left: 12px !important;
  padding-right: 12px !important;
}`,
        `aside#sidebar [class*="_content_"][class*="_show_tooltip_"] {
  margin-left: -200px !important;
  margin-right: 0 !important;
  padding-left: 216px !important;
}`,
        `aside#sidebar[class*="_is_expanded_"] [class*="_content_"] {
  padding-left: 20px !important;
  padding-right: 20px !important;
}`,
        `aside#sidebar[class*="_is_expanded_"] [class*="_content_"][class*="_show_tooltip_"] {
  padding-left: 220px !important;
}`,
        `header#header { padding-right: 80px !important; }`,
        `header#header :has(> button[aria-controls="navigation"]) { position: static !important; }`,
        `header#header button[aria-controls="navigation"] {
  position: absolute !important;
  right: 20px !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  z-index: 10001 !important;
}`,
        `@media (width <= 1199px) {
  header#header:has(~ aside#sidebar button[aria-controls="navigation"][aria-expanded="true"]) :has(> button[aria-controls="navigation"]) {
    opacity: 0 !important;
    pointer-events: none !important;
    visibility: hidden !important;
  }
  aside#sidebar:has(button[aria-controls="navigation"][aria-expanded="true"])::before {
    background-color: rgba(var(--color-bg-black-fixed-rgb), .7) !important;
    content: "" !important;
    height: 100vh !important;
    left: auto !important;
    position: fixed !important;
    right: 0 !important;
    top: 0 !important;
    width: 100vw !important;
  }
}`,
      );
    }
    // 섹션별 숨김은 JS 마커 클래스로(텍스트 식별 필요).
    rules.push(
      `aside#sidebar .${SIDEBAR_HIDE_ITEM_CLASS} { display: none !important; }`,
    );
    // 메뉴 항목 숨김은 href 기반 CSS로 직접 숨긴다 — 치지직이 그리는 즉시 가려져
    // JS 클래스 부여 지연으로 인한 깜빡임이 없다(:has는 Chromium 105+ 지원).
    const menuHrefs = {
      "/lives": featureFlags.sbLives,
      "/clips": featureFlags.sbClips,
      "/category": featureFlags.sbCategory,
      "/schedule": featureFlags.sbSchedule,
      "/following": featureFlags.sbFollowing,
      "/cheezefarm": featureFlags.sbCheezefarm,
    };
    const hiddenSel = Object.entries(menuHrefs)
      .filter(([, hide]) => hide)
      .map(([href]) => `aside#sidebar li:has(> a[href="${href}"])`);
    if (hiddenSel.length) {
      rules.push(`${hiddenSel.join(",\n")} { display: none !important; }`);
    }
  }
  // 헤더 '스튜디오' 버튼 숨김 — 텍스트형/아이콘형 둘 다 href가
  // studio.chzzk.naver.com을 가리키므로 href 기반 CSS로 숨긴다(깜빡임 없음).
  // 아이콘형일 때 검색창 컨테이너의 ::before(구분 여백)가 남아 보이므로 함께 폭 0.
  if (featureFlags.headerStudio) {
    rules.push(
      `header#header a[href*="studio.chzzk.naver.com"] { display: none !important; }`,
      `header#header form[role="search"] > :first-child::before,
header#header :has(> form[role="search"])::before { width: 0 !important; }`,
      // 버튼을 감싼 박스(_box_)의 우측 패딩이 빈 공간으로 남으므로 0으로.
      // 숨김 해제 시 이 규칙 자체가 빠져 원래 패딩으로 복구된다.
      `header#header [class*="_box_"]:has(> a[href*="studio.chzzk.naver.com"]) { padding-right: 0 !important; }`,
    );
  }
  // 헤더 주제 탭(게임/e스포츠/스포츠/엔터+) 숨김 — 컨테이너는 그대로 두고(그 margin
  // auto가 우측 컨트롤을 오른쪽으로 밀어내는 역할을 하므로 제거하면 레이아웃이 무너짐)
  // 내부 nav와 이벤트 배너만 숨긴다. nav 옆 형제(_banner_ 등)도 함께 가린다.
  if (featureFlags.headerTopicTabs) {
    rules.push(
      `header#header :has(> nav[aria-label="주제 탭"]) > :not(#${HEADER_FOLLOW_CONTAINER_ID}) { display: none !important; }`,
    );
  }
  // 헤더 자동 숨김 — 평소엔 헤더를 흐름에서 빼서(position:absolute) 그 60px 높이를
  // 아래 콘텐츠가 회수하게 하고, 위로 밀어 올려(translateY -100%) 화면 밖으로 숨긴다.
  // JS가 상단 호버존 감지 시 cheese-header-peek를 붙이면 sticky로 복귀해 다시 60px를
  // 차지하며 슬라이드로 나타난다. 사이드바(fixed)는 흐름과 무관해 그대로 상단 공간 사용.
  // transition으로 슬라이드 + 콘텐츠 자리 이동을 부드럽게. !important로 치지직 sticky를 이김.
  if (featureFlags.headerAutoHide) {
    // ── 오버레이 방식 ──────────────────────────────────────────────────────
    // peek(헤더 표시/숨김)할 때 콘텐츠/사이드바를 밀지 않는다 → 레이아웃 변화 0
    // → CLS/버벅임 없음. 헤더는 fixed 오버레이로 콘텐츠 '위에' 떠서 나타났다 사라진다.
    // 콘텐츠/사이드바의 상단 60px 회수는 자동숨김이 켜진 동안 '항상'(peek 무관) 고정
    // 적용하므로 호버 토글 시 reflow가 없다(1회성 레이아웃만).
    rules.push(
      // 헤더: 위치는 top으로만(치지직 인라인 transform은 none으로 무력화). 숨김은
      // 화면 위로(-60-offset), peek는 배너 아래(offset). top만 transition → 가벼움.
      `header#header {
  position: fixed !important;
  top: calc(-60px - var(--cheese-header-offset, 0px)) !important;
  left: 0 !important;
  right: 0 !important;
  transform: none !important;
  transition: top 0.2s ease !important;
  will-change: top;
  z-index: 10000 !important;
}`,
      `header#header.cheese-header-peek {
  top: var(--cheese-header-offset, 0px) !important;
}`,
      // 콘텐츠 섹션: 헤더가 빠진 60px를 회수해 항상 100vh(peek 무관). PIP 제외.
      `body:has(header#header) div#layout-body > section:not([class*="_type_pip_"]) {
  height: 100vh !important;
}`,
      // 사이드바: 헤더가 빠졌으니 배너 아래(offset)부터 항상 시작(peek 무관).
      // 치지직 인라인 translateY(60px)는 무력화. transition 없음(토글 시 안 움직임).
      // 높이도 치지직 인라인 calc(100vh - 111px)(배너51+헤더60)에서 헤더 60px를
      // 회수해 calc(100vh - 배너오프셋)으로 덮는다(안 하면 아래에 60px 빈 공간).
      `aside#sidebar {
  transform: translateY(var(--cheese-header-offset, 0px)) !important;
  height: calc(100vh - var(--cheese-header-offset, 0px)) !important;
}`,
      // 콘텐츠 내 sticky 요소(탭/필터/패널헤더)는 인라인 top에 헤더 높이(60px)가
      // 미리 더해진 값(예: 채널 탭 110px·패널헤더 153px, lives 탭 111px·필터 154px)을
      // 갖는다. 헤더가 빠진 만큼 위로 당겨야 같은 시각 위치가 된다. 인라인 top은 CSS로
      // 못 줄이므로 transform:translateY로 시각 보정.
      // **연속 보정**: 클래스로 0↔-60px를 이산 전환하면 sticky 고정 순간 갑자기 점프
      // 한다. 대신 스크롤량에 비례한 --cheese-sticky-shift(JS가 -min(60,scrollTop)px로
      // 갱신)로 0→-60px를 매끄럽게 따라가게 한다(치지직처럼 헤더·탭이 같이 올라가다
      // sticky 고정). 대상은 인라인 top 보유(style*="top") _tab_/_filter_/_header_.
      `div#layout-body [class*="_tab_"][style*="top"],
div#layout-body [class*="_filter_"][style*="top"],
div#layout-body [class*="_header_"][style*="top"] {
  transform: translateY(var(--cheese-sticky-shift, 0px)) !important;
}`,
      // lives/videos 페이지 헤더(section 직계 _header_)는 인라인 top 대신 CSS
      // padding-top:30px으로 헤더 아래 여백을 둔다 → 헤더 자동 숨김 시 빈 공간으로
      // 남으므로 0으로 회수. 단 **배너 없을 때만**(body에 cheese-has-banner 없을 때):
      // 배너가 있으면 헤더가 배너 아래 그대로라 이 여백이 필요하다. 셀렉터는 section
      // 직계 _header_로 한정해 콘텐츠 내 다른 _header_ 오염을 막는다.
      `body:not(.cheese-has-banner) div#layout-body section[class*="_section_"] > [class*="_header_"]:not([style*="top"]) {
  padding-top: 0 !important;
}`,
    );
    // 사이드바가 보일 때만 본문 여백 보정(숨김이면 위 분기가 0 회수).
    if (!featureFlags.sidebar) {
      rules.push(
        featureFlags.sidebarRight
          ? `div#layout-body { padding-left: 0 !important; padding-right: 80px !important; }`
          : `div#layout-body { padding-left: 80px !important; }`,
      );
    }
  }
  const css = rules.join("\n");
  if (style.textContent !== css) style.textContent = css;
  applySidebarSections();
}

// ── 헤더 자동 숨김(상단 호버존에서 슬라이드 표시) ───────────────────────────
// CSS는 applySidebarHidden이 처리(평소 숨김 + .cheese-header-peek 시 표시). 여기선
// 마우스 위치를 보고 peek 클래스를 토글하는 리스너를 켜고 끈다.
const HEADER_PEEK_CLASS = "cheese-header-peek";
const HEADER_PEEK_ZONE_PX = 8; // 화면 상단 이 px 안에 마우스가 오면 표시
const HEADER_PEEK_HYSTERESIS_PX = 24; // 헤더 아래 이만큼 더 내려가야 숨김(경계 진동 방지)
let headerAutoHideOn = false;
let headerPeekPinned = false; // 헤더 위 호버/포커스 중이면 계속 표시
let headerAutoHideBoundEl = null; // 현재 헤더 리스너가 걸린 header 요소
let headerPeekShown = false; // 현재 peek(표시) 상태 — 멱등 토글용 캐시

// 치지직 인라인 transform(translateY(NNpx))의 NN을 읽는다. 메인의 51px 배너처럼
// 헤더를 아래로 미는 정상 오프셋. 값이 없거나 0이면 0(라이브/다시보기 등 배너 없음).
function readHeaderInlineOffsetPx(header) {
  const t = header?.style?.transform || "";
  const m = t.match(/translateY\(\s*(-?\d+(?:\.\d+)?)px\s*\)/);
  const v = m ? parseFloat(m[1]) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// 오프셋을 CSS 변수(--cheese-header-offset)에 반영. **:root에 둔다** — 헤더 top뿐
// 아니라 layout-body padding-top/섹션 height도 이 변수를 쓰는데, 헤더는 그들의
// 조상이 아니라 헤더에만 두면 상속이 안 닿는다(:root는 모두의 조상). 멱등.
function updateHeaderOffsetVar(header) {
  if (!header) return;
  const px = readHeaderInlineOffsetPx(header);
  const next = `${px}px`;
  const root = document.documentElement;
  if (root.style.getPropertyValue("--cheese-header-offset") !== next) {
    root.style.setProperty("--cheese-header-offset", next);
  }
  // 배너 유무 마커(px>0=배너 있음). 헤더 padding-top 회수는 배너 없을 때만 적용.
  const hasBanner = px > 0;
  if (document.body.classList.contains("cheese-has-banner") !== hasBanner) {
    document.body.classList.toggle("cheese-has-banner", hasBanner);
  }
}

// 멱등: 상태가 실제로 바뀔 때만 클래스를 토글한다. mousemove가 초당 수십~수백 번
// 호출되므로, 매번 classList.toggle을 하면 :has() 레이아웃 재계산(padding/100vh)이
// 반복돼 페이지가 멈춘다(자가 발화/스래싱). 변화 있을 때만 DOM을 건드린다.
function setHeaderPeek(show) {
  show = Boolean(show);
  const header = document.getElementById("header");
  if (!header) return;
  // 표시로 전환할 땐 현재 배너 오프셋을 먼저 반영(배너 유무가 바뀌었을 수 있음).
  if (show) updateHeaderOffsetVar(header);
  if (show === headerPeekShown) return;
  headerPeekShown = show;
  header.classList.toggle(HEADER_PEEK_CLASS, show);
  if (show) flushHeaderFollowRefreshIfNeeded();
}

function onHeaderAutoHideMouseMove(e) {
  if (headerPeekPinned) return; // 헤더에 마우스 올라가 있으면 유지
  // 히스테리시스로 경계 깜빡임 방지: 숨김→표시는 좁은 영역(offset+8px)에서만 켜고,
  // 표시→숨김은 헤더 아래(offset+60+24px)를 벗어나야 끈다. 두 임계가 달라
  // 경계에서 on/off가 진동하지 않는다. (배너 있으면 offset만큼 아래로 내려감)
  const offset = readHeaderInlineOffsetPx(document.getElementById("header"));
  const showThreshold = offset + HEADER_PEEK_ZONE_PX; // 켜는 경계(좁게)
  const hideThreshold = offset + 60 + HEADER_PEEK_HYSTERESIS_PX; // 끄는 경계(넓게)
  if (headerPeekShown) {
    if (e.clientY > hideThreshold) setHeaderPeek(false);
  } else {
    if (e.clientY <= showThreshold) setHeaderPeek(true);
  }
}

function onHeaderAreaEnter() {
  headerPeekPinned = true;
  setHeaderPeek(true);
}

function onHeaderAreaLeave() {
  // pin만 풀고 즉시 숨기지 않는다 — 숨김 여부는 mousemove 히스테리시스가 판단해
  // 헤더 하단 경계에서 갑자기 사라졌다 나타나는 깜빡임을 막는다. 마우스가 화면을
  // 떠난 경우(relatedTarget 없음)엔 즉시 숨긴다.
  headerPeekPinned = false;
}

// 마우스가 페이지(뷰포트) 밖으로 나가면 헤더를 숨긴다(mousemove가 멈춰 표시로
// 남는 것 방지). relatedTarget이 null이면 문서를 떠난 것.
function onDocumentMouseOut(e) {
  if (e.relatedTarget === null && !headerPeekPinned) setHeaderPeek(false);
}

// sticky 보정량(--cheese-sticky-shift)을 스크롤량에 '연속' 연동한다. 클래스로
// 0↔-60px 이산 전환하면 sticky 고정 순간 점프하므로, 스크롤 0~60px 동안 0→-60px로
// 매끄럽게 따라가게 한다(헤더·탭이 같이 올라가다 sticky 고정되는 치지직 동작 재현).
// 치지직 스크롤 컨테이너는 window/layout-body/내부 섹션 중 페이지마다 달라 후보들의
// scrollTop 최댓값을 쓴다. capture 단계 리스너로 어느 컨테이너든 잡는다.
const STICKY_SHIFT_MAX_PX = 60; // 헤더 높이만큼만 보정(그 이상 스크롤해도 -60 고정)
let headerScrollRaf = 0;
function updateStickyShift() {
  headerScrollRaf = 0;
  const candidates = [
    window.scrollY || 0,
    document.scrollingElement?.scrollTop || 0,
    document.getElementById("layout-body")?.scrollTop || 0,
  ];
  const section = document.querySelector(
    'div#layout-body section[class*="_section_"]',
  );
  if (section) candidates.push(section.scrollTop || 0);
  const scrollTop = Math.max(0, ...candidates);
  const shift = -Math.min(STICKY_SHIFT_MAX_PX, scrollTop); // 0 → -60px
  const next = `${shift}px`;
  const root = document.documentElement;
  if (root.style.getPropertyValue("--cheese-sticky-shift") !== next) {
    root.style.setProperty("--cheese-sticky-shift", next);
  }
}
function onHeaderScroll() {
  // rAF로 합쳐 과도한 변수 갱신/스래싱 방지(멱등 비교).
  if (headerScrollRaf) return;
  headerScrollRaf = requestAnimationFrame(updateStickyShift);
}

function bindHeaderAutoHide() {
  const header = document.getElementById("header");
  document.addEventListener("mousemove", onHeaderAutoHideMouseMove, {
    passive: true,
  });
  document.addEventListener("mouseout", onDocumentMouseOut, { passive: true });
  // 스크롤 감지(capture=어느 스크롤 컨테이너든 잡음). sticky transform 보정 게이트.
  document.addEventListener("scroll", onHeaderScroll, {
    passive: true,
    capture: true,
  });
  // 헤더 위에 있거나 포커스가 있으면 계속 표시(메뉴 조작 중 사라지지 않게).
  header?.addEventListener("mouseenter", onHeaderAreaEnter);
  header?.addEventListener("mouseleave", onHeaderAreaLeave);
  header?.addEventListener("focusin", onHeaderAreaEnter);
  header?.addEventListener("focusout", onHeaderAreaLeave);
  headerAutoHideBoundEl = header || null;
  updateHeaderOffsetVar(header); // 시작부터 배너 오프셋 반영(숨김 top 계산 정확히)
  updateStickyShift(); // 진입 시 현재 스크롤량 반영
}

function unbindHeaderAutoHide() {
  const header = document.getElementById("header");
  document.removeEventListener("mousemove", onHeaderAutoHideMouseMove);
  document.removeEventListener("mouseout", onDocumentMouseOut);
  document.removeEventListener("scroll", onHeaderScroll, { capture: true });
  header?.removeEventListener("mouseenter", onHeaderAreaEnter);
  header?.removeEventListener("mouseleave", onHeaderAreaLeave);
  header?.removeEventListener("focusin", onHeaderAreaEnter);
  header?.removeEventListener("focusout", onHeaderAreaLeave);
  if (headerScrollRaf) {
    cancelAnimationFrame(headerScrollRaf);
    headerScrollRaf = 0;
  }
  headerPeekPinned = false;
  setHeaderPeek(false); // peek 클래스 제거(기능 끄면 CSS도 빠져 원상복구)
  document.documentElement.style.removeProperty("--cheese-header-offset"); // 변수 정리
  document.body.classList.remove("cheese-has-banner"); // 배너 마커 정리
  document.documentElement.style.removeProperty("--cheese-sticky-shift"); // 보정량 정리
  headerAutoHideBoundEl = null; // 다시 켜질 때 새로 바인딩되도록
}

// 기능 on/off에 따라 리스너를 켜고 끈다. SPA로 header가 재생성될 수 있어 멱등 재호출.
function applyHeaderAutoHide() {
  const on = featureFlags.headerAutoHide;
  if (on === headerAutoHideOn) {
    // 상태 동일하지만 header가 교체됐을 수 있으니 켜진 상태면 헤더 리스너 보정 +
    // 배너 오프셋 갱신. init()이 SPA 전환/DOM 변화마다 호출되므로, 배너 있는 메인 →
    // 배너 없는 라이브로 이동(peek 이벤트 없이)해도 여기서 offset이 51px→0으로
    // 따라잡힌다(안 하면 사이드바가 51px만큼 빈 채로 남음).
    if (on) {
      rebindHeaderAutoHideElement();
      updateHeaderOffsetVar(document.getElementById("header"));
    }
    return;
  }
  headerAutoHideOn = on;
  if (on) bindHeaderAutoHide();
  else {
    unbindHeaderAutoHide();
    flushHeaderFollowRefreshIfNeeded();
  }
}

// SPA 재렌더로 header 요소가 바뀌면 헤더 전용 리스너를 새 요소에 다시 건다.
function rebindHeaderAutoHideElement() {
  const header = document.getElementById("header");
  if (!header || header === headerAutoHideBoundEl) return;
  // 이전 요소의 리스너는 요소가 사라지면 자동 GC되지만, 새 요소엔 다시 건다.
  header.addEventListener("mouseenter", onHeaderAreaEnter);
  header.addEventListener("mouseleave", onHeaderAreaLeave);
  header.addEventListener("focusin", onHeaderAreaEnter);
  header.addEventListener("focusout", onHeaderAreaLeave);
  headerAutoHideBoundEl = header;
  // 새 요소엔 peek 클래스가 없으니 캐시를 실제 상태(숨김)로 맞춘다(멱등 토글 동기화).
  headerPeekShown = header.classList.contains(HEADER_PEEK_CLASS);
}

// 사이드바 메뉴 항목/섹션에 숨김 마커 클래스를 부여/제거한다. 클래스 해시는
// 빌드마다 바뀌므로 href(메뉴 항목)·제목 텍스트(섹션)로 식별한다.
function applySidebarSections() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  // 1) 메뉴 항목 숨김은 applySidebarHidden의 href 기반 CSS가 처리(깜빡임 방지).

  // 2) 섹션별 숨김: nav를 제목 텍스트로 식별 → nav 토글. 사이드바 접힘/펼침에 따라
  //    제목이 달라지므로(예: "팔로우"↔"팔로잉 채널", "방송 일정"↔"다가오는 방송 일정")
  //    정확 일치 대신 부분 포함(includes)으로 매칭한다.
  const sections = sidebar.querySelectorAll('nav[class*="_section_"]');
  sections.forEach((nav) => {
    // 제목(_title_)은 접힘 상태에서 없을 수 있다(서비스 바로가기 등). 그땐 blind
    // 텍스트도 함께 본다. 둘을 합쳐 부분 일치로 식별.
    const label = getSidebarNavLabel(nav);
    let hidden = null; // null=대상 아님(건드리지 않음)
    if (label.includes("팔로"))
      hidden = featureFlags.sbFollow; // 팔로우/팔로잉
    else if (label.includes("인기카테고리"))
      hidden = featureFlags.sbPopularCategory;
    else if (label.includes("방송일정"))
      hidden = featureFlags.sbBroadcastSchedule;
    else if (label.includes("파트너")) hidden = featureFlags.sbPartner;
    else if (label.includes("서비스바로가기")) hidden = featureFlags.sbServices;
    if (hidden !== null) {
      nav.classList.toggle(SIDEBAR_HIDE_ITEM_CLASS, Boolean(hidden));
      // 팔로잉 섹션이면 오프라인 항목 숨김도 함께 처리.
      if (label.includes("팔로")) applyFollowOffline(nav);
    }
  });
}

// 팔로잉 섹션(치지직 원본)의 오프라인 채널 li를 숨긴다. 오프라인 = 프로필에
// _is_live_ 클래스가 없는 항목(또는 blind "오프라인"). 우리가 렌더한 ul은 라이브만이라
// 대상이 아님.
function applyFollowOffline(followNav) {
  const hide = featureFlags.sbFollowOffline;
  const originalUl = followNav.querySelector('ul[class*="_list_"]');
  if (!originalUl) return;
  originalUl.querySelectorAll(":scope > li").forEach((li) => {
    li.classList.toggle(
      "cheese-sb-offline-hide",
      hide && isOfflineFollowItem(li),
    );
  });
}

// 팔로잉 li가 오프라인인지 판정. blind 텍스트("오프라인"/"LIVE")를 1순위(해시 무관),
// _is_live_ 클래스를 폴백으로 본다. 둘 다 애매하면 라이브로 간주(숨기지 않음=보수적).
function isOfflineFollowItem(li) {
  const profile = li.querySelector('[class*="_profile_"]');
  if (!profile) return false;
  const blind = (profile.querySelector(".blind")?.textContent || "").trim();
  if (blind === "오프라인") return true;
  if (blind === "LIVE") return false;
  return !/_is_live_/.test(profile.className);
}

function getSidebarNavLabel(nav) {
  const titleText = nav.querySelector('[class*="_title_"]')?.textContent || "";
  const blindText = Array.from(nav.querySelectorAll(".blind"))
    .map((el) => el.textContent || "")
    .join(" ");
  return (titleText + " " + blindText).replace(/\s+/g, "");
}

function findSidebarFollowNav() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return null;
  const navs = sidebar.querySelectorAll('nav[class*="_section_"]');
  for (const nav of navs) {
    if (getSidebarNavLabel(nav).includes("팔로")) return nav;
  }
  return null;
}

// ── 팔로잉 '더보기' 한 번에 모두 펼치기 + 갱신 후 펼침 복원 ──────────────────
// 치지직 더보기는 클릭당 일부만 추가 로드한다. 사용자가 한 번 클릭하면 '접기'가
// 나올 때까지(=전부 로드) 자동 반복 클릭한다. 또 자동 갱신/오프라인 숨김의 재렌더로
// 펼침이 접힌 채로 돌아오면 다시 펼친다(followExpandWanted로 사용자 의사 추적).
let followExpandWanted = false; // 사용자가 '모두 펼침'을 원하는 상태
let followAutoExpandTimer = 0; // 반복 클릭 드라이버 타이머
let followAutoExpandTries = 0; // 안전: 무한 반복 방지

// 팔로잉 nav의 더보기/접기 버튼을 찾는다(_more_button_ 클래스, aria-label로 구분).
function findFollowMoreButton(nav) {
  const followNav = nav || findSidebarFollowNav();
  return followNav?.querySelector('button[aria-label="더보기"]') || null;
}
function findFollowCollapseButton(nav) {
  const followNav = nav || findSidebarFollowNav();
  return followNav?.querySelector('button[aria-label="접기"]') || null;
}

function stopFollowAutoExpand() {
  if (followAutoExpandTimer) {
    clearTimeout(followAutoExpandTimer);
    followAutoExpandTimer = 0;
  }
  followAutoExpandTries = 0;
}

// '접기'가 나올 때까지 더보기를 반복 클릭한다. 클릭→React 추가 로드(비동기)→다음
// 더보기 버튼 등장을 기다려 다시 클릭. 접기가 보이거나 더보기가 사라지면 종료.
function driveFollowAutoExpand() {
  followAutoExpandTimer = 0;
  if (!followExpandWanted) return;
  const nav = findSidebarFollowNav();
  if (!nav) return;
  if (findFollowCollapseButton(nav)) {
    // 이미 전부 펼침(접기 버튼) → 종료.
    stopFollowAutoExpand();
    return;
  }
  const more = findFollowMoreButton(nav);
  if (!more) {
    // 더보기/접기 둘 다 없음(목록이 짧거나 전환 중) → 더 할 일 없음.
    stopFollowAutoExpand();
    return;
  }
  if (followAutoExpandTries >= 50) {
    // 안전장치: 비정상적으로 많이 반복되면 중단(rate-limit/루프 방지).
    stopFollowAutoExpand();
    return;
  }
  followAutoExpandTries += 1;
  more.click();
  // 추가 로드 렌더를 기다렸다 다음 라운드(없어질 때까지).
  followAutoExpandTimer = setTimeout(driveFollowAutoExpand, 250);
}

// 사용자가 펼침을 원하는데(followExpandWanted) 현재 접힌 상태(더보기 버튼 존재)면
// 자동 펼침을 (재)시작한다. 사이드바 옵저버/갱신 후 호출 → 재렌더로 접혀도 복원.
function ensureFollowExpansion() {
  if (!followExpandWanted) return;
  const nav = findSidebarFollowNav();
  if (!nav) return;
  // 접기 버튼이 있으면 이미 펼쳐진 상태 → 아무것도 안 함.
  if (findFollowCollapseButton(nav)) return;
  // 더보기 버튼이 있고 드라이버가 안 돌고 있으면 시작.
  if (findFollowMoreButton(nav) && !followAutoExpandTimer) {
    followAutoExpandTries = 0;
    driveFollowAutoExpand();
  }
}

// 팔로잉 더보기/접기 버튼 클릭을 가로채 사용자 의사를 기록하고 자동 펼침을 건다.
// capture 단계로 치지직 React 핸들러보다 먼저 의사만 기록(클릭 자체는 막지 않음).
function onFollowMoreClickCapture(e) {
  const btn = e.target?.closest?.(
    'button[aria-label="더보기"], button[aria-label="접기"]',
  );
  if (!btn) return;
  // 팔로잉 nav 안의 버튼만 대상.
  const nav = btn.closest('nav[class*="_section_"]');
  if (!nav || !getSidebarNavLabel(nav).includes("팔로")) return;
  if (btn.getAttribute("aria-label") === "더보기") {
    // 사용자가 펼침 시작 → 모두 펼치고 싶다는 의사. 치지직이 1차 로드한 뒤
    // 우리가 접기 나올 때까지 이어서 클릭한다(이 클릭은 그대로 진행).
    followExpandWanted = true;
    followAutoExpandTries = 0;
    if (followAutoExpandTimer) clearTimeout(followAutoExpandTimer);
    followAutoExpandTimer = setTimeout(driveFollowAutoExpand, 250);
  } else {
    // '접기' → 펼침 의사 해제(이후 갱신에도 다시 안 펼침).
    followExpandWanted = false;
    stopFollowAutoExpand();
  }
}
document.addEventListener("click", onFollowMoreClickCapture, true);

let headerFollowLiveItems = [];
let headerFollowLiveInfoLoaded = false;
let headerFollowLiveInfoVersion = 0;
let headerFollowLiveInfoPromise = null;
let headerFollowCarouselPage = 0;
let headerFollowHovering = false;
let headerFollowPendingRender = false;
let headerFollowRefreshPending = false;
let headerFollowRefreshPendingHasFreshData = false;
let headerFollowPageSize = HEADER_FOLLOW_DEFAULT_COUNT;

function normalizeHeaderFollowCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return HEADER_FOLLOW_DEFAULT_COUNT;
  return Math.min(
    HEADER_FOLLOW_MAX_COUNT,
    Math.max(HEADER_FOLLOW_MIN_COUNT, Math.round(n)),
  );
}

function getHeaderFollowEffectivePageSize() {
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  let responsiveMax = HEADER_FOLLOW_MAX_COUNT;
  if (width <= 820) responsiveMax = 1;
  else if (width <= 980) responsiveMax = 2;
  else if (width <= 1180) responsiveMax = 4;
  return Math.max(
    HEADER_FOLLOW_MIN_COUNT,
    Math.min(headerFollowPageSize, responsiveMax),
  );
}

function formatHeaderFollowCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("ko-KR").format(n);
}

function getAchievementBadgeUrls(ids) {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => ACHIEVEMENT_BADGE_URL_MAP[id])
    .filter((url) => typeof url === "string" && url);
}

function normalizeHeaderFollowLiveItem(item) {
  const channelId = item?.channelId || item?.channel?.channelId || "";
  if (!channelId) return null;
  return {
    channelId,
    channelName: item?.channel?.channelName || "",
    channelImageUrl: item?.channel?.channelImageUrl || "",
    verifiedMark: item?.channel?.verifiedMark === true,
    achievementBadgeUrls: getAchievementBadgeUrls(
      item?.channel?.activatedChannelBadgeIds,
    ),
    category: item?.liveInfo?.liveCategoryValue || "",
    title: item?.liveInfo?.liveTitle || "",
    count: formatHeaderFollowCount(item?.liveInfo?.concurrentUserCount),
  };
}

async function refreshHeaderFollowLiveInfo() {
  if (headerFollowLiveInfoPromise) return headerFollowLiveInfoPromise;
  headerFollowLiveInfoPromise = (async () => {
    try {
      const response = await fetch(FOLLOWING_LIVE_API_URL, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const list = Array.isArray(payload?.content?.followingList)
        ? payload.content.followingList
        : [];
      const nextItems = [];
      list.forEach((item) => {
        const normalized = normalizeHeaderFollowLiveItem(item);
        if (normalized) {
          nextItems.push(normalized);
        }
      });
      headerFollowLiveItems = nextItems;
      headerFollowLiveInfoLoaded = true;
      headerFollowLiveInfoVersion += 1;
      if (shouldDeferHeaderFollowRefresh()) {
        headerFollowRefreshPending = true;
        headerFollowRefreshPendingHasFreshData = true;
      } else {
        ensureHeaderFollowNav();
      }
    } catch (error) {
      console.debug?.(
        "[CheeseSearch] failed to refresh follow live info",
        error,
      );
    } finally {
      headerFollowLiveInfoPromise = null;
    }
  })();
  return headerFollowLiveInfoPromise;
}

function shouldDeferHeaderFollowRefresh() {
  return featureFlags.headerAutoHide && !headerPeekShown;
}

function requestHeaderFollowLiveInfoRefresh() {
  if (shouldDeferHeaderFollowRefresh()) {
    headerFollowRefreshPending = true;
    headerFollowRefreshPendingHasFreshData = false;
    return null;
  }
  headerFollowRefreshPending = false;
  headerFollowRefreshPendingHasFreshData = false;
  return refreshHeaderFollowLiveInfo();
}

function flushHeaderFollowRefreshIfNeeded() {
  if (!headerFollowRefreshPending || shouldDeferHeaderFollowRefresh()) return;
  if (headerFollowRefreshPendingHasFreshData) {
    headerFollowRefreshPending = false;
    headerFollowRefreshPendingHasFreshData = false;
    ensureHeaderFollowNav();
    return;
  }
  headerFollowRefreshPending = false;
  headerFollowRefreshPendingHasFreshData = false;
  void refreshHeaderFollowLiveInfo();
}

function getHeaderFollowMaxPage() {
  const pageSize = getHeaderFollowEffectivePageSize();
  return Math.max(0, Math.ceil(headerFollowLiveItems.length / pageSize) - 1);
}

function clampHeaderFollowCarouselPage() {
  headerFollowCarouselPage = Math.min(
    Math.max(0, headerFollowCarouselPage),
    getHeaderFollowMaxPage(),
  );
}

function createHeaderFollowTooltipHtml(item, href) {
  const channelName = item.channelName || "팔로우 채널";
  const badgeHtml = item.achievementBadgeUrls
    .map(
      (url) =>
        `<i class="cheese-header-follow-achievement-badge" style="background-image:url('${escapeAttribute(url)}')" aria-hidden="true"></i>`,
    )
    .join("");
  return (
    `<span class="cheese-header-follow-tooltip">` +
    `<span class="cheese-header-follow-tooltip-inner">` +
    `<a class="cheese-header-follow-tooltip-group" href="${escapeAttribute(href)}">` +
    `<span class="cheese-header-follow-tooltip-box">` +
    `<strong class="cheese-header-follow-tooltip-name">` +
    `<span>${escapeHtml(channelName)}</span>` +
    `${item.verifiedMark ? `<i class="cheese-header-follow-official-mark" aria-hidden="true"></i><span class="blind">인증 마크</span>` : ""}` +
    badgeHtml +
    `</strong>` +
    `${item.category ? `<span class="cheese-header-follow-tooltip-category">${escapeHtml(item.category)}</span>` : ""}` +
    `</span>` +
    `${item.title ? `<span class="cheese-header-follow-tooltip-title">${escapeHtml(item.title)}</span>` : ""}` +
    `${item.count ? `<em class="cheese-header-follow-tooltip-count">${escapeHtml(item.count)}</em>` : ""}` +
    `</a>` +
    `</span>` +
    `</span>`
  );
}

function createHeaderFollowItemHtml(item) {
  const href = `/live/${encodeURIComponent(item.channelId)}`;
  const imageUrl = item.channelImageUrl
    ? `${item.channelImageUrl}${item.channelImageUrl.includes("?") ? "&" : "?"}type=f120_120_na`
    : "";
  return (
    `<li class="cheese-header-follow-item" data-channel-id="${escapeAttribute(item.channelId)}">` +
    `<a class="cheese-header-follow-link" href="${escapeAttribute(href)}" aria-label="${escapeAttribute(item.channelName || "팔로우 채널")}">` +
    (imageUrl
      ? `<span class="cheese-header-follow-profile is-live"><img width="26" height="26" src="${escapeAttribute(imageUrl)}" alt="" loading="lazy" decoding="async"><span class="blind">LIVE</span></span>`
      : `<span class="cheese-header-follow-profile is-live"><span class="blind">LIVE</span></span>`) +
    `</a>` +
    createHeaderFollowTooltipHtml(item, href) +
    `</li>`
  );
}

function updateHeaderFollowVisibleTooltips(container) {
  const liveByChannelId = new Map(
    headerFollowLiveItems.map((item) => [item.channelId, item]),
  );
  container.querySelectorAll(".cheese-header-follow-item").forEach((li) => {
    const channelId = li.dataset.channelId || "";
    const item = liveByChannelId.get(channelId);
    if (!item) return;
    const href = `/live/${encodeURIComponent(item.channelId)}`;
    const currentTooltip = li.querySelector(".cheese-header-follow-tooltip");
    const next = document.createElement("template");
    next.innerHTML = createHeaderFollowTooltipHtml(item, href);
    const nextTooltip = next.content.firstElementChild;
    if (!nextTooltip) return;
    if (currentTooltip) {
      currentTooltip.replaceWith(nextTooltip);
    } else {
      li.appendChild(nextTooltip);
    }
  });
}

function renderHeaderFollowCarousel(container) {
  clampHeaderFollowCarouselPage();
  const maxPage = getHeaderFollowMaxPage();
  const pageSize = getHeaderFollowEffectivePageSize();
  const start = headerFollowCarouselPage * pageSize;
  const items = headerFollowLiveItems.slice(start, start + pageSize);
  container.dataset.sig = [
    headerFollowLiveInfoVersion,
    headerFollowCarouselPage,
    headerFollowPageSize,
    pageSize,
    headerFollowLiveItems.map((item) => item.channelId).join(","),
  ].join(":");
  delete container.dataset.hoverSig;
  container.innerHTML =
    `<button type="button" class="cheese-header-follow-chevron" data-header-follow-action="prev" aria-label="이전 팔로우 채널" ${headerFollowCarouselPage <= 0 ? "disabled" : ""}>` +
    `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 1 0 1.4L10.4 12l4.3 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z" fill="currentColor"/></svg>` +
    `</button>` +
    `<ul class="cheese-header-follow-list" aria-label="팔로우 라이브">` +
    items.map((item) => createHeaderFollowItemHtml(item)).join("") +
    `</ul>` +
    `<button type="button" class="cheese-header-follow-chevron" data-header-follow-action="next" aria-label="다음 팔로우 채널" ${headerFollowCarouselPage >= maxPage ? "disabled" : ""}>` +
    `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.3 17.7a1 1 0 0 1 0-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 1.4-1.4l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4 0Z" fill="currentColor"/></svg>` +
    `</button>`;
}

function ensureHeaderFollowNav() {
  const header = document.getElementById("header");
  if (!header) return;

  const shouldShow =
    featureFlags.sidebar &&
    featureFlags.headerTopicTabs &&
    !featureFlags.sbFollow;
  let container = header.querySelector(`#${HEADER_FOLLOW_CONTAINER_ID}`);

  if (!shouldShow) {
    if (container) container.remove();
    return;
  }

  const topicNav = header.querySelector('nav[aria-label="주제 탭"]');
  const topicContainer = topicNav?.parentElement;
  if (!topicContainer) {
    if (container) container.remove();
    return;
  }

  if (!headerFollowLiveInfoLoaded) void requestHeaderFollowLiveInfoRefresh();

  if (headerFollowLiveInfoLoaded && !headerFollowLiveItems.length) {
    if (container) container.remove();
    return;
  }

  if (!headerFollowLiveInfoLoaded && !container) return;

  if (!container) {
    container = document.createElement("div");
    container.id = HEADER_FOLLOW_CONTAINER_ID;
    container.addEventListener("click", onHeaderFollowClick);
    container.addEventListener("pointerenter", () => {
      headerFollowHovering = true;
    });
    container.addEventListener("pointerleave", () => {
      headerFollowHovering = false;
      if (headerFollowPendingRender) {
        headerFollowPendingRender = false;
        ensureHeaderFollowNav();
      }
    });
  }

  if (container.parentElement !== topicContainer) {
    topicContainer.appendChild(container);
  }

  clampHeaderFollowCarouselPage();
  const fullSig = [
    headerFollowLiveInfoVersion,
    headerFollowCarouselPage,
    headerFollowPageSize,
    getHeaderFollowEffectivePageSize(),
    headerFollowLiveItems.map((item) => item.channelId).join(","),
  ].join(":");
  if (container.dataset.sig === fullSig) return;

  if (headerFollowHovering) {
    if (container.dataset.hoverSig !== fullSig) {
      container.dataset.hoverSig = fullSig;
      updateHeaderFollowVisibleTooltips(container);
    }
    headerFollowPendingRender = true;
    return;
  }

  renderHeaderFollowCarousel(container);
}

function onHeaderFollowClick(event) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const actionButton = event.target.closest("[data-header-follow-action]");
  if (actionButton) {
    event.preventDefault();
    const action = actionButton.dataset.headerFollowAction;
    const delta = action === "next" ? 1 : action === "prev" ? -1 : 0;
    if (!delta) return;
    headerFollowCarouselPage += delta;
    headerFollowPendingRender = false;
    const container = document.getElementById(HEADER_FOLLOW_CONTAINER_ID);
    if (container) renderHeaderFollowCarousel(container);
    return;
  }
  const anchor = event.target.closest("a[href]");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href) return;
  event.preventDefault();
  spaNavigate(href);
}

// ── 사이드바 전담 옵저버(섹션 숨김 깜빡임 최소화) ───────────────────────────
// 전역 init은 120ms 디바운스라 치지직 재렌더~우리 클래스 부여 사이에 항목이 잠깐
// 보였다 사라진다. 사이드바만 보는 전담 옵저버로 디바운스 없이 즉시 섹션 클래스를
// 다시 부여해 깜빡임 창을 최소화한다.
let sidebarObserver = null;
let sidebarObservedRoot = null;
function ensureSidebarObserver() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  if (sidebarObservedRoot === sidebar && sidebarObserver) return;
  if (sidebarObserver) sidebarObserver.disconnect();
  sidebarObservedRoot = sidebar;
  sidebarObserver = new MutationObserver(() => {
    // 동기 즉시 재적용(디바운스 없음). applySidebarSections는 멱등(toggle force).
    applySidebarSections();
    ensureHeaderFollowNav();
    ensureFollowExpansion(); // 갱신/재렌더로 접혀도 펼침 의사면 다시 펼침
  });
  sidebarObserver.observe(sidebar, { childList: true, subtree: true });
  applySidebarSections();
  ensureHeaderFollowNav();
  ensureFollowExpansion();
}

// ── 헤더 미니 네비 주입/유지 ──────────────────────────────────────────────
// 한 항목이 표시 대상인지(설정값 우선, 미설정이면 기본 표시 집합으로 판정).
function isHeaderNavShown(key) {
  const v = headerNavConfig[key];
  return typeof v === "boolean" ? v : HEADER_NAV_DEFAULT_SHOWN.has(key);
}

// 사이드바 숨김 + 표시 항목이 하나라도 있으면 헤더에 미니 네비를 보장한다.
// 스튜디오 버튼을 감싼 박스(_box_) 앞에 두며, 없으면 헤더 첫 section 앞에 둔다.
// React 재렌더로 사라질 수 있어 init/옵저버에서 멱등 재호출.
function ensureHeaderNav() {
  const header = document.getElementById("header");
  if (!header) return;

  const shouldShow =
    featureFlags.sidebar &&
    HEADER_NAV_ITEMS.some((it) => isHeaderNavShown(it.key));
  let container = header.querySelector(`#${HEADER_NAV_CONTAINER_ID}`);

  if (!shouldShow) {
    if (container) container.remove();
    return;
  }

  // 컨테이너 보장(없으면 생성). 클릭은 위임 핸들러 1개로 처리(innerHTML 재구성에도
  // 살아남음). 전체 리로드 대신 치지직 SPA 라우터로 부분 네비게이션시킨다.
  if (!container) {
    container = document.createElement("nav");
    container.id = HEADER_NAV_CONTAINER_ID;
    container.setAttribute("aria-label", "바로가기");
    container.addEventListener("click", onHeaderNavClick);
  }

  // 위치 보장: 항상 '스튜디오 버튼 박스(_box_) 앞'을 목표로 한다. 새로고침/페이지
  // 이동 직후엔 스튜디오 버튼이 아직 렌더 전이라 못 찾을 수 있는데, 그땐 헤더
  // 마지막 section에 임시로 둔다. 이후 옵저버가 다시 호출될 때 스튜디오 버튼이
  // 나타나면 그 앞으로 다시 옮긴다(이미 옳은 위치면 이동하지 않음 → 자가발화 방지).
  const studioAnchor = header.querySelector(
    'a[href*="studio.chzzk.naver.com"]',
  );
  const studioBox = studioAnchor?.closest('[class*="_box_"]') || studioAnchor;
  if (studioBox && studioBox.parentElement) {
    // 목표: studioBox 바로 앞. 이미 그 위치면 건드리지 않는다.
    if (container.nextElementSibling !== studioBox) {
      studioBox.parentElement.insertBefore(container, studioBox);
    }
  } else {
    // 스튜디오 버튼이 아직 없으면 마지막 section(없으면 헤더)에 임시 배치.
    const fallback =
      header.querySelector('[class*="_section_"]:last-of-type') || header;
    if (
      container.parentElement !== fallback ||
      fallback.lastElementChild !== container
    ) {
      fallback.appendChild(container);
    }
  }

  // 항목 시그니처(표시 항목 key 순서)로 변경 시에만 재구성 → 불필요한 리플로우 방지.
  const sig = HEADER_NAV_ITEMS.filter((it) => isHeaderNavShown(it.key))
    .map((it) => it.key)
    .join(",");
  if (container.dataset.sig === sig) return;
  container.dataset.sig = sig;

  const html = HEADER_NAV_ITEMS.filter((it) => isHeaderNavShown(it.key))
    .map(
      (it) =>
        `<a class="cheese-header-nav-item" href="${it.href}" aria-label="${it.label}" data-label="${it.label}">` +
        `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${it.svg}</svg>` +
        `</a>`,
    )
    .join("");
  if (container.innerHTML !== html) container.innerHTML = html;
}

// 헤더 미니 네비 클릭 → 전체 리로드 대신 치지직 SPA 라우터로 부분 네비게이션.
// 우리 <a>는 순수 링크라 React Router가 모른다 → 기본 동작이 full reload가 된다.
function onHeaderNavClick(event) {
  // 새 탭/새 창/다운로드 등 사용자의 보조키 동작은 브라우저 기본에 맡긴다.
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const anchor = event.target.closest("a.cheese-header-nav-item");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href) return;
  event.preventDefault();
  spaNavigate(href);
}

// 같은 경로로 가는 치지직(React) 링크를 찾아 그 요소를 클릭한다 → 라우터가
// 부분 렌더(div#layout-body)로 처리. 사이드바가 숨겨져도(display:none) DOM엔
// 존재하므로 클릭이 먹는다. 못 찾으면 history.pushState로 폴백.
function spaNavigate(href) {
  // 사이드바(숨김 상태 포함) → 헤더 → 문서 전체 순으로 동일 href의 치지직 링크 탐색.
  // 우리 컨테이너 내부 링크는 제외(자기 자신 클릭 무한루프 방지).
  const scopes = [
    document.getElementById("sidebar"),
    document.getElementById("header"),
    document,
  ];
  for (const scope of scopes) {
    if (!scope) continue;
    const links = scope.querySelectorAll(`a[href="${href}"]`);
    for (const link of links) {
      if (
        link.closest(
          `#${HEADER_NAV_CONTAINER_ID}, #${HEADER_FOLLOW_CONTAINER_ID}`,
        )
      )
        continue;
      link.click();
      return;
    }
  }
  // 폴백: 라우터가 직접 클릭할 링크를 못 찾은 경우. pushState 후 popstate를 쏴
  // 라우터가 경로 변화를 감지하게 한다(반응 안 하면 위 링크 클릭이 정답이라 드묾).
  try {
    history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  } catch {
    location.href = href; // 최후엔 전체 이동.
  }
}

// ── 채널 홈 라이브 바로가기 버튼 ───────────────────────────────────────────
// 채널 페이지(chzzk.naver.com/<32hex>/...) 탭리스트(div[class*="_tab_"] 안
// [role="tablist"]) 끝에 /live/<id>로 가는 버튼을 추가한다. 라이브 상태(OPEN/CLOSE)를
// API로 조회해 라벨을 '라이브'/'오프라인'으로 바꾼다. SPA 네비로 전체 리로드 없이 이동.
const CHANNEL_LIVE_BUTTON_CLASS = "cheese-channel-live-button";
// 채널별 라이브 상태 캐시 {channelId: {live:boolean, at:ms}} + in-flight 가드.
const channelLiveStatus = new Map();
let channelLiveFetching = "";

// 현재 경로가 채널 페이지면 32hex 채널id 반환(없으면 null). 경로 첫 세그먼트가
// 32hex일 때만 매칭되므로 /live/<id>·/video/<no>(첫 세그먼트가 live/video) 자동 제외.
function getChannelHomeId() {
  const m = location.pathname.match(/^\/([a-f0-9]{32})(?:\/|$)/i);
  return m ? m[1] : null;
}

async function fetchChannelLiveStatus(channelId) {
  if (channelLiveFetching === channelId) return;
  const cached = channelLiveStatus.get(channelId);
  if (cached && Date.now() - cached.at < 30000) return; // 30초 캐시
  channelLiveFetching = channelId;
  try {
    const res = await fetch(
      `https://api.chzzk.naver.com/polling/v3.1/channels/${encodeURIComponent(channelId)}/live-status`,
      { credentials: "include", headers: { accept: "application/json" } },
    );
    if (!res.ok) return;
    const json = await res.json();
    const live = json?.content?.status === "OPEN";
    channelLiveStatus.set(channelId, { live, at: Date.now() });
    ensureChannelLiveButton(); // 상태 반영해 라벨 갱신
  } catch {
    // 실패 시 캐시 없음 → 라벨은 보수적으로 '라이브'(이동은 가능).
  } finally {
    if (channelLiveFetching === channelId) channelLiveFetching = "";
  }
}

// 바로가기 SVG(네모+화살표) 아이콘.
function channelLiveArrowIcon() {
  return `<svg class="${CHANNEL_LIVE_BUTTON_CLASS}-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 4h6v6M20 4l-8.5 8.5M18 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function ensureChannelLiveButton() {
  // 기능 off거나 채널 페이지가 아니면 제거.
  const channelId = channelLiveButtonOn ? getChannelHomeId() : null;
  const existing = document.querySelector(`.${CHANNEL_LIVE_BUTTON_CLASS}`);
  if (!channelId) {
    existing?.remove();
    return;
  }
  // 탭리스트 찾기: div[class*="_tab_"] 안의 [role="tablist"](채널 홈 탭바).
  const tab = document.querySelector('div#layout-body [class*="_tab_"]');
  const list = tab?.querySelector('[role="tablist"]');
  if (!list) {
    existing?.remove();
    return;
  }

  const href = `/live/${channelId}`;
  const status = channelLiveStatus.get(channelId);
  // 3-상태: loading(미조회) / live / offline. 미조회 땐 라이브/오프라인을 확정 못 하니
  // 깜빡임(라이브→오프라인) 대신 로딩 표시를 보여준다(클릭 비활성).
  const phase = !status ? "loading" : status.live ? "live" : "offline";
  const label =
    phase === "loading" ? "확인 중" : phase === "live" ? "라이브" : "오프라인";

  let btn = list.querySelector(`.${CHANNEL_LIVE_BUTTON_CLASS}`);
  if (!btn) {
    btn = document.createElement("a");
    btn.className = CHANNEL_LIVE_BUTTON_CLASS;
    btn.addEventListener("click", (e) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      e.preventDefault();
      // 로딩 중(상태 미확정)엔 이동하지 않는다(잘못된 방식으로 갈 수 있음).
      if (btn.classList.contains("is-loading")) return;
      const target = btn.getAttribute("href");
      // 라이브면 사이드바 등에 그 채널 라이브 링크가 있어 SPA 네비가 먹는다. 오프라인은
      // 페이지에 라이브 링크가 없어 spaNavigate가 못 찾고 pushState로도 React가 '방송
      // 종료' 경로를 잘 처리 못 한다 → 일반 전체 이동으로 확실히 보낸다.
      if (btn.classList.contains("is-offline")) location.assign(target);
      else spaNavigate(target);
    });
  }
  // 탭리스트 마지막 자식으로 보장(치지직이 탭을 다시 그려도 끝으로 이동).
  if (btn.parentElement !== list || list.lastElementChild !== btn) {
    list.appendChild(btn);
  }
  // 멱등: 변경 있을 때만 갱신(옵저버 자가발화 방지).
  if (btn.getAttribute("href") !== href) btn.setAttribute("href", href);
  btn.classList.toggle("is-loading", phase === "loading");
  btn.classList.toggle("is-live", phase === "live");
  btn.classList.toggle("is-offline", phase === "offline");
  // 배치: 끝(우측)이면 at-end(margin-left:auto), 아니면 탭 바로 뒤.
  btn.classList.toggle("at-end", channelLiveButtonEnd);
  const sig = `${href}|${phase}`;
  if (btn.dataset.sig !== sig) {
    btn.dataset.sig = sig;
    btn.setAttribute(
      "aria-label",
      phase === "loading"
        ? "라이브 상태 확인 중"
        : `라이브 페이지로 이동 (${label})`,
    );
    // 로딩이면 3-dot pulse, 확정이면 화살표+라벨.
    btn.innerHTML =
      phase === "loading"
        ? `<span class="${CHANNEL_LIVE_BUTTON_CLASS}-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="${CHANNEL_LIVE_BUTTON_CLASS}-label">${label}</span>`
        : `${channelLiveArrowIcon()}<span class="${CHANNEL_LIVE_BUTTON_CLASS}-label">${label}</span>`;
  }
  // 상태 미조회면 조회 트리거(라벨 갱신은 fetch 완료 후 재호출).
  if (!status) void fetchChannelLiveStatus(channelId);
}

async function loadChannelLiveButton() {
  if (!chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get([
      CHANNEL_LIVE_BUTTON_KEY,
      CHANNEL_LIVE_BUTTON_END_KEY,
    ]);
    channelLiveButtonOn = data?.[CHANNEL_LIVE_BUTTON_KEY] !== false; // 미설정/true=표시
    channelLiveButtonEnd = data?.[CHANNEL_LIVE_BUTTON_END_KEY] !== false; // 미설정/true=끝
  } catch {}
  ensureChannelLiveButton();
}

// ── 사이드바 팔로잉 채널 호버 라이브 영상 미리보기 ─────────────────────────────
// 라이브 중인 팔로잉 채널 li에 호버하면 치지직 툴팁 위치에 음소거 라이브 영상을
// 띄운다. live-detail API의 livePlaybackJson에서 HLS m3u8을 받아 네이티브 우선,
// 안 되면 hls.js로 재생. 우리 자체 fixed 패널이라 React에 개입하지 않는다.
const FOLLOW_PREVIEW_ID = "cheese-follow-preview";
const FOLLOW_PREVIEW_HOVER_DELAY_MS = 250;
const FOLLOW_PREVIEW_DEFAULT_W = 320; // 16:9 → 180h
const FOLLOW_PREVIEW_MIN_W = 200;
const FOLLOW_PREVIEW_MAX_W = 1080; // 더 크게 조절 가능
const FOLLOW_PREVIEW_NARROW_W = 320; // 이 폭 미만이면 우측 메타(시청자/경과시간) 숨김

// 폭에 따라 좁음 클래스 토글(is-narrow면 CSS가 우측 메타를 숨긴다). 멱등.
function applyFollowPreviewWidthClass(el, w) {
  el?.classList?.toggle("is-narrow", w < FOLLOW_PREVIEW_NARROW_W);
}
const FOLLOW_PREVIEW_CACHE_TTL_MS = 30000; // m3u8 토큰 만료 대비 짧게
const followPreviewState = {
  playbackCache: new Map(), // channelId → {m3u8, at}
  fetching: "",
  hoverTimer: 0,
  currentChannelId: "",
  hls: null, // hls.js 인스턴스(폴백 시)
  width: FOLLOW_PREVIEW_DEFAULT_W,
  retried: false, // 토큰 만료 등으로 1회 재시도했는지
  bound: false,
  resizing: false, // 드래그 리사이즈/이동 중(이때 닫기 금지)
  pinned: false, // 고정 핀(켜면 호버 벗어나도 유지)
  movedPos: null, // 헤더 드래그로 옮긴 좌표 {left,top}(있으면 그 위치 유지)
  elapsedTimer: 0, // 라이브 경과 시간 1초 갱신 타이머
};

// 팔로잉 li → 32hex 채널id(a[href^="/live/"]). 없으면 null.
function getFollowItemChannelId(li) {
  const a = li?.querySelector?.('a[href^="/live/"]');
  const href = a?.getAttribute("href") || "";
  const m = href.match(/^\/live\/([a-f0-9]{32})/i);
  return m ? m[1] : null;
}

// 팔로잉 li가 라이브 중인지(오프라인 판정의 역). isOfflineFollowItem 재사용.
function isLiveFollowItem(li) {
  return !isOfflineFollowItem(li);
}

// live-detail → livePlaybackJson → HLS m3u8. 캐시(30초)+in-flight 가드.
async function fetchLivePreviewData(channelId) {
  const cached = followPreviewState.playbackCache.get(channelId);
  if (cached && Date.now() - cached.at < FOLLOW_PREVIEW_CACHE_TTL_MS) {
    return cached;
  }
  if (followPreviewState.fetching === channelId) return null;
  followPreviewState.fetching = channelId;
  try {
    const res = await fetch(
      `https://api.chzzk.naver.com/service/v3/channels/${encodeURIComponent(channelId)}/live-detail`,
      { credentials: "include", headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const c = json?.content;
    if (c?.status !== "OPEN") return null;
    const raw = c?.livePlaybackJson;
    if (!raw) return null;
    const playback = JSON.parse(raw);
    const medias = Array.isArray(playback?.media) ? playback.media : [];
    // HLS 프로토콜 우선(여러 화질이면 마스터 m3u8 그대로 — hls.js/네이티브가 선택).
    const media =
      medias.find((m) => /hls/i.test(m?.protocol || "")) || medias[0];
    const m3u8 = media?.path || null;
    if (!m3u8) return null;
    // 메타: 프로필/채널명/인증/제목/카테고리/시청자/라이브 시작시각.
    const meta = {
      channelName: c?.channel?.channelName || "",
      channelImageUrl: c?.channel?.channelImageUrl || "",
      verifiedMark: c?.channel?.verifiedMark === true,
      title: c?.liveTitle || "",
      category: c?.liveCategoryValue || c?.liveCategory || "",
      viewers: Number.isFinite(Number(c?.concurrentUserCount))
        ? new Intl.NumberFormat("ko-KR").format(Number(c.concurrentUserCount))
        : "",
      openAt: parsePublishDate(c?.openDate) || 0,
    };
    const data = { m3u8, meta, at: Date.now() };
    followPreviewState.playbackCache.set(channelId, data);
    return data;
  } catch {
    return null;
  } finally {
    if (followPreviewState.fetching === channelId)
      followPreviewState.fetching = "";
  }
}

// 미리보기 패널 생성/획득(드래그 리사이즈 핸들 포함). 1회 생성 후 재사용.
function ensureFollowPreviewEl() {
  let el = document.getElementById(FOLLOW_PREVIEW_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = FOLLOW_PREVIEW_ID;
  el.innerHTML =
    // 별도 헤더 바(채널명·카테고리·시청자 + 제목 + 고정 핀).
    `<div class="cheese-follow-preview-header">` +
    `<div class="cheese-follow-preview-meta"></div>` +
    `<button type="button" class="cheese-follow-preview-pin" aria-label="고정" aria-pressed="false" title="고정">` +
    // 'pin' 아이콘.
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>` +
    `</button>` +
    `</div>` +
    // 영상 본문.
    `<div class="cheese-follow-preview-body">` +
    `<div class="cheese-follow-preview-loading" aria-hidden="true"><i></i><i></i><i></i></div>` +
    `<video class="cheese-follow-preview-video" muted autoplay playsinline controls controlslist="nodownload noremoteplayback noplaybackrate"></video>` +
    `<span class="cheese-follow-preview-resize" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 9a12 12 0 0 1-12 12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></span>` +
    `</div>`;
  document.body.appendChild(el);
  // 패널 위에 있으면 닫지 않도록 hover 추적(드래그 리사이즈용). 벗어나면 닫음.
  el.addEventListener("mouseleave", () => scheduleCloseFollowPreview());
  el.addEventListener("mouseenter", () => {
    if (followPreviewState.hoverTimer) {
      clearTimeout(followPreviewState.hoverTimer);
      followPreviewState.hoverTimer = 0;
    }
  });
  // 고정 핀 토글: 켜면 호버 벗어나도 유지(닫기 차단).
  el.querySelector(".cheese-follow-preview-pin")?.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFollowPreviewPinned(!followPreviewState.pinned);
    },
  );
  bindFollowPreviewResize(el);
  bindFollowPreviewMove(el);
  return el;
}

// 헤더 바를 드래그해 패널을 이동한다(핀 버튼 제외). 이동하면 movedPos에 좌표를
// 저장해 같은 세션 동안 그 위치를 유지(닫으면 리셋). 드래그 중엔 닫기 차단.
function bindFollowPreviewMove(el) {
  const header = el.querySelector(".cheese-follow-preview-header");
  if (!header) return;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let moving = false;
  const onMove = (e) => {
    if (!moving) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = startLeft + (e.clientX - startX);
    let top = startTop + (e.clientY - startY);
    // 화면 안으로 클램프.
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    followPreviewState.movedPos = { left, top };
  };
  const onUp = (e) => {
    if (!moving) return;
    moving = false;
    followPreviewState.resizing = false; // 이동도 리사이즈와 같은 '닫기 차단' 플래그 공유
    try {
      header.releasePointerCapture?.(e.pointerId);
    } catch {}
    header.removeEventListener("pointermove", onMove);
    header.removeEventListener("pointerup", onUp);
    header.removeEventListener("pointercancel", onUp);
  };
  header.addEventListener("pointerdown", (e) => {
    // 핀 버튼 클릭은 이동이 아님.
    if (e.target?.closest?.(".cheese-follow-preview-pin")) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    moving = true;
    followPreviewState.resizing = true; // 드래그 동안 호버-닫기 차단
    if (followPreviewState.hoverTimer) {
      clearTimeout(followPreviewState.hoverTimer);
      followPreviewState.hoverTimer = 0;
    }
    const r = el.getBoundingClientRect();
    startLeft = r.left;
    startTop = r.top;
    startX = e.clientX;
    startY = e.clientY;
    try {
      header.setPointerCapture?.(e.pointerId);
    } catch {}
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
    header.addEventListener("pointercancel", onUp);
  });
}

function setFollowPreviewPinned(on) {
  followPreviewState.pinned = on;
  const el = document.getElementById(FOLLOW_PREVIEW_ID);
  if (!el) return;
  el.classList.toggle("is-pinned", on);
  const btn = el.querySelector(".cheese-follow-preview-pin");
  if (btn) {
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "고정 해제" : "고정");
    btn.setAttribute("title", on ? "고정 해제" : "고정");
  }
  // 고정 켜는 순간 대기 중 닫기 취소.
  if (on && followPreviewState.hoverTimer) {
    clearTimeout(followPreviewState.hoverTimer);
    followPreviewState.hoverTimer = 0;
  }
}

// 패널을 호버 요소 옆(치지직 툴팁 자리)에 fixed 배치. 기본은 우측, 사이드바가
// 오른쪽 배치(sidebarRight)거나 우측 공간 부족이면 좌측에 둔다. 좌측 배치면 패널에
// is-left 클래스 → 리사이즈 핸들이 좌하단으로 가고 드래그 방향도 반대가 된다.
function positionFollowPreview(el, anchor) {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const GAP = 10;
  const EDGE = 8;

  // 드래그로 옮겼으면 그 위치 유지(저장 너비 그대로).
  if (followPreviewState.movedPos) {
    const w = followPreviewState.width;
    el.style.width = `${w}px`;
    el.style.height = "";
    applyFollowPreviewWidthClass(el, w);
    const totalH = el.offsetHeight || Math.round((w * 9) / 16) + 44;
    let { left, top } = followPreviewState.movedPos;
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
    top = Math.max(EDGE, Math.min(top, vh - totalH - EDGE));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    return;
  }

  // 앵커(li) 양옆의 가용 폭.
  const rightSpace = vw - r.right - GAP - EDGE; // li 우측에 둘 때 쓸 수 있는 폭
  const leftSpace = r.left - GAP - EDGE; // li 좌측에 둘 때 쓸 수 있는 폭
  // 배치 쪽 판단은 **저장 너비가 아니라 '최소 너비가 들어가는가'** 기준.
  // (큰 저장 너비로 판단하면, 우측을 줄여 넣을 수 있는데도 좌측=사이드바 위로 잘못 감.)
  // 기본 우측, sidebarRight거나 우측에 최소폭도 안 들어가고 좌측이 더 넓을 때만 좌측.
  let side; // true=좌측(is-left)
  if (featureFlags.sidebarRight) side = true;
  else if (rightSpace >= FOLLOW_PREVIEW_MIN_W)
    side = false; // 우측에 최소폭 들어가면 우측
  else side = leftSpace > rightSpace; // 우측 너무 좁으면 더 넓은 쪽
  const space = side ? leftSpace : rightSpace;
  // 표시 너비를 그 쪽 가용 폭으로 클램프(저장값은 보존, 표시만 축소).
  const w = Math.max(
    FOLLOW_PREVIEW_MIN_W,
    Math.min(followPreviewState.width, Math.floor(space)),
  );

  el.style.width = `${w}px`;
  el.style.height = "";
  applyFollowPreviewWidthClass(el, w);
  const totalH = el.offsetHeight || Math.round((w * 9) / 16) + 44;

  let left = side ? r.left - w - GAP : r.right + GAP;
  if (left < EDGE) left = EDGE;
  if (left + w + EDGE > vw) left = vw - w - EDGE;
  let top = r.top + r.height / 2 - totalH / 2;
  top = Math.max(EDGE, Math.min(top, vh - totalH - EDGE));
  el.classList.toggle("is-left", side);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

// 미리보기 시작: m3u8 받아 video에 연결(네이티브 우선, 폴백 hls.js).
async function openFollowPreview(li, channelId) {
  if (!followPreviewOn || document.hidden) return;
  followPreviewState.currentChannelId = channelId;
  followPreviewState.retried = false;
  // 새 호버로 여는 것이므로 이전에 드래그로 옮긴 위치는 버리고 앵커 기준으로 재배치
  // 한다(고정 중엔 호버로 안 열리니 movedPos가 안 남는다 — 이건 호버 신규 진입).
  followPreviewState.movedPos = null;
  const el = ensureFollowPreviewEl();
  positionFollowPreview(el, li);
  el.classList.add("is-loading");
  el.classList.remove("is-ready");

  const data = await fetchLivePreviewData(channelId);
  // 그새 호버가 바뀌었으면 중단.
  if (followPreviewState.currentChannelId !== channelId) return;
  if (!data?.m3u8) {
    closeFollowPreview();
    return;
  }
  renderFollowPreviewMeta(el, data.meta);
  attachFollowPreviewSource(el, data.m3u8, channelId);
}

// 경과 시간(ms 시작시각 → "HH:MM:SS", 시는 0패딩).
function formatLiveElapsed(openAtMs) {
  if (!openAtMs) return "";
  let s = Math.floor((Date.now() - openAtMs) / 1000);
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

// 메타 바 — 프로필 | (제목 / 채널명·인증·카테고리) | (현재 시청자 / 경과시간).
function renderFollowPreviewMeta(el, meta) {
  const bar = el.querySelector(".cheese-follow-preview-meta");
  if (!bar || !meta) return;
  const elapsed = formatLiveElapsed(meta.openAt);
  const imageUrl = meta.channelImageUrl
    ? `${meta.channelImageUrl}${meta.channelImageUrl.includes("?") ? "&" : "?"}type=f120_120_na`
    : "";
  bar.innerHTML =
    // 1) 프로필
    `<span class="cheese-follow-preview-meta-profile">` +
    (imageUrl
      ? `<img src="${escapeAttribute(imageUrl)}" alt="" loading="lazy" decoding="async">`
      : "") +
    `</span>` +
    // 2) 중앙: 제목 + (채널명·인증·카테고리)
    `<span class="cheese-follow-preview-meta-center">` +
    (meta.title
      ? `<strong class="cheese-follow-preview-meta-title">${escapeHtml(meta.title)}</strong>`
      : "") +
    `<span class="cheese-follow-preview-meta-sub">` +
    `<span class="cheese-follow-preview-meta-name">${escapeHtml(meta.channelName)}</span>` +
    (meta.verifiedMark
      ? `<i class="cheese-follow-preview-meta-verified" aria-hidden="true"></i>`
      : "") +
    (meta.category
      ? `<span class="cheese-follow-preview-meta-category">${escapeHtml(meta.category)}</span>`
      : "") +
    `</span>` +
    `</span>` +
    // 3) 우측: 현재 시청자 / 경과시간
    `<span class="cheese-follow-preview-meta-side">` +
    (meta.viewers
      ? `<em class="cheese-follow-preview-meta-viewers">현재 ${escapeHtml(meta.viewers)}</em>`
      : "") +
    (elapsed
      ? `<span class="cheese-follow-preview-meta-elapsed" data-open-at="${meta.openAt}"><b>${escapeHtml(elapsed)}</b> 스트리밍 중</span>`
      : "") +
    `</span>`;
  startFollowPreviewElapsedTimer(el);
}

// 경과 시간을 1초마다 갱신(텍스트만). 패널 있을 때만 동작.
function startFollowPreviewElapsedTimer(el) {
  stopFollowPreviewElapsedTimer();
  followPreviewState.elapsedTimer = setInterval(() => {
    const span = el.querySelector(".cheese-follow-preview-meta-elapsed");
    if (!span) return;
    const openAt = Number(span.dataset.openAt);
    if (!openAt) return;
    const b = span.querySelector("b");
    const next = formatLiveElapsed(openAt);
    if (b && b.textContent !== next) b.textContent = next; // 시간 부분만 갱신
  }, 1000);
}

function stopFollowPreviewElapsedTimer() {
  if (followPreviewState.elapsedTimer) {
    clearInterval(followPreviewState.elapsedTimer);
    followPreviewState.elapsedTimer = 0;
  }
}

function attachFollowPreviewSource(el, m3u8, channelId) {
  const video = el.querySelector(".cheese-follow-preview-video");
  if (!video) return;
  teardownFollowPreviewMedia(video); // 이전 연결 정리
  const onReady = () => {
    if (followPreviewState.currentChannelId === channelId) {
      el.classList.remove("is-loading");
      el.classList.add("is-ready");
    }
  };
  const onError = () => {
    // 토큰 만료 등 → 캐시 무효화 후 1회 재시도.
    if (followPreviewState.retried) return;
    followPreviewState.retried = true;
    followPreviewState.playbackCache.delete(channelId);
    void (async () => {
      const fresh = await fetchLivePreviewData(channelId);
      if (fresh?.m3u8 && followPreviewState.currentChannelId === channelId) {
        renderFollowPreviewMeta(el, fresh.meta);
        attachFollowPreviewSource(el, fresh.m3u8, channelId);
      }
    })();
  };
  video.addEventListener("loadeddata", onReady, { once: true });
  video.addEventListener("error", onError, { once: true });

  // hls.js 우선: 네이티브 HLS는 ABR이 144p→점진 상승이라 초반 저화질이 오래간다.
  // hls.js는 startLevel을 최고로 두면 처음부터 1080p로 시작한다(UX↑). hls.js가
  // 불가능한 환경(드묾)에서만 네이티브 폴백.
  if (typeof Hls !== "undefined" && Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      startLevel: -1, // MANIFEST_PARSED에서 최고 레벨로 직접 지정
      autoStartLoad: true,
      capLevelToPlayerSize: false, // 작은 미리보기라도 고화질 시작 허용
    });
    followPreviewState.hls = hls;
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data?.fatal) onError();
    });
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      // 가장 높은 화질로 시작(레벨 인덱스가 클수록 보통 고화질).
      const levels = data?.levels || hls.levels || [];
      if (levels.length) {
        let best = 0;
        let bestH = -1;
        levels.forEach((lv, i) => {
          const hgt = lv?.height || 0;
          if (hgt >= bestH) {
            bestH = hgt;
            best = i;
          }
        });
        hls.startLevel = best;
        hls.currentLevel = best; // 즉시 그 화질로
      }
      video.play?.().catch(() => {});
    });
    hls.loadSource(m3u8);
    hls.attachMedia(video);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    // 네이티브 폴백(화질 제어 제한 — ABR이 점진 상승할 수 있음).
    video.src = m3u8;
    video.play?.().catch(() => {});
  } else {
    closeFollowPreview();
  }
}

// video/hls 연결 해제(스트림 끊기).
function teardownFollowPreviewMedia(video) {
  if (followPreviewState.hls) {
    try {
      followPreviewState.hls.destroy();
    } catch {}
    followPreviewState.hls = null;
  }
  if (video) {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {}
  }
}

function closeFollowPreview() {
  followPreviewState.currentChannelId = "";
  followPreviewState.resizing = false;
  followPreviewState.pinned = false;
  followPreviewState.movedPos = null;
  stopFollowPreviewElapsedTimer();
  if (followPreviewState.hoverTimer) {
    clearTimeout(followPreviewState.hoverTimer);
    followPreviewState.hoverTimer = 0;
  }
  const el = document.getElementById(FOLLOW_PREVIEW_ID);
  if (!el) return;
  const video = el.querySelector(".cheese-follow-preview-video");
  teardownFollowPreviewMedia(video);
  el.remove();
}

// 잠깐의 유예 후 닫기(li↔패널 사이 이동 시 깜빡임 방지). 드래그 리사이즈 중엔
// 마우스가 패널 밖으로 나가도 닫지 않는다(드래그 중 화면 꺼짐 버그 방지).
function scheduleCloseFollowPreview() {
  if (followPreviewState.resizing || followPreviewState.pinned) return;
  if (followPreviewState.hoverTimer)
    clearTimeout(followPreviewState.hoverTimer);
  followPreviewState.hoverTimer = setTimeout(() => {
    followPreviewState.hoverTimer = 0;
    if (followPreviewState.resizing || followPreviewState.pinned) return;
    closeFollowPreview();
  }, 120);
}

// 드래그 리사이즈. 우측 배치면 우하단 핸들을 오른쪽으로 끌수록 커지고, 좌측 배치
// (is-left)면 좌하단 핸들을 왼쪽으로 끌수록 커진다(패널 우측 가장자리 고정). width만
// 조절, height는 16:9 연동. 저장.
function bindFollowPreviewResize(el) {
  const handle = el.querySelector(".cheese-follow-preview-resize");
  if (!handle) return;
  let startX = 0;
  let startW = 0;
  let startRight = 0; // 좌측 배치 시 고정할 우측 가장자리
  let leftMode = false;
  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    // 좌측 배치면 왼쪽으로 끌수록(델타 음수) 커지므로 부호 반전.
    const delta = leftMode ? startX - e.clientX : e.clientX - startX;
    const w = Math.round(
      Math.max(
        FOLLOW_PREVIEW_MIN_W,
        Math.min(FOLLOW_PREVIEW_MAX_W, startW + delta),
      ),
    );
    followPreviewState.width = w;
    el.style.width = `${w}px`; // 높이는 CSS(헤더 auto + body 16:9)가 처리
    applyFollowPreviewWidthClass(el, w); // 좁아지면 우측 메타 숨김
    // 좌측 배치면 우측 가장자리를 고정(왼쪽으로 확장).
    if (leftMode) el.style.left = `${Math.max(8, startRight - w)}px`;
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    followPreviewState.resizing = false;
    try {
      handle.releasePointerCapture?.(e.pointerId);
    } catch {}
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    saveFollowPreviewSize();
  };
  // Pointer Events + setPointerCapture: 영상 컨트롤 위에서 손을 떼도 up 이벤트가
  // 핸들에 확실히 도달한다(mousedown/mouseup만 쓰면 video controls가 가로채 드래그가
  // 안 끝나고 추가 클릭이 필요했던 버그 해결).
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    followPreviewState.resizing = true;
    if (followPreviewState.hoverTimer) {
      clearTimeout(followPreviewState.hoverTimer);
      followPreviewState.hoverTimer = 0;
    }
    startX = e.clientX;
    startW = followPreviewState.width;
    leftMode = el.classList.contains("is-left");
    startRight = el.getBoundingClientRect().right; // 좌측 확장 시 고정점
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {}
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

function saveFollowPreviewSize() {
  try {
    chrome.storage?.local?.set({
      [FOLLOW_PREVIEW_SIZE_KEY]: { w: followPreviewState.width },
    });
  } catch {}
}

// 호버 대상에서 미리보기 앵커({anchor, channelId})를 찾는다. 두 출처:
//  1) 사이드바 팔로잉 섹션의 라이브 li
//  2) 헤더 미니 팔로우 네비 아이템(li.cheese-header-follow-item[data-channel-id])
function getFollowPreviewAnchor(target) {
  const t = target?.closest?.(
    'aside#sidebar nav[class*="_section_"] li, .cheese-header-follow-item',
  );
  if (!t) return null;
  if (t.classList.contains("cheese-header-follow-item")) {
    // 헤더 팔로우 아이템은 모두 라이브(우리가 라이브만 렌더). data-channel-id 사용.
    const channelId = t.dataset.channelId || "";
    return channelId ? { anchor: t, channelId } : null;
  }
  // 사이드바: 팔로잉 섹션 + 라이브만.
  const nav = t.closest('nav[class*="_section_"]');
  if (!nav || !getSidebarNavLabel(nav).includes("팔로")) return null;
  if (!isLiveFollowItem(t)) return null;
  const channelId = getFollowItemChannelId(t);
  return channelId ? { anchor: t, channelId } : null;
}

// 위임 호버. 라이브 팔로잉(사이드바/헤더) 진입 → 디바운스 후 미리보기.
function onFollowPreviewMouseOver(e) {
  if (!followPreviewOn || document.hidden) return;
  // 드래그/고정 중엔 다른 채널로 전환하지 않는다.
  if (followPreviewState.resizing || followPreviewState.pinned) return;
  const found = getFollowPreviewAnchor(e.target);
  if (!found) return;
  if (found.channelId === followPreviewState.currentChannelId) return; // 이미 표시 중
  if (followPreviewState.hoverTimer)
    clearTimeout(followPreviewState.hoverTimer);
  followPreviewState.hoverTimer = setTimeout(() => {
    followPreviewState.hoverTimer = 0;
    openFollowPreview(found.anchor, found.channelId);
  }, FOLLOW_PREVIEW_HOVER_DELAY_MS);
}

function onFollowPreviewMouseOut(e) {
  // 앵커를 벗어나 패널/외부로 가면 닫기 예약(패널 진입은 mouseenter가 취소).
  const toEl = e.relatedTarget;
  if (toEl && toEl.closest?.(`#${FOLLOW_PREVIEW_ID}`)) return; // 패널로 이동
  if (!getFollowPreviewAnchor(e.target)) return;
  scheduleCloseFollowPreview();
}

// 고정된 미리보기는 패널 밖을 클릭하면 닫는다(호버 외 닫기 수단).
function onFollowPreviewDocClick(e) {
  if (!followPreviewState.pinned) return;
  if (e.target?.closest?.(`#${FOLLOW_PREVIEW_ID}`)) return; // 패널 내부 클릭은 유지
  if (getFollowPreviewAnchor(e.target)) return; // 팔로우 아이템 클릭(이동)은 그대로
  closeFollowPreview();
}

function bindFollowPreviewHover() {
  if (followPreviewState.bound) return;
  followPreviewState.bound = true;
  document.addEventListener("mouseover", onFollowPreviewMouseOver, {
    passive: true,
  });
  document.addEventListener("mouseout", onFollowPreviewMouseOut, {
    passive: true,
  });
  document.addEventListener("click", onFollowPreviewDocClick, true);
}

async function loadFollowPreview() {
  if (!chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get([
      FOLLOW_PREVIEW_KEY,
      FOLLOW_PREVIEW_SIZE_KEY,
    ]);
    followPreviewOn = data?.[FOLLOW_PREVIEW_KEY] !== false; // 미설정/true=ON
    const size = data?.[FOLLOW_PREVIEW_SIZE_KEY];
    const w = Number(size?.w);
    if (Number.isFinite(w)) {
      followPreviewState.width = Math.max(
        FOLLOW_PREVIEW_MIN_W,
        Math.min(FOLLOW_PREVIEW_MAX_W, w),
      );
    }
  } catch {}
  if (followPreviewOn) bindFollowPreviewHover();
  else closeFollowPreview();
}

// ── 라이브 탐색 카드 호버 미리보기 음소거 토글(우클릭) ─────────────────────
// 치지직이 카드(a[href^="/live/"]) 호버 시 주입하는 음소거 video(.webplayer-internal-
// video) 위에서 **우클릭**하면 음소거를 토글한다. 버튼 오버레이는 두지 않는다 —
// video 부모는 React DOM이라 버튼 주입 시 무한 재렌더, body 오버레이는 마우스가
// 카드를 벗어난 것으로 판정돼 치지직이 미리보기를 멈춘다. 우클릭은 카드 위에 마우스가
// 머문 채라 미리보기가 안 멈추고, 네비게이션도 안 유발해 capture로 안정적이다.
const CARD_PREVIEW_VIDEO_SEL = "video.webplayer-internal-video";
let cardPreviewBound = false;

// 카드 미리보기 video인지(우리 미리보기/플레이어 PIP 제외). 카드 링크 안의 것만.
function isCardPreviewVideo(v) {
  if (!v || !v.matches?.(CARD_PREVIEW_VIDEO_SEL)) return false;
  if (v.closest("#cheese-follow-preview")) return false;
  if (v.closest(".pzp")) return false; // 메인 플레이어/PIP 제외
  return Boolean(v.closest('a[href^="/live/"]'));
}

// document capture 우클릭: 카드 미리보기 video 위면 기본 메뉴 막고 음소거 토글.
// 이벤트 지점의 카드 미리보기 video를 찾는다(target 직접 또는 카드 안의 video).
function cardPreviewVideoAtEvent(e) {
  if (
    e.target?.matches?.(CARD_PREVIEW_VIDEO_SEL) &&
    isCardPreviewVideo(e.target)
  )
    return e.target;
  const card = e.target?.closest?.('a[href^="/live/"]');
  const v = card?.querySelector?.(CARD_PREVIEW_VIDEO_SEL);
  return v && isCardPreviewVideo(v) ? v : null;
}

// 우클릭: 카드 미리보기 video 위면 기본 메뉴 막고 음소거 토글.
function onCardPreviewContextCapture(e) {
  if (!cardPreviewAudioOn) return;
  const video = cardPreviewVideoAtEvent(e);
  if (!video) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  video.muted = !video.muted;
  if (!video.muted && video.volume === 0) video.volume = 1;
}

// 휠: 카드 미리보기 video 위면 음량 ±5%(올리면 자동 음소거 해제). 페이지 스크롤 막음.
const CARD_PREVIEW_WHEEL_STEP = 0.05;
function onCardPreviewWheelCapture(e) {
  if (!cardPreviewAudioOn) return;
  const video = cardPreviewVideoAtEvent(e);
  if (!video) return;
  e.preventDefault(); // 페이지 스크롤 차단
  e.stopPropagation();
  e.stopImmediatePropagation();
  const dir = e.deltaY < 0 ? 1 : -1; // 위로=증가
  let vol =
    (Number.isFinite(video.volume) ? video.volume : 1) +
    dir * CARD_PREVIEW_WHEEL_STEP;
  vol = Math.max(0, Math.min(1, Math.round(vol * 100) / 100));
  video.volume = vol;
  // 음량을 올리면 자동 음소거 해제, 0으로 내리면 음소거.
  if (dir > 0 && video.muted) video.muted = false;
  if (vol === 0) video.muted = true;
}

// 조작 안내(우클릭=음소거, 휠=음량)를 **커스텀 툴팁**으로 표시. title 속성은 표시/
// 숨김 타이밍을 브라우저가 제어해 '잠깐 떴다 사라짐'이 안 됐다(나타남 지연 + 호버 중
// 안 닫힘). body 직속 div(pointer-events:none)라 마우스 이벤트를 안 가로채 미리보기가
// 안 멈춘다. 미리보기 video가 실제 있는 카드에만, 세션당 1회, N초 뒤 페이드아웃.
const CARD_HINT_ID = "cheese-card-hint";
const CARD_HINT_TEXT = "우클릭: 음소거 / 토글 · 마우스 휠: 음량 조절";
const CARD_HINT_SHOW_MS = 3000; // 표시 후 이 시간 뒤 사라짐
let cardPreviewHoverCard = null; // 현재 호버 중인 카드(세션당 1회)
let cardHintPollTimer = 0; // video 생성 폴링
let cardHintHideTimer = 0; // 자동 숨김

function ensureCardHintEl() {
  let el = document.getElementById(CARD_HINT_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = CARD_HINT_ID;
  el.textContent = CARD_HINT_TEXT;
  document.body.appendChild(el);
  return el;
}

function hideCardHint() {
  if (cardHintPollTimer) {
    clearTimeout(cardHintPollTimer);
    cardHintPollTimer = 0;
  }
  if (cardHintHideTimer) {
    clearTimeout(cardHintHideTimer);
    cardHintHideTimer = 0;
  }
  document.getElementById(CARD_HINT_ID)?.classList.remove("is-visible");
}

// 카드에 미리보기 video가 있으면 그 카드 우상단에 툴팁 표시(없으면 폴링).
function tryShowCardHint(card, tries) {
  cardHintPollTimer = 0;
  if (!cardPreviewAudioOn || !card.isConnected || card !== cardPreviewHoverCard)
    return;
  const v = card.querySelector(CARD_PREVIEW_VIDEO_SEL);
  if (v && isCardPreviewVideo(v)) {
    const el = ensureCardHintEl();
    const r = v.getBoundingClientRect();
    // video 상단 중앙에 배치(가로 중앙, 위에서 살짝 안쪽).
    el.style.top = `${Math.round(r.top + 10)}px`;
    el.style.left = `${Math.round(r.left + r.width / 2)}px`;
    el.classList.add("is-visible");
    // N초 뒤 페이드아웃(호버 유지해도 다시 안 띄움 = 세션당 1회).
    cardHintHideTimer = setTimeout(() => {
      cardHintHideTimer = 0;
      el.classList.remove("is-visible");
    }, CARD_HINT_SHOW_MS);
    return;
  }
  if (tries > 0) {
    cardHintPollTimer = setTimeout(() => tryShowCardHint(card, tries - 1), 150);
  }
}

function onCardPreviewMouseOver(e) {
  if (!cardPreviewAudioOn) return;
  const card = e.target?.closest?.('a[href^="/live/"]');
  // 메인 플레이어/우리 미리보기 안의 링크는 제외.
  if (card && (card.closest(".pzp") || card.closest("#cheese-follow-preview")))
    return;
  if (card === cardPreviewHoverCard) return; // 같은 카드 계속 호버 → 그대로
  hideCardHint(); // 다른 카드/이탈 → 이전 툴팁·타이머 정리
  cardPreviewHoverCard = card || null;
  if (card) tryShowCardHint(card, 10); // ~1.5초 폴링 후 표시
}

function bindCardPreviewAudio() {
  if (cardPreviewBound) return;
  cardPreviewBound = true;
  // capture로 치지직 기본 우클릭 메뉴/핸들러보다 먼저 선점.
  document.addEventListener("contextmenu", onCardPreviewContextCapture, true);
  // wheel은 passive:false라야 preventDefault로 페이지 스크롤을 막을 수 있다.
  document.addEventListener("wheel", onCardPreviewWheelCapture, {
    capture: true,
    passive: false,
  });
  // 안내 툴팁(미리보기 있는 카드 진입 시).
  document.addEventListener("mouseover", onCardPreviewMouseOver, {
    passive: true,
  });
}

function unbindCardPreviewAudio() {
  cardPreviewBound = false;
  document.removeEventListener(
    "contextmenu",
    onCardPreviewContextCapture,
    true,
  );
  document.removeEventListener("wheel", onCardPreviewWheelCapture, {
    capture: true,
  });
  document.removeEventListener("mouseover", onCardPreviewMouseOver);
  hideCardHint();
  document.getElementById(CARD_HINT_ID)?.remove();
  cardPreviewHoverCard = null;
}

async function loadCardPreviewAudio() {
  if (!chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get(CARD_PREVIEW_AUDIO_KEY);
    cardPreviewAudioOn = data?.[CARD_PREVIEW_AUDIO_KEY] !== false; // 미설정/true=ON
  } catch {}
  if (cardPreviewAudioOn) bindCardPreviewAudio();
  else unbindCardPreviewAudio();
}

// 헤더 전담 옵저버(미니 네비가 React 재렌더로 사라지면 즉시 복구).
let headerObserver = null;
let headerObservedRoot = null;
function ensureHeaderObserver() {
  const header = document.getElementById("header");
  if (!header) return;
  if (headerObservedRoot === header && headerObserver) return;
  if (headerObserver) headerObserver.disconnect();
  headerObservedRoot = header;
  headerObserver = new MutationObserver(() => {
    // 우리 컨테이너 변경으로 자가 발화하지 않도록 ensureHeaderNav는 멱등(시그니처 비교).
    ensureHeaderNav();
    ensureHeaderFollowNav();
  });
  headerObserver.observe(header, { childList: true, subtree: true });
  ensureHeaderNav();
  ensureHeaderFollowNav();
}

async function loadHeaderNav() {
  if (!chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get([
      HEADER_NAV_KEY,
      HEADER_FOLLOW_COUNT_KEY,
    ]);
    const v = data?.[HEADER_NAV_KEY];
    headerNavConfig = v && typeof v === "object" ? v : {};
    headerFollowPageSize = normalizeHeaderFollowCount(
      data?.[HEADER_FOLLOW_COUNT_KEY],
    );
  } catch {
    headerNavConfig = {};
    headerFollowPageSize = HEADER_FOLLOW_DEFAULT_COUNT;
  }
  ensureHeaderNav();
  ensureHeaderFollowNav();
}

// ── 사이드바 팔로우 채널 주기 갱신(치지직 새로고침 버튼 자동 클릭) ───────────
// 우리가 DOM을 만들지 않고, 치지직 '새로고침' 버튼을 주기적으로 클릭해 React가
// 스스로 갱신하게 한다(충돌 없음). 0=끔, 그 외 30/60/120초.
const FOLLOW_REFRESH_KEY = "cheeseFollowRefreshSec";
let followRefreshSec = 0;
let followRefreshTimer = 0;

function clickFollowRefresh() {
  if (document.hidden) return;
  if (
    featureFlags.sidebar &&
    featureFlags.headerTopicTabs &&
    !featureFlags.sbFollow
  ) {
    void requestHeaderFollowLiveInfoRefresh();
  }
  const nav = findFollowNavForRefresh();
  if (!nav) return;
  // 새로고침 버튼은 펼침 상태에만 존재한다 → 접힘 상태에선 버튼이 없어 자동
  // 클릭이 일어나지 않는다(=펼침 상태에서만 갱신). 접힘은 치지직 기본 동작 유지.
  // (API 직접 호출은 치지직 React 상태를 못 바꿔 사이드바/툴팁이 갱신되지 않으므로
  //  쓰지 않는다.)
  const btn = nav.querySelector('button[aria-label="새로고침"]');
  if (btn) btn.click();
}

function findFollowNavForRefresh() {
  return findSidebarFollowNav();
}

// 10초 이하로 짧게 설정하면 연속 호출이 rate-limit에 걸릴 수 있어, '설정값 ↔
// 설정값~10초 랜덤'을 번갈아 호출한다(짧은 갱신 + 가끔 긴 간격으로 부담 분산).
const FOLLOW_REFRESH_SHORT_THRESHOLD = 10;
const FOLLOW_REFRESH_RANDOM_MAX = 10; // 랜덤 간격 상한(초)
let followRefreshAlternate = false; // 다음 간격이 '긴(랜덤)' 차례인지

// 다음 호출까지의 간격(ms)을 계산한다. 짧은 설정이면 설정값과 설정값~10초 랜덤을
// 번갈아(설정값이 하한 → 최소한 설정한 만큼은 기다리되 가끔 최대 10초까지 늘림).
function nextFollowRefreshDelayMs() {
  if (followRefreshSec <= FOLLOW_REFRESH_SHORT_THRESHOLD) {
    followRefreshAlternate = !followRefreshAlternate;
    if (followRefreshAlternate) {
      const span = Math.max(0, FOLLOW_REFRESH_RANDOM_MAX - followRefreshSec);
      return (followRefreshSec + Math.random() * span) * 1000;
    }
  }
  return followRefreshSec * 1000;
}

function startFollowRefreshTimer() {
  stopFollowRefreshTimer();
  if (!followRefreshSec) return;
  followRefreshAlternate = false;
  const tick = () => {
    clickFollowRefresh();
    // 매번 다음 간격을 새로 계산(가변 간격이라 setInterval 대신 setTimeout 체인).
    followRefreshTimer = setTimeout(tick, nextFollowRefreshDelayMs());
  };
  followRefreshTimer = setTimeout(tick, nextFollowRefreshDelayMs());
}

function stopFollowRefreshTimer() {
  if (followRefreshTimer) {
    clearTimeout(followRefreshTimer);
    followRefreshTimer = 0;
  }
}

// 0=끔, 그 외 3~600초로 클램프. 잘못된 값/음수는 끔으로.
function applyFollowRefresh(secRaw) {
  let sec = Number(secRaw);
  if (!Number.isFinite(sec) || sec <= 0) sec = 0;
  else sec = Math.min(600, Math.max(3, sec));
  followRefreshSec = sec;
  startFollowRefreshTimer();
}

async function loadFollowRefresh() {
  if (!chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get(FOLLOW_REFRESH_KEY);
    applyFollowRefresh(data?.[FOLLOW_REFRESH_KEY]);
  } catch {}
}

// 기능 플래그 + 따라잡기 프리셋을 MAIN world(오디오믹서 등)에 한 번에 전달.
// 저장된 프리셋 문자열을 유효값으로 정규화(low/normal/high/custom, 그 외 normal).
function normalizeSyncPresetValue(p) {
  return p === "low" || p === "normal" || p === "high" || p === "custom"
    ? p
    : "normal";
}

function broadcastFeatureFlags() {
  window.postMessage(
    {
      source: FEATURE_FLAGS_MESSAGE,
      flags: { ...featureFlags },
      syncPreset: syncPresetValue,
      syncCustom: syncCustomValue, // {enable,target} 또는 null
      mixerAlwaysOn, // 오디오 믹서 항상 켜기(전역)
    },
    location.origin,
  );
}

async function loadFeatureFlags() {
  if (!chrome.storage?.local) return;
  try {
    const data = await chrome.storage.local.get([
      FEATURE_HIDDEN_KEY,
      SYNC_PRESET_KEY,
      SYNC_CUSTOM_KEY,
      MIXER_ALWAYS_ON_KEY,
    ]);
    syncPresetValue = normalizeSyncPresetValue(data?.[SYNC_PRESET_KEY]);
    const custom = data?.[SYNC_CUSTOM_KEY];
    syncCustomValue = custom && typeof custom === "object" ? custom : null;
    mixerAlwaysOn = data?.[MIXER_ALWAYS_ON_KEY] === true;
    applyFeatureFlags(data?.[FEATURE_HIDDEN_KEY]); // 내부에서 broadcast
  } catch {
    // 실패 시 전부 표시(기본값) 유지.
  }
}

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SYNC_PRESET_KEY]) {
      syncPresetValue = normalizeSyncPresetValue(
        changes[SYNC_PRESET_KEY].newValue,
      );
    }
    if (changes[SYNC_CUSTOM_KEY]) {
      const custom = changes[SYNC_CUSTOM_KEY].newValue;
      syncCustomValue = custom && typeof custom === "object" ? custom : null;
    }
    if (changes[MIXER_ALWAYS_ON_KEY]) {
      mixerAlwaysOn = changes[MIXER_ALWAYS_ON_KEY].newValue === true;
    }
    if (changes[CHANNEL_LIVE_BUTTON_KEY]) {
      channelLiveButtonOn = changes[CHANNEL_LIVE_BUTTON_KEY].newValue !== false;
      ensureChannelLiveButton();
    }
    if (changes[CHANNEL_LIVE_BUTTON_END_KEY]) {
      channelLiveButtonEnd =
        changes[CHANNEL_LIVE_BUTTON_END_KEY].newValue !== false;
      ensureChannelLiveButton();
    }
    if (changes[FOLLOW_PREVIEW_KEY]) {
      followPreviewOn = changes[FOLLOW_PREVIEW_KEY].newValue !== false;
      if (followPreviewOn) bindFollowPreviewHover();
      else closeFollowPreview();
    }
    if (changes[CARD_PREVIEW_AUDIO_KEY]) {
      cardPreviewAudioOn = changes[CARD_PREVIEW_AUDIO_KEY].newValue !== false;
      if (cardPreviewAudioOn) bindCardPreviewAudio();
      else unbindCardPreviewAudio();
    }
    if (changes[FOLLOW_PREVIEW_SIZE_KEY]) {
      const w = Number(changes[FOLLOW_PREVIEW_SIZE_KEY].newValue?.w);
      if (Number.isFinite(w)) {
        followPreviewState.width = Math.max(
          FOLLOW_PREVIEW_MIN_W,
          Math.min(FOLLOW_PREVIEW_MAX_W, w),
        );
      }
    }
    if (changes[FEATURE_HIDDEN_KEY]) {
      applyFeatureFlags(changes[FEATURE_HIDDEN_KEY].newValue); // broadcast 포함
    } else if (
      changes[SYNC_PRESET_KEY] ||
      changes[SYNC_CUSTOM_KEY] ||
      changes[MIXER_ALWAYS_ON_KEY]
    ) {
      broadcastFeatureFlags(); // 프리셋/커스텀/항상켜기만 바뀐 경우도 전달
    }
    if (changes[FOLLOW_REFRESH_KEY]) {
      applyFollowRefresh(changes[FOLLOW_REFRESH_KEY].newValue);
    }
    if (changes[HEADER_NAV_KEY]) {
      const v = changes[HEADER_NAV_KEY].newValue;
      headerNavConfig = v && typeof v === "object" ? v : {};
      ensureHeaderNav();
      ensureHeaderFollowNav();
    }
    if (changes[HEADER_FOLLOW_COUNT_KEY]) {
      headerFollowPageSize = normalizeHeaderFollowCount(
        changes[HEADER_FOLLOW_COUNT_KEY].newValue,
      );
      clampHeaderFollowCarouselPage();
      document
        .getElementById(HEADER_FOLLOW_CONTAINER_ID)
        ?.removeAttribute("data-sig");
      ensureHeaderFollowNav();
    }
  });
}

function init() {
  initCommentTimestampMarkers();
  initSeekPreviewRealtime();
  initLiveDetailStartTooltip();
  // 사이드바는 SPA 재렌더로 마커 클래스가 지워질 수 있어 매 init마다 다시 부여한다.
  applySidebarSections();
  ensureSidebarObserver(); // 사이드바 전담 옵저버로 즉시 재적용(깜빡임 최소화)
  ensureHeaderNav(); // 사이드바 숨김 시 헤더 미니 네비 보장
  ensureHeaderFollowNav(); // 사이드바/주제 탭 숨김 시 팔로우 목록을 헤더에 보장
  ensureHeaderObserver(); // 헤더 재렌더로 사라지면 즉시 복구
  applyHeaderAutoHide(); // 자동 숨김 켜져 있으면 새 헤더 요소에 리스너 보정
  ensureChannelLiveButton(); // 채널 홈 탭리스트에 라이브 바로가기 버튼 보장

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
  // 검색 숨김: 현재 페이지 콘텐츠 타입(다시보기/클립)이 숨김이면 주입하지 않는다.
  const searchHidden =
    context?.contentType === "clips"
      ? featureFlags.searchClips
      : context?.contentType === "videos"
        ? featureFlags.searchVideos
        : false;
  if (!context?.channelId || searchHidden) {
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
  debounce(() => {
    repositionOpenCommentTimestampPanel();
    document
      .getElementById(HEADER_FOLLOW_CONTAINER_ID)
      ?.removeAttribute("data-sig");
    ensureHeaderFollowNav();
  }, 120),
  { passive: true },
);
document.addEventListener("click", handleCategoryFilterClick);
document.addEventListener("click", handleCategoryResetDocumentClick);
document.addEventListener("click", handleCommentTimestampDocumentClick);
document.addEventListener("click", handleStudioMoreCaptureClick, true);
document.addEventListener("click", handleStudioDocumentClick);
document.addEventListener("keydown", handleCommentTimestampKeydown);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "CHEESE_SEARCH_STUDIO_MAKE_CLIP_DELETED") {
    handleExternalStudioMakeClipDeletion(message.payload);
    return;
  }
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
void loadFeatureFlags();
void loadFollowRefresh();
void loadHeaderNav();
void loadChannelLiveButton();
void loadFollowPreview();
void loadCardPreviewAudio();

// MAIN world 스크립트가 로드 후 플래그를 요청하면 현재 값을 보내준다(레이스 방지).
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== `${FEATURE_FLAGS_MESSAGE}-request`) return;
  broadcastFeatureFlags();
});

// ── 오디오 믹서 설정 저장 브릿지 ─────────────────────────────────────────────
// MAIN world의 src/audioMixer.js는 chrome.storage에 직접 접근할 수 없으므로,
// window.postMessage로 받은 저장/복원 요청을 여기(격리 월드)에서 처리한다.
// per-media 설정은 audioMixer:<mediaId>, 커스텀 프리셋은 모든 채널이 공유하도록
// audioMixer:presets 전역 키에 따로 저장한다.
const AUDIO_MIXER_STORAGE_PREFIX = "audioMixer:";
const AUDIO_MIXER_PRESETS_KEY = "audioMixer:presets";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "cheese-audio-mixer") return;
  const channelId = String(data.channelId || "").trim();
  if (!channelId) return;
  const key = `${AUDIO_MIXER_STORAGE_PREFIX}${channelId}`;

  if (data.type === "save") {
    try {
      const incoming = data.state || {};
      // customPresets는 전역으로, 나머지는 per-media로 분리 저장.
      const { customPresets, ...perMedia } = incoming;
      const toSet = { [key]: perMedia };
      if (Array.isArray(customPresets)) {
        toSet[AUDIO_MIXER_PRESETS_KEY] = customPresets;
      }
      chrome.storage.local.set(toSet);
    } catch {}
  } else if (data.type === "load") {
    try {
      chrome.storage.local.get([key, AUDIO_MIXER_PRESETS_KEY], (result) => {
        const saved = result?.[key] || null;
        const presets = result?.[AUDIO_MIXER_PRESETS_KEY] || [];
        // per-media 설정에 전역 커스텀 프리셋을 합쳐서 반환.
        const merged = saved
          ? { ...saved, customPresets: presets }
          : { customPresets: presets };
        window.postMessage(
          {
            source: "cheese-audio-mixer-content",
            type: "loaded",
            channelId,
            state: merged,
          },
          location.origin,
        );
      });
    } catch {}
  }
});

// ── 탭 음소거 브릿지 ─────────────────────────────────────────────────────────
// MAIN world(audioMixer.js)의 탭 음소거 버튼이 보낸 토글/조회 요청을 background로
// 중계하고(콘텐츠는 chrome.tabs.update 못 씀), 응답(muted)을 MAIN world로 돌려준다.
function sendTabMute(action) {
  try {
    chrome.runtime.sendMessage({ type: "CHEESE_TAB_MUTE", action }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) return;
      window.postMessage(
        { source: "cheese-tab-mute-content", muted: resp.muted === true },
        location.origin,
      );
    });
  } catch {}
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "cheese-tab-mute") return;
  // type: "toggle" | "query"
  sendTabMute(data.type === "query" ? "query" : "toggle");
});

// ── 비디오 필터 설정 저장 브릿지 ─────────────────────────────────────────────
// 오디오 믹서 브릿지와 동일 패턴. MAIN world의 src/videoFilter.js가 보낸 저장/복원
// 요청을 여기(격리 월드)에서 chrome.storage로 처리한다. per-media 필터는
// videoFilter:<mediaId>, 커스텀 프리셋은 전역 videoFilter:presets에 저장한다.
const VIDEO_FILTER_STORAGE_PREFIX = "videoFilter:";
const VIDEO_FILTER_PRESETS_KEY = "videoFilter:presets";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "cheese-video-filter") return;
  const channelId = String(data.channelId || "").trim();
  if (!channelId) return;
  const key = `${VIDEO_FILTER_STORAGE_PREFIX}${channelId}`;

  if (data.type === "save") {
    try {
      const incoming = data.state || {};
      const { customPresets, ...perMedia } = incoming;
      const toSet = { [key]: perMedia };
      if (Array.isArray(customPresets)) {
        toSet[VIDEO_FILTER_PRESETS_KEY] = customPresets;
      }
      chrome.storage.local.set(toSet);
    } catch {}
  } else if (data.type === "load") {
    try {
      chrome.storage.local.get([key, VIDEO_FILTER_PRESETS_KEY], (result) => {
        const saved = result?.[key] || null;
        const presets = result?.[VIDEO_FILTER_PRESETS_KEY] || [];
        const merged = saved
          ? { ...saved, customPresets: presets }
          : { customPresets: presets };
        window.postMessage(
          {
            source: "cheese-video-filter-content",
            type: "loaded",
            channelId,
            state: merged,
          },
          location.origin,
        );
      });
    } catch {}
  }
});
