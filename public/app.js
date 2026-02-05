const gatePanel = document.getElementById("gate");
const testPanel = document.getElementById("test");
const completePanel = document.getElementById("complete");
const questionArea = document.getElementById("question-area");
const sectionTitle = document.getElementById("section-title");
const sectionInstructions = document.getElementById("section-instructions");
const totalTimerEl = document.getElementById("total-timer");
const sectionTimerEl = document.getElementById("section-timer");
const questionTimerEl = document.getElementById("question-timer");
const btnRunChecks = document.getElementById("btn-run-checks");
const btnReady = document.getElementById("btn-ready");
const btnForceNext = document.getElementById("btn-force-next");
const fullscreenBlock = document.getElementById("fullscreen-block");
const btnFullscreen = document.getElementById("btn-fullscreen");

const checkChrome = document.querySelector("#check-chrome .status");
const checkMic = document.querySelector("#check-mic .status");
const checkNoise = document.querySelector("#check-noise .status");
const checkReady = document.querySelector("#check-ready .status");
const checkFullscreen = document.querySelector("#check-fullscreen .status");
const checkDesktop = document.querySelector("#check-desktop .status");

let session = null;
let sectionConfig = null;
let sectionOrder = null;
let totalSeconds = 0;
let audioStream = null;
let recorder = null;
let recordingChunks = [];
let questionTimer = null;
let questionTimeRemaining = 0;
let sectionTimeRemaining = 0;
let totalTimeRemaining = 0;
let currentQuestionStart = null;
let noiseTestPassed = false;
let micPermissionGranted = false;
let readyConfirmed = false;
let forceAdvanceDisabled = false;

const QUESTION_BANK = {
  A: [
    "Read this passage clearly and at a steady pace.",
    "Practice articulation and natural rhythm with the passage below."
  ],
  B: Array.from({ length: 16 }, (_, i) => `Sentence repeat prompt ${i + 1}.`),
  C: Array.from({ length: 10 }, (_, i) => ["a business report", "must include", "clear numbers", `item ${i + 1}`]),
  D: Array.from({ length: 12 }, (_, i) => ({
    dialogue: `Speaker A: Hello, this is question ${i + 1}. Speaker B: Please respond clearly.`,
    question: `What is the main topic of the conversation ${i + 1}?`
  })),
  E: [
    "The quick brown fox jumps over the lazy dog. This is a typing accuracy prompt."
  ],
  F: Array.from({ length: 20 }, (_, i) => `The presentation ${i + 1} was ____ yesterday.`),
  G: Array.from({ length: 16 }, (_, i) => `Dictation sentence number ${i + 1} should be typed exactly.`),
  H: Array.from({ length: 3 }, (_, i) => `This is a reconstruction passage ${i + 1}. You must remember the details and type them later.`),
  I: [
    "Read the passage about workplace communication and provide a summary and opinion."
  ]
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
};

const setStatus = (el, ok, message) => {
  el.textContent = message;
  el.classList.remove("ok", "fail");
  if (ok === true) {
    el.classList.add("ok");
  }
  if (ok === false) {
    el.classList.add("fail");
  }
};

const isChrome = () => {
  const ua = navigator.userAgent;
  return /Chrome/.test(ua) && !/Edg|OPR/.test(ua);
};

const isDesktop = () => window.innerWidth >= 1024;

const updateDesktopStatus = () => {
  const ok = isDesktop();
  setStatus(checkDesktop, ok, ok ? "Detected" : "Desktop required");
  return ok;
};

const requestFullscreen = async () => {
  if (document.fullscreenElement) {
    return true;
  }
  if (document.documentElement.requestFullscreen) {
    await document.documentElement.requestFullscreen();
    return true;
  }
  return false;
};

const updateFullscreenStatus = () => {
  const ok = Boolean(document.fullscreenElement);
  setStatus(checkFullscreen, ok, ok ? "Enabled" : "Required");
  fullscreenBlock.classList.toggle("hidden", ok);
  return ok;
};

const runNoiseTest = async () => {
  if (!audioStream) {
    return false;
  }
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(audioStream);
  source.connect(analyser);
  analyser.fftSize = 2048;
  const dataArray = new Uint8Array(analyser.fftSize);

  const samples = [];
  const endTime = Date.now() + 4000;

  const sample = () => {
    analyser.getByteTimeDomainData(dataArray);
    const normalized = dataArray.reduce((sum, val) => sum + Math.abs(val - 128), 0) / dataArray.length;
    samples.push(normalized);
    if (Date.now() < endTime) {
      requestAnimationFrame(sample);
    }
  };
  sample();

  await new Promise((resolve) => setTimeout(resolve, 4200));
  await audioContext.close();
  const avg = samples.reduce((sum, val) => sum + val, 0) / samples.length;
  return avg < 12;
};

