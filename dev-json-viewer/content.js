/**
 * content.js
 * Injected into every page. Detects if the current page is a raw JSON response
 * and, if so, replaces the page content with the Dev JSON Viewer interface.
 */

(function () {
  "use strict";

  /**
   * Check if this page is a raw JSON document.
   * Handles both Content-Type detection and body heuristics.
   */
  function isJsonPage() {
    const ct = document.contentType || "";

    // Explicit JSON content type
    if (ct.includes("application/json") || ct.includes("text/json")) {
      return true;
    }

    // Some servers return plain text but the body is valid JSON
    // Only try this on pages whose <body> contains just a <pre> (typical browser JSON display)
    if (ct.includes("text/plain") || ct === "") {
      const body = document.body;
      if (!body) return false;

      // The browser wraps raw text/JSON in a <pre> tag
      const pre = body.querySelector("pre");
      if (pre && body.children.length === 1) {
        const text = pre.textContent.trim();
        return (text.startsWith("{") || text.startsWith("["));
      }
    }

    return false;
  }

  /**
   * Extract the raw JSON string from the page.
   */
  function extractJson() {
    const pre = document.body.querySelector("pre");
    if (pre) return pre.textContent;
    return document.body.innerText;
  }

  /**
   * Parse and validate JSON, return parsed object or null on failure.
   */
  function parseJson(raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /**
   * Replace the current page with the JSON viewer iframe.
   * We inject an iframe that loads viewer.html (a web-accessible resource)
   * and communicate the JSON data via postMessage.
   */
  function injectViewer(rawJson) {
    // Prevent default browser rendering without using deprecated document.write
    document.documentElement.innerHTML = "<!DOCTYPE html><html><head></head><body></body></html>";

    // Apply reset styles to the host page
    document.documentElement.style.cssText =
      "margin:0;padding:0;width:100%;height:100%;overflow:hidden;";
    document.body.style.cssText =
      "margin:0;padding:0;width:100%;height:100%;overflow:hidden;";

    // Create full-page iframe pointing to viewer.html.
    // allow="clipboard-write" is required so the Permissions Policy
    // grants the async Clipboard API access inside the frame.
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("viewer.html");
    iframe.style.cssText = "width:100%;height:100vh;border:none;display:block;";
    iframe.setAttribute("id", "json-forge-frame");
    iframe.setAttribute("allow", "clipboard-write");
    document.body.appendChild(iframe);

    // Once iframe is ready, send it the JSON payload
    iframe.addEventListener("load", function () {
      iframe.contentWindow.postMessage(
        {
          type: "JSON_FORGE_DATA",
          raw: rawJson,
          url: window.location.href,
        },
        "*"
      );
    });
  }

  /**
   * Main entry point – runs at document_start.
   * We wait for DOMContentLoaded so the <pre> tag is available.
   */
  function main() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }

  function run() {
    if (!isJsonPage()) return;

    const raw = extractJson();
    if (!raw) return;

    if (parseJson(raw.trim()) === null) return; // not valid JSON, leave page alone

    injectViewer(raw.trim());
  }

  main();
})();
