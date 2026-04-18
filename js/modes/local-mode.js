export function createLocalMode(deps) {
  const {
    getState,
    setMessage,
    getPatternInfo,
    commitGuess,
    render
  } = deps;

  function reset() {
    const state = getState();
    const vocabList = Array.from(state.vocabulary.values());

    if (!vocabList.length) {
      throw new Error("후보 단어가 없음");
    }

    state.answers = state.answers.length ? state.answers : vocabList;
    if (!state.answers.length) {
      state.answers = vocabList;
    }

    state.secret = state.answers[Math.floor(Math.random() * state.answers.length)];
    state.rowIndex = 0;
    state.currentInput = [];
    state.guesses = [];
    state.keyColors = {};
    state.pendingJudge = null;
    state.history = [];
    state.gameOver = false;

    setMessage("자동 판정 모드 시작", "");
  }

function submit() {
  const state = getState();

  if (state.gameOver) return;
  if (state.pendingJudge) {
    setMessage("먼저 판정 적용을 해야 함", "error");
    render();
    return;
  }

  if (state.currentInput.length !== 5) {
    setMessage("정확히 5키를 입력해야 함", "error");
    render();
    return;
  }

  const guessKey = state.currentInput.join("");
  const vocabEntry = state.vocabulary.get(guessKey) ?? {
    key: guessKey,
    word: guessKey
  };

  const pattern = getPatternInfo(guessKey, state.secret.key);
  const result = commitGuess(vocabEntry, pattern.statuses);

  state.currentInput = [];

  if (result.patternBYG === "GGGGG") {
    state.gameOver = true;
    setMessage(`정답! ${state.secret.word} (${state.secret.key})`, "success");
  } else if (state.rowIndex >= 4) {
    state.gameOver = true;
    setMessage(`실패. 정답은 ${state.secret.word} (${state.secret.key})`, "error");
  } else {
    state.rowIndex += 1;
    setMessage(
      result.followed ? "전략 추천대로 진행 중" : "전략 경로에서 이탈함",
      result.followed ? "" : "error"
    );
  }

  render();
}

  return {
    name: "local",
    reset,
    submit
  };
}