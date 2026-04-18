import { createLocalMode } from "./modes/local-mode.js";
import { createAssistMode } from "./modes/assist-mode.js";

const TREE_URL = "./data/wordle_strategy_tree.json";
const CANDIDATE_URLS = [
  "./data/candidates.csv",
  "./data/candidates(1).csv",
  "./data/워들후보_명사_5키_자판확장조합(2).csv",
  "./data/워들후보_명사_5키_자판확장조합.csv"
];

const MAX_ROWS = 5;

const KEYBOARD_ROWS = [
  ["ㅂ", "ㅈ", "ㄷ", "ㄱ", "ㅅ", "ㅛ", "ㅕ", "ㅑ", "⌫"],
  ["ㅁ", "ㄴ", "ㅇ", "ㄹ", "ㅎ", "ㅗ", "ㅓ", "ㅏ", "ㅣ"],
  ["ㅋ", "ㅌ", "ㅊ", "ㅍ", "ㅠ", "ㅜ", "ㅡ", "ENTER"]
];

const PHYSICAL_KEY_MAP = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ",
  y: "ㅛ", u: "ㅕ", i: "ㅑ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ",
  h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ",
  b: "ㅠ", n: "ㅜ", m: "ㅡ"
};

const COLOR_RANK = {
  absent: 1,
  misplaced: 2,
  correct: 3
};

const STATUS_TO_BYG = {
  absent: "B",
  misplaced: "Y",
  correct: "G"
};

const state = {
  tree: null,
  answers: [],
  vocabulary: new Map(),

  secret: null,
  mode: "manual", // "manual" | "auto"

  rowIndex: 0,
  currentInput: [],
  guesses: [],
  keyColors: {},

  strategyNode: null,
  strategyAlive: false,

  pendingJudge: null,

  history: [],
  gameOver: false,

  message: "",
  messageType: ""
};

const dom = {
  root: null,
  appShell: null,
  topbarRight: null,
  playPanel: null,
  sidePanel: null,

  message: null,
  statusRow: null,
  board: null,
  keyboard: null,
  recommendation: null,

  newGameBtn: null,
  modeAutoBtn: null,
  modeManualBtn: null,
  backspaceBtn: null,
  submitBtn: null,
  judgeBtn: null
};

let localMode = null;
let assistMode = null;

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function addWord(map, word, key) {
  if (!key || typeof key !== "string" || key.length !== 5) return;
  if (!map.has(key)) {
    map.set(key, {
      key,
      word: word && String(word).trim() ? String(word).trim() : key
    });
  }
}

function collectAnswers(node, map = new Map()) {
  if (!node) return map;

  if (node.type === "leaf") {
    addWord(map, node.word, node.key);
    return map;
  }

  const branches = Array.isArray(node.branches) ? node.branches : [];
  for (const branch of branches) {
    if (branch.outcome === "solved_now" && branch.solution) {
      addWord(map, branch.solution.word, branch.solution.key);
    }
    if (branch.outcome === "continue" && branch.child) {
      collectAnswers(branch.child, map);
    }
  }

  return map;
}

function collectVocabulary(node, map = new Map()) {
  if (!node) return map;

  if (node.type === "leaf") {
    addWord(map, node.word, node.key);
    return map;
  }

  addWord(map, node.guessWord, node.guessKey);

  const branches = Array.isArray(node.branches) ? node.branches : [];
  for (const branch of branches) {
    if (branch.outcome === "solved_now" && branch.solution) {
      addWord(map, branch.solution.word, branch.solution.key);
    }
    if (branch.outcome === "continue" && branch.child) {
      collectVocabulary(branch.child, map);
    }
  }

  return map;
}

