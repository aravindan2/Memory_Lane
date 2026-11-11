/**
 * Thin API client for the Memory Lane backend (see docs/swagger.json).
 *
 * GET  /search?q=<text>
 *      -> searchPhotos({ query })
 *
 * PUT  /photos?filename=<name>          (raw image bytes in the body)
 *      headers: x-api-key, x-amz-meta-customLabels, Content-Type
 *      -> uploadPhoto(file, labels)
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

  /** Headers applied to every request (gateway API key, when configured). */
  function withAuthHeaders(headers) {
    var out = Object.assign({}, headers || {});
    if (config.apiKey) out["x-api-key"] = config.apiKey;
    return out;
  }

  /**
   * fetch() wrapper: adds timeout, API key and turns non-2xx responses into
   * ApiError with a hint when the API key is missing.
   * @returns {Promise<Response>}
   */
  function request(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, config.timeoutMs);

    var opts = Object.assign({ signal: controller.signal }, options || {});
    opts.headers = withAuthHeaders(opts.headers);

    return fetch(url, opts)
      .then(function (res) {
        if (!res.ok) {
          return res
            .text()
            .catch(function () {})
            .then(function (body) {
              var detail = body ? " — " + body.slice(0, 300) : "";
              var message =
                "Request failed (" + res.status + " " + res.statusText + ")" + detail;
              if ((res.status === 401 || res.status === 403) && !config.apiKey) {
                message +=
                  " · The API Gateway requires an x-api-key — open the page with" +
                  " ?apiKey=YOUR_KEY or set it in js/config.js";
              }
              throw new ApiError(message, res.status);
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
          "Network error — is the backend reachable at " + config.apiBase + "? (" + err.message + ")",
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
   * Accepts: [...] | { results: [...] } | { photos: [...] } | { items: [...] } |
   *          { data: [...] } | Elasticsearch-style { hits: { hits: [{ _source }] } }
   */
  function normalizeResults(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      // Elasticsearch / OpenSearch search response
      if (payload.hits && Array.isArray(payload.hits.hits)) {
        return payload.hits.hits.map(function (hit) {
          return hit._source || hit;
        });
      }
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
   * GET /search?q=<text>
   * @param {{query?: string}} criteria
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
   * PUT /photos?filename=<name>  — raw bytes, labels in a metadata header.
   * @param {File|Blob} file
   * @param {string[]} labels  one or more custom labels
   * @returns {Promise<object|null>} parsed JSON response, or null for empty bodies
   */
  function uploadPhoto(file, labels) {
    var filename = file.name || "upload";
    var url =
      endpoint("upload") +
      "?" +
      encodeURIComponent(config.upload.filenameParam) +
      "=" +
      encodeURIComponent(filename);

    var headers = { Accept: "application/json" };
    if (config.upload.useFileContentType && file.type) {
      headers["Content-Type"] = file.type;
    }
    var labelList = (labels || [])
      .map(function (label) { return String(label).trim(); })
      .filter(Boolean);
    if (labelList.length) {
      headers[config.upload.labelsHeader] = labelList.join(",");
    }

    return request(url, {
      method: config.upload.method,
      body: file, // raw image bytes
      headers: headers
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
