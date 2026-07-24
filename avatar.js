/* ==========================================================
   Toll Audit Assistant
   avatar.js

   Lets each account pick a fun sticker as its profile picture.
   Purely per-account — stored under its own key (see
   getAvatarStorageKey() in data.js) — shown on the welcome
   screen and in the topbar.
========================================================== */

const AVATAR_STICKERS = [
    "🚗", "🚕", "🚙", "🚌", "🚛", "🏍️", "🛻", "🚜",
    "🚦", "🚧", "🎫", "📋", "🕵️", "👮", "🧑‍💼", "🦺",
    "⭐", "🏆", "🔥", "💪", "😎", "🤓", "🦉", "🐯"
];

const DEFAULT_AVATAR = "🧑‍💼";

document.addEventListener("DOMContentLoaded", () => {

    renderAvatarGrid();

    setupAvatarTriggers();

    setupAvatarUploadControls();

    refreshAvatarDisplays();

});

/* ===============================
   BUILD THE STICKER GRID
=============================== */

function renderAvatarGrid() {

    const gridEl = document.getElementById("avatarStickerGrid");

    if (!gridEl) return;

    gridEl.innerHTML = AVATAR_STICKERS.map(sticker =>

        `<button type="button" class="avatar-sticker-option" data-sticker="${sticker}">${sticker}</button>`

    ).join("");

    gridEl.querySelectorAll(".avatar-sticker-option").forEach(btn => {

        btn.addEventListener("click", function () {

            saveUserAvatar(this.dataset.sticker);

            refreshAvatarDisplays();

            /* Close modal so the user sees the new avatar instantly */
            const modalEl = document.getElementById("avatarModal");
            if (modalEl && typeof bootstrap !== "undefined") {
                bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            }

        });

    });

}

/* ===============================
   OPEN TRIGGERS
   (welcome screen avatar circle +
   topbar "Change Sticker" item)
=============================== */

function setupAvatarTriggers() {

    document.querySelectorAll("[data-avatar-trigger]").forEach(el => {

        el.addEventListener("click", function () {

            if (typeof bootstrap === "undefined") return;

            const modalEl = document.getElementById("avatarModal");

            if (!modalEl) return;

            bootstrap.Modal.getOrCreateInstance(modalEl).show();

        });

    });

}

/* ===============================
   REFRESH EVERY VISIBLE AVATAR
   Called on load, on sticker pick,
   and whenever the active account
   changes (see setActiveUser in
   data.js).
=============================== */

function refreshAvatarDisplays() {

    const stored = loadUserAvatar() || DEFAULT_AVATAR;

    const isPhoto = stored.indexOf("data:image") === 0;

    document.querySelectorAll(".avatar-display").forEach(el => {

        if (isPhoto) {

            el.innerHTML = `<img src="${stored}" class="avatar-img" alt="Profile picture">`;

        } else {

            el.innerHTML = "";

            el.textContent = stored;

        }

    });

    const gridEl = document.getElementById("avatarStickerGrid");

    if (gridEl) {

        gridEl.querySelectorAll(".avatar-sticker-option").forEach(btn => {

            btn.classList.toggle(

                "selected",

                !isPhoto && btn.dataset.sticker === stored

            );

        });

    }

}

/* ===============================
   UPLOAD YOUR OWN PHOTO
   (from the computer, or a web
   image URL). Whatever is picked
   is auto center-cropped to a
   square so it always fits the
   round avatar slot cleanly —
   no manual resizing needed.
=============================== */

function setupAvatarUploadControls() {

    const fileInput = document.getElementById("avatarUploadFile");

    const urlInput = document.getElementById("avatarUploadUrl");

    const urlBtn = document.getElementById("avatarUploadUrlBtn");

    if (fileInput) {

        fileInput.addEventListener("change", function () {

            const file = this.files && this.files[0];

            if (!file) return;

            if (!file.type || file.type.indexOf("image/") !== 0) {

                setAvatarUploadStatus("Please choose an image file.", true);

                return;

            }

            const reader = new FileReader();

            reader.onload = function (e) {

                loadAvatarImageSource(e.target.result, false);

            };

            reader.onerror = function () {

                setAvatarUploadStatus("Could not read that file.", true);

            };

            reader.readAsDataURL(file);

            fileInput.value = "";

        });

    }

    if (urlBtn && urlInput) {

        urlBtn.addEventListener("click", function () {

            const url = urlInput.value.trim();

            if (!url) {

                setAvatarUploadStatus("Please paste an image URL first.", true);

                return;

            }

            loadAvatarImageSource(url, true);

        });

    }

}

function setAvatarUploadStatus(message, isError) {

    const statusEl = document.getElementById("avatarUploadStatus");

    if (!statusEl) return;

    statusEl.className = isError ?
        "small mt-2 text-danger" : "small mt-2 text-success";

    statusEl.textContent = message || "";

}

function loadAvatarImageSource(src, isRemote) {

    setAvatarUploadStatus("Loading image…", false);

    const img = new Image();

    if (isRemote) {

        img.crossOrigin = "anonymous";

    }

    img.onload = function () {

        try {

            const dataUrl = cropImageToSquareDataUrl(img);

            saveUserAvatar(dataUrl);

            refreshAvatarDisplays();

            setAvatarUploadStatus("Profile picture updated.", false);

            /* Close modal so the user sees the new photo instantly */
            const modalEl = document.getElementById("avatarModal");
            if (modalEl && typeof bootstrap !== "undefined") {
                setTimeout(() => bootstrap.Modal.getOrCreateInstance(modalEl).hide(), 600);
            }

        } catch (err) {

            setAvatarUploadStatus(

                "Couldn't use that image — the site it's hosted on may block " +
                "saving it here. Try downloading it and uploading it from " +
                "your computer instead.",

                true

            );

        }

    };

    img.onerror = function () {

        setAvatarUploadStatus(

            "Couldn't load that image. Check the URL and try again.",

            true

        );

    };

    img.src = src;

}

/* Center-crops to a square (so off-center faces in wide photos
   aren't cut off unevenly) and resizes down to a fixed size, so
   every stored avatar is small and consistent regardless of the
   original photo's dimensions. */

function cropImageToSquareDataUrl(img) {

    const outputSize = 240;

    const canvas = document.createElement("canvas");

    canvas.width = outputSize;

    canvas.height = outputSize;

    const ctx = canvas.getContext("2d");

    const sourceSize =
        Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);

    const sourceX =
        ((img.naturalWidth || img.width) - sourceSize) / 2;

    const sourceY =
        ((img.naturalHeight || img.height) - sourceSize) / 2;

    ctx.drawImage(

        img,

        sourceX, sourceY, sourceSize, sourceSize,

        0, 0, outputSize, outputSize

    );

    return canvas.toDataURL("image/png");

}
