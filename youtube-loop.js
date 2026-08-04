const STORAGE_KEY = "loop45-saved-segments-v1";
const SAMPLE_VIDEO = "https://www.youtube.com/watch?v=iBuTs1qg2lQ";

let player = null;
let playerReady = false;
let activeVideoId = "";
let monitorTimer = null;
let repeatCount = 0;
let seekingForLoop = false;

const $ = (selector) => document.querySelector(selector);
const elements = {
  url: $("#videoUrl"), load: $("#loadButton"), sample: $("#sampleButton"),
  start: $("#startTime"), end: $("#endTime"), setStart: $("#setStartButton"), setEnd: $("#setEndButton"),
  length: $("#segmentLength"), playSegment: $("#playSegmentButton"), toggle: $("#toggleButton"),
  back: $("#backButton"), forward: $("#forwardButton"), loop: $("#loopToggle"), speed: $("#speedSelect"),
  repeats: $("#repeatCount"), current: $("#currentTime"), duration: $("#durationTime"), progress: $("#progressBar"),
  title: $("#videoTitle"), status: $("#statusText"), statusDot: $("#statusDot"),
  save: $("#saveButton"), share: $("#shareButton"), savedList: $("#savedList"),
};

window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player("player", {
    width: "100%",
    height: "100%",
    playerVars: {
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      cc_load_policy: 1,
      cc_lang_pref: "en",
      origin: window.location.origin === "null" ? undefined : window.location.origin,
    },
    events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange, onError: onPlayerError },
  });
};

bindEvents();
renderSavedSegments();
restoreFromQuery();
updateSegmentSummary();

function bindEvents() {
  elements.load.addEventListener("click", loadFromInput);
  elements.url.addEventListener("keydown", (event) => { if (event.key === "Enter") loadFromInput(); });
  elements.sample.addEventListener("click", () => {
    elements.url.value = SAMPLE_VIDEO;
    elements.start.value = "0:00";
    elements.end.value = "0:45";
    loadFromInput();
  });
  elements.start.addEventListener("change", updateSegmentSummary);
  elements.end.addEventListener("change", updateSegmentSummary);
  elements.setStart.addEventListener("click", () => setTimeFromPlayer(elements.start));
  elements.setEnd.addEventListener("click", () => setTimeFromPlayer(elements.end));
  elements.playSegment.addEventListener("click", playSegment);
  elements.toggle.addEventListener("click", togglePlayback);
  elements.back.addEventListener("click", () => shiftPlayback(-5));
  elements.forward.addEventListener("click", () => shiftPlayback(5));
  elements.speed.addEventListener("change", () => { if (playerReady) player.setPlaybackRate(Number(elements.speed.value)); });
  elements.save.addEventListener("click", saveCurrentSegment);
  elements.share.addEventListener("click", copyShareUrl);
  window.addEventListener("keydown", handleKeyboardShortcuts);
}

function onPlayerReady() {
  playerReady = true;
  setStatus("プレーヤーの準備ができました", "ready");
  startMonitor();
  if (elements.url.value) loadFromInput();
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    elements.title.textContent = player.getVideoData().title || "YouTube video";
    setStatus("再生中", "ready");
  } else if (event.data === YT.PlayerState.PAUSED) {
    setStatus("一時停止中", "ready");
  } else if (event.data === YT.PlayerState.ENDED && elements.loop.checked) {
    loopToStart();
  }
}

function onPlayerError(event) {
  const messages = {
    2: "URLまたは動画IDを確認してください",
    5: "この動画はHTML5プレーヤーで再生できません",
    100: "動画が見つからないか、非公開です",
    101: "この動画は埋め込み再生を許可していません",
    150: "この動画は埋め込み再生を許可していません",
  };
  setStatus(messages[event.data] || "動画を再生できませんでした", "error");
}

function loadFromInput() {
  const videoId = extractVideoId(elements.url.value);
  if (!videoId) {
    setStatus("有効なYouTube URLを入力してください", "error");
    return;
  }
  if (!playerReady) {
    setStatus("プレーヤーを準備しています…");
    return;
  }
  const segment = getSegment();
  if (!segment) return;
  activeVideoId = videoId;
  repeatCount = 0;
  renderRepeatCount();
  player.loadVideoById({ videoId, startSeconds: segment.start });
  player.setPlaybackRate(Number(elements.speed.value));
  setStatus("動画を読み込んでいます…");
  updateQueryString();
}

function playSegment() {
  if (!ensurePlayer()) return;
  const segment = getSegment();
  if (!segment) return;
  if (!activeVideoId) {
    loadFromInput();
    return;
  }
  repeatCount = 0;
  renderRepeatCount();
  player.seekTo(segment.start, true);
  player.playVideo();
  setStatus("区間を再生中", "ready");
}