const ensureMicPermission = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioStream = stream;
  return true;
};

const runChecks = async () => {
  setStatus(checkChrome, isChrome(), isChrome() ? "Detected" : "Use Chrome" );
  updateDesktopStatus();
  try {
    await ensureMicPermission();
    micPermissionGranted = true;
    setStatus(checkMic, true, "Granted");
  } catch (error) {
    micPermissionGranted = false;
    setStatus(checkMic, false, "Blocked");
  }

  if (micPermissionGranted) {
    const noiseOk = await runNoiseTest();
    noiseTestPassed = noiseOk;
    setStatus(checkNoise, noiseOk, noiseOk ? "Quiet enough" : "Too noisy");
  }

  updateFullscreenStatus();
  toggleReady();
};

const toggleReady = () => {
  const allOk = isChrome() && micPermissionGranted && noiseTestPassed && readyConfirmed && document.fullscreenElement && isDesktop();
  btnReady.disabled = !allOk;
  setStatus(checkReady, readyConfirmed, readyConfirmed ? "Confirmed" : "Pending");
};

const showPanel = (panel) => {
  [gatePanel, testPanel, completePanel].forEach((el) => el.classList.remove("active"));
  panel.classList.add("active");
};

const fetchConfig = async () => {
  const res = await fetch("/api/config");
  const data = await res.json();
  sectionConfig = data.sectionConfig;
  sectionOrder = data.sectionOrder;
  totalSeconds = data.totalSeconds;
};

const startTest = async () => {
  const res = await fetch("/api/start", { method: "POST" });
  session = await res.json();
  showPanel(testPanel);
  setupTimers();
  renderQuestion();
};

const updateTimers = async () => {
  if (!session) return;
  const res = await fetch(`/api/status?userId=${session.userId}`);
  const data = await res.json();
  sectionTimeRemaining = data.sectionRemaining;
  totalTimeRemaining = data.totalRemaining;
  totalTimerEl.textContent = formatTime(totalTimeRemaining);
  sectionTimerEl.textContent = formatTime(sectionTimeRemaining);
  if (totalTimeRemaining <= 0 || sectionTimeRemaining <= 0) {
    await handleAutoAdvance(true);
  }
};

const setupTimers = () => {
  updateTimers();
  setInterval(updateTimers, 1000);
};

const startQuestionTimer = (seconds) => {
  clearInterval(questionTimer);
  questionTimeRemaining = seconds;
  questionTimerEl.textContent = formatTime(questionTimeRemaining);
  questionTimer = setInterval(() => {
    questionTimeRemaining -= 1;
    questionTimerEl.textContent = formatTime(Math.max(questionTimeRemaining, 0));
    if (questionTimeRemaining <= 0) {
      clearInterval(questionTimer);
      handleAutoAdvance(true);
    }
  }, 1000);
};

const stopQuestionTimer = () => {
  clearInterval(questionTimer);
  questionTimerEl.textContent = "--:--";
};

const startRecording = () => {
  if (!audioStream) return;
  recordingChunks = [];
  recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordingChunks.push(event.data);
    }
  };
  recorder.start();
};

const stopRecording = () => {
  if (!recorder) return null;
  return new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(recordingChunks, { type: "audio/webm" });
      resolve(blob);
    };
    recorder.stop();
  });
};

const saveResponse = async ({ section, questionId, responseType, responseData, timeTaken, autoSubmitted }) => {
  const formData = new FormData();
  formData.append("userId", session.userId);
  formData.append("section", section);
  formData.append("questionId", questionId);
  formData.append("responseType", responseType);
  formData.append("timeTaken", timeTaken);
  formData.append("autoSubmitted", autoSubmitted);
  if (responseType === "audio") {
    formData.append("audio", responseData, "response.webm");
  } else {
    formData.append("responseData", responseData);
  }
  await fetch("/api/response", { method: "POST", body: formData });
};

