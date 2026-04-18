export function createAssistMode(deps) {
  const {
    getState,
    setMessage,
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

    state.secret = null;
    state.rowIndex = 0;
    state.currentInput = [];
    state.guesses = [];
    state.keyColors = {};
    state.pendingJudge = null;
    state.history = [];
    state.gameOver = false;

    setMessage("수동 판정 모드 시작", "");
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

  state.pendingJudge = {
    guessKey,
    guessWord: vocabEntry.word,
    letters: guessKey.split(""),
    statuses: ["absent", "absent", "absent", "absent", "absent"]
  };

  state.currentInput = [];
  setMessage("타일 5칸을 눌러서 색을 맞춘 뒤 ‘판정 적용’을 누르면 됨", "");
  render();
}

  function confirmJudge() {
    const state = getState();

    if (state.gameOver) return;
    if (!state.pendingJudge) {
      setMessage("적용할 수동 판정이 없음", "error");
      render();
      return;
    }

    const guessEntry = {
      key: state.pendingJudge.guessKey,
      word: state.pendingJudge.guessWord
    };

    const statuses = [...state.pendingJudge.statuses];
    const result = commitGuess(guessEntry, statuses);

    state.pendingJudge = null;

    if (result.patternBYG === "GGGGG") {
      state.gameOver = true;
      setMessage("수동 판정 기준으로 정답 처리됨", "success");
    } else if (state.rowIndex >= 4) {
      state.gameOver = true;
      setMessage("최대 시도 수 도달", "error");
    } else {
      state.rowIndex += 1;
      setMessage(
        result.followed ? "전략 추천대로 다음 분기로 이동함" : "전략 경로에서 이탈함",
        result.followed ? "" : "error"
      );
    }

    render();
  }

  return {
    name: "assist",
    reset,
    submit,
    confirmJudge
  };
}