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
    labelSuggestions: $("label-suggestions")
  };

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

    if (!photos.length) {
      els.resultsEmpty.classList.remove("hidden");
      els.resultsEmpty.querySelector("p").textContent = "No photos matched your search.";
      els.resultsCount.textContent = "";
      return;
    }

    els.resultsEmpty.classList.add("hidden");
    els.resultsCount.textContent = photos.length + (photos.length === 1 ? " photo" : " photos");

    var cards = photos.map(function (photo) {
      var url = photoUrl(photo);
      var labels = photoLabels(photo);
      var chips = labels
        .map(function (label) { return '<li class="chip">' + escapeHtml(label) + "</li>"; })
        .join("");
      var id = photoId(photo);

      return (
        '<article class="photo-card">' +
        (url
          ? '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(photoCaption(photo)) +
            '" loading="lazy" onerror="this.style.visibility=\'hidden\'" />'
          : '<img alt="" />') +
        '<div class="photo-body">' +
        '<p class="photo-caption">' + escapeHtml(photoCaption(photo)) + "</p>" +
        (chips ? '<ul class="chips">' + chips + "</ul>" : "") +
        (id !== "" ? '<p class="photo-meta">id: ' + escapeHtml(id) + "</p>" : "") +
        "</div></article>"
      );
    });

    els.resultsGrid.innerHTML = cards.join("");
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
      .searchPhotos({ query: query, labels: labels })
      .then(function (photos) {
        renderResults(photos);
        setStatus(
          els.searchStatus,
          photos.length
            ? "Found " + photos.length + " photo" + (photos.length === 1 ? "" : "s") + "."
            : "No photos matched your search.",
          photos.length ? "success" : ""
        );
        els.searchClear.hidden = false;
      })
      .catch(function (err) {
        els.resultsGrid.innerHTML = "";
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
    els.resultsCount.textContent = "";
    els.resultsEmpty.classList.remove("hidden");
    els.resultsEmpty.querySelector("p").textContent = "Run a search to see photos here.";
  }

  /* ------------------------------------------------------------------ *
   * Upload form — custom labels (chips)
   * ------------------------------------------------------------------ */

  var labels = [];

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
    if (!file) {
      els.filePreview.hidden = true;
      els.filePreviewImg.removeAttribute("src");
      return;
    }
    els.filePreviewName.textContent =
      file.name + " (" + Math.max(1, Math.round(file.size / 1024)) + " KB)";
    els.filePreviewImg.src = URL.createObjectURL(file);
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
        setStatus(
          els.uploadStatus,
          "Uploaded " + uploaded.length + " photo" + (uploaded.length === 1 ? "" : "s") +
            " with labels: " + labels.join(", ") + ".",
          "success"
        );
        rememberLabels();
        els.uploadForm.reset();
        labels = [];
        renderChips();
        els.filePreview.hidden = true;
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
   * Init
   * ------------------------------------------------------------------ */

  function init() {
    els.apiBaseLabel.textContent = config.apiBase;

    els.searchForm.addEventListener("submit", doSearch);
    els.searchClear.addEventListener("click", clearSearch);

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