const handleAutoAdvance = async (autoSubmitted = false) => {
  if (forceAdvanceDisabled) return;
  forceAdvanceDisabled = true;
  stopQuestionTimer();

  if (recorder && recorder.state !== "inactive") {
    const audioBlob = await stopRecording();
    if (audioBlob) {
      await saveResponse({
        section: getCurrentSectionKey(),
        questionId: getQuestionId(),
        responseType: "audio",
        responseData: audioBlob,
        timeTaken: Date.now() - currentQuestionStart,
        autoSubmitted
      });
    }
  }

  const res = await fetch("/api/advance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: session.userId })
  });
  const data = await res.json();
  if (data.completed) {
    showPanel(completePanel);
    return;
  }
  session.sectionKey = data.sectionKey;
  session.sectionStartedAt = data.sectionStartedAt;
  session.questionIndex = data.questionIndex;
  forceAdvanceDisabled = false;
  renderQuestion();
};

const getCurrentSectionKey = () => session.sectionKey || sectionOrder[session.sectionIndex || 0];

const getQuestionId = () => `${getCurrentSectionKey()}-${session.questionIndex + 1}`;

const speakText = (text) => {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.onend = resolve;
    speechSynthesis.speak(utterance);
  });
};

const disableCopyPaste = (input) => {
  input.addEventListener("paste", (event) => event.preventDefault());
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");
};

const renderQuestion = async () => {
  const sectionKey = getCurrentSectionKey();
  const config = sectionConfig[sectionKey];
  const questionIndex = session.questionIndex || 0;
  currentQuestionStart = Date.now();
  questionArea.innerHTML = "";
  sectionTitle.textContent = `Part ${sectionKey} – ${config.name}`;
  sectionInstructions.textContent = getInstructions(sectionKey);

  if (sectionKey === "A") {
    const passage = QUESTION_BANK.A[questionIndex];
    questionArea.innerHTML = `<div class="prompt">${passage}</div><div class="prompt">Speak clearly for 30 seconds.</div>`;
    startQuestionTimer(config.perQuestionSeconds);
    startRecording();
    await new Promise((resolve) => setTimeout(resolve, config.perQuestionSeconds * 1000));
    await handleAutoAdvance(true);
    return;
  }

  if (sectionKey === "B") {
    const prompt = QUESTION_BANK.B[questionIndex];
    questionArea.innerHTML = `<div class="prompt">Listen and repeat the sentence.</div><div class="prompt">${prompt}</div>`;
    await speakText(prompt);
    startRecording();
    startQuestionTimer(15);
    return;
  }

  if (sectionKey === "C") {
    const fragments = QUESTION_BANK.C[questionIndex];
    questionArea.innerHTML = `<div class="prompt">Arrange the phrases and speak the sentence.</div><div class="prompt">${fragments.join(" • ")}</div>`;
    startRecording();
    startQuestionTimer(15);
    return;
  }

  if (sectionKey === "D") {
    const convo = QUESTION_BANK.D[questionIndex];
    questionArea.innerHTML = `<div class="prompt">Conversation:</div><div class="prompt">${convo.dialogue}</div><div class="prompt">${convo.question}</div>`;
    await speakText(convo.dialogue);
    await speakText(convo.question);
    startRecording();
    startQuestionTimer(10);
    return;
  }

  if (sectionKey === "E") {
    const text = QUESTION_BANK.E[0];
    questionArea.innerHTML = `<div class="prompt">Type the passage exactly as shown.</div><div class="prompt">${text}</div>`;
    const input = document.createElement("textarea");
    disableCopyPaste(input);
    input.addEventListener("input", async () => {
      await saveResponse({
        section: sectionKey,
        questionId: getQuestionId(),
        responseType: "text",
        responseData: input.value,
        timeTaken: Date.now() - currentQuestionStart,
        autoSubmitted: false
      });
    });
    questionArea.appendChild(input);
    startQuestionTimer(config.totalSeconds);
    return;
  }

  if (sectionKey === "F") {
    const sentence = QUESTION_BANK.F[questionIndex];
    questionArea.innerHTML = `<div class="prompt">Complete the sentence with one word.</div><div class="prompt">${sentence}</div>`;
    const input = document.createElement("input");
    input.type = "text";
    disableCopyPaste(input);
    input.addEventListener("change", async () => {
      await saveResponse({
        section: sectionKey,
        questionId: getQuestionId(),
        responseType: "text",
        responseData: input.value.trim(),
        timeTaken: Date.now() - currentQuestionStart,
        autoSubmitted: false
      });
      await handleAutoAdvance(false);
    });
    questionArea.appendChild(input);
    startQuestionTimer(config.perQuestionSeconds);
    return;
  }

  if (sectionKey === "G") {
    const sentence = QUESTION_BANK.G[questionIndex];
    questionArea.innerHTML = `<div class="prompt">Listen and type the sentence.</div>`;
    await speakText(sentence);
    const input = document.createElement("textarea");
    disableCopyPaste(input);
    input.addEventListener("change", async () => {
      await saveResponse({
        section: sectionKey,
        questionId: getQuestionId(),
        responseType: "text",
        responseData: input.value,
        timeTaken: Date.now() - currentQuestionStart,
        autoSubmitted: false
      });
    });
    questionArea.appendChild(input);
    startQuestionTimer(config.perQuestionSeconds);
    return;
  }

  if (sectionKey === "H") {
    const passage = QUESTION_BANK.H[questionIndex];
    questionArea.innerHTML = `<div class="prompt">Memorize the passage. It will disappear in 30 seconds.</div><div class="prompt" id="passage">${passage}</div>`;
    startQuestionTimer(config.viewSeconds + config.typeSeconds);
    setTimeout(() => {
      const passageEl = document.getElementById("passage");
      if (passageEl) passageEl.remove();
      const input = document.createElement("textarea");
      disableCopyPaste(input);
      input.addEventListener("change", async () => {
        await saveResponse({
          section: sectionKey,
          questionId: getQuestionId(),
          responseType: "text",
          responseData: input.value,
          timeTaken: Date.now() - currentQuestionStart,
          autoSubmitted: false
        });
      });
      questionArea.appendChild(input);
    }, config.viewSeconds * 1000);
    return;
  }

  if (sectionKey === "I") {
    const passage = QUESTION_BANK.I[0];
    questionArea.innerHTML = `<div class="prompt">${passage}</div><div class="prompt">Summary (25–50 words)</div>`;
    const summary = document.createElement("textarea");
    disableCopyPaste(summary);
    const opinionLabel = document.createElement("div");
    opinionLabel.className = "prompt";
    opinionLabel.textContent = "Opinion (50+ words)";
    const opinion = document.createElement("textarea");
    disableCopyPaste(opinion);
    summary.addEventListener("input", () => {
      saveResponse({
        section: sectionKey,
        questionId: `${getQuestionId()}-summary`,
        responseType: "text",
        responseData: summary.value,
        timeTaken: Date.now() - currentQuestionStart,
        autoSubmitted: false
      });
    });
    opinion.addEventListener("input", () => {
      saveResponse({
        section: sectionKey,
        questionId: `${getQuestionId()}-opinion`,
        responseType: "text",
        responseData: opinion.value,
        timeTaken: Date.now() - currentQuestionStart,
        autoSubmitted: false
      });
    });
    questionArea.appendChild(summary);
    questionArea.appendChild(opinionLabel);
    questionArea.appendChild(opinion);
    startQuestionTimer(config.totalSeconds);
  }
};

