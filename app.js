const DB_NAME = "media-host-db";
const DB_VERSION = 1;
const STORE_NAME = "files";

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

let db;

init().catch((error) => {
  console.error(error);
  alert(`初始化失败：${error.message}`);
});

async function init() {
  db = await openDb();
  bindEvents();
  await renderFiles();
}

function bindEvents() {
  uploadBtn.addEventListener("click", uploadFiles);
  clearBtn.addEventListener("click", clearAllFiles);
  closePreviewBtn.addEventListener("click", () => previewDialog.close());
  previewDialog.addEventListener("click", (event) => {
    const box = previewDialog.querySelector(".preview-content");
    const isInDialog = box.contains(event.target);
    if (!isInDialog) {
      previewDialog.close();
    }
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(mode = "readonly") {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function uploadFiles() {
  const files = [...fileInput.files];
  if (!files.length) {
    alert("请选择文件后再上传。");
    return;
  }

  const store = tx("readwrite");
  for (const file of files) {
    const record = {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      createdAt: new Date().toISOString(),
      blob: file,
    };
    await reqToPromise(store.add(record));
  }

  fileInput.value = "";
  await renderFiles();
}

async function getAllFiles() {
  const store = tx("readonly");
  const result = await reqToPromise(store.getAll());
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function renderFiles() {
  const files = await getAllFiles();
  mediaGrid.innerHTML = "";

  if (!files.length) {
    emptyState.hidden = false;
    stats.textContent = "0 个文件";
    return;
  }

  emptyState.hidden = true;
  stats.textContent = `${files.length} 个文件`;

  const fragment = document.createDocumentFragment();
  for (const record of files) {
    const card = buildCard(record);
    fragment.append(card);
  }
  mediaGrid.append(fragment);
}

function buildCard(record) {
  const node = template.content.cloneNode(true);
  const card = node.querySelector(".media-card");
  const thumbBtn = node.querySelector(".thumb-btn");
  const fileName = node.querySelector(".file-name");
  const fileInfo = node.querySelector(".file-info");
  const deleteBtn = node.querySelector(".delete-btn");
  const downloadBtn = node.querySelector(".download-btn");

  const blobUrl = URL.createObjectURL(record.blob);

  fileName.textContent = record.name;
  fileInfo.textContent = `${formatSize(record.size)} · ${formatDate(record.createdAt)}`;

  if (record.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = blobUrl;
    img.alt = record.name;
    thumbBtn.append(img);
  } else if (record.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = blobUrl;
    video.muted = true;
    video.playsInline = true;
    thumbBtn.append(video);
  } else {
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = "📄";
    thumbBtn.append(icon);
  }

  thumbBtn.addEventListener("click", () => openPreview(record));
  downloadBtn.addEventListener("click", () => downloadFile(record));
  deleteBtn.addEventListener("click", async () => {
    await deleteFile(record.id);
    URL.revokeObjectURL(blobUrl);
    await renderFiles();
  });

  card.addEventListener("DOMNodeRemoved", () => URL.revokeObjectURL(blobUrl), { once: true });

  return node;
}

function openPreview(record) {
  previewTitle.textContent = record.name;
  previewBody.innerHTML = "";

  const url = URL.createObjectURL(record.blob);

  if (record.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = record.name;
    previewBody.append(img);
  } else if (record.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    previewBody.append(video);
  } else {
    const p = document.createElement("p");
    p.textContent = "该文件类型不支持在线预览。";
    previewBody.append(p);
  }

  previewDialog.showModal();
  previewDialog.addEventListener(
    "close",
    () => {
      URL.revokeObjectURL(url);
      previewBody.innerHTML = "";
    },
    { once: true }
  );
}

function downloadFile(record) {
  const url = URL.createObjectURL(record.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = record.name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function deleteFile(id) {
  const store = tx("readwrite");
  await reqToPromise(store.delete(id));
}

async function clearAllFiles() {
  const confirmed = confirm("确定要删除所有历史文件吗？");
  if (!confirmed) {
    return;
  }
  const store = tx("readwrite");
  await reqToPromise(store.clear());
  await renderFiles();
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
