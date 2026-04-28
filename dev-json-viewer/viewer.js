/**
 * viewer.js — JSON Forge v1.1
 *
 * Responsibilities:
 *  1.  Receive JSON data from content.js via postMessage
 *  2.  Build a collapsible, syntax-highlighted tree
 *  3.  Raw / Tree view toggle
 *  4.  Per-row inline copy button (on hover)
 *  5.  Search with highlight & keyboard navigation
 *  6.  Expand all / Collapse all / Collapse-to-depth
 *  7.  Copy JSON / Download JSON / Copy URL
 *  8.  Right-click context menu (copy value, path, subtree, expand/collapse node)
 *  9.  Status bar — shows hovered node's JSONPath + type
 *  10. Dark / Light theme toggle (persisted in localStorage)
 *  11. Keyboard shortcuts: Ctrl+F, Ctrl+E, Ctrl+Shift+E
 */

(function () {
  "use strict";

  // ── State ────────────────────────────────────────────────────────────────
  let rawJson    = "";
  let parsedJson = null;
  let isDarkTheme  = true;
  let isRawView    = false;

  // Search
  let searchMatches = [];
  let searchCursor  = -1;

  // Context menu
  let ctxTargetNode = null;   // { path, value, type, childrenEl? }

  // ── DOM Refs ─────────────────────────────────────────────────────────────
  const body           = document.body;
  const jsonTree       = document.getElementById("json-tree");
  const jsonStats      = document.getElementById("json-stats");
  const urlText        = document.getElementById("url-text");
  const btnCopyUrl     = document.getElementById("btn-copy-url");
  const searchInput    = document.getElementById("search-input");
  const searchCount    = document.getElementById("search-count");
  const searchPrev     = document.getElementById("search-prev");
  const searchNext     = document.getElementById("search-next");
  const searchClear    = document.getElementById("search-clear");
  const btnExpandAll   = document.getElementById("btn-expand-all");
  const btnCollapseAll = document.getElementById("btn-collapse-all");
  const collapseDepth  = document.getElementById("collapse-depth");
  const btnRaw         = document.getElementById("btn-raw");
  const btnCopyJson    = document.getElementById("btn-copy-json");
  const btnDownload    = document.getElementById("btn-download");
  const btnTheme       = document.getElementById("btn-theme");
  const iconMoon       = document.getElementById("icon-moon");
  const iconSun        = document.getElementById("icon-sun");
  const toast          = document.getElementById("toast");
  const contextMenu    = document.getElementById("context-menu");
  const ctxCopyValue   = document.getElementById("ctx-copy-value");
  const ctxCopyPath    = document.getElementById("ctx-copy-path");
  const ctxCopySubtree = document.getElementById("ctx-copy-subtree");
  const ctxExpandNode  = document.getElementById("ctx-expand-node");
  const ctxCollapseNode= document.getElementById("ctx-collapse-node");
  const jsonContainer  = document.getElementById("json-container");
  const rawContainer   = document.getElementById("raw-container");
  const rawOutput      = document.getElementById("raw-output");
  const statusPath     = document.getElementById("status-path");
  const statusType     = document.getElementById("status-type");

  // ── postMessage from content.js ──────────────────────────────────────────
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "JSON_FORGE_DATA") {
      rawJson = e.data.raw;
      urlText.textContent = e.data.url || "";
      init(rawJson);
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  function init(raw) {
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      jsonTree.innerHTML =
        `<div style="color:var(--color-boolean);padding:24px;font-size:13px">
           <strong>Invalid JSON</strong><br/><br/>${escapeHtml(err.message)}
         </div>`;
      return;
    }

    // Populate stats badge
    const byteSize = new TextEncoder().encode(raw).length;
    const keyCount = countKeys(parsedJson);
    const depth    = calcDepth(parsedJson);
    jsonStats.textContent = `${keyCount} keys · ${formatBytes(byteSize)} · depth ${depth}`;
    jsonStats.title = `Keys: ${keyCount} · Bytes: ${byteSize} · Max depth: ${depth}`;

    // Populate raw view
    rawOutput.textContent = JSON.stringify(parsedJson, null, 2);

    // Build tree
    jsonTree.innerHTML = "";
    jsonTree.appendChild(buildNode(parsedJson, null, null, true));
  }

  // ── Tree Builder ─────────────────────────────────────────────────────────

  /**
   * Recursively build a .json-node element.
   *
   * @param {*}       value   - JSON value
   * @param {string|number|null} key - parent key / array index / null for root
   * @param {string|null}  parentPath - JSONPath of the parent
   * @param {boolean} isRoot
   * @param {boolean} isLast - no trailing comma when true
   * @returns {HTMLElement}
   */
  function buildNode(value, key, parentPath, isRoot = false, isLast = true) {
    const nodeEl = document.createElement("div");
    nodeEl.className = "json-node";
    const type = getType(value);

    if (type === "object" || type === "array") {
      buildComplexNode(nodeEl, value, key, parentPath, isRoot, isLast, type);
    } else {
      buildLeafNode(nodeEl, value, key, parentPath, isLast, type);
    }
    return nodeEl;
  }

  /** Object or Array node with toggle arrow */
  function buildComplexNode(nodeEl, value, key, parentPath, _isRoot, isLast, type) {
    const isArray      = type === "array";
    const count        = isArray ? value.length : Object.keys(value).length;
    const openBracket  = isArray ? "[" : "{";
    const closeBracket = isArray ? "]" : "}";
    const nodePath     = buildPath(parentPath, key);

    // ── Opening row ───────────────────────────────────────────────────────
    const rowEl = document.createElement("div");
    rowEl.className  = "json-row";
    rowEl.dataset.path = nodePath;
    rowEl.dataset.type = type;

    // Toggle arrow
    const arrow = document.createElement("span");
    arrow.className = "toggle-arrow expanded";
    arrow.innerHTML = `<svg width="8" height="10" viewBox="0 0 8 10">
      <path d="M1 1l6 4-6 4" stroke="currentColor" stroke-width="1.8"
            fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    arrow.title = "Collapse";

    // Key / index label
    if (key !== null && !Number.isInteger(key)) {
      rowEl.appendChild(arrow);
      rowEl.appendChild(span("jv-key", `"${escapeHtml(String(key))}"`));
      rowEl.appendChild(span("jv-colon", ":"));
    } else if (Number.isInteger(key)) {
      rowEl.appendChild(arrow);
      rowEl.appendChild(span("jv-index", String(key) + " "));
    } else {
      rowEl.appendChild(arrow);
    }

    // Empty object/array — inline, no children needed
    if (count === 0) {
      rowEl.appendChild(span("jv-bracket", isArray ? "[]" : "{}"));
      if (!isLast) rowEl.appendChild(span("jv-comma", ","));
      addRowCopyBtn(rowEl, value);
      addHoverStatus(rowEl, nodePath, type);
      nodeEl.appendChild(rowEl);
      return;
    }

    // Opening bracket + collapsed preview
    rowEl.appendChild(span("jv-bracket", openBracket));

    const preview = document.createElement("span");
    preview.className    = "jv-preview";
    preview.textContent  = isArray
      ? `… ${count} item${count !== 1 ? "s" : ""}`
      : `… ${count} key${count !== 1 ? "s" : ""}`;
    preview.style.display = "none";
    rowEl.appendChild(preview);

    // Trailing comma only shown when collapsed
    const inlineComma = span("jv-comma", ",");
    inlineComma.style.display = "none";
    if (!isLast) rowEl.appendChild(inlineComma);

    addRowCopyBtn(rowEl, value);
    addHoverStatus(rowEl, nodePath, type);
    nodeEl.appendChild(rowEl);

    // ── Children ──────────────────────────────────────────────────────────
    const childrenEl = document.createElement("div");
    childrenEl.className = "json-children";
    childrenEl.dataset.depth = String(getNodeDepth(nodeEl));

    if (isArray) {
      value.forEach((item, i) => {
        childrenEl.appendChild(
          buildNode(item, i, nodePath, false, i === value.length - 1)
        );
      });
    } else {
      const keys = Object.keys(value);
      keys.forEach((k, i) => {
        childrenEl.appendChild(
          buildNode(value[k], k, nodePath, false, i === keys.length - 1)
        );
      });
    }
    nodeEl.appendChild(childrenEl);

    // ── Closing bracket row ───────────────────────────────────────────────
    const closingRow = document.createElement("div");
    closingRow.className = "json-closing-row";
    closingRow.appendChild(span("jv-bracket", closeBracket));
    if (!isLast) closingRow.appendChild(span("jv-comma", ","));
    nodeEl.appendChild(closingRow);

    // ── Wire toggle ───────────────────────────────────────────────────────
    arrow.addEventListener("click", function (e) {
      e.stopPropagation();
      collapseNode(childrenEl, arrow, preview, closingRow, inlineComma, isLast);
    });

    // ── Context menu ──────────────────────────────────────────────────────
    rowEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      ctxTargetNode = { path: nodePath, value, type, childrenEl, arrow, preview, closingRow, inlineComma, isLast };
      showContextMenu(e.clientX, e.clientY);
    });
  }

  /** Leaf node (string, number, boolean, null) */
  function buildLeafNode(nodeEl, value, key, parentPath, isLast, type) {
    const nodePath = buildPath(parentPath, key);

    const rowEl = document.createElement("div");
    rowEl.className    = "json-row";
    rowEl.dataset.path = nodePath;
    rowEl.dataset.type = type;

    rowEl.appendChild(createEl("span", "toggle-spacer", ""));

    if (key !== null && !Number.isInteger(key)) {
      rowEl.appendChild(span("jv-key", `"${escapeHtml(String(key))}"`));
      rowEl.appendChild(span("jv-colon", ":"));
    } else if (Number.isInteger(key)) {
      rowEl.appendChild(span("jv-index", String(key) + " "));
    }

    rowEl.appendChild(renderValue(value, type));
    if (!isLast) rowEl.appendChild(span("jv-comma", ","));

    addRowCopyBtn(rowEl, value);
    addHoverStatus(rowEl, nodePath, type);

    nodeEl.appendChild(rowEl);

    rowEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      ctxTargetNode = { path: nodePath, value, type, childrenEl: null };
      showContextMenu(e.clientX, e.clientY);
    });
  }

  /** Append a small inline copy button to a row */
  function addRowCopyBtn(rowEl, value) {
    const btn = document.createElement("button");
    btn.className = "row-copy-btn";
    btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
            stroke="currentColor" stroke-width="2"/>
    </svg> copy`;
    btn.title = "Copy value";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const out = typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : String(value);
      copyToClipboard(out, "Copied!");
    });
    rowEl.appendChild(btn);
  }

  /** Wire mouseenter/leave to update the status bar */
  function addHoverStatus(rowEl, path, type) {
    rowEl.addEventListener("mouseenter", () => {
      statusPath.textContent = path;
      statusType.textContent = type;
      statusType.classList.add("visible");
    });
    rowEl.addEventListener("mouseleave", () => {
      statusPath.textContent = "Hover a node to see its path";
      statusType.classList.remove("visible");
    });
  }

  /** Collapse / expand a single complex node */
  function collapseNode(childrenEl, arrow, preview, closingRow, inlineComma, isLast) {
    const collapsing = !childrenEl.classList.contains("collapsed");
    childrenEl.classList.toggle("collapsed", collapsing);
    closingRow.style.display  = collapsing ? "none" : "";
    preview.style.display     = collapsing ? ""     : "none";
    if (isLast === false) inlineComma.style.display = collapsing ? "" : "none";
    arrow.classList.toggle("expanded", !collapsing);
    arrow.title = collapsing ? "Expand" : "Collapse";
  }

  /** Render a leaf value span */
  function renderValue(value, type) {
    switch (type) {
      case "string":  return span("jv-string",  `"${escapeHtml(value)}"`);
      case "number":  return span("jv-number",  String(value));
      case "boolean": return span("jv-boolean", String(value));
      case "null":    return span("jv-null",    "null");
      default:        return span("",           escapeHtml(String(value)));
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function span(cls, text) { return createEl("span", cls, text); }

  function createEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls)  el.className   = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function getType(v) {
    if (v === null)        return "null";
    if (Array.isArray(v)) return "array";
    return typeof v;
  }

  function buildPath(parent, key) {
    if (parent === null) return "$";
    if (key === null || key === undefined) return parent;
    if (Number.isInteger(key)) return `${parent}[${key}]`;
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) return `${parent}.${key}`;
    return `${parent}["${key}"]`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function countKeys(obj) {
    if (obj === null || typeof obj !== "object") return 1;
    let n = 0;
    if (Array.isArray(obj)) {
      obj.forEach(v => { n += countKeys(v); });
    } else {
      Object.values(obj).forEach(v => {
        n += 1 + (v !== null && typeof v === "object" ? countKeys(v) : 0);
      });
    }
    return n;
  }

  function calcDepth(obj) {
    if (obj === null || typeof obj !== "object") return 0;
    const children = Array.isArray(obj) ? obj : Object.values(obj);
    return 1 + Math.max(0, ...children.map(calcDepth));
  }

  /** Get the nesting depth of a DOM node by counting ancestor .json-children */
  function getNodeDepth(el) {
    let d = 0, p = el.parentElement;
    while (p) {
      if (p.classList.contains("json-children")) d++;
      p = p.parentElement;
    }
    return d;
  }

  function formatBytes(b) {
    if (b < 1024)          return `${b} B`;
    if (b < 1024 * 1024)   return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  // ── Expand / Collapse helpers ─────────────────────────────────────────────

  /** Expand or collapse every .json-children in `root` */
  function setAllCollapsed(root, collapse) {
    root.querySelectorAll(".json-children").forEach(childrenEl => {
      const node        = childrenEl.closest(".json-node");
      if (!node) return;
      const arrow       = node.querySelector(":scope > .json-row .toggle-arrow");
      const preview     = node.querySelector(":scope > .json-row .jv-preview");
      const closingRow  = node.querySelector(":scope > .json-closing-row");
      const inlineComma = node.querySelector(":scope > .json-row .jv-comma");

      childrenEl.classList.toggle("collapsed", collapse);
      if (closingRow)  closingRow.style.display  = collapse ? "none" : "";
      if (preview)     preview.style.display     = collapse ? ""     : "none";
      if (inlineComma) inlineComma.style.display = collapse ? ""     : "none";
      if (arrow) {
        arrow.classList.toggle("expanded", !collapse);
        arrow.title = collapse ? "Expand" : "Collapse";
      }
    });
  }

  /** Collapse everything beyond a given depth level */
  function collapseToDepth(maxDepth) {
    document.querySelectorAll(".json-children").forEach(childrenEl => {
      // Count how deep this element sits in the tree
      let depth = 0, p = childrenEl.parentElement;
      while (p && p !== jsonTree) {
        if (p.classList.contains("json-children")) depth++;
        p = p.parentElement;
      }

      const shouldCollapse = depth >= maxDepth;
      const node       = childrenEl.closest(".json-node");
      if (!node) return;
      const arrow      = node.querySelector(":scope > .json-row .toggle-arrow");
      const preview    = node.querySelector(":scope > .json-row .jv-preview");
      const closingRow = node.querySelector(":scope > .json-closing-row");
      const inlineComma= node.querySelector(":scope > .json-row .jv-comma");

      childrenEl.classList.toggle("collapsed", shouldCollapse);
      if (closingRow)  closingRow.style.display  = shouldCollapse ? "none" : "";
      if (preview)     preview.style.display     = shouldCollapse ? ""     : "none";
      if (inlineComma) inlineComma.style.display = shouldCollapse ? ""     : "none";
      if (arrow) {
        arrow.classList.toggle("expanded", !shouldCollapse);
        arrow.title = shouldCollapse ? "Expand" : "Collapse";
      }
    });
  }

  /** Expand all ancestors of `el` so it is visible */
  function expandAncestors(el) {
    let p = el.parentElement;
    while (p && p !== jsonTree) {
      if (p.classList.contains("json-children") && p.classList.contains("collapsed")) {
        const node       = p.closest(".json-node");
        const arrow      = node?.querySelector(":scope > .json-row .toggle-arrow");
        const preview    = node?.querySelector(":scope > .json-row .jv-preview");
        const closingRow = node?.querySelector(":scope > .json-closing-row");
        const inlineComma= node?.querySelector(":scope > .json-row .jv-comma");
        p.classList.remove("collapsed");
        if (closingRow)  closingRow.style.display  = "";
        if (preview)     preview.style.display     = "none";
        if (inlineComma) inlineComma.style.display = "none";
        if (arrow) { arrow.classList.add("expanded"); arrow.title = "Collapse"; }
      }
      p = p.parentElement;
    }
  }

  // ── Toolbar: Expand / Collapse All ───────────────────────────────────────
  btnExpandAll.addEventListener("click", () => setAllCollapsed(document, false));
  btnCollapseAll.addEventListener("click", () => setAllCollapsed(document, true));

  collapseDepth.addEventListener("change", function () {
    const d = parseInt(this.value, 10);
    if (!isNaN(d)) {
      // First expand all, then collapse beyond chosen depth
      setAllCollapsed(document, false);
      collapseToDepth(d);
    }
    this.value = ""; // reset dropdown
  });

  // ── Toolbar: Raw / Tree Toggle ───────────────────────────────────────────
  btnRaw.addEventListener("click", function () {
    isRawView = !isRawView;
    jsonContainer.classList.toggle("hidden", isRawView);
    rawContainer.classList.toggle("hidden", !isRawView);
    btnRaw.classList.toggle("active", isRawView);
    btnRaw.title = isRawView ? "Switch to tree view" : "Switch to raw JSON view";
  });

  // ── Toolbar: Copy JSON ────────────────────────────────────────────────────
  btnCopyJson.addEventListener("click", function () {
    if (!parsedJson) return;
    copyToClipboard(JSON.stringify(parsedJson, null, 2), "JSON copied!");
  });

  // ── Toolbar: Download JSON ────────────────────────────────────────────────
  btnDownload.addEventListener("click", function () {
    if (!parsedJson) return;
    const blob = new Blob([JSON.stringify(parsedJson, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    const base = (urlText.textContent || "data").split("/").pop().split("?")[0] || "data";
    a.download = base.endsWith(".json") ? base : base + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Download started!");
  });

  // ── URL Copy ──────────────────────────────────────────────────────────────
  btnCopyUrl.addEventListener("click", function () {
    copyToClipboard(urlText.textContent, "URL copied!");
  });

  // ── Toolbar: Theme Toggle ─────────────────────────────────────────────────
  btnTheme.addEventListener("click", function () {
    isDarkTheme = !isDarkTheme;
    applyTheme();
    try { localStorage.setItem("jf-theme", isDarkTheme ? "dark" : "light"); } catch (_) {}
  });

  function applyTheme() {
    body.classList.toggle("theme-dark",  isDarkTheme);
    body.classList.toggle("theme-light", !isDarkTheme);
    iconMoon.style.display = isDarkTheme  ? "" : "none";
    iconSun.style.display  = !isDarkTheme ? "" : "none";
    btnTheme.title = isDarkTheme ? "Switch to light mode" : "Switch to dark mode";
  }

  // Restore saved theme
  (function () {
    try {
      if (localStorage.getItem("jf-theme") === "light") {
        isDarkTheme = false;
        applyTheme();
      }
    } catch (_) {}
  })();

  // ── Search ───────────────────────────────────────────────────────────────
  searchInput.addEventListener("input", debounce(runSearch, 200));
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter")  { e.shiftKey ? prevMatch() : nextMatch(); }
    if (e.key === "Escape") clearSearch();
  });
  searchNext.addEventListener("click", nextMatch);
  searchPrev.addEventListener("click", prevMatch);
  searchClear.addEventListener("click", clearSearch);

  function runSearch() {
    const q = searchInput.value.trim().toLowerCase();
    clearHighlights();
    searchMatches = [];
    searchCursor  = -1;

    if (!q) { searchCount.textContent = ""; return; }

    document.querySelectorAll(".json-row").forEach(rowEl => {
      if (rowEl.textContent.toLowerCase().includes(q)) {
        rowEl.classList.add("highlighted");
        searchMatches.push(rowEl);
      }
    });

    searchCount.textContent = searchMatches.length
      ? `${searchMatches.length} match${searchMatches.length !== 1 ? "es" : ""}`
      : "no matches";

    if (searchMatches.length) nextMatch();
  }

  function nextMatch() {
    if (!searchMatches.length) return;
    searchCursor = (searchCursor + 1) % searchMatches.length;
    focusMatch();
  }

  function prevMatch() {
    if (!searchMatches.length) return;
    searchCursor = (searchCursor - 1 + searchMatches.length) % searchMatches.length;
    focusMatch();
  }

  function focusMatch() {
    searchMatches.forEach((el, i) =>
      el.classList.toggle("current-match", i === searchCursor)
    );
    const cur = searchMatches[searchCursor];
    if (cur) {
      expandAncestors(cur);
      cur.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    searchCount.textContent = `${searchCursor + 1} / ${searchMatches.length}`;
  }

  function clearHighlights() {
    document.querySelectorAll(".highlighted,.current-match").forEach(el =>
      el.classList.remove("highlighted", "current-match")
    );
  }

  function clearSearch() {
    searchInput.value = "";
    clearHighlights();
    searchMatches = [];
    searchCursor  = -1;
    searchCount.textContent = "";
  }

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────
  document.addEventListener("keydown", function (e) {
    // Ctrl+F — focus search
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    // Ctrl+E — expand all
    if (e.ctrlKey && !e.shiftKey && e.key === "e") {
      e.preventDefault();
      setAllCollapsed(document, false);
    }
    // Ctrl+Shift+E — collapse all
    if (e.ctrlKey && e.shiftKey && e.key === "E") {
      e.preventDefault();
      setAllCollapsed(document, true);
    }
  });

  // ── Context Menu ──────────────────────────────────────────────────────────
  document.addEventListener("click", e => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") hideContextMenu();
  });

  function showContextMenu(x, y) {
    // Show/hide expand/collapse options based on node type
    const hasChildren = !!(ctxTargetNode && ctxTargetNode.childrenEl);
    ctxExpandNode.style.display  = hasChildren ? "" : "none";
    ctxCollapseNode.style.display= hasChildren ? "" : "none";

    contextMenu.classList.remove("hidden");
    const mw = 200, mh = 160;
    contextMenu.style.left = Math.min(x, window.innerWidth  - mw) + "px";
    contextMenu.style.top  = Math.min(y, window.innerHeight - mh) + "px";
  }

  function hideContextMenu() {
    contextMenu.classList.add("hidden");
    ctxTargetNode = null;
  }

  ctxCopyValue.addEventListener("click", () => {
    if (!ctxTargetNode) return;
    const out = typeof ctxTargetNode.value === "object"
      ? JSON.stringify(ctxTargetNode.value, null, 2)
      : String(ctxTargetNode.value);
    copyToClipboard(out, "Value copied!");
    hideContextMenu();
  });

  ctxCopyPath.addEventListener("click", () => {
    if (!ctxTargetNode) return;
    copyToClipboard(ctxTargetNode.path, "Path copied!");
    hideContextMenu();
  });

  ctxCopySubtree.addEventListener("click", () => {
    if (!ctxTargetNode) return;
    copyToClipboard(JSON.stringify(ctxTargetNode.value, null, 2), "Subtree copied!");
    hideContextMenu();
  });

  ctxExpandNode.addEventListener("click", () => {
    if (!ctxTargetNode?.childrenEl) return;
    setAllCollapsed(ctxTargetNode.childrenEl.closest(".json-node"), false);
    hideContextMenu();
  });

  ctxCollapseNode.addEventListener("click", () => {
    if (!ctxTargetNode?.childrenEl) return;
    setAllCollapsed(ctxTargetNode.childrenEl.closest(".json-node"), true);
    hideContextMenu();
  });

  // ── Utilities ─────────────────────────────────────────────────────────────

  function copyToClipboard(text, msg) {
    // Primary path: async Clipboard API (requires allow="clipboard-write" on the iframe).
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showToast(msg || "Copied!"),
        () => execCommandFallback(text, msg)
      );
    } else {
      execCommandFallback(text, msg);
    }
  }

  /**
   * execCommand fallback — used when the async Clipboard API is unavailable.
   * Creates a temporary off-screen textarea, selects its contents, and issues
   * the deprecated but still-functional document.execCommand("copy").
   */
  function execCommandFallback(text, msg) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      // execCommand is deprecated upstream but remains the only viable
      // synchronous clipboard fallback inside extension-hosted iframes.
      const anyDoc = /** @type {any} */ (document);
      const ok = anyDoc.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) showToast(msg || "Copied!");
    } catch (_) { /* clipboard unavailable — silently ignore */ }
  }

  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

})();
