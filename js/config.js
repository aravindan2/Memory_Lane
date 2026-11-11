/**
 * Central configuration for the photo search & upload frontend.
 *
 * Everything the app "assumes" about the backend lives here, so you can
 * re-wire it to the real API later without touching the UI code.
 *
 * Overrides (highest priority first):
 *   1. URL query parameter:   ?apiBase=http://localhost:8000
 *   2. localStorage key "photoApp.config", e.g.
 *        localStorage.setItem("photoApp.config",
 *          JSON.stringify({ apiBase: "http://localhost:8000" }))
 *   3. The defaults below.
 */
(function () {
  "use strict";

  var DEFAULTS = {
    // Where the backend lives (no trailing slash).
    apiBase: "http://localhost:5000",

    // Endpoint paths, relative to apiBase.
    endpoints: {
      search: "/search", // GET
      upload: "/photos" // PUT
    },

    // How to serialize a search request.
    // key = what the UI produces, value = query-param name sent on the wire.
    searchParams: {
      query: "q", // ?q=<text>
      labels: "labels" // ?labels=a,b   (omit the param when empty)
    },

    // How to serialize an upload request (multipart/form-data).
    upload: {
      fileField: "file", // FormData key for the binary
      labelsField: "label", // FormData key repeated once per label
      method: "PUT"
    },

    // Request timeout in milliseconds.
    timeoutMs: 15000,

    // If true, relative URLs in search results (e.g. "/photos/1.jpg")
    // are resolved against apiBase. Absolute URLs are always left alone.
    resolveRelativeUrls: true
  };

  /** Shallow-merge a plain object into the defaults. */
  function merge(target, source) {
    if (!source) return target;
    Object.keys(source).forEach(function (key) {
      var value = source[key];
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        target[key] &&
        typeof target[key] === "object"
      ) {
        merge(target[key], value);
      } else if (value !== undefined && value !== null) {
        target[key] = value;
      }
    });
    return target;
  }

  var config = merge({}, DEFAULTS);

  // localStorage override
  try {
    var stored = window.localStorage.getItem("photoApp.config");
    if (stored) merge(config, JSON.parse(stored));
  } catch (err) {
    console.warn("[config] ignoring invalid localStorage config:", err);
  }

  // URL parameter override
  var params = new URLSearchParams(window.location.search);
  if (params.get("apiBase")) config.apiBase = params.get("apiBase");
  if (params.get("apiBase")) config.apiBase = params.get("apiBase").replace(/\/+$/, "");

  // Normalize: strip trailing slashes from apiBase
  config.apiBase = String(config.apiBase).replace(/\/+$/, "");

  window.APP_CONFIG = config;
})();
