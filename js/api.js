/**
 * Thin API client for the photo backend.
 *
 * GET  /search   -> searchPhotos({ query, labels })
 * PUT  /photos   -> uploadPhoto(file, labels)
 *
 * The wire format is driven entirely by window.APP_CONFIG (js/config.js).
 */
(function () {
  "use strict";

  var config = window.APP_CONFIG;

  /** Error carrying the HTTP status, if any. */
  function ApiError(message, status) {
    this.name = "ApiError";
    this.message = message;
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function endpoint(name) {
    return config.apiBase + config.endpoints[name];
  }

  /**
   * fetch() wrapper: adds timeout and turns non-2xx responses into ApiError.
   * @returns {Promise<Response>}
   */
  function request(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, config.timeoutMs);

    var opts = Object.assign({ signal: controller.signal }, options || {});

    return fetch(url, opts)
      .then(function (res) {
        if (!res.ok) {
          return res
            .text()
            .catch(function () {})
            .then(function (body) {
              var detail = body ? " — " + body.slice(0, 300) : "";
              throw new ApiError(
                "Request failed (" + res.status + " " + res.statusText + ")" + detail,
                res.status
              );
            });
        }
        return res;
      })
      .catch(function (err) {
        if (err.name === "AbortError") {
          throw new ApiError("Request timed out after " + config.timeoutMs + " ms", 0);
        }
        if (err instanceof ApiError) throw err;
        throw new ApiError(
          "Network error — is the backend running at " + config.apiBase + "? (" + err.message + ")",
          0
        );
      })
      .finally(function () {
        clearTimeout(timer);
      });
  }

  /**
   * Build the query string for GET /search from the config's param mapping.
   * Empty values are skipped so optional params are omitted entirely.
   */
  function buildSearchQueryString(criteria) {
    var mapping = config.searchParams;
    var parts = [];
    Object.keys(mapping).forEach(function (key) {
      var value = criteria[key];
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) value = value.join(",");
      value = String(value).trim();
      if (!value) return;
      parts.push(
        encodeURIComponent(mapping[key]) + "=" + encodeURIComponent(value)
      );
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  /**
   * Normalize a search response into an array of photo records.
   * Accepts: [...] | { results: [...] } | { photos: [...] } |
   *          { items: [...] } | { data: [...] }
   */
  function normalizeResults(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      var keys = ["results", "photos", "items", "data"];
      for (var i = 0; i < keys.length; i++) {
        if (Array.isArray(payload[keys[i]])) return payload[keys[i]];
      }
    }
    return [];
  }

  /** Resolve a possibly-relative image URL against the API base. */
  function resolveUrl(url) {
    if (!url || typeof url !== "string") return "";
    if (/^(https?:)?\/\//i.test(url) || /^(blob|data):/i.test(url)) return url;
    if (!config.resolveRelativeUrls) return url;
    return url.charAt(0) === "/" ? config.apiBase + url : config.apiBase + "/" + url;
  }

  /**
   * GET /search?q=<query>&labels=<a,b>
   * @param {{query?: string, labels?: string[]|string}} criteria
   * @returns {Promise<Array<object>>} normalized photo records
   */
  function searchPhotos(criteria) {
    var url = endpoint("search") + buildSearchQueryString(criteria || {});
    return request(url, { method: "GET", headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.json().catch(function () {
          throw new ApiError("Backend returned a non-JSON response for " + url, res.status);
        });
      })
      .then(normalizeResults);
  }

  /**
   * PUT /photos  (multipart/form-data)
   * @param {File|Blob} file
   * @param {string[]} labels  one or more custom labels
   * @returns {Promise<object|null>} parsed JSON response, or null for empty bodies
   */
  function uploadPhoto(file, labels) {
    var form = new FormData();
    form.append(config.upload.fileField, file, file.name || "upload");
    (labels || []).forEach(function (label) {
      label = String(label).trim();
      if (label) form.append(config.upload.labelsField, label);
    });

    return request(endpoint("upload"), {
      method: config.upload.method,
      body: form,
      headers: { Accept: "application/json" } // let the browser set Content-Type + boundary
    }).then(function (res) {
      if (res.status === 204) return null;
      return res
        .text()
        .then(function (text) {
          if (!text) return null;
          try {
            return JSON.parse(text);
          } catch (err) {
            return { raw: text };
          }
        });
    });
  }

  window.PhotoApi = {
    ApiError: ApiError,
    searchPhotos: searchPhotos,
    uploadPhoto: uploadPhoto,
    normalizeResults: normalizeResults,
    resolveUrl: resolveUrl,
    buildSearchQueryString: buildSearchQueryString
  };
})();
