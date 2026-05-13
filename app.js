const SOURCE_URL = "https://git333-20260310.github.io/english-memorizer/app.js";
const STORAGE_KEY = "english-trainer-state-v1";

const state = loadState();
let sections = [];
let activeSection = "001";
let currentList = [];
let currentIndex = 0;
let revealed = false;

const $ = (selector) => document.querySelector(selector);
const statusText = $("#statusText");
const sectionTabs = $("#sectionTabs");
const counterText = $("#counterText");
const stateText = $("#stateText");
const promptText = $("#promptText");
const answerBox = $("#answerBox");
const answerText = $("#answerText");
const showButton = $("#showButton");
const nextButton = $("#nextButton");
const randomButton = $("#randomButton");
const knownButton = $("#knownButton");
const perfectButton = $("#perfectButton");
const clearMarkButton = $("#clearMarkButton");
const resetButton = $("#resetButton");
const speechButton = $("#speechButton");

init();

async function init() {
  try {
    const raw = await loadRawData();
    sections = parseRaw(raw);
    activeSection = sections[0]?.id ?? "001";
    bindEvents();
    renderTabs();
    refreshList();
  } catch (error) {
    console.error(error);
    statusText.textContent = "教材データを読み込めませんでした";
    promptText.textContent = "english-memorizer の公開後にもう一度開いてください。";
  }
}

async function loadRawData() {
  const source = await fetch(`${SOURCE_URL}?v=${Date.now()}`).then((res) => res.text());
  const match = source.match(/const DATA="([^"]+)"/);
  if (match) return decodeGzipBase64(match[1]);

  const rawMatch = source.match(/const RAW = String\.raw`([\s\S]*?)`;/);
  if (rawMatch) return rawMatch[1];

  throw new Error("教材データが見つかりません");
}

async function decodeGzipBase64(data) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function parseRaw(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = [];
  let current = null;
  let pendingHeading = "";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\d{3}$/.test(line)) {
      current = { id: line, items: [] };
      result.push(current);
      pendingHeading = "";
      continue;
    }
    if (!current) continue;
    if (/^[①-⑩]/.test(line)) {
      pendingHeading = line;
      continue;
    }
    const next = lines[i + 1];
    if (!next || /^\d{3}$/.test(next) || /^[①-⑩]/.test(next)) continue;
    const isVocab = current.id === "005";
    current.items.push({
      id: `${current.id}-${current.items.length}`,
      section: current.id,
      heading: pendingHeading,
      english: isVocab ? next : line,
      japanese: isVocab ? line : next,
    });
    pendingHeading = "";
    i += 1;
  }

  return result;
}

function bindEvents() {
  document.querySelectorAll('input[name="mode"], input[name="filter"]').forEach((input) => {
    input.addEventListener("change", refreshList);
  });
  showButton.addEventListener("click", () => {
    revealed = true;
    renderCard();
  });
  nextButton.addEventListener("click", nextCard);
  randomButton.addEventListener("click", randomCard);
  knownButton.addEventListener("click", () => markCurrent("known"));
  perfectButton.addEventListener("click", () => markCurrent("perfect"));
  clearMarkButton.addEventListener("click", () => markCurrent("none"));
  resetButton.addEventListener("click", resetMarks);
  speechButton.addEventListener("click", selectCurrentCardText);
}

function renderTabs() {
  sectionTabs.innerHTML = "";
  for (const section of sections) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${section.id === activeSection ? " active" : ""}`;
    button.textContent = section.id;
    button.addEventListener("click", () => {
      activeSection = section.id;
      renderTabs();
      refreshList();
    });
    sectionTabs.append(button);
  }
}

function refreshList() {
  const filter = getRadioValue("filter");
  const section = sections.find((entry) => entry.id === activeSection);
  currentList = section.items.filter((item) => {
    const mark = state[item.id]?.mark ?? "none";
    if (filter === "unlearned") return mark === "none";
    if (filter === "review") return mark !== "perfect";
    return true;
  });
  currentIndex = 0;
  revealed = false;
  renderCard();
}

function renderCard() {
  if (currentList.length === 0) {
    statusText.textContent = `${activeSection} / 0件`;
    counterText.textContent = "0 / 0";
    stateText.textContent = "対象なし";
    promptText.textContent = "この条件のカードはありません。";
    answerBox.hidden = true;
    return;
  }

  const item = getCurrentItem();
  const mode = resolveMode();
  const mark = state[item.id]?.mark ?? "none";
  const prompt = mode === "ja-en" ? item.japanese : item.english;
  const answer = mode === "ja-en" ? item.english : item.japanese;

  statusText.textContent = `${activeSection} / ${sections.find((entry) => entry.id === activeSection).items.length}件`;
  counterText.textContent = `${currentIndex + 1} / ${currentList.length}`;
  stateText.textContent = markLabel(mark);
  promptText.textContent = prompt;
  promptText.lang = mode === "ja-en" ? "ja" : "en";
  answerText.textContent = answer;
  answerText.lang = mode === "ja-en" ? "en" : "ja";
  answerBox.hidden = !revealed;
  knownButton.classList.toggle("active", mark === "known");
  perfectButton.classList.toggle("active", mark === "perfect");
}

function resolveMode() {
  const mode = getRadioValue("mode");
  if (mode !== "random") return mode;
  return Math.random() > 0.5 ? "ja-en" : "en-ja";
}

function getCurrentItem() {
  return currentList[currentIndex];
}

function nextCard() {
  if (currentList.length === 0) return;
  currentIndex = (currentIndex + 1) % currentList.length;
  revealed = false;
  renderCard();
}

function randomCard() {
  if (currentList.length === 0) return;
  if (currentList.length === 1) {
    currentIndex = 0;
  } else {
    let next = currentIndex;
    while (next === currentIndex) next = Math.floor(Math.random() * currentList.length);
    currentIndex = next;
  }
  revealed = false;
  renderCard();
}

function markCurrent(mark) {
  if (currentList.length === 0) return;
  const item = getCurrentItem();
  state[item.id] = { mark };
  saveState();
  renderCard();
}

function resetMarks() {
  if (!confirm("このトレーナーのチェックをすべて消しますか？")) return;
  for (const key of Object.keys(state)) delete state[key];
  saveState();
  refreshList();
}

function selectCurrentCardText() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(document.querySelector(".trainer"));
  selection.removeAllRanges();
  selection.addRange(range);
}

function getRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function markLabel(mark) {
  if (mark === "known") return "覚えた";
  if (mark === "perfect") return "完璧";
  return "未チェック";
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
