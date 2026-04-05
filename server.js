const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const crypto = require("crypto");

const app = express();

const CONFIG = {
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  mediaDir: path.join(__dirname, process.env.MEDIA_DIR || "uploads"),
  dataDir: path.join(__dirname, process.env.DATA_DIR || "data"),
  dbFile: path.join(__dirname, process.env.DATA_DIR || "data", "files.json"),
  maxFileSize: Number(process.env.MAX_FILE_SIZE_MB || 512) * 1024 * 1024,
  maxFilesPerUpload: Number(process.env.MAX_FILES_PER_UPLOAD || 20),
  requireApiKey: process.env.REQUIRE_API_KEY === "true",
  apiKey: process.env.API_KEY || "",
};

const ALLOWED_MIME_PREFIX = ["image/", "video/"];
const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
]);

let writeQueue = Promise.resolve();

ensureDirs();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(requestId);
app.use(requestLog);
app.use("/media", express.static(CONFIG.mediaDir, { etag: true, maxAge: "7d" }));
app.use(express.static(CONFIG.root, { etag: true, maxAge: "1h" }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CONFIG.mediaDir),
  filename: (_req, file, cb) => {
    const ext = sanitizeExt(path.extname(file.originalname));
    const generated = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
    cb(null, generated);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: CONFIG.maxFileSize,
    files: CONFIG.maxFilesPerUpload,
  },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedFile(file)) {
      cb(new Error(`不支持的文件类型：${file.originalname}`));
      return;
    }
    cb(null, true);
  },
});

app.get("/healthz", (_req, res) => {
  ok(res, { status: "ok", now: new Date().toISOString() });
});

app.get("/api/files", asyncHandler(async (req, res) => {
  const page = clampNumber(req.query.page, 1, 100000, 1);
  const pageSize = clampNumber(req.query.pageSize, 1, 100, 20);
  const q = String(req.query.q || "").trim().toLowerCase();
  const type = String(req.query.type || "all");

  let records = await readRecords();
  records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (q) {
    records = records.filter((x) => x.name.toLowerCase().includes(q));
  }
  if (type === "image") {
    records = records.filter((x) => x.mimeType.startsWith("image/"));
  } else if (type === "video") {
    records = records.filter((x) => x.mimeType.startsWith("video/"));
  }

  const total = records.length;
  const start = (page - 1) * pageSize;
  const data = records.slice(start, start + pageSize);

  ok(res, data, {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}));

app.post("/api/upload", requireApiKey, upload.array("files", CONFIG.maxFilesPerUpload), asyncHandler(async (req, res) => {
  const incoming = req.files || [];
  if (!incoming.length) {
    throw httpError(400, "请先选择文件。");
  }

  const records = await readRecords();
  for (const file of incoming) {
    records.push({
      id: crypto.randomUUID(),
      name: file.originalname,
      mimeType: file.mimetype || "application/octet-stream",
      extension: sanitizeExt(path.extname(file.originalname)),
      size: file.size,
      storageName: file.filename,
      url: `/media/${file.filename}`,
      createdAt: new Date().toISOString(),
    });
  }

  await writeRecords(records);
  ok(res, { uploaded: incoming.length });
}));

app.delete("/api/files/:id", requireApiKey, asyncHandler(async (req, res) => {
  const id = String(req.params.id || "");
  const records = await readRecords();
  const target = records.find((x) => x.id === id);

  if (!target) {
    throw httpError(404, "文件不存在。");
  }

  const next = records.filter((x) => x.id !== id);
  await writeRecords(next);
  await safeUnlink(path.join(CONFIG.mediaDir, target.storageName));
  ok(res, { deletedId: id });
}));

app.delete("/api/files", requireApiKey, asyncHandler(async (_req, res) => {
  const records = await readRecords();
  await Promise.all(records.map((item) => safeUnlink(path.join(CONFIG.mediaDir, item.storageName))));
  await writeRecords([]);
  ok(res, { deleted: records.length });
}));

app.get("/api/files/:id/download", asyncHandler(async (req, res) => {
  const id = String(req.params.id || "");
  const records = await readRecords();
  const target = records.find((x) => x.id === id);

  if (!target) {
    throw httpError(404, "文件不存在。");
  }

  const filePath = path.join(CONFIG.mediaDir, target.storageName);
  const exists = await fsp
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw httpError(410, "文件已丢失，请删除该历史记录。");
  }

  const encoded = encodeRFC5987ValueChars(target.name);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encoded}`);
  res.sendFile(filePath);
}));

app.get("*", (_req, res) => {
  res.sendFile(path.join(CONFIG.root, "index.html"));
});

app.use((err, req, res, _next) => {
  const status = Number(err.status || 500);
  const message = err.message || "服务器内部错误";
  console.error(`[${req.requestId}]`, err);
  res.status(status).json({ success: false, error: { message, requestId: req.requestId } });
});

app.listen(CONFIG.port, () => {
  console.log(`Media host server running at http://127.0.0.1:${CONFIG.port}`);
});

function ensureDirs() {
  for (const dir of [CONFIG.mediaDir, CONFIG.dataDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  if (!fs.existsSync(CONFIG.dbFile)) {
    fs.writeFileSync(CONFIG.dbFile, "[]", "utf8");
  }
}

function sanitizeExt(ext) {
  const normalized = String(ext || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
  return normalized || "";
}

function isAllowedFile(file) {
  const ext = sanitizeExt(path.extname(file.originalname));
  const isAllowedExt = ALLOWED_EXTENSIONS.has(ext);
  const isAllowedMime = ALLOWED_MIME_PREFIX.some((prefix) => String(file.mimetype || "").startsWith(prefix));
  return isAllowedExt && isAllowedMime;
}

async function readRecords() {
  try {
    const raw = await fsp.readFile(CONFIG.dbFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function writeRecords(records) {
  const payload = JSON.stringify(records, null, 2);
  writeQueue = writeQueue.then(async () => {
    const tempFile = `${CONFIG.dbFile}.tmp`;
    await fsp.writeFile(tempFile, payload, "utf8");
    await fsp.rename(tempFile, CONFIG.dbFile);
  });
  await writeQueue;
}

async function safeUnlink(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (_error) {
    // ignore
  }
}

function ok(res, data, meta) {
  res.json({ success: true, data, meta });
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requestId(req, _res, next) {
  req.requestId = crypto.randomUUID();
  next();
}

function requestLog(req, _res, next) {
  console.log(`[${req.requestId}] ${req.method} ${req.originalUrl}`);
  next();
}

function requireApiKey(req, _res, next) {
  if (!CONFIG.requireApiKey) {
    next();
    return;
  }

  const token = req.header("x-api-key");
  if (!token || token !== CONFIG.apiKey) {
    next(httpError(401, "未授权，请检查 API Key。"));
    return;
  }
  next();
}

function clampNumber(input, min, max, fallback) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function encodeRFC5987ValueChars(str) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A")
    .replace(/%(?:7C|60|5E)/g, unescape);
}