function buildFallbackDictionary() {
  const fallback = [
    { word: "사람", key: "ㅅㅏㄹㅏㅁ" },
    { word: "학교", key: "ㅎㅏㄱㄱㅛ" },
    { word: "그때", key: "ㄱㅡㄷㄷㅐ" },
    { word: "필요", key: "ㅍㅣㄹㅇㅛ" },
    { word: "가위", key: "ㄱㅏㅇㅜㅣ" },
    { word: "가방", key: "ㄱㅏㅂㅏㅇ" },
    { word: "바람", key: "ㅂㅏㄹㅏㅁ" },
    { word: "마음", key: "ㅁㅏㅇㅡㅁ" }
  ];

  const map = new Map();
  for (const item of fallback) {
    addWord(map, item.word, item.key);
  }
  return map;
}

function setMessage(text, type = "") {
  state.message = text || "";
  state.messageType = type || "";
}

function mergeKeyColors(keyColors, letters, statuses) {
  const next = { ...keyColors };

  for (let i = 0; i < letters.length; i++) {
    const ch = letters[i];
    const st = statuses[i];
    if (!ch) continue;

    const prev = next[ch];
    if (!prev || COLOR_RANK[st] > COLOR_RANK[prev]) {
      next[ch] = st;
    }
  }

  return next;
}

