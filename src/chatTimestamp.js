// 채팅 강화 — 시간 표시 + 가려진 채팅 복원 (MAIN world)
// 배지 모아 챗(badge-moa-chat) 로직 이식. (1) 각 채팅 앞에 회색 HH:MM 시간 표시,
// (2) 클린봇/블라인드로 가려진 메시지를 원문으로 복원. 둘 다 치지직 React 내부
// 데이터(chatMessage)에서 읽으므로 MAIN world가 필요하다(__reactProps$/__reactFiber$는
// 격리 월드에서 안 보임). 마커는 우리 고유 클래스 — moa의 chzzk-badge-moa-* 와 분리.
// 설정은 content.js(격리)가 cheese-feature-flags postMessage로 전달한다.
(() => {
  "use strict";

  let showChatTimestamp = false;
  let restoreBlindedChat = false;
  let chatRowObserver = null;
  let retryTimer = 0;

  // 가려진 채팅 복원용 상태.
  const BLIND_PLACEHOLDER_TEXTS = [
    "메시지가 블라인드 처리되었습니다.",
    "클린봇이 부적절한 표현을 감지했습니다.",
  ];
  let blindRestoreWriting = false; // 우리가 DOM 쓸 때 observer 재반응 무한루프 방지
  // 행 → { placeholder, nickname }: OFF 시 원래 가림 문구로 되돌리기 위함.
  const restoredRowInfo = new WeakMap();

  // ── React 내부 접근 ──────────────────────────────────────────────────────
  function getReactProps(node) {
    if (node == null) return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
    return key ? node[key] : null;
  }

  function getReactFiber(node) {
    if (node == null) return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    return key ? node[key] : null;
  }

  // 채팅 행 노드에서 React props의 chatMessage 객체를 얻는다.
  function getChatMessage(row) {
    const props = getReactProps(row);
    const direct =
      props && props.children && props.children.props
        ? props.children.props.chatMessage
        : null;
    if (direct && typeof direct === "object") return direct;
    // 폴백: fiber 서브트리에서 chatMessage를 가진 props 탐색
    let fiber = getReactFiber(row);
    let guard = 0;
    while (fiber != null && guard < 60) {
      const mp = fiber.memoizedProps;
      if (mp) {
        if (mp.chatMessage && typeof mp.chatMessage === "object") {
          return mp.chatMessage;
        }
        if (
          mp.children &&
          mp.children.props &&
          mp.children.props.chatMessage &&
          typeof mp.children.props.chatMessage === "object"
        ) {
          return mp.children.props.chatMessage;
        }
      }
      fiber = fiber.child;
      guard += 1;
    }
    return null;
  }

  // 실제 전송 시각(epoch ms)을 찾는다. playerMessageTime(영상 경과)은 제외.
  function readChatEpochMs(chatMessage) {
    if (!chatMessage || typeof chatMessage !== "object") return null;
    const candidates = [
      chatMessage.time,
      chatMessage.messageTime,
      chatMessage.createTime,
      chatMessage.ctime,
      chatMessage.regTime,
      chatMessage.msgTime,
    ];
    for (const value of candidates) {
      const n = Number(value);
      // 2001년 이후(ms)만 타당한 실제 시각으로 인정
      if (Number.isFinite(n) && n > 1e12) return n;
    }
    return null;
  }

  function parseJsonSafe(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  // chatMessage에서 원문 텍스트와 이모티콘 맵을 읽는다(객체/JSON 문자열 모두).
  function readChatOriginal(chatMessage) {
    if (!chatMessage || typeof chatMessage !== "object") return null;
    const msgTypeCode =
      chatMessage.msgTypeCode || chatMessage.messageTypeCode || 1;
    if (msgTypeCode === 30 || msgTypeCode === 11 || msgTypeCode === 12) {
      return null; // 시스템/구독 합성 메시지 제외
    }
    const text = String(chatMessage.content || chatMessage.msg || "");
    if (!text) return null;
    let extras = chatMessage.extras;
    if (typeof extras === "string") extras = parseJsonSafe(extras);
    const emojis =
      extras && typeof extras.emojis === "object" && extras.emojis
        ? extras.emojis
        : {};
    return { text, emojis };
  }

  // ── 시간 span 삽입/제거 ───────────────────────────────────────────────────
  // 닉네임 앞에 회색 HH:MM 시간 span을 삽입.
  function applyTimestamp(row, epochMs) {
    if (row.querySelector(":scope .cheese-chat-time")) return;
    const nicknameBtn =
      row.querySelector("button[class*='_nickname_']") ||
      row.querySelector("[class*='_nickname_']");
    if (!nicknameBtn || !nicknameBtn.parentNode) return;
    const d = new Date(epochMs);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const span = document.createElement("span");
    span.className = "cheese-chat-time";
    span.textContent = `${hh}:${mm}`;
    nicknameBtn.parentNode.insertBefore(span, nicknameBtn);
  }

  function removeAllTimestamps() {
    document
      .querySelectorAll(".cheese-chat-time")
      .forEach((el) => el.remove());
  }

  // badge-moa-chat이 시간 표시 기능을 켰으면 우리는 양보(중복 방지).
  // 신버전 moa는 <html>에 enabled 클래스를 붙여 채팅이 없어도 즉시 감지된다.
  // 구버전 호환: 삽입된 시간 span 마커도 폴백으로 본다.
  function moaShowingTime() {
    return (
      document.documentElement.classList.contains(
        "chzzk-badge-moa-chat-timestamp-enabled",
      ) || !!document.querySelector(".chzzk-badge-moa-chat-time")
    );
  }

  // ── 가려진 채팅 복원 ──────────────────────────────────────────────────────
  // badge-moa-chat이 복원 기능을 켰으면 양보. 신버전 moa는 <html>에 enabled
  // 클래스를 붙여 가려진 채팅이 올라오기 전에도 감지된다(구버전: 복원 마커 폴백).
  function moaRestoring() {
    return (
      document.documentElement.classList.contains(
        "chzzk-badge-moa-restore-blind-enabled",
      ) || !!document.querySelector(".chzzk-badge-moa-blind-restored-text")
    );
  }

  // 메시지 텍스트 span = _chatting_message_ 하위 _text_ 중 _nickname_ 버튼 밖의 것.
  function getRowMessageSpan(row) {
    const message = row.querySelector("[class*='_chatting_message_']") || row;
    const candidates = message.querySelectorAll("[class*='_text_']");
    for (const span of candidates) {
      if (!span.closest("[class*='_nickname_']")) return span;
    }
    return null;
  }

  function getRowNickname(row) {
    const node = row.querySelector(
      "[class*='_nickname_'] [class*='_text_']",
    );
    return node ? String(node.textContent || "").trim() : "";
  }

  function isHiddenRow(row) {
    return (
      row.matches("[class*='_is_hidden_']") ||
      !!row.querySelector("[class*='_is_hidden_']")
    );
  }

  function getBlindRestoreLabel(placeholder) {
    const text = String(placeholder || "");
    if (text.includes("클린봇")) return "(클린봇)";
    if (text.includes("블라인드")) return "(블라인드)";
    return "";
  }

  // {:emojiKey:} 토큰을 텍스트 노드 + <img>로 조립.
  function buildRestoredMessageFragment(text, emojiMap) {
    const fragment = document.createDocumentFragment();
    const messageText = String(text || "");
    if (!messageText) return fragment;
    const hasEmojis =
      emojiMap &&
      typeof emojiMap === "object" &&
      Object.keys(emojiMap).length > 0;
    if (!hasEmojis) {
      fragment.appendChild(document.createTextNode(messageText));
      return fragment;
    }
    const tokenPattern = /\{:([^:}]+):\}/g;
    let lastIndex = 0;
    let match = null;
    while ((match = tokenPattern.exec(messageText)) !== null) {
      const key = String(match[1] || "").trim();
      const url = emojiMap[key];
      if (match.index > lastIndex) {
        fragment.appendChild(
          document.createTextNode(messageText.slice(lastIndex, match.index)),
        );
      }
      if (typeof url === "string" && url) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.className = "cheese-blind-emoji";
        img.width = 24;
        img.height = 24;
        img.loading = "lazy";
        img.decoding = "async";
        img.draggable = false;
        fragment.appendChild(img);
      } else {
        fragment.appendChild(document.createTextNode(match[0]));
      }
      lastIndex = tokenPattern.lastIndex;
    }
    if (lastIndex < messageText.length) {
      fragment.appendChild(
        document.createTextNode(messageText.slice(lastIndex)),
      );
    }
    return fragment;
  }

  // 가려진 행을 원문(텍스트+이모티콘)으로 복원.
  function applyRestore(row, original) {
    const span = getRowMessageSpan(row);
    if (!(span instanceof HTMLElement)) return;
    if (!restoredRowInfo.has(row)) {
      restoredRowInfo.set(row, {
        placeholder: String(span.textContent || ""),
        nickname: getRowNickname(row),
      });
    }
    const info = restoredRowInfo.get(row);
    const label = getBlindRestoreLabel(info?.placeholder || span.textContent);
    const fragment = buildRestoredMessageFragment(
      original.text,
      original.emojis,
    );
    if (label) fragment.appendChild(document.createTextNode(` ${label}`));
    blindRestoreWriting = true;
    try {
      span.textContent = "";
      span.appendChild(fragment);
      span.classList.add("cheese-blind-restored-text");
    } finally {
      queueMicrotask(() => {
        blindRestoreWriting = false;
      });
    }
  }

  // OFF: 복원된 행을 원래 가림 문구로 되돌린다.
  function revertAllRestores() {
    document
      .querySelectorAll(".cheese-blind-restored-text")
      .forEach((span) => {
        const row = span.closest("[class*='_item_']");
        const info = row ? restoredRowInfo.get(row) : null;
        blindRestoreWriting = true;
        try {
          span.textContent = info ? info.placeholder : span.textContent;
          span.classList.remove("cheese-blind-restored-text");
        } finally {
          queueMicrotask(() => {
            blindRestoreWriting = false;
          });
        }
        if (row) restoredRowInfo.delete(row);
      });
  }

  // React 재렌더로 다시 가림 문구가 된 복원행을 재복원.
  function reapplyRestoreForTarget(target) {
    if (!restoreBlindedChat || blindRestoreWriting || moaRestoring()) return;
    if (!(target instanceof Element)) return;
    const row = target.closest("[class*='_item_']");
    if (!(row instanceof HTMLElement)) return;
    const info = restoredRowInfo.get(row);
    if (!info) return;
    if (getRowNickname(row) !== info.nickname) {
      restoredRowInfo.delete(row); // 노드 재활용 가드
      return;
    }
    const span = getRowMessageSpan(row);
    if (!(span instanceof HTMLElement)) return;
    const current = String(span.textContent || "").trim();
    if (BLIND_PLACEHOLDER_TEXTS.includes(current)) {
      const chatMessage = getChatMessage(row);
      const original = chatMessage ? readChatOriginal(chatMessage) : null;
      if (original) applyRestore(row, original);
    }
  }

  // 채팅 행 하나 처리: 시간 삽입 + 가림 복원.
  function processRow(row) {
    if (!(row instanceof HTMLElement)) return;
    if (!row.querySelector("[class*='_chatting_message_']")) return;
    const chatMessage = getChatMessage(row);
    if (!chatMessage) return;

    if (showChatTimestamp && !moaShowingTime()) {
      const epoch = readChatEpochMs(chatMessage);
      if (epoch) applyTimestamp(row, epoch);
    }

    if (restoreBlindedChat && !moaRestoring() && isHiddenRow(row)) {
      const span = getRowMessageSpan(row);
      if (span && !span.classList.contains("cheese-blind-restored-text")) {
        const original = readChatOriginal(chatMessage);
        if (original) applyRestore(row, original);
      }
    }
  }

  // ── 채팅 리스트 감시 ──────────────────────────────────────────────────────
  function findChatListContainers() {
    const containers = [];
    const live = document.querySelector(
      "aside#aside-chatting [class*='live_chatting_list_container'], aside#aside-chatting [role='log']",
    );
    if (live) containers.push(live);
    const vod = document.querySelector(
      "aside#vod-aside [class*='vod_chatting_list_container'], aside#vod-aside [role='log']",
    );
    if (vod) containers.push(vod);
    if (containers.length === 0) {
      const aside =
        document.querySelector("aside#aside-chatting") ||
        document.querySelector("aside#vod-aside");
      if (aside) containers.push(aside);
    }
    return containers;
  }

  function isChatRowNode(node) {
    if (!(node instanceof HTMLElement)) return false;
    return (
      node.matches(
        "[class*='live_chatting_list_item'], [class*='vod_chatting_item'], [class*='_item_']",
      ) && !!node.querySelector("[class*='_chatting_message_']")
    );
  }

  // 이미 떠 있는 행들을 한 번 훑어 시간 삽입.
  function sweepExistingRows() {
    document
      .querySelectorAll(
        "[class*='live_chatting_list_item'], [class*='vod_chatting_item'], [class*='_item_']",
      )
      .forEach((row) => {
        if (row.querySelector("[class*='_chatting_message_']")) processRow(row);
      });
  }

  function anyChatEnhanceOn() {
    return showChatTimestamp || restoreBlindedChat;
  }

  function ensureChatRowObserver() {
    if (!anyChatEnhanceOn()) return;
    const containers = findChatListContainers();
    if (containers.length === 0) {
      scheduleRetry();
      return;
    }
    clearRetry();
    if (chatRowObserver) chatRowObserver.disconnect();
    chatRowObserver = new MutationObserver((mutations) => {
      if (blindRestoreWriting || !anyChatEnhanceOn()) return;
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        // 기존 행이 React 재렌더로 다시 가려졌으면 재복원.
        if (mutation.target instanceof Element) {
          reapplyRestoreForTarget(mutation.target);
        }
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (isChatRowNode(node)) {
            processRow(node);
          } else {
            node
              .querySelectorAll(
                "[class*='live_chatting_list_item'], [class*='vod_chatting_item'], [class*='_item_']",
              )
              .forEach((row) => {
                if (row.querySelector("[class*='_chatting_message_']")) {
                  processRow(row);
                }
              });
          }
        });
      }
    });
    containers.forEach((c) =>
      chatRowObserver.observe(c, { childList: true, subtree: true }),
    );
    sweepExistingRows();
  }

  function scheduleRetry() {
    if (!anyChatEnhanceOn() || retryTimer) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      ensureChatRowObserver();
    }, 500);
  }

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = 0;
    }
  }

  function stopChatRowObserver() {
    if (chatRowObserver) {
      chatRowObserver.disconnect();
      chatRowObserver = null;
    }
    clearRetry();
  }

  // ── 설정 적용 ─────────────────────────────────────────────────────────────
  function setShowChatTimestamp(next) {
    next = next === true;
    if (next === showChatTimestamp) {
      if (next) ensureChatRowObserver(); // SPA 전환 등으로 컨테이너가 바뀌었을 수 있음
      return;
    }
    showChatTimestamp = next;
    if (next) {
      ensureChatRowObserver();
    } else {
      removeAllTimestamps();
      if (!anyChatEnhanceOn()) stopChatRowObserver();
    }
  }

  function setRestoreBlindedChat(next) {
    next = next === true;
    if (next === restoreBlindedChat) {
      if (next) ensureChatRowObserver();
      return;
    }
    restoreBlindedChat = next;
    if (next) {
      ensureChatRowObserver();
    } else {
      revertAllRestores();
      if (!anyChatEnhanceOn()) stopChatRowObserver();
    }
  }

  // content.js(격리)가 보내는 기능 플래그 수신.
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "cheese-feature-flags") return;
    const f = e.data.flags || {};
    // 체크=표시(true)면 각 기능 ON. (data-feature지만 '숨김'이 아니라 '켬' 의미)
    setShowChatTimestamp(f.chatShowTime === true);
    setRestoreBlindedChat(f.chatRestoreBlind === true);
  });
  // 로드 직후 현재 플래그 요청(초기 송신을 놓쳤을 수 있음).
  window.postMessage(
    { source: "cheese-feature-flags-request" },
    location.origin,
  );

  // moa의 enabled 클래스가 <html>에서 켜졌다/꺼졌다 하면 양보 상태를 재평가한다.
  // moa가 켜지면 우리가 적용한 시간/복원을 거두고, 꺼지면 다시 적용한다.
  let prevMoaTime = moaShowingTime();
  let prevMoaRestore = moaRestoring();
  const moaWatcher = new MutationObserver(() => {
    const nowTime = moaShowingTime();
    const nowRestore = moaRestoring();
    if (nowTime !== prevMoaTime) {
      prevMoaTime = nowTime;
      if (nowTime) removeAllTimestamps(); // moa가 시간 표시 시작 → 우리 것 제거(양보)
      else if (showChatTimestamp) ensureChatRowObserver(); // moa 꺼짐 → 우리가 다시
    }
    if (nowRestore !== prevMoaRestore) {
      prevMoaRestore = nowRestore;
      if (nowRestore) revertAllRestores(); // moa가 복원 시작 → 우리 복원 되돌림(양보)
      else if (restoreBlindedChat) ensureChatRowObserver(); // moa 꺼짐 → 우리가 다시
    }
  });
  moaWatcher.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // SPA 네비게이션(라이브↔다시보기↔채널)으로 채팅 컨테이너가 바뀌면 재부착.
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    removeAllTimestamps();
    if (anyChatEnhanceOn()) ensureChatRowObserver();
  }, 1000);
})();
