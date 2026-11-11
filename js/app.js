/**
 * UI wiring for the photo search & upload frontend.
 * Talks to the backend exclusively through window.PhotoApi (js/api.js).
 */
(function () {
  "use strict";

  var api = window.PhotoApi;
  var config = window.APP_CONFIG;

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    apiBaseLabel: $("api-base-label"),
    apiIndicator: $("api-indicator"),

    searchForm: $("search-form"),
    searchQuery: $("search-query"),
    searchLabels: $("search-labels"),
    searchButton: $("search-button"),
    searchClear: $("search-clear"),
    searchStatus: $("search-status"),

    resultsGrid: $("results-grid"),
    resultsEmpty: $("results-empty"),
    resultsCount: $("results-count"),

    uploadForm: $("upload-form"),
    uploadFile: $("upload-file"),
    uploadButton: $("upload-button"),
    uploadReset: $("upload-reset"),
    uploadStatus: $("upload-status"),
    filePreview: $("file-preview"),
    filePreviewImg: $("file-preview-img"),
    filePreviewName: $("file-preview-name"),

    labelInput: $("label-input"),
    labelAdd: $("label-add"),
    labelChips: $("label-chips"),
    labelSuggestions: $("label-suggestions"),

    labelsToggle: $("labels-toggle"),
    labelsRow: $("labels-row"),
    uploadModal: $("upload-modal"),
    uploadOpen: $("upload-open"),
    uploadClose: $("upload-close"),

    lightbox: $("lightbox"),
    lightboxImg: $("lightbox-img"),
    lightboxTitle: $("lightbox-title"),
    lightboxChips: $("lightbox-chips"),
    lightboxMeta: $("lightbox-meta"),
    lightboxOpen: $("lightbox-open"),
    lightboxClose: $("lightbox-close")
  };

  /** Photos backing the currently rendered cards (for the lightbox). */
  var currentPhotos = [];

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function setStatus(el, message, kind) {
    el.textContent = message || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function clearStatus(el) {
    el.textContent = "";
    el.className = "status";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Pull labels out of a photo record regardless of the exact shape. */
  function photoLabels(photo) {
    var value = photo.labels || photo.tags || photo.label || [];
    if (typeof value === "string") {
      value = value.split(",").map(function (s) { return s.trim(); });
    }
    if (!Array.isArray(value)) value = [];
    return value.filter(Boolean).map(String);
  }

  function photoCaption(photo) {
    return photo.caption || photo.title || photo.name || photo.filename || "Untitled";
  }

  function photoId(photo) {
    return photo.id != null ? photo.id : photo.photoId || photo._id || "";
  }

  function photoUrl(photo) {
    return api.resolveUrl(photo.url || photo.imageUrl || photo.image || photo.src || "");
  }

  /* ------------------------------------------------------------------ *
   * Search
   * ------------------------------------------------------------------ */

  function renderResults(photos) {
    els.resultsGrid.innerHTML = "";
    currentPhotos = photos || [];

    if (!photos.length) {
      els.resultsEmpty.classList.remove("hidden");
      els.resultsEmpty.querySelector("p").textContent = "No photos matched your search.";
      els.resultsCount.textContent = "";
      return;
    }

    els.resultsEmpty.classList.add("hidden");
    els.resultsCount.textContent = photos.length + (photos.length === 1 ? " photo" : " photos");

    var cards = photos.map(function (photo, index) {
      var url = photoUrl(photo);
      var labels = photoLabels(photo);
      var chips = labels
        .map(function (label) { return '<li class="chip">' + escapeHtml(label) + "</li>"; })
        .join("");
      var id = photoId(photo);
      var caption = photoCaption(photo);

      return (
        '<article class="photo-card" role="button" tabindex="0" data-index="' + index +
        '" aria-label="View ' + escapeHtml(caption) + '">' +
        (url
          ? '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(caption) +
            '" loading="lazy" onerror="this.classList.add(\'failed\')" />'
          : '<img alt="" class="failed" />') +
        '<div class="photo-body">' +
        '<p class="photo-caption">' + escapeHtml(caption) + "</p>" +
        (chips ? '<ul class="chips">' + chips + "</ul>" : "") +
        (id !== "" ? '<p class="photo-meta">id: ' + escapeHtml(id) + "</p>" : "") +
        "</div></article>"
      );
    });

    els.resultsGrid.innerHTML = cards.join("");
  }

  /**
   * Client-side label filter. The gateway's GET /search only documents ?q=,
   * so labels typed into the funnel row filter the results we already have.
   * Every requested label must appear somewhere on the photo (case-insensitive
   * substring match, so "beach" matches "Beach day").
   */
  function filterByLabels(photos, wanted) {
    return photos.filter(function (photo) {
      var have = photoLabels(photo).map(function (label) { return label.toLowerCase(); });
      return wanted.every(function (w) {
        w = w.toLowerCase();
        return have.some(function (haveLabel) { return haveLabel.indexOf(w) !== -1; });
      });
    });
  }

  function doSearch(event) {
    if (event) event.preventDefault();

    var query = els.searchQuery.value.trim();
    var labels = els.searchLabels.value
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    if (!query && !labels.length) {
      setStatus(els.searchStatus, "Enter a query or at least one label to search.", "error");
      return;
    }

    els.searchButton.disabled = true;
    setStatus(els.searchStatus, "Searching…", "loading");

    api
      .searchPhotos({ query: query }) // gateway contract: ?q= only
      .then(function (photos) {
        var shown = labels.length ? filterByLabels(photos, labels) : photos;
        renderResults(shown);

        var message;
        if (!shown.length) {
          message = labels.length && photos.length
            ? "No photos matched your label filter (" + labels.join(", ") + ")."
            : "No photos matched your search.";
        } else if (labels.length) {
          message =
            "Found " + shown.length + " of " + photos.length +
            " photo" + (photos.length === 1 ? "" : "s") +
            " matching labels: " + labels.join(", ") + ".";
        } else {
          message = "Found " + shown.length + " photo" + (shown.length === 1 ? "" : "s") + ".";
        }

        setStatus(els.searchStatus, message, shown.length ? "success" : "");
        els.searchClear.hidden = false;
      })
      .catch(function (err) {
        els.resultsGrid.innerHTML = "";
        currentPhotos = [];
        els.resultsEmpty.classList.remove("hidden");
        els.resultsEmpty.querySelector("p").textContent = "Search failed.";
        els.resultsCount.textContent = "";
        setStatus(els.searchStatus, err.message, "error");
      })
      .finally(function () {
        els.searchButton.disabled = false;
      });
  }

  function clearSearch() {
    els.searchForm.reset();
    clearStatus(els.searchStatus);
    els.searchClear.hidden = true;
    els.resultsGrid.innerHTML = "";
    currentPhotos = [];
    els.resultsCount.textContent = "";
    els.resultsEmpty.classList.remove("hidden");
    els.resultsEmpty.innerHTML = emptyStateHtml; // restore the original hint
  }

  /* ------------------------------------------------------------------ *
   * Upload form — custom labels (chips)
   * ------------------------------------------------------------------ */

  var labels = [];

  // Snapshot of the empty-state markup, restored by clearSearch().
  var emptyStateHtml = els.resultsEmpty.innerHTML;

  function rememberLabels() {
    try {
      var known = JSON.parse(localStorage.getItem("photoApp.knownLabels") || "[]");
      labels.forEach(function (label) {
        if (known.indexOf(label) === -1) known.push(label);
      });
      localStorage.setItem("photoApp.knownLabels", JSON.stringify(known));
      renderSuggestions(known);
    } catch (err) { /* non-fatal */ }
  }

  function renderSuggestions(known) {
    els.labelSuggestions.innerHTML = known
      .map(function (label) { return '<option value="' + escapeHtml(label) + '">'; })
      .join("");
  }

  function renderChips() {
    els.labelChips.innerHTML = labels
      .map(function (label, index) {
        return (
          "<li>" + escapeHtml(label) +
          '<button type="button" data-index="' + index +
          '" aria-label="Remove label ' + escapeHtml(label) + '">&times;</button></li>'
        );
      })
      .join("");
  }

  function addLabel(rawValue) {
    String(rawValue || "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .forEach(function (label) {
        if (labels.indexOf(label) === -1) labels.push(label);
      });
    renderChips();
  }

  function removeLabel(index) {
    labels.splice(index, 1);
    renderChips();
  }

  function updatePreview() {
    var file = els.uploadFile.files && els.uploadFile.files[0];
    // Release the previous object URL so repeated selections don't leak memory.
    if (els.filePreviewImg.dataset.objectUrl) {
      URL.revokeObjectURL(els.filePreviewImg.dataset.objectUrl);
      delete els.filePreviewImg.dataset.objectUrl;
    }
    if (!file) {
      els.filePreview.hidden = true;
      els.filePreviewImg.removeAttribute("src");
      return;
    }
    els.filePreviewName.textContent =
      file.name + " (" + Math.max(1, Math.round(file.size / 1024)) + " KB)";
    var objectUrl = URL.createObjectURL(file);
    els.filePreviewImg.dataset.objectUrl = objectUrl;
    els.filePreviewImg.src = objectUrl;
    els.filePreview.hidden = false;
  }

  function doUpload(event) {
    if (event) event.preventDefault();

    var files = els.uploadFile.files;
    if (!files || !files.length) {
      setStatus(els.uploadStatus, "Choose at least one photo file.", "error");
      return;
    }
    if (!labels.length) {
      setStatus(els.uploadStatus, "Add at least one custom label.", "error");
      els.labelInput.focus();
      return;
    }

    els.uploadButton.disabled = true;
    setStatus(
      els.uploadStatus,
      "Uploading " + files.length + " file" + (files.length === 1 ? "" : "s") + "…",
      "loading"
    );

    // PUT each file sequentially so the backend isn't hit with N parallel writes.
    var chain = Promise.resolve();
    var uploaded = [];

    Array.prototype.forEach.call(files, function (file) {
      chain = chain.then(function () {
        return api.uploadPhoto(file, labels).then(function (response) {
          uploaded.push({ file: file.name, response: response });
        });
      });
    });

    chain
      .then(function () {
        // Snapshot before resetting: the form's reset handler clears both the
        // status line and the labels array.
        var summary = labels.join(", ");
        rememberLabels(); // must run before reset wipes `labels`
        els.uploadForm.reset();
        els.filePreview.hidden = true;
        setStatus(
          els.uploadStatus,
          "Uploaded " + uploaded.length + " photo" + (uploaded.length === 1 ? "" : "s") +
            " with labels: " + summary + ".",
          "success"
        );
      })
      .catch(function (err) {
        setStatus(
          els.uploadStatus,
          (uploaded.length ? uploaded.length + " succeeded before the error. " : "") + err.message,
          "error"
        );
      })
      .finally(function () {
        els.uploadButton.disabled = false;
      });
  }

  /* ------------------------------------------------------------------ *
   * Lightbox — click a photo card to view it large
   * ------------------------------------------------------------------ */

  function openLightbox(index) {
    var photo = currentPhotos[index];
    if (!photo) return;

    var url = photoUrl(photo);
    var caption = photoCaption(photo);
    var labels = photoLabels(photo);
    var id = photoId(photo);

    els.lightboxImg.classList.remove("failed");
    els.lightboxImg.src = url;
    els.lightboxImg.alt = caption;
    els.lightboxTitle.textContent = caption;
    els.lightboxChips.innerHTML = labels
      .map(function (label) { return '<li class="chip">' + escapeHtml(label) + "</li>"; })
      .join("");
    els.lightboxMeta.textContent = id !== "" ? "id: " + id : "";
    els.lightboxMeta.hidden = id === "";
    els.lightboxOpen.href = url || "#";
    els.lightboxOpen.hidden = !url;

    els.lightbox.hidden = false;
    els.lightboxClose.focus();
  }

  function closeLightbox() {
    if (els.lightbox.hidden) return;
    els.lightbox.hidden = true;
    els.lightboxImg.removeAttribute("src");
    els.lightboxTitle.textContent = "";
    els.lightboxChips.innerHTML = "";
  }

  /* ------------------------------------------------------------------ *
   * Dock controls: label filter toggle + upload modal
   * ------------------------------------------------------------------ */

  function toggleLabelsRow() {
    var open = els.labelsRow.hidden;
    els.labelsRow.hidden = !open;
    els.labelsToggle.classList.toggle("active", open);
    els.labelsToggle.setAttribute("aria-expanded", String(open));
    if (open) els.searchLabels.focus();
  }

  function openUploadModal() {
    els.uploadModal.hidden = false;
    clearStatus(els.uploadStatus);
    els.uploadFile.focus();
  }

  function closeUploadModal() {
    els.uploadModal.hidden = true;
    els.uploadOpen.focus();
  }

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */

  function init() {
    els.apiBaseLabel.textContent = config.apiBase;
    if (!config.apiKey) {
      els.apiIndicator.classList.add("no-key");
      els.apiIndicator.title =
        "No x-api-key configured — open with ?apiKey=YOUR_KEY if the gateway requires it";
    } else {
      els.apiIndicator.title = "API key configured (x-api-key)";
    }

    els.searchForm.addEventListener("submit", doSearch);
    els.searchClear.addEventListener("click", clearSearch);

    els.labelsToggle.addEventListener("click", toggleLabelsRow);
    els.uploadOpen.addEventListener("click", openUploadModal);
    els.uploadClose.addEventListener("click", closeUploadModal);

    els.uploadModal.addEventListener("click", function (event) {
      if (event.target === els.uploadModal) closeUploadModal(); // backdrop click
    });

    // Lightbox: open from a card (click or keyboard), close via X / backdrop / Esc.
    els.resultsGrid.addEventListener("click", function (event) {
      var card = event.target.closest(".photo-card");
      if (card) openLightbox(Number(card.getAttribute("data-index")));
    });

    els.resultsGrid.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var card = event.target.closest(".photo-card");
      if (card) {
        event.preventDefault();
        openLightbox(Number(card.getAttribute("data-index")));
      }
    });

    els.lightboxClose.addEventListener("click", closeLightbox);
    els.lightbox.addEventListener("click", function (event) {
      if (event.target === els.lightbox) closeLightbox(); // backdrop click
    });
    els.lightboxImg.addEventListener("error", function () {
      els.lightboxImg.classList.add("failed");
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (!els.lightbox.hidden) closeLightbox();
      else if (!els.uploadModal.hidden) closeUploadModal();
    });

    els.uploadForm.addEventListener("submit", doUpload);
    els.uploadForm.addEventListener("reset", function () {
      labels = [];
      renderChips();
      clearStatus(els.uploadStatus);
      setTimeout(function () { els.filePreview.hidden = true; }, 0);
    });

    els.uploadFile.addEventListener("change", updatePreview);

    els.labelAdd.addEventListener("click", function () {
      addLabel(els.labelInput.value);
      els.labelInput.value = "";
      els.labelInput.focus();
    });

    els.labelInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        addLabel(els.labelInput.value);
        els.labelInput.value = "";
      } else if (event.key === "Backspace" && !els.labelInput.value && labels.length) {
        removeLabel(labels.length - 1);
      }
    });

    els.labelChips.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-index]");
      if (button) removeLabel(Number(button.getAttribute("data-index")));
    });

    // Show previously used labels as suggestions.
    try {
      renderSuggestions(JSON.parse(localStorage.getItem("photoApp.knownLabels") || "[]"));
    } catch (err) { /* ignore */ }
  }

  init();
})();
