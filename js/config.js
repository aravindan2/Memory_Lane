/**
 * Central configuration for the Memory Lane photo frontend.
 *
 * Every assumption about the backend lives here, taken from the API Gateway
 * spec committed at docs/swagger.json:
 *
 *   GET  https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/search?q=...
 *   PUT  https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/photos?filename=...
 *        headers: x-api-key            (gateway security)
 *                 x-amz-meta-customLabels   (comma-separated custom labels)
 *                 Content-Type         (the image's MIME type)
 *        body:    raw image bytes
 *
 * Overrides (highest priority first):
 *   1. URL query parameters:  ?apiBase=http://localhost:5000&apiKey=abc123
 *   2. localStorage key "photoApp.config", e.g.
 *        localStorage.setItem("photoApp.config",
 *          JSON.stringify({ apiBase: "http://localhost:5000", apiKey: "abc123" }))
 *   3. The defaults below.
 */
(function () {
  "use strict";

  var DEFAULTS = {
    // API Gateway stage URL from docs/swagger.json (no trailing slash).
    apiBase: "https://oi25a7sswf.execute-api.us-east-1.amazonaws.com/dev",

    // Value for the x-api-key header (gateway security). Leave empty for a
    // local backend without API-key auth. Never commit a real key.
    apiKey: "",

    // Endpoint paths, relative to apiBase.
    endpoints: {
      search: "/search", // GET
      upload: "/photos" // PUT
    },

    // How to serialize a search request.
    // key = what the UI produces, value = query-param name sent on the wire.
    // The gateway only documents ?q=, so label filtering happens client-side
    // (see filterByLabels in js/app.js).
    searchParams: {
      query: "q"
    },

    // How to serialize an upload request: raw bytes + filename query param +
    // custom labels in a metadata header (matches the gateway + S3 metadata
    // read by backend/index_photos/lambda_function.py).
    upload: {
      method: "PUT",
      filenameParam: "filename", // ?filename=<original name>
      labelsHeader: "x-amz-meta-customLabels", // comma-joined, omitted when empty
      useFileContentType: true // send the file's MIME type as Content-Type
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

  // URL parameter overrides
  var params = new URLSearchParams(window.location.search);
  if (params.get("apiBase")) config.apiBase = params.get("apiBase");
  if (params.get("apiKey")) config.apiKey = params.get("apiKey");

  // Normalize: strip trailing slashes from apiBase
  config.apiBase = String(config.apiBase).replace(/\/+$/, "");

  window.APP_CONFIG = config;
})();
