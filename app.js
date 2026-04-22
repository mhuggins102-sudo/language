(function () {
  "use strict";

  const phraseEl = document.getElementById("phrase");
  const inputEl = document.getElementById("guess-input");
  const formEl = document.getElementById("guess-form");
  const submitBtn = document.getElementById("submit-btn");
  const feedbackEl = document.getElementById("feedback");
  const verdictEl = document.getElementById("verdict");
  const answerLangEl = document.getElementById("answer-language");
  const answerTranslationEl = document.getElementById("answer-translation");
  const answerTipEl = document.getElementById("answer-tip");
  const nextBtn = document.getElementById("next-btn");
  const skipBtn = document.getElementById("skip-btn");
  const resetBtn = document.getElementById("reset-btn");
  const suggestionsEl = document.getElementById("suggestions");
  const comboboxEl = document.querySelector(".combobox");
  const correctEl = document.getElementById("correct");
  const totalEl = document.getElementById("total");
  const streakEl = document.getElementById("streak");

  const STORAGE_KEY = "polyglot-score-v1";

  let current = null;      // currently displayed question
  let awaiting = false;    // true once user submitted and we're showing feedback
  let recentIds = [];      // avoid immediate repeats
  const recentWindow = Math.min(12, Math.max(3, Math.floor(QUESTIONS.length / 3)));

  const LANGUAGE_NAMES = QUESTIONS
    .map((q) => q.lang)
    .sort((a, b) => a.localeCompare(b));

  let activeSuggestion = -1;
  let suggestionItems = [];

  const score = loadScore();
  renderScore();
  wireAutocomplete();
  nextQuestion();

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    if (awaiting) {
      advance();
    } else {
      handleGuess(inputEl.value);
    }
  });

  nextBtn.addEventListener("click", advance);

  skipBtn.addEventListener("click", () => {
    if (awaiting) {
      advance();
    } else {
      revealAnswer(null);
    }
  });

  resetBtn.addEventListener("click", () => {
    score.correct = 0;
    score.total = 0;
    score.streak = 0;
    saveScore();
    renderScore();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && awaiting) {
      e.preventDefault();
      advance();
    }
  });

  function wireAutocomplete() {
    inputEl.addEventListener("input", updateSuggestions);
    inputEl.addEventListener("focus", updateSuggestions);
    inputEl.addEventListener("keydown", handleAutocompleteKey);
    document.addEventListener("click", (e) => {
      if (!comboboxEl.contains(e.target)) hideSuggestions();
    });
  }

  function updateSuggestions() {
    if (awaiting) {
      hideSuggestions();
      return;
    }
    const query = inputEl.value.trim();
    if (!query) {
      hideSuggestions();
      return;
    }
    const qn = normalise(query);
    const matches = LANGUAGE_NAMES.filter((name) =>
      normalise(name).includes(qn)
    ).slice(0, 8);
    if (!matches.length) {
      hideSuggestions();
      return;
    }
    renderSuggestions(matches, query);
  }

  function renderSuggestions(matches, query) {
    suggestionsEl.innerHTML = "";
    suggestionItems = matches;
    const qn = normalise(query);
    for (let i = 0; i < matches.length; i++) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.index = String(i);
      li.innerHTML = highlight(matches[i], qn);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        commitSuggestion(i);
      });
      suggestionsEl.appendChild(li);
    }
    activeSuggestion = -1;
    suggestionsEl.classList.remove("hidden");
    comboboxEl.setAttribute("aria-expanded", "true");
  }

  function hideSuggestions() {
    suggestionsEl.classList.add("hidden");
    suggestionsEl.innerHTML = "";
    suggestionItems = [];
    activeSuggestion = -1;
    comboboxEl.setAttribute("aria-expanded", "false");
  }

  function commitSuggestion(i) {
    if (i < 0 || i >= suggestionItems.length) return;
    inputEl.value = suggestionItems[i];
    hideSuggestions();
    inputEl.focus();
  }

  function handleAutocompleteKey(e) {
    if (suggestionsEl.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter" && activeSuggestion >= 0) {
      e.preventDefault();
      commitSuggestion(activeSuggestion);
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  }

  function moveActive(delta) {
    if (!suggestionItems.length) return;
    activeSuggestion =
      (activeSuggestion + delta + suggestionItems.length) %
      suggestionItems.length;
    const children = suggestionsEl.children;
    for (let i = 0; i < children.length; i++) {
      children[i].classList.toggle("active", i === activeSuggestion);
    }
    const active = children[activeSuggestion];
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function highlight(name, qn) {
    if (!qn) return escapeHtml(name);
    const flat = normalise(name);
    const idx = flat.indexOf(qn);
    if (idx < 0) return escapeHtml(name);
    // map normalised index back to original by counting preserved chars
    let origStart = -1;
    let origEnd = -1;
    let seen = 0;
    for (let i = 0; i < name.length; i++) {
      const piece = normalise(name[i]);
      if (!piece) continue;
      if (origStart < 0 && seen === idx) origStart = i;
      seen += piece.length;
      if (origStart >= 0 && origEnd < 0 && seen >= idx + qn.length) {
        origEnd = i + 1;
        break;
      }
    }
    if (origStart < 0 || origEnd < 0) return escapeHtml(name);
    return (
      escapeHtml(name.slice(0, origStart)) +
      '<span class="hl">' +
      escapeHtml(name.slice(origStart, origEnd)) +
      "</span>" +
      escapeHtml(name.slice(origEnd))
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pickQuestion() {
    const eligible = QUESTIONS
      .map((q, i) => ({ q, i }))
      .filter(({ i }) => !recentIds.includes(i));
    const pool = eligible.length ? eligible : QUESTIONS.map((q, i) => ({ q, i }));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    recentIds.push(pick.i);
    if (recentIds.length > recentWindow) recentIds.shift();
    return pick.q;
  }

  function nextQuestion() {
    current = pickQuestion();
    awaiting = false;
    phraseEl.textContent = current.phrase;
    phraseEl.setAttribute("lang", current.tag || "und");
    feedbackEl.classList.add("hidden");
    inputEl.value = "";
    inputEl.disabled = false;
    submitBtn.textContent = "Guess";
    hideSuggestions();
    inputEl.focus();
  }

  function advance() {
    nextQuestion();
  }

  function handleGuess(raw) {
    const guess = (raw || "").trim();
    if (!guess) {
      inputEl.focus();
      return;
    }
    const isRight = matchesLanguage(guess, current);
    revealAnswer(isRight);
  }

  function revealAnswer(isRight) {
    awaiting = true;
    score.total += 1;
    if (isRight === true) {
      score.correct += 1;
      score.streak += 1;
      verdictEl.textContent = streakLine(score.streak) + " Correct!";
      verdictEl.className = "verdict good";
    } else if (isRight === false) {
      score.streak = 0;
      verdictEl.textContent = "Not quite — your guess was “" + inputEl.value.trim() + "”.";
      verdictEl.className = "verdict bad";
    } else {
      // skip
      score.streak = 0;
      verdictEl.textContent = "Skipped.";
      verdictEl.className = "verdict";
    }
    answerLangEl.textContent = current.lang;
    answerTranslationEl.textContent = current.translation;
    answerTipEl.textContent = current.tip;
    feedbackEl.classList.remove("hidden");
    submitBtn.textContent = "Next";
    inputEl.disabled = true;
    renderScore();
    saveScore();
    nextBtn.focus();
  }

  function matchesLanguage(guess, q) {
    const n = normalise(guess);
    if (!n) return false;
    const candidates = [q.lang, ...(q.aliases || [])].map(normalise);
    if (candidates.some((c) => c === n)) return true;
    // allow substring match if it's unambiguous and reasonably long
    if (n.length >= 4) {
      const substringHits = QUESTIONS.filter((other) =>
        [other.lang, ...(other.aliases || [])]
          .map(normalise)
          .some((c) => c.includes(n) || n.includes(c))
      );
      if (
        substringHits.length === 1 &&
        substringHits[0].lang === q.lang
      ) {
        return true;
      }
    }
    return false;
  }

  function normalise(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[\s\-_.'’]/g, "")
      .trim();
  }

  function streakLine(n) {
    if (n >= 10) return "🔥 " + n + " in a row!";
    if (n >= 5) return "🔥 " + n + " streak!";
    if (n >= 3) return n + " in a row!";
    return "";
  }

  function renderScore() {
    correctEl.textContent = score.correct;
    totalEl.textContent = score.total;
    streakEl.textContent = score.streak;
  }

  function loadScore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          correct: Number(parsed.correct) || 0,
          total: Number(parsed.total) || 0,
          streak: Number(parsed.streak) || 0,
        };
      }
    } catch (_) {}
    return { correct: 0, total: 0, streak: 0 };
  }

  function saveScore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(score));
    } catch (_) {}
  }
})();
