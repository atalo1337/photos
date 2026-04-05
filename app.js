const state = {
  page: 1,
  pageSize: 20,
  totalPages: 1,
  q: "",
  type: "all",
};

const fileInput = document.querySelector("#fileInput");
const uploadBtn = document.querySelector("#uploadBtn");
const clearBtn = document.querySelector("#clearBtn");
const mediaGrid = document.querySelector("#mediaGrid");
const emptyState = document.querySelector("#emptyState");
const stats = document.querySelector("#stats");
const template = document.querySelector("#mediaCardTemplate");
const previewDialog = document.querySelector("#previewDialog");
const previewTitle = document.querySelector("#previewTitle");
const previewBody = document.querySelector("#previewBody");
const closePreviewBtn = document.querySelector("#closePreviewBtn");
const apiKeyInput = document.querySelector("#apiKeyInput");
const searchInput = document.querySelector("#searchInput");
const typeSelect = document.querySelector("#typeSelect");
const prevPageBtn = document.querySelector("#prevPageBtn");
const nextPageBtn = document.querySelector("#nextPageBtn");
const pageInfo = document.querySelector("#pageInfo");

bootstrap();

async function bootstrap() {
  restoreApiKey();
  bindEvents();
  await renderFiles();
}

function bindEvents() {
  uploadBtn.addEventListener("click", () => guard(uploadFiles));
  clearBtn.addEventListener("click", () => guard(clearAllFiles));
  closePreviewBtn.addEventListener("click", () => previewDialog.close());

  previewDialog.addEventListener("click", (event) => {
    const box = previewDialog.querySelector(".preview-content");
    if (!box.contains(event.target)) previewDialog.close();
  });

  apiKeyInput.addEventListener("change", () => {
    localStorage.setItem("media_host_api_key", apiKeyInput.value.trim());
  });

  searchInput.addEventListener("input", debounce(async () => {
    state.q = searchInput.value.trim();
    state.page = 1;
    await renderFiles();
  }, 300));

  typeSelect.addEventListener("change", async () => {
    state.type = typeSelect.value;
    state.page = 1;
    await renderFiles();
  });

  prevPageBtn.addEventListener("click", async () => {
    if (state.page <= 1) return;
    state.page -= 1;
    await renderFiles();
  });

  nextPageBtn.addEventListener("click", async () => {
    if (state.page >= state.totalPages) return;
    state.page += 1;
    await renderFiles();
  });
}

async function uploadFiles() {
  const files = [...fileInput.files];
  if (!files.length) {
    alert("请选择文件后再上传。");
    return;
  }

  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  await request("/api/upload", {
    method: "POST",
    body: formData,
  });

  fileInput.value = "";
  await renderFiles();
}

async function renderFiles() {
  const result = await fetchFiles();
  const files = result.data || [];
  const meta = result.meta || {};

  state.totalPages = meta.totalPages || 1;
  stats.textContent = `总计 ${meta.total ?? files.length} 个文件`;
  pageInfo.textContent = `第 ${state.page} / ${state.totalPages} 页`;
  prevPageBtn.disabled = state.page <= 1;
  nextPageBtn.disabled = state.page >= state.totalPages;

  mediaGrid.innerHTML = "";
  if (!files.length) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;
  const fragment = document.createDocumentFragment();
  files.forEach((item) => fragment.append(buildCard(item)));
  mediaGrid.append(fragment);
}

async function fetchFiles() {
  const query = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize),
    q: state.q,
    type: state.type,
  });
  return request(`/api/files?${query.toString()}`);
}

function buildCard(record) {
  const node = template.content.cloneNode(true);
  const thumbBtn = node.querySelector(".thumb-btn");
  const fileName = node.querySelector(".file-name");
  const fileInfo = node.querySelector(".file-info");
  const deleteBtn = node.querySelector(".delete-btn");
  const downloadBtn = node.querySelector(".download-btn");
  const copyBtn = node.querySelector(".copy-btn");

  fileName.textContent = record.name;
  fileInfo.textContent = `${formatSize(record.size)} · ${formatDate(record.createdAt)}`;

  if (record.mimeType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = record.url;
    img.alt = record.name;
    thumbBtn.append(img);
  } else if (record.mimeType.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = record.url;
    video.muted = true;
    video.playsInline = true;
    thumbBtn.append(video);
  } else {
    thumbBtn.textContent = "📄";
  }

  thumbBtn.addEventListener("click", () => openPreview(record));

  copyBtn.addEventListener("click", () => guard(async () => {
    const fullUrl = new URL(record.url, window.location.origin).toString();
    await navigator.clipboard.writeText(fullUrl);
    flashButton(copyBtn, "已复制");
  }));

  downloadBtn.addEventListener("click", () => {
    window.open(`/api/files/${encodeURIComponent(record.id)}/download`, "_blank");
  });

  deleteBtn.addEventListener("click", () => guard(async () => {
    await request(`/api/files/${encodeURIComponent(record.id)}`, { method: "DELETE" });
    await renderFiles();
  }));

  return node;
}

function openPreview(record) {
  previewTitle.textContent = record.name;
  previewBody.innerHTML = "";

  if (record.mimeType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = record.url;
    img.alt = record.name;
    previewBody.append(img);
  } else if (record.mimeType.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = record.url;
    video.controls = true;
    video.autoplay = true;
    previewBody.append(video);
  } else {
    previewBody.textContent = "该文件类型不支持在线预览。";
  }

  previewDialog.showModal();
}

async function clearAllFiles() {
  if (!confirm("确定要删除所有历史文件吗？此操作不可恢复。")) return;
  await request("/api/files", { method: "DELETE" });
  state.page = 1;
  await renderFiles();
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const apiKey = apiKeyInput.value.trim();
  if (apiKey) headers.set("x-api-key", apiKey);

  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok || !payload?.success) {
    const message = payload?.error?.message || `请求失败：${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function restoreApiKey() {
  apiKeyInput.value = localStorage.getItem("media_host_api_key") || "";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function flashButton(button, text) {
  const backup = button.textContent;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = backup;
  }, 1200);
}

async function guard(fn) {
  try {
    await fn();
  } catch (error) {
    console.error(error);
    alert(error.message || "操作失败");
  }
}

function debounce(fn, waitMs) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}
