const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "uploads");
const dataDir = path.join(__dirname, "data");
const responsesFile = path.join(dataDir, "responses.json");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = `${req.body.userId || "anonymous"}_${req.body.section}_${req.body.questionId}_${Date.now()}`;
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${safeName}${ext}`);
  }
});

const upload = multer({ storage });

const sessions = new Map();

const SECTION_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

const SECTION_CONFIG = {
  A: { name: "Read Aloud", totalSeconds: 120, questions: 2, perQuestionSeconds: 30 },
  B: { name: "Repeats", totalSeconds: 300, questions: 16 },
  C: { name: "Sentence Builds", totalSeconds: 180, questions: 10 },
  D: { name: "Conversations", totalSeconds: 120, questions: 12 },
  E: { name: "Typing", totalSeconds: 60, questions: 1 },
  F: { name: "Sentence Completion", totalSeconds: 480, questions: 20, perQuestionSeconds: 25 },
  G: { name: "Dictation", totalSeconds: 420, questions: 16, perQuestionSeconds: 25 },
  H: { name: "Passage Reconstruction", totalSeconds: 360, questions: 3, viewSeconds: 30, typeSeconds: 90 },
  I: { name: "Summary & Opinion", totalSeconds: 1080, questions: 1 }
};

const TOTAL_TEST_SECONDS = 3000; // 50 minutes

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(responsesFile)) {
  fs.writeFileSync(responsesFile, JSON.stringify([]), "utf8");
}

const appendResponse = (payload) => {
  const existing = JSON.parse(fs.readFileSync(responsesFile, "utf8"));
  existing.push(payload);
  fs.writeFileSync(responsesFile, JSON.stringify(existing, null, 2));
};

const createSession = () => {
  const userId = uuidv4();
  const startedAt = Date.now();
  const session = {
    userId,
    startedAt,
    sectionIndex: 0,
    sectionStartedAt: startedAt,
    questionIndex: 0,
    completed: false
  };
  sessions.set(userId, session);
  return session;
};

const getSession = (userId) => sessions.get(userId);

const getSectionKey = (session) => SECTION_ORDER[session.sectionIndex];

const getSectionRemaining = (session, now) => {
  const sectionKey = getSectionKey(session);
  const config = SECTION_CONFIG[sectionKey];
  const elapsed = Math.floor((now - session.sectionStartedAt) / 1000);
  return Math.max(config.totalSeconds - elapsed, 0);
};

const getTotalRemaining = (session, now) => {
  const elapsed = Math.floor((now - session.startedAt) / 1000);
  return Math.max(TOTAL_TEST_SECONDS - elapsed, 0);
};

app.get("/api/config", (req, res) => {
  res.json({
    sectionOrder: SECTION_ORDER,
    sectionConfig: SECTION_CONFIG,
    totalSeconds: TOTAL_TEST_SECONDS
  });
});

app.post("/api/start", (req, res) => {
  const session = createSession();
  res.json({
    userId: session.userId,
    startedAt: session.startedAt,
    sectionKey: getSectionKey(session),
    sectionStartedAt: session.sectionStartedAt,
    questionIndex: session.questionIndex
  });
});

app.post("/api/advance", (req, res) => {
  const { userId } = req.body;
  const session = getSession(userId);
  if (!session || session.completed) {
    return res.status(400).json({ error: "Invalid session" });
  }
  const sectionKey = getSectionKey(session);
  const config = SECTION_CONFIG[sectionKey];
  if (session.questionIndex + 1 < config.questions) {
    session.questionIndex += 1;
  } else if (session.sectionIndex + 1 < SECTION_ORDER.length) {
    session.sectionIndex += 1;
    session.sectionStartedAt = Date.now();
    session.questionIndex = 0;
  } else {
    session.completed = true;
  }
  sessions.set(userId, session);
  res.json({
    sectionKey: getSectionKey(session),
    sectionStartedAt: session.sectionStartedAt,
    questionIndex: session.questionIndex,
    completed: session.completed
  });
});

app.get("/api/status", (req, res) => {
  const { userId } = req.query;
  const session = getSession(userId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const now = Date.now();
  res.json({
    now,
    sectionKey: getSectionKey(session),
    sectionRemaining: getSectionRemaining(session, now),
    totalRemaining: getTotalRemaining(session, now),
    sectionStartedAt: session.sectionStartedAt,
    questionIndex: session.questionIndex,
    completed: session.completed
  });
});

app.post("/api/response", upload.single("audio"), (req, res) => {
  const payload = {
    userId: req.body.userId,
    section: req.body.section,
    questionId: req.body.questionId,
    responseType: req.body.responseType,
    responseData: req.file ? req.file.filename : req.body.responseData,
    timeTaken: req.body.timeTaken,
    autoSubmitted: req.body.autoSubmitted === "true" || req.body.autoSubmitted === true
  };
  appendResponse(payload);
  res.json({ ok: true, stored: payload.responseData });
});

app.listen(PORT, () => {
  console.log(`Versant simulator running on http://localhost:${PORT}`);
});