function togglePlayback() {
  if (!ensurePlayer()) return;
  if (player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
  else player.playVideo();
}

function shiftPlayback(seconds) {
  if (!ensurePlayer()) return;
  const duration = player.getDuration() || Infinity;
  player.seekTo(Math.max(0, Math.min(duration, player.getCurrentTime() + seconds)), true);
}

function setTimeFromPlayer(input) {
  if (!ensurePlayer()) return;
  input.value = formatTime(player.getCurrentTime());
  updateSegmentSummary();
}

function startMonitor() {
  clearInterval(monitorTimer);
  monitorTimer = setInterval(() => {
    if (!playerReady || typeof player.getCurrentTime !== "function") return;
    const current = player.getCurrentTime() || 0;
    const duration = player.getDuration() || 0;
    elements.current.textContent = formatTime(current);
    elements.duration.textContent = formatTime(duration);
    elements.progress.style.width = duration ? `${Math.min(100, current / duration * 100)}%` : "0%";
    const segment = getSegment(false);
    if (!segment || !elements.loop.checked || player.getPlayerState() !== YT.PlayerState.PLAYING) return;
    if (current >= segment.end - 0.06 && !seekingForLoop) loopToStart();
  }, 100);
}

function loopToStart() {
  const segment = getSegment(false);
  if (!segment || seekingForLoop) return;
  seekingForLoop = true;
  repeatCount += 1;
  renderRepeatCount();
  player.seekTo(segment.start, true);
  player.playVideo();
  window.setTimeout(() => { seekingForLoop = false; }, 260);
}

function getSegment(showError = true) {
  const start = parseTime(elements.start.value);
  const end = parseTime(elements.end.value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    if (showError) setStatus("終了時間は開始時間より後にしてください", "error");
    return null;
  }
  return { start, end };
}

function updateSegmentSummary() {
  const segment = getSegment(false);
  elements.length.textContent = segment ? describeDuration(segment.end - segment.start) : "—";
  if (segment) updateQueryString();
}

function extractVideoId(value) {
  const raw = value.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (url.hostname.endsWith("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex((part) => ["shorts", "embed", "live"].includes(part));
      if (marker >= 0) return parts[marker + 1] || "";
    }
  } catch (_) {}
  return "";
}

function parseTime(value) {
  const text = String(value).trim();
  if (!text) return NaN;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return NaN;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

function formatTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function describeDuration(seconds) {
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}秒`;
  return `${Math.floor(rounded / 60)}分${rounded % 60 ? `${rounded % 60}秒` : ""}`;
}

function ensurePlayer() {
  if (!playerReady) {
    setStatus("プレーヤーを準備しています…", "error");
    return false;
  }
  return true;
}

function setStatus(message, state = "") {
  elements.status.textContent = message;
  elements.statusDot.className = `status-dot${state ? ` ${state}` : ""}`;
}

function renderRepeatCount() { elements.repeats.textContent = String(repeatCount); }

function saveCurrentSegment() {
  const videoId = activeVideoId || extractVideoId(elements.url.value);
  const segment = getSegment();
  if (!videoId || !segment) {
    setStatus("動画と区間を決めてから保存してください", "error");
    return;
  }
  const saved = loadSavedSegments();
  const entry = {
    id: `${videoId}-${segment.start}-${segment.end}`,
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: playerReady && player.getVideoData().title ? player.getVideoData().title : "YouTube video",
    start: segment.start,
    end: segment.end,
    savedAt: Date.now(),
  };
  const next = [entry, ...saved.filter((item) => item.id !== entry.id)].slice(0, 12);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  renderSavedSegments();
  setStatus("この区間を保存しました", "ready");
}

function loadSavedSegments() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch (_) { return []; }
}

function renderSavedSegments() {
  const saved = loadSavedSegments();
  if (!saved.length) {
    elements.savedList.innerHTML = '<p class="empty-state">保存した区間はまだありません。</p>';
    return;
  }
  elements.savedList.innerHTML = "";
  for (const item of saved) {
    const row = document.createElement("div");
    row.className = "saved-item";
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "saved-load";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const time = document.createElement("span");
    time.textContent = `${formatTime(item.start)} → ${formatTime(item.end)}`;
    loadButton.append(title, time);
    loadButton.addEventListener("click", () => {
      elements.url.value = item.url;
      elements.start.value = formatTime(item.start);
      elements.end.value = formatTime(item.end);
      loadFromInput();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.filter((entry) => entry.id !== item.id)));
      renderSavedSegments();
    });
    row.append(loadButton, deleteButton);
    elements.savedList.append(row);
  }
}

async function copyShareUrl() {
  const videoId = activeVideoId || extractVideoId(elements.url.value);
  const segment = getSegment();
  if (!videoId || !segment) {
    setStatus("動画と区間を決めてから共有してください", "error");
    return;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("v", videoId);
  url.searchParams.set("start", String(segment.start));
  url.searchParams.set("end", String(segment.end));
  try {
    await navigator.clipboard.writeText(url.toString());
    setStatus("共有URLをコピーしました", "ready");
  } catch (_) {
    window.prompt("このURLをコピーしてください", url.toString());
  }
}

function updateQueryString() {
  const videoId = activeVideoId || extractVideoId(elements.url.value);
  const segment = getSegment(false);
  if (!videoId || !segment || !history.replaceState) return;
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("v", videoId);
  url.searchParams.set("start", String(segment.start));
  url.searchParams.set("end", String(segment.end));
  history.replaceState(null, "", url);
}

function restoreFromQuery() {
  const query = new URLSearchParams(window.location.search);
  const videoId = query.get("v");
  if (!videoId) return;
  elements.url.value = `https://www.youtube.com/watch?v=${videoId}`;
  if (query.has("start")) elements.start.value = formatTime(Number(query.get("start")));
  if (query.has("end")) elements.end.value = formatTime(Number(query.get("end")));
  activeVideoId = videoId;
}

function handleKeyboardShortcuts(event) {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.key.toLowerCase() === "s") {
    setTimeFromPlayer(elements.start);
  } else if (event.key.toLowerCase() === "e") {
    setTimeFromPlayer(elements.end);
  } else if (event.key.toLowerCase() === "l") {
    elements.loop.checked = !elements.loop.checked;
  }
}