const getInstructions = (sectionKey) => {
  const instructions = {
    A: "Read aloud each passage. Recording starts automatically and stops after 30 seconds.",
    B: "Listen to each sentence once and repeat immediately. No replay.",
    C: "See jumbled phrases and speak the correct sentence.",
    D: "Listen to the conversation once and answer the question by voice.",
    E: "Type the passage exactly. Copy/paste and autocorrect are disabled.",
    F: "Type one word to complete each sentence. 25 seconds each.",
    G: "Listen once and type the sentence. 25 seconds each.",
    H: "Memorize the passage, then type it from memory. No hints.",
    I: "Write a summary and opinion within the shared time limit."
  };
  return instructions[sectionKey] || "";
};

btnRunChecks.addEventListener("click", runChecks);

btnReady.addEventListener("click", async () => {
  readyConfirmed = true;
  toggleReady();
  if (!btnReady.disabled) {
    await fetchConfig();
    await startTest();
  }
});

btnForceNext.addEventListener("click", () => {
  handleAutoAdvance(false);
});

btnFullscreen.addEventListener("click", async () => {
  await requestFullscreen();
  updateFullscreenStatus();
  toggleReady();
});

window.addEventListener("resize", () => {
  updateDesktopStatus();
  toggleReady();
});

document.addEventListener("fullscreenchange", () => {
  updateFullscreenStatus();
  toggleReady();
});

window.addEventListener("beforeunload", (event) => {
  event.preventDefault();
  event.returnValue = "";
});

updateDesktopStatus();
updateFullscreenStatus();