function getPatternInfo(guessKey, answerKey) {
  const g = guessKey.split("");
  const a = answerKey.split("");
  const marks = [0, 0, 0, 0, 0];
  const remain = Object.create(null);

  for (let i = 0; i < 5; i++) {
    if (g[i] === a[i]) {
      marks[i] = 2;
    } else {
      remain[a[i]] = (remain[a[i]] || 0) + 1;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (marks[i] !== 0) continue;
    const ch = g[i];
    if ((remain[ch] || 0) > 0) {
      marks[i] = 1;
      remain[ch] -= 1;
    }
  }

  const statuses = marks.map(v => (v === 2 ? "correct" : v === 1 ? "misplaced" : "absent"));
  const byg = statuses.map(s => STATUS_TO_BYG[s]).join("");
  const squares = statuses.map(s => {
    if (s === "correct") return "🟩";
    if (s === "misplaced") return "🟨";
    return "⬛";
  }).join("");
  const code = marks[0] + 3 * marks[1] + 9 * marks[2] + 27 * marks[3] + 81 * marks[4];

  return { statuses, byg, squares, code };
}

function statusesToBYG(statuses) {
  return statuses.map(s => STATUS_TO_BYG[s] || "B").join("");
}

function statusesToSquares(statuses) {
  return statuses.map(s => {
    if (s === "correct") return "🟩";
    if (s === "misplaced") return "🟨";
    return "⬛";
  }).join("");
}

function cycleStatus(status) {
  if (status === "absent") return "misplaced";
  if (status === "misplaced") return "correct";
  return "absent";
}

function ensureBaseShell() {
  dom.root = document.getElementById("root");
  if (!dom.root) {
    throw new Error("#root가 없음");
  }

  let appShell = qs(".app-shell", dom.root);
  if (!appShell) {
    dom.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <div class="topbar-left"></div>
            <div class="topbar-title">단어맞추기</div>
            <div class="topbar-right"></div>
          </div>
        </header>

        <main class="layout">
          <section class="play-panel"></section>
          <aside class="side-panel"></aside>
        </main>
      </div>
    `;
    appShell = qs(".app-shell", dom.root);
  }

  dom.appShell = appShell;
  dom.topbarRight = qs(".topbar-right", dom.root);
  dom.playPanel = qs(".play-panel", dom.root);
  dom.sidePanel = qs(".side-panel", dom.root);

  if (!dom.topbarRight || !dom.playPanel || !dom.sidePanel) {
    throw new Error("기본 셸 구조가 부족함");
  }
}

function buildStaticShellContent() {
  dom.topbarRight.innerHTML = `
    <button type="button" class="ghost-btn" id="newGameBtn">새 게임</button>
  `;

  dom.playPanel.innerHTML = `
    <div id="message" class="message"></div>
    <div id="statusRow" class="status-row"></div>

    <div class="controls" style="margin-top: 4px;">
      <button type="button" id="modeAutoBtn" class="secondary-btn">자동 판정</button>
      <button type="button" id="modeManualBtn" class="primary-btn">수동 판정</button>
    </div>

    <div id="board" class="board"></div>

    <div class="controls">
      <button type="button" class="secondary-btn" id="backspaceBtn">지우기</button>
      <button type="button" class="primary-btn" id="submitBtn">입력 제출</button>
      <button type="button" class="primary-btn" id="judgeBtn" style="display:none;">판정 적용</button>
    </div>

    <div id="keyboard" class="keyboard"></div>
  `;

  dom.sidePanel.innerHTML = `
    <h2 class="section-title">전략 추천</h2>
    <div id="recommendation"></div>
  `;

  dom.message = document.getElementById("message");
  dom.statusRow = document.getElementById("statusRow");
  dom.board = document.getElementById("board");
  dom.keyboard = document.getElementById("keyboard");
  dom.recommendation = document.getElementById("recommendation");

  dom.newGameBtn = document.getElementById("newGameBtn");
  dom.modeAutoBtn = document.getElementById("modeAutoBtn");
  dom.modeManualBtn = document.getElementById("modeManualBtn");
  dom.backspaceBtn = document.getElementById("backspaceBtn");
  dom.submitBtn = document.getElementById("submitBtn");
  dom.judgeBtn = document.getElementById("judgeBtn");
}

function bindEvents() {
  dom.newGameBtn.addEventListener("click", resetGame);
  dom.modeAutoBtn.addEventListener("click", () => switchMode("auto"));
  dom.modeManualBtn.addEventListener("click", () => switchMode("manual"));
  dom.backspaceBtn.addEventListener("click", () => onKeyPress("⌫"));
  dom.submitBtn.addEventListener("click", submitGuess);
  dom.judgeBtn.addEventListener("click", confirmManualJudge);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      if (state.pendingJudge) return;
      onKeyPress("⌫");
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (state.pendingJudge) {
        confirmManualJudge();
      } else {
        onKeyPress("ENTER");
      }
      return;
    }

    const mapped = PHYSICAL_KEY_MAP[event.key.toLowerCase()];
    if (mapped) {
      event.preventDefault();
      onKeyPress(mapped);
    }
  });
}

function applyStrategyTransition(guessKey, guessWord, patternBYG, patternSquares) {
  let followed = false;

  if (state.strategyAlive && state.strategyNode) {
    const currentRec = getCurrentRecommendation(state.strategyNode);

    if (currentRec && guessKey === currentRec.key && currentRec.kind === "node") {
      const branches = Array.isArray(state.strategyNode.branches)
        ? state.strategyNode.branches
        : [];

      const branch = branches.find(b => b.patternBYG === patternBYG);

      if (branch) {
        followed = true;

        if (branch.outcome === "continue" && branch.child) {
          state.strategyNode = branch.child;
        } else {
          state.strategyNode = null;
        }
      } else {
        state.strategyAlive = false;
      }
    } else {
      state.strategyAlive = false;
    }
  } else {
    state.strategyAlive = false;
  }

  state.history.push({
    guessKey,
    guessWord,
    patternBYG,
    patternSquares,
    followed
  });

  return followed;
}

function commitGuess(guessEntry, statuses) {
  const patternBYG = statusesToBYG(statuses);
  const patternSquares = statusesToSquares(statuses);

  state.guesses.push({
    key: guessEntry.key,
    word: guessEntry.word,
    letters: guessEntry.key.split(""),
    statuses: [...statuses],
    byg: patternBYG,
    squares: patternSquares
  });

  state.keyColors = mergeKeyColors(
    state.keyColors,
    guessEntry.key.split(""),
    statuses
  );

  const followed = applyStrategyTransition(
    guessEntry.key,
    guessEntry.word,
    patternBYG,
    patternSquares
  );

  return { patternBYG, patternSquares, followed };
}

function resetGame() {
  state.strategyNode = state.tree || null;
  state.strategyAlive = !!state.tree;

  if (state.mode === "auto") {
    localMode.reset();
  } else {
    assistMode.reset();
  }

  render();
}

function switchMode(mode) {
  if (mode !== "auto" && mode !== "manual") return;
  state.mode = mode;
  resetGame();
}

function onKeyPress(value) {
  if (state.gameOver) return;
  if (state.pendingJudge) return;

  if (value === "⌫") {
    if (state.currentInput.length > 0) {
      state.currentInput.pop();
      setMessage("");
      render();
    }
    return;
  }

  if (value === "ENTER") {
    submitGuess();
    return;
  }

  const allowed = KEYBOARD_ROWS.flat().includes(value);
  if (!allowed) return;
  if (state.currentInput.length >= 5) return;

  state.currentInput.push(value);
  setMessage("");
  render();
}

function submitGuess() {
  if (state.mode === "auto") {
    localMode.submit();
  } else {
    assistMode.submit();
  }
}

function cyclePendingTile(index) {
  if (!state.pendingJudge) return;
  state.pendingJudge.statuses[index] = cycleStatus(state.pendingJudge.statuses[index]);
  render();
}

function confirmManualJudge() {
  if (state.mode !== "manual") return;
  assistMode.confirmJudge();
}

function getCurrentRecommendation(node) {
  if (!node) return null;

  if (node.type === "leaf") {
    return {
      kind: "leaf",
      word: node.word || node.key || "",
      key: node.key || "",
      remaining: Number(node.remaining ?? 1),
      depth: Number(node.depth ?? 0)
    };
  }

  return {
    kind: "node",
    word: node.guessWord || node.guessKey || "",
    key: node.guessKey || "",
    remaining: Number(node.remaining ?? 0),
    depth: Number(node.depth ?? 0)
  };
}

function renderBoard() {
  dom.board.innerHTML = "";

  for (let row = 0; row < MAX_ROWS; row++) {
    const rowEl = document.createElement("div");
    rowEl.className = "board-row";

    const committed = state.guesses[row];
    const isPendingRow = !!state.pendingJudge && row === state.rowIndex;
    const active = !state.pendingJudge && row === state.rowIndex && !state.gameOver;

    for (let col = 0; col < 5; col++) {
      const tile = document.createElement("div");
      tile.className = "tile";

      let letter = "";
      let status = "";

      if (committed) {
        letter = committed.letters[col] || "";
        status = committed.statuses[col] || "";
      } else if (isPendingRow) {
        letter = state.pendingJudge.letters[col] || "";
        status = state.pendingJudge.statuses[col] || "absent";
        tile.style.cursor = "pointer";
        tile.addEventListener("click", () => cyclePendingTile(col));
      } else if (active) {
        letter = state.currentInput[col] || "";
        if (letter) tile.classList.add("active");
      }

      if (status) tile.classList.add(status);
      tile.textContent = letter;

      rowEl.appendChild(tile);
    }

    dom.board.appendChild(rowEl);
  }
}

function renderKeyboard() {
  dom.keyboard.innerHTML = "";

  for (const row of KEYBOARD_ROWS) {
    const rowEl = document.createElement("div");
    rowEl.className = "keyboard-row";

    for (const keyLabel of row) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "key";

      if (keyLabel === "ENTER" || keyLabel === "⌫") {
        btn.classList.add("wide");
      }

      const color = state.keyColors[keyLabel];
      if (color) btn.classList.add(color);

      btn.textContent = keyLabel;
      btn.disabled = !!state.pendingJudge || state.gameOver;
      btn.addEventListener("click", () => onKeyPress(keyLabel));

      rowEl.appendChild(btn);
    }

    dom.keyboard.appendChild(rowEl);
  }
}

function renderMessage() {
  dom.message.className = "message";
  if (state.messageType) {
    dom.message.classList.add(state.messageType);
  }
  dom.message.textContent = state.message || "";
}

function renderStatusRow() {
  const rec = state.strategyAlive ? getCurrentRecommendation(state.strategyNode) : null;
  const currentRec = rec ? `${rec.word} (${rec.key})` : "없음";

  const jsonState = state.tree ? "있음" : "없음";
  const dictSize = state.answers.length || state.vocabulary.size;

  dom.statusRow.innerHTML = `
    <div class="chip">모드 ${state.mode === "auto" ? "자동" : "수동"}</div>
    <div class="chip">시도 ${state.guesses.length} / ${MAX_ROWS}</div>
    <div class="chip">후보 ${dictSize}개</div>
    <div class="chip">전략 JSON ${jsonState}</div>
    <div class="chip">추천 ${escapeHtml(currentRec)}</div>
  `;
}

function renderRecommendation() {
  const rec = state.strategyAlive ? getCurrentRecommendation(state.strategyNode) : null;
  let mainHtml = "";

  if (!state.tree) {
    mainHtml = `
      <div class="recommend-main">
        <div class="recommend-word">전략 트리 없음</div>
        <div class="recommend-state"><code>app/data/wordle_strategy_tree.json</code>을 넣으면 추천 연결 가능.</div>
      </div>
    `;
  } else if (state.gameOver) {
    mainHtml = `
      <div class="recommend-main">
        <div class="recommend-word">게임 종료</div>
        <div class="recommend-state">
          ${state.mode === "auto" && state.secret
            ? `정답: <strong>${escapeHtml(state.secret.word)}</strong>`
            : "수동 판정 종료"}
        </div>
        ${state.mode === "auto" && state.secret
          ? `<div class="recommend-key">${escapeHtml(state.secret.key)}</div>`
          : ""}
      </div>
    `;
  } else if (rec) {
    mainHtml = `
      <div class="recommend-main">
        <div class="recommend-word">${escapeHtml(rec.word || rec.key)}</div>
        <div class="recommend-key">${escapeHtml(rec.key)}</div>
        <div class="recommend-state">
          ${rec.kind === "leaf" ? "강제 다음 답안 후보" : "현재 전략 트리 기준 추천 단어"}
        </div>
        <div class="recommend-state">남은 후보: ${Number(rec.remaining || 0)}개 · 보장 깊이: ${Number(rec.depth || 0)}</div>
      </div>
    `;
  } else {
    mainHtml = `
      <div class="recommend-main">
        <div class="recommend-word">추천 경로 이탈</div>
        <div class="recommend-state">추천 단어와 다른 단어를 쳤거나, 입력한 색 패턴이 전략 트리와 맞지 않음.</div>
      </div>
    `;
  }

  let judgeHtml = "";
  if (state.pendingJudge) {
    judgeHtml = `
      <div class="panel-block">
        <h3 class="section-title" style="margin-top:0;">수동 판정</h3>
        <div class="recommend-state"><strong>${escapeHtml(state.pendingJudge.guessWord)}</strong> (${escapeHtml(state.pendingJudge.guessKey)})</div>
        <div class="recommend-state">보드의 현재 줄 5칸을 눌러서 회색 → 노랑 → 초록 순서로 바꾸면 됨.</div>
        <div class="recommend-state">현재 패턴: <strong>${escapeHtml(statusesToBYG(state.pendingJudge.statuses))}</strong> ${escapeHtml(statusesToSquares(state.pendingJudge.statuses))}</div>
      </div>
    `;
  }

  const historyHtml = state.history.length
    ? state.history.map(item => `
        <div class="history-item">
          <div class="history-top">
            <div class="history-word">${escapeHtml(item.guessWord)} <span class="history-pattern">${escapeHtml(item.guessKey)}</span></div>
            <span class="badge ${item.followed ? "followed" : "broken"}">${item.followed ? "추천 따름" : "이탈"}</span>
          </div>
          <div class="history-pattern">${escapeHtml(item.patternSquares)} ${escapeHtml(item.patternBYG)}</div>
        </div>
      `).join("")
    : `<div class="subtle">아직 입력한 시도가 없음.</div>`;

  dom.recommendation.innerHTML = `
    <div class="panel-block">
      ${mainHtml}
    </div>

    ${judgeHtml}

    <div class="panel-block">
      <h3 class="section-title" style="margin-top:0;">진행 기록</h3>
      <div class="history-list">${historyHtml}</div>
    </div>

    <div class="footer-note">
      수동 모드에서는 실제 게임에서 나온 색을 직접 맞춰 넣으면 그 기준으로 다음 추천을 따라감.
    </div>
  `;
}

function renderControls() {
  if (dom.judgeBtn) {
    dom.judgeBtn.style.display = state.pendingJudge ? "inline-flex" : "none";
    dom.judgeBtn.disabled = !state.pendingJudge || state.gameOver;
  }

  if (dom.submitBtn) {
    dom.submitBtn.disabled = !!state.pendingJudge || state.gameOver;
  }

  if (dom.backspaceBtn) {
    dom.backspaceBtn.disabled = !!state.pendingJudge || state.gameOver;
  }

  if (dom.modeAutoBtn) {
    dom.modeAutoBtn.className = state.mode === "auto" ? "primary-btn" : "secondary-btn";
  }

  if (dom.modeManualBtn) {
    dom.modeManualBtn.className = state.mode === "manual" ? "primary-btn" : "secondary-btn";
  }
}

function render() {
  renderMessage();
  renderStatusRow();
  renderBoard();
  renderKeyboard();
  renderRecommendation();
  renderControls();
}

function readInlineTree() {
  const el = document.getElementById("strategy-tree-inline");
  if (!el) return null;

  const text = (el.textContent || "").trim();
  if (!text) return null;

  return JSON.parse(text);
}

async function loadTreeSafely() {
  try {
    const inlineTree = readInlineTree();
    if (inlineTree) return inlineTree;
  } catch (error) {
    console.error("inline strategy tree parse 실패:", error);
  }

  try {
    const response = await fetch(TREE_URL, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(line => line.trim().length > 0);

  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]).map(v => v.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = {};

    for (let j = 0; j < header.length; j++) {
      row[header[j]] = (cols[j] ?? "").trim();
    }

    rows.push(row);
  }

  return rows;
}

function pickField(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && String(row[name]).trim()) {
      return String(row[name]).trim();
    }
  }
  return "";
}

async function loadCandidatesCsv() {
  let lastError = null;

  for (const url of CANDIDATE_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        lastError = new Error(`${url} 로드 실패: ${res.status}`);
        continue;
      }

      const text = await res.text();
      const rows = parseCsv(text);
      const map = new Map();

      for (const row of rows) {
        const word = pickField(row, ["단어", "word"]);
        const key = pickField(row, ["키열", "key"]);

        if (!word) continue;
        if (!key || key.length !== 5) continue;

        addWord(map, word, key);
      }

      if (map.size > 0) {
        return map;
      }

      lastError = new Error(`${url} 에서 유효한 후보를 못 찾음`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("후보 CSV 로드 실패");
}

async function init() {
  ensureBaseShell();
  buildStaticShellContent();
  bindEvents();

  let csvLoaded = false;

  try {
    state.vocabulary = await loadCandidatesCsv();
    state.answers = Array.from(state.vocabulary.values());
    csvLoaded = true;
  } catch (error) {
    console.error(error);
    state.vocabulary = buildFallbackDictionary();
    state.answers = Array.from(state.vocabulary.values());
    setMessage("후보 CSV를 못 읽어서 fallback 후보어로 실행 중", "error");
  }

  state.tree = await loadTreeSafely();

  if (state.tree) {
    const answersMap = collectAnswers(state.tree);
    const vocabularyMap = collectVocabulary(state.tree);

    if (answersMap.size > 0) {
      state.answers = Array.from(answersMap.values());
    }

    if (vocabularyMap.size > 0) {
      for (const [key, value] of vocabularyMap.entries()) {
        if (!state.vocabulary.has(key)) {
          state.vocabulary.set(key, value);
        }
      }
    }
  }

  localMode = createLocalMode({
    getState: () => state,
    setMessage,
    getPatternInfo,
    commitGuess,
    render
  });

  assistMode = createAssistMode({
    getState: () => state,
    setMessage,
    commitGuess,
    render
  });

  resetGame();

  if (csvLoaded && !state.tree) {
    setMessage("CSV 후보어 기준으로 실행 중. 전략 트리는 아직 없음", "");
    render();
  }
}

init();