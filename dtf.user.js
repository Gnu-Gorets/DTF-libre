// ==UserScript==
// @name         DTF Libre
// @namespace    https://dtf.ru/
// @version      0.0.85
// @description  Customize feed, improve image loading, add topic search, comment controls, themes, and more.
// @match        https://dtf.ru/*
// @match        https://*.dtf.ru/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.dtf.ru
// @connect      api.dtfrandomizer.xyz
// @run-at       document-start
// ==/UserScript==

(() => {
  "use strict";

  const get = (key, fallback) => GM_getValue(key, fallback);
  const set = (key, value) => GM_setValue(key, value);
  const page = unsafeWindow;
  let plusWasEnabled = false;
  const syncPlus = (notify = false) => {
    const enabled = Boolean(get("plusFeatures", false));
    if (!enabled && !plusWasEnabled) return;
    plusWasEnabled = enabled;
    const previous = page.localStorage.getItem("user");
    if (!previous) return;
    try {
      const user = JSON.parse(previous);
      if (
        !user ||
        typeof user !== "object" ||
        Array.isArray(user) ||
        (!enabled && user.badge !== null) ||
        (user.isPlus === enabled && !notify)
      )
        return;
      if (user.isPlus !== enabled) user.isPlus = enabled;
      const current = JSON.stringify(user);
      if (current !== previous) page.localStorage.setItem("user", current);
      page.dispatchEvent(
        new page.StorageEvent("storage", {
          key: "user",
          oldValue: previous,
          newValue: current,
          storageArea: page.localStorage,
        }),
      );
    } catch (error) {
      console.warn("DTF: could not update Plus state", error);
    }
  };
  syncPlus();
  if (document.readyState === "complete") queueMicrotask(() => syncPlus(true));
  else page.addEventListener("load", () => syncPlus(true), { once: true });
  page.addEventListener("storage", (event) => {
    if (event.key !== "user" || !event.newValue || !get("plusFeatures", false))
      return;
    try {
      const user = JSON.parse(event.newValue);
      if (!user?.id || user.isPlus === true) return;
    } catch {
      return;
    }
    event.stopImmediatePropagation();
    syncPlus(true);
  });
  const originalFetch = page.fetch;
  const commentFeedListeners = new Set();
  const recentCommentResponses = [];
  page.fetch = function (...args) {
    const response = originalFetch.apply(this, args);
    const url = args[0]?.url || String(args[0]);
    const observed =
      /api\.(?:dtf|vc)\.ru\/v\d+\.\d+\/(?:feed|recommendations|timeline|comments)/.test(
        url,
      )
        ? response.then((result) => {
            result
              .clone()
              .json()
              .then((data) => {
                const items = data?.result?.items;
                if (Array.isArray(items)) {
                  const entry = { url: String(url), items };
                  recentCommentResponses.push(entry);
                  if (recentCommentResponses.length > 20)
                    recentCommentResponses.shift();
                  commentFeedListeners.forEach((listener) => listener(entry));
                }
              })
              .catch(() => {});
            return result;
          })
        : response;
    if (
      get("plusFeatures", false) &&
      (args[1]?.method || args[0]?.method || "GET").toUpperCase() === "GET" &&
      /^https:\/\/api\.dtf\.ru\/v\d+\.\d+\/(?:content|comment)\/\d+\/reactions(?:\?|$)/.test(
        url,
      )
    ) {
      return observed.then(async (result) => {
        if (result.status !== 403) return result;
        try {
          const data = await result.clone().json();
          if (data?.error?.info?.errorCode !== "PLUS_SUBSCRIPTION_REQUIRED")
            return result;
          const headers = new page.Headers(result.headers);
          headers.delete("content-length");
          headers.delete("content-encoding");
          return new page.Response(
            JSON.stringify({
              message: "",
              result: { reactions: [], lastSortingValue: null },
            }),
            { status: 200, statusText: "OK", headers },
          );
        } catch {
          return result;
        }
      });
    }
    if (!url.includes("/favorite-gifs") || !get("plusFeatures", false))
      return observed;
    return observed.then(async (result) => {
      try {
        const user = JSON.parse(page.localStorage.getItem("user") || "null");
        if (
          !result.ok ||
          new URL(url, location.href).searchParams.get("page") > 0 ||
          !user?.id ||
          user.badge != null
        )
          return result;
        const data = await result.clone().json();
        if (!Array.isArray(data?.result?.items)) return result;
        const identify = (item) =>
          item?.andropov?.data?.uuid || item?.leonardoUuid;
        const historyKey = `plusRecentGifs:${user.id}`;
        const gifs = new Map();
        const saved = get(historyKey, []);
        for (const item of [
          ...(Array.isArray(saved) ? saved : []),
          ...data.result.items,
        ]) {
          const id = identify(item);
          if (id) gifs.set(id, item);
        }
        const items = [...gifs.values()]
          .sort(
            (a, b) =>
              (b.dateLastUsedTimestamp || 0) - (a.dateLastUsedTimestamp || 0),
          )
          .slice(0, 100);
        set(historyKey, items);
        const headers = new page.Headers(result.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        return new page.Response(
          JSON.stringify({ ...data, result: { ...data.result, items } }),
          { status: result.status, statusText: result.statusText, headers },
        );
      } catch (error) {
        console.warn("DTF: could not restore recent GIFs", error);
        return result;
      }
    });
  };
  let liveSocket = null;
  let liveReconnectTimer = null;
  let liveContainer = null;
  let livePaused = false;
  const liveQueue = [];
  const stretchRightActive = () =>
    window.innerWidth >= 1240 &&
    get("hideRightSidebar", false) &&
    get("stretchRight", false) &&
    !get("livePanel", false);
  const liveEnabled = () =>
    window.innerWidth >= 1240 &&
    get("hideRightSidebar", false) &&
    get("livePanel", false) &&
    !stretchRightActive();
  const addLiveComment = (data) => {
    const user = data?.user;
    const content = data?.content;
    if (
      !liveContainer?.isConnected ||
      !user ||
      typeof user.name !== "string" ||
      typeof data.text !== "string" ||
      typeof data.url !== "string" ||
      typeof content?.title !== "string" ||
      typeof content.url !== "string"
    )
      return;
    const localPath = (value) => {
      try {
        const url = new URL(value, location.origin);
        return url.origin === location.origin
          ? `${url.pathname}${url.search}${url.hash}`
          : "/";
      } catch {
        return "/";
      }
    };
    const item = document.createElement("article");
    item.className = "dtf-vm-live-comment";
    const heading = document.createElement("div");
    heading.className = "dtf-vm-live-heading";
    if (
      typeof user.avatar === "string" &&
      /^[\da-f-]{36}$/i.test(user.avatar)
    ) {
      const avatar = document.createElement("img");
      avatar.src = `https://leonardo.osnova.io/${user.avatar}/-/scale_crop/36x36/`;
      avatar.alt = "";
      heading.append(avatar);
    }
    const author = document.createElement("a");
    author.href = localPath(user.url || `/id${user.id}`);
    author.textContent = user.name;
    const post = document.createElement("a");
    post.href = localPath(content.url);
    post.textContent = content.title;
    post.title = content.title;
    const text = document.createElement("a");
    text.href = localPath(data.url);
    text.textContent = data.text;
    item.append(heading, text);
    heading.append(author, post);
    const list = liveContainer.querySelector(".dtf-vm-live-list");
    list.prepend(item);
    while (list.children.length > 20) list.lastElementChild.remove();
  };
  const queueLiveComment = (data) => {
    if (!livePaused) return addLiveComment(data);
    if (liveQueue.length >= 50) liveQueue.shift();
    liveQueue.push(data);
  };
  const closeLiveSocket = () => {
    clearTimeout(liveReconnectTimer);
    liveReconnectTimer = null;
    if (liveSocket) {
      liveSocket.onclose = null;
      liveSocket.close();
      liveSocket = null;
    }
  };
  const stopLivePanel = () => {
    closeLiveSocket();
    livePaused = false;
    liveQueue.length = 0;
    liveContainer?.remove();
    liveContainer = null;
  };
  const connectLivePanel = () => {
    if (liveSocket || !liveEnabled()) return;
    try {
      const socket = new WebSocket(
        "wss://ws-sio.dtf.ru/socket.io/?EIO=4&transport=websocket",
      );
      liveSocket = socket;
      socket.onmessage = (event) => {
        if (liveSocket !== socket) return;
        const message = String(event.data);
        if (message === "2") return socket.send("3");
        if (message.startsWith("0")) return socket.send("40");
        if (message.startsWith("40"))
          return socket.send('42["subscribe",{"channel":"live"}]');
        if (!message.startsWith("42")) return;
        try {
          const payload = JSON.parse(message.slice(2));
          if (
            payload[0] === "event" &&
            payload[1]?.data?.type === "comment_add"
          )
            queueLiveComment(payload[1].data);
        } catch {}
      };
      socket.onclose = () => {
        if (liveSocket !== socket) return;
        liveSocket = null;
        if (liveEnabled())
          liveReconnectTimer = setTimeout(connectLivePanel, 3000);
      };
      socket.onerror = () => socket.close();
    } catch {
      liveSocket = null;
    }
  };
  const syncLivePanel = () => {
    if (!liveEnabled()) return stopLivePanel();
    const layout = document.querySelector(".layout");
    if (!layout) return;
    if (!liveContainer?.isConnected) {
      liveContainer = document.createElement("aside");
      liveContainer.className = "dtf-vm-live-panel";
      liveContainer.innerHTML =
        '<div class="dtf-vm-live-inner"><header><h3>Последние комментарии</h3><button type="button" aria-label="Остановить обновления">Ⅱ</button></header><div class="dtf-vm-live-list"></div></div>';
      const pause = liveContainer.querySelector("button");
      pause.onclick = () => {
        livePaused = !livePaused;
        pause.textContent = livePaused ? "▶" : "Ⅱ";
        pause.setAttribute(
          "aria-label",
          livePaused ? "Продолжить обновления" : "Остановить обновления",
        );
        if (!livePaused)
          while (liveQueue.length) addLiveComment(liveQueue.shift());
      };
      layout.append(liveContainer);
    }
    connectLivePanel();
  };
  const updateRightPanelControls = () => {
    const live = document.querySelector(".dtf-vm-dialog [name=livePanel]");
    const stretch = document.querySelector(
      ".dtf-vm-dialog [name=stretchRight]",
    );
    const available =
      window.innerWidth >= 1240 && get("hideRightSidebar", false);
    if (live) {
      live.disabled = !available || stretchRightActive();
      live.closest("label").classList.toggle("dtf-vm-disabled", live.disabled);
    }
    if (stretch) {
      stretch.disabled = !available || get("livePanel", false);
      stretch
        .closest("label")
        .classList.toggle("dtf-vm-disabled", stretch.disabled);
    }
  };
  const viewedKey = "viewedPostHistory";
  const viewedTtl = 48 * 60 * 60 * 1000;
  const loadViewedPosts = (saved = get(viewedKey, []), now = Date.now()) =>
    new Map(
      (Array.isArray(saved) ? saved : [])
        .filter(
          (item) =>
            /^\d+$/.test(String(item?.id ?? "")) &&
            Number.isFinite(Number(item.timestamp)) &&
            now - Number(item.timestamp) < viewedTtl,
        )
        .map((item) => [String(item.id), Number(item.timestamp)]),
    );
  const postIdFromUrl = (value) => {
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin
        ? url.pathname.match(/\/[^/]+\/(\d+)/)?.[1] || null
        : null;
    } catch {
      return null;
    }
  };
  const viewedModeEnabled = () =>
    get("hideViewedPosts", false) || get("showHideButton", false);
  let viewedPosts = new Map();
  let viewedObserver = null;
  let viewedStorageListener = null;
  let viewedModeActive = false;
  let viewedAutoHide = false;
  let viewedButtonMode = false;
  let feedLoaderObserver = null;
  let observedFeedLoader = null;
  let lastWakeTarget = null;
  let lastWakeCount = -1;
  let wakeRestore = null;
  const wakeCollapsedFeed = () => {
    const loader = document.querySelector(".feed-page .content-list__loader");
    if (loader !== observedFeedLoader) {
      feedLoaderObserver?.disconnect();
      observedFeedLoader = loader;
      if (loader)
        feedLoaderObserver.observe(loader, {
          attributes: true,
          attributeFilter: ["style"],
        });
    }
    const list = loader?.closest(".content-list");
    if (
      !list?.querySelector(".dtf-vm-minimized-post") ||
      loader.style.display !== "none" ||
      wakeRestore
    )
      return;
    const target = loader.parentElement;
    const rect = target.getBoundingClientRect();
    if (rect.top > innerHeight * 6 || rect.bottom < -innerHeight * 2) return;
    const count = list.querySelectorAll(".content").length;
    if (target === lastWakeTarget && count === lastWakeCount) return;
    lastWakeTarget = target;
    lastWakeCount = count;
    const previous = target.style.getPropertyValue("transform");
    const priority = target.style.getPropertyPriority("transform");
    target.style.transform = "translateY(600vh)";
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) wakeRestore?.();
      },
      { rootMargin: "200% 0px" },
    );
    observer.observe(target);
    const timer = setTimeout(() => wakeRestore?.(), 500);
    wakeRestore = () => {
      observer.disconnect();
      clearTimeout(timer);
      target.style.setProperty("transform", previous, priority);
      wakeRestore = null;
    };
  };
  const postIdForCard = (card) => {
    for (const link of card.querySelectorAll(".content-header a[href]")) {
      if (link.closest(".content") !== card) continue;
      const id = postIdFromUrl(link.href);
      if (id) return id;
    }
    return null;
  };
  const saveViewedPosts = () =>
    set(
      viewedKey,
      [...viewedPosts].map(([id, timestamp]) => ({ id, timestamp })),
    );
  const syncViewedCard = (card) => {
    if (!card.isConnected || card.closest(".entry")) return;
    const id = postIdForCard(card);
    if (!id) return;
    const viewed = viewedPosts.has(id);
    card.classList.toggle("dtf-vm-minimized-post", viewed);
    const actions = card.querySelector(".content-header__actions");
    if (!actions) return;
    let button = actions.querySelector(".dtf-vm-viewed-button");
    if ((viewed || viewedButtonMode) && !button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "dtf-vm-viewed-button";
      button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      actions.prepend(button);
    } else if (!viewed && !viewedButtonMode) {
      button?.remove();
      return;
    }
    if (button) {
      button.title = viewed ? "Развернуть пост" : "Свернуть пост";
      button.setAttribute("aria-label", button.title);
    }
  };
  const syncViewedCards = () =>
    document.querySelectorAll(".content").forEach(syncViewedCard);
  const setPostViewed = (id, viewed) => {
    if (viewed) viewedPosts.set(id, Date.now());
    else viewedPosts.delete(id);
    saveViewedPosts();
    syncViewedCards();
  };
  const onViewedPostClick = (event) => {
    const target =
      event.target instanceof Element
        ? event.target
        : event.target?.parentElement;
    const button = target?.closest(".dtf-vm-viewed-button");
    if (button) {
      const card = button.closest(".content");
      const id = card && postIdForCard(card);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      setPostViewed(id, !viewedPosts.has(id));
      return;
    }
    if (!viewedAutoHide) return;
    const link = target?.closest("a[href]");
    const card = link && link.closest(".content");
    if (!card || card.closest(".entry")) return;
    const id = postIdForCard(card);
    if (id && postIdFromUrl(link.href) === id && !viewedPosts.has(id)) {
      viewedPosts.set(id, Date.now());
      saveViewedPosts();
      syncViewedCard(card);
    }
  };
  const stopViewedPosts = () => {
    viewedObserver?.disconnect();
    viewedObserver = null;
    wakeRestore?.();
    feedLoaderObserver?.disconnect();
    feedLoaderObserver = null;
    observedFeedLoader = null;
    lastWakeTarget = null;
    lastWakeCount = -1;
    window.removeEventListener("scroll", wakeCollapsedFeed);
    document.removeEventListener("click", onViewedPostClick, true);
    if (viewedStorageListener !== null)
      GM_removeValueChangeListener(viewedStorageListener);
    viewedStorageListener = null;
    document
      .querySelectorAll(".dtf-vm-minimized-post")
      .forEach((card) => card.classList.remove("dtf-vm-minimized-post"));
    document
      .querySelectorAll(".dtf-vm-viewed-button")
      .forEach((button) => button.remove());
    viewedModeActive = false;
    viewedAutoHide = false;
    viewedButtonMode = false;
  };
  const syncViewedPosts = () => {
    if (!viewedModeEnabled()) return viewedModeActive && stopViewedPosts();
    const autoHide = Boolean(get("hideViewedPosts", false));
    const buttonMode = Boolean(get("showHideButton", false));
    if (!viewedModeActive) {
      viewedPosts = loadViewedPosts();
      viewedModeActive = true;
      document.addEventListener("click", onViewedPostClick, true);
      window.addEventListener("scroll", wakeCollapsedFeed, { passive: true });
      feedLoaderObserver = new MutationObserver(() =>
        requestAnimationFrame(wakeCollapsedFeed),
      );
      viewedObserver = new MutationObserver((records) => {
        for (const { addedNodes } of records)
          for (const node of addedNodes) {
            if (!(node instanceof Element)) continue;
            const card = node.matches(".content")
              ? node
              : node.closest(".content");
            if (card) syncViewedCard(card);
            node.querySelectorAll(".content").forEach(syncViewedCard);
          }
        requestAnimationFrame(wakeCollapsedFeed);
      });
      viewedObserver.observe(document.body, { childList: true, subtree: true });
      viewedStorageListener = GM_addValueChangeListener(
        viewedKey,
        (_key, _oldValue, _newValue, remote) => {
          if (!remote || !viewedModeActive) return;
          viewedPosts = loadViewedPosts();
          syncViewedCards();
        },
      );
    }
    if (autoHide !== viewedAutoHide || buttonMode !== viewedButtonMode) {
      viewedAutoHide = autoHide;
      viewedButtonMode = buttonMode;
      syncViewedCards();
      requestAnimationFrame(wakeCollapsedFeed);
    }
  };
  const sidebarOptions = {
    hidePopular: "dtf-vm-hide-popular",
    hideNew: "dtf-vm-hide-new",
    hideMy: "dtf-vm-hide-my",
    hideMessages: "dtf-vm-hide-messages",
    hideRating: "dtf-vm-hide-rating",
    hideGames: "dtf-vm-hide-games",
    hideTopics: "dtf-vm-hide-topics",
    hideDonationsMenu: "dtf-vm-hide-donations-menu",
    hidePlusMenu: "dtf-vm-hide-plus-menu",
  };
  const applySidebarClasses = (root) => {
    for (const [key, className] of Object.entries(sidebarOptions))
      root.classList.toggle(className, Boolean(get(key, false)));
    root.classList.toggle(
      "dtf-vm-hide-footer",
      Boolean(get("hideFooter", false)),
    );
    root.classList.toggle(
      "dtf-vm-hide-plus-ads",
      Boolean(get("hidePlusAds", false)),
    );
  };
  const feedMetrics = (viewport, percent, left = 220, right = 320, gap = 0) => {
    const desktop = viewport >= 1240;
    const tablet = viewport >= 925;
    const columns = Number(tablet) + Number(desktop) + 1;
    const rails =
      (tablet ? left : 0) + (desktop ? right : 0) + gap * (columns - 1);
    const available = Math.max(0, viewport - 32 - rails);
    const feed = (available * Math.min(percent, 100)) / 100;
    return { feed, layout: Math.min(viewport - 32, rails + feed) };
  };
  const style = document.createElement("style");
  style.textContent = `
    .layout:has(.view) { --layout-max-content-width: var(--dtf-feed-width) !important; --layout-max-width: var(--dtf-layout-width) !important; }
    html.dtf-vm-header-width { --layout-max-content-width: var(--dtf-feed-width) !important; --layout-max-width: var(--dtf-layout-width) !important; }
    @media (min-width: 925px) { html.dtf-vm-header-width .header__layout { position: relative; justify-content: space-between; transform: none; } html.dtf-vm-header-width .header__left > :last-child { position: absolute; left: var(--dtf-header-left, 220px); } }
    @media (max-width: 924px) { .layout:has(.view) { --layout-max-width: 100vw !important; } }
    html.dtf-vm-stretch-right .layout:has(.view) { --layout-right-aside-width: 0px !important; }
    html.dtf-vm-stretch-right .layout:has(.entry) { --layout-max-content-width: var(--dtf-feed-width) !important; --layout-max-width: var(--dtf-layout-width) !important; --layout-right-aside-width: 0px !important; }
    .feed-page:has(.dtf-vm-minimized-post) .content-list__loader { display: block !important; box-sizing: border-box !important; width: 1px !important; height: 1px !important; min-height: 1px !important; padding: 0 !important; border: 0 !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }
    .dtf-vm-centered .block-wrapper--media .block-media { display: flex !important; justify-content: center !important; }
    .dtf-vm-centered .block-wrapper--media .andropov-media { margin-inline: auto !important; }
    .dtf-vm-centered .block-wrapper--gallery .mvqlyolt { justify-content: center; }
    html.dtf-vm-classic-gallery .block-wrapper--gallery .mvqlyolt { display: flex !important; flex-wrap: wrap; justify-content: center; gap: 2px; }
    html.dtf-vm-classic-gallery .block-wrapper--gallery .mvqlyolt > * { position: relative; flex: 0 0 calc((100% - 4px) / 3); min-width: 0; width: auto !important; }
    html.dtf-vm-classic-gallery .block-wrapper--gallery .mvqlyolt > [data-dtf-gallery-hidden] { display: none !important; }
    html.dtf-vm-classic-gallery .block-wrapper--gallery .mvqlyolt > * .andropov-media.andropov-image { width: 100% !important; height: auto !important; max-width: 100% !important; }
    html.dtf-vm-classic-gallery .block-wrapper--gallery .mvqlyolt > [data-dtf-gallery-more] .andropov-media { opacity: 0; }
    html.dtf-vm-classic-gallery .block-wrapper--gallery .mvqlyolt > [data-dtf-gallery-more]::after { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; background: #0009; border-radius: 10px; content: attr(data-dtf-gallery-more); font-size: clamp(24px, 5vw, 48px); font-weight: 600; pointer-events: none; }
    .content-nsfw { display: none !important; }
    html.dtf-vm-disable-spoiler-blur .spoiler { display: none !important; }
    .dtf-vm-centered .content__blocks img, .dtf-vm-centered .content__blocks video { display: block; max-width: 100%; height: auto; margin: 0 auto; }
    .dtf-vm-centered .andropov-video-player:fullscreen video, .dtf-vm-centered .andropov-video-player:-moz-full-screen video { height: 100% !important; }
    .dtf-vm-minimized-post .content__blocks, .dtf-vm-minimized-post .content__read-more, .dtf-vm-minimized-post .content-comment { display: none !important; }
    .dtf-vm-minimized-post .content-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dtf-vm-viewed-button { display: flex; align-items: center; order: -1; padding: 0; color: var(--theme-color-text-primary); background: var(--theme-color-button-minimal); border: 0; border-radius: 10px; cursor: pointer; }
    .dtf-vm-viewed-button svg { display: block; width: 28px; height: 28px; }
    .dtf-vm-minimized-post .dtf-vm-viewed-button svg { transform: rotate(180deg); }
    .dtf-vm-subsetting { margin-left: 28px !important; padding-left: 12px; border-left: 2px solid #414348; }
    .dtf-vm-overlay { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px; background: #000b; font: 14px/1.4 Arial,sans-serif; }
    .dtf-vm-dialog, .dtf-vm-dialog * { box-sizing: border-box; font-family: Arial,sans-serif !important; line-height: 1.3; }
    .dtf-vm-dialog { position: relative; width: min(900px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 12px; color: #f4f4f4 !important; background: #27282b !important; border: 1px solid #414348; border-radius: 8px; box-shadow: 0 12px 40px #0009; }
    .dtf-vm-dialog h2 { margin: 0 0 6px; color: inherit !important; font-size: 21px; }
    .dtf-vm-settings-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 16px; }
    .dtf-vm-settings-column { min-width: 0; }
    @media (max-width: 700px) { .dtf-vm-dialog { width: min(460px, 100%); } .dtf-vm-settings-grid { grid-template-columns: 1fr; gap: 0; } }
    .dtf-vm-dialog h3 { margin: 0 0 6px; color: #aeb4c0 !important; font-size: 14px; }
    .dtf-vm-section { padding: 6px 0; border-top: 1px solid #414348; }
    .dtf-vm-section h3 { display: flex; align-items: center; gap: 8px; color: #e0e5ec !important; font-weight: 600; }
    .dtf-vm-section-icon { display: grid; flex: 0 0 23px; place-items: center; width: 23px; height: 23px; color: #83bdff; background: #1685ff24; border: 1px solid #1685ff66; border-radius: 7px; }
    .dtf-vm-section-icon svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
    .dtf-vm-subsettings { margin: 3px 0 4px; }
    .dtf-vm-subsettings summary { color: #aeb4c0; font-size: 12px; cursor: pointer; }
    .dtf-vm-subsettings .dtf-vm-subsetting { margin-left: 0 !important; padding-left: 0; border-left: 0; }
    .dtf-vm-subsettings[open] summary { margin-bottom: 3px; }
    .dtf-vm-personalization-header { display: flex; align-items: center; justify-content: space-between; }
    .dtf-vm-dialog .dtf-vm-personalization-header h3 { margin: 0; }
    .dtf-vm-dialog .dtf-vm-personalization-header label { display: flex; align-items: center; margin: 0; }
    .dtf-vm-dialog .dtf-vm-personalization-header input[type=checkbox] { appearance: none; position: relative; width: 38px; height: 22px; margin: 0; border-radius: 12px; background: #3b4552; cursor: pointer; }
    .dtf-vm-dialog .dtf-vm-personalization-header input[type=checkbox]::before { content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #9aa5b3; transition: transform .15s; }
    .dtf-vm-dialog .dtf-vm-personalization-header input[type=checkbox]:checked { background: #4285f4; }
    .dtf-vm-dialog .dtf-vm-personalization-header input[type=checkbox]:checked::before { transform: translateX(16px); background: #fff; }
    .dtf-vm-personalization-colors { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 12px; }
    .dtf-vm-dialog .dtf-vm-personalization-colors label { display: flex; align-items: center; justify-content: flex-start; gap: 8px; margin: 4px 0; color: #8298b8 !important; }
    .dtf-vm-personalization-colors label span { min-width: 0; }
    .dtf-vm-personalization-colors input[type=color] { flex: 0 0 22px; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 5px; overflow: hidden; }
    .dtf-vm-dialog .dtf-vm-personalization-background { display: flex; align-items: center; gap: 10px; margin: 8px 0 0; }
    .dtf-vm-personalization-background input { flex: 1; min-width: 0; }
    .dtf-vm-theme-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .dtf-vm-theme-actions button { padding: 6px 10px; color: #e2e6ec; background: #272a30; border: 1px solid #454a53; border-radius: 8px; cursor: pointer; white-space: nowrap; }
    .dtf-vm-theme-actions input { flex: 1; min-width: 0; padding: 7px 10px; color: inherit; background: #202329; border: 1px solid #454a53; border-radius: 8px; }
    .dtf-vm-section:first-of-type { padding-top: 0; border-top: 0; }
    .dtf-vm-dialog label { display: block; margin: 2px 0; color: inherit !important; font-size: 13px; }
    .dtf-vm-dialog label:last-child { margin-bottom: 0; }
    .dtf-vm-dialog label.dtf-vm-disabled { opacity: .45; }
    .dtf-vm-dialog input[type=range] { appearance: none; display: block; width: 100%; height: 20px; margin: 4px 0 0; background: transparent !important; cursor: pointer; }
    .dtf-vm-dialog input[type=range]::-webkit-slider-runnable-track { height: 6px; background: #555a64; border-radius: 6px; }
    .dtf-vm-dialog input[type=range]::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; margin-top: -6px; background: #1685ff; border: 0; border-radius: 50%; }
    .dtf-vm-dialog input[type=range]::-moz-range-track { height: 6px; background: #555a64; border-radius: 6px; }
    .dtf-vm-dialog input[type=range]::-moz-range-thumb { width: 18px; height: 18px; background: #1685ff; border: 0; border-radius: 50%; }
    .dtf-vm-dialog input[type=checkbox] { appearance: auto; width: 16px; height: 16px; margin: 0 7px 0 0; accent-color: #1685ff; vertical-align: middle; }
    .dtf-vm-reset-topics { margin-top: 4px; padding: 8px 12px; color: #d7dbe2; background: #34363b; border: 1px solid #50535a; border-radius: 6px; font-size: 13px; cursor: pointer; }
    .dtf-vm-reset-topics:hover { color: #fff; background: #41444a; }
    .dtf-vm-reset-topics:focus-visible { outline: 2px solid #1685ff; outline-offset: 2px; }
    .dtf-vm-close { position: absolute; top: 8px; right: 10px; color: #fff; background: none; border: 0; font-size: 20px; cursor: pointer; }
    .dtf-vm-top { position: fixed; right: 24px; bottom: 24px; z-index: 2147483646; display: grid; place-items: center; width: 48px; height: 48px; padding: 0; color: #fff !important; background: #1685ff !important; border: 0; border-radius: 50%; box-shadow: 0 3px 12px #0007; font: 28px/1 system-ui,sans-serif !important; cursor: pointer; }
    .dtf-vm-top[hidden] { display: none !important; }
    html.dtf-vm-hide-popular a[href="/popular"], html.dtf-vm-hide-new a[href="/new"], html.dtf-vm-hide-my a[href="/my"], html.dtf-vm-hide-messages a[href="/m"], html.dtf-vm-hide-rating a[href="/discovery"] { display: none !important; }
    html.dtf-vm-hide-games :has(> [data-section="games"]), html.dtf-vm-hide-topics :has(> [data-section="topics"]) { display: none !important; }
    .scroll-next-button { display: none !important; }
    html.dtf-vm-back-to-top .scroll-prev-button, html.dtf-vm-back-to-top .scroll-to-top { display: none !important; }
    .sidebar, .sidebar *, .layout__left-aside, .layout__left-aside * { scrollbar-width: none; }
    .sidebar::-webkit-scrollbar, .sidebar *::-webkit-scrollbar, .layout__left-aside::-webkit-scrollbar, .layout__left-aside *::-webkit-scrollbar { display: none; }
    .dtf-vm-topic-search { box-sizing: border-box; width: 100%; margin: 4px 0 8px; padding: 7px 10px; color: inherit; background: var(--theme-color-background-content); border: 1px solid var(--theme-color-text-secondary); border-radius: 6px; font: inherit; }
    .dtf-vm-topic-search-hidden { display: none !important; }
    .dtf-vm-topic-extras { display: flex; flex-direction: column; row-gap: 4px; }
    .dtf-vm-topic-extras > a { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 4px 8px; color: inherit; text-decoration: none; }
    .dtf-vm-topic-extras > a img { flex: 0 0 32px; width: 32px; height: 32px; object-fit: cover; border-radius: 50%; }
    .dtf-vm-topic-original { display: none !important; }
    .dtf-vm-topic-extras[hidden], .dtf-vm-topic-extras > [hidden] { display: none !important; }
    .dtf-vm-topic-show-all { width: 100%; color: inherit; background: none; border: 0; font: inherit; text-align: left; }
    html.dtf-vm-hide-footer :has(> [data-section="footer"]) { display: none !important; }
    html.dtf-vm-hide-donations-menu [href*="/donat"], html.dtf-vm-hide-plus-menu [href*="/plus"] { display: none !important; }
    html.dtf-vm-waiting-css body { visibility: hidden !important; }
    @media (min-width: 1240px) {
      html.dtf-vm-hide-right-sidebar .layout > .aside.aside--right { display: none !important; }
      .dtf-vm-live-panel { grid-column: 3; grid-row: 1; margin-left: 8px; position: sticky; top: var(--layout-header-height); width: var(--layout-right-aside-width, 320px); height: calc(100vh - var(--layout-header-height)); padding-top: 16px; color: var(--theme-color-text-primary); }
    }
    .dtf-vm-live-inner { display: flex; flex-direction: column; height: 100%; padding: 16px; overflow: hidden; background: var(--theme-color-background-content); border-radius: 10px; }
    .dtf-vm-live-inner header { display: flex; align-items: center; justify-content: space-between; }
    .dtf-vm-live-inner h3 { margin: 0; font-size: 15px; font-weight: 500; }
    .dtf-vm-live-inner button { padding: 4px; color: inherit; background: transparent; border: 0; border-radius: 6px; cursor: pointer; }
    .dtf-vm-live-list { flex: 1; overflow-y: auto; }
    .dtf-vm-live-comment { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .dtf-vm-live-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .dtf-vm-live-heading img { flex: 0 0 36px; width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
    .dtf-vm-live-heading a, .dtf-vm-live-comment > a { color: inherit; text-decoration: none; }
    .dtf-vm-live-heading a { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .dtf-vm-live-comment > a { display: -webkit-box; overflow: hidden; font-size: 15px; line-height: 22px; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .dtf-vm-live-heading a:hover, .dtf-vm-live-comment > a:hover { color: var(--theme-color-accent); }
    html.dtf-vm-hide-plus-ads .supbar--top, html.dtf-vm-hide-plus-ads .header__distribution, html.dtf-vm-hide-plus-ads .header__main-distribution,
    html.dtf-vm-hide-plus-ads .rotator, html.dtf-vm-hide-plus-ads .entry-rotator, html.dtf-vm-hide-plus-ads .entry-steam-pay-widget,
    html.dtf-vm-hide-plus-ads .sidebar-apps-promo,
    html.dtf-vm-hide-plus-ads :has(> [data-section="services"]), html.dtf-vm-hide-plus-ads a[href="https://edu.vc.ru/chatgpt"], html.dtf-vm-hide-plus-ads a[href="https://edu.vc.ru"], html.dtf-vm-hide-plus-ads a[href="/store"] { display: none !important; }
    html.dtf-vm-small-fixes .textarea:has(textarea), html.dtf-vm-small-fixes .textarea:has([contenteditable="true"]), html.dtf-vm-small-fixes [class*="comment"] .textarea { padding: 4px 8px !important; border-radius: 6px !important; }
    html.dtf-vm-small-fixes .textarea textarea, html.dtf-vm-small-fixes .textarea [contenteditable="true"], html.dtf-vm-small-fixes .textarea__input, html.dtf-vm-small-fixes [class*="comment"] textarea, html.dtf-vm-small-fixes [class*="comment"] [contenteditable="true"] { padding: 4px 8px !important; border-radius: 4px !important; }
    .dtf-vm-hint { display: block; margin: 1px 0 0 26px; color: #aeb4c0; font-size: 11px; }
    [data-dtf-vm-hidden] { display: none !important; }
    [data-dtf-vm-hidden][data-dtf-vm-restore="1"] { display: inline-flex !important; align-items: center; width: auto !important; max-width: max-content; padding: 6px 12px; border: 1px solid #8884; border-radius: 8px; background: #8882; cursor: pointer; }
    [data-dtf-vm-hidden][data-dtf-vm-restore="1"] > * { display: none !important; }
    [data-dtf-vm-hidden][data-dtf-vm-restore="1"]::after { content: attr(data-dtf-vm-label); font-size: 13px; }
    .dtf-vm-nocomment { width: 20px; height: 20px; vertical-align: middle; }
    .dtf-vm-nocomment-hidden { display: none !important; }
    html.dtf-vm-show-removed-comments .comment--hidden .comment__content { display: block !important; }
    .dtf-vm-edits { margin-left: 5px; }
    .dtf-vm-hidden-comments { margin-left: 6px; }
    .dtf-vm-quote { position: absolute; z-index: 1000; padding: 5px 10px; border: 0; border-radius: 10px; background: #232324; color: white; cursor: pointer; font: italic 14px Arial,sans-serif; }
    .dtf-vm-comment-overlay { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px; background: #0008; }
    .dtf-vm-comment-dialog { width: min(600px, 90vw); max-height: 80vh; overflow: auto; padding: 20px; border-radius: 12px; color: var(--theme-color-text-primary); background: var(--theme-color-background-content); }
    .dtf-vm-comment-dialog header { display: flex; justify-content: space-between; margin-bottom: 12px; font-weight: 600; }
    .dtf-vm-comment-dialog header button { border: 0; color: inherit; background: none; font-size: 20px; cursor: pointer; }
    .dtf-vm-comment-dialog article { padding: 12px 0; white-space: pre-wrap; border-top: 1px solid var(--theme-color-border); }
    .dtf-vm-comment-dialog article.dtf-vm-comment-row { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--theme-color-border); border-radius: 8px; white-space: normal; }
    .dtf-vm-comment-meta, .dtf-vm-comment-author { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .dtf-vm-comment-author { gap: 6px; color: inherit; text-decoration: none; }
    .dtf-vm-comment-author img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
    .dtf-vm-comment-reply { color: var(--theme-color-text-secondary); }
    .dtf-vm-comment-date { margin-left: auto; color: var(--theme-color-text-secondary); font-size: 12px; }
    .dtf-vm-comment-text { white-space: pre-wrap; }
    .dtf-vm-comment-media img, .dtf-vm-comment-media video { display: block; max-width: 100%; max-height: 400px; border-radius: 8px; }
  `;
  const personalizationColors = {
    accent: ["Акцент", "#1685ff", ["--theme-color-accent"]],
    background: ["Фон", "#101114", ["--theme-color-background"]],
    content: [
      "Фон контента",
      "#1b1c20",
      [
        "--theme-color-background-content",
        "--theme-color-bg-content",
        "--theme-color-brand-content-background",
      ],
    ],
    text: ["Основной текст", "#f4f4f4", ["--theme-color-text-primary"]],
    secondaryText: [
      "Второстепенный текст",
      "#aeb4c0",
      ["--theme-color-text-secondary", "--theme-color-text-secondary-light"],
    ],
    buttons: [
      "Кнопки",
      "#34363b",
      [
        "--theme-color-button-minimal",
        "--theme-color-button-secondary",
        "--theme-color-button-subtle",
      ],
    ],
  };
  const personalizationStyle = document.createElement("style");
  personalizationStyle.id = "dtf-vm-personalization";
  const applyPersonalization = () => {
    if (!get("personalizationEnabled", false)) {
      personalizationStyle.remove();
      return;
    }
    const vars = Object.entries(personalizationColors).flatMap(
      ([key, [, fallback, names]]) => {
        const color = get(`personalization:${key}`, "") || fallback;
        return /^#[\da-f]{6}$/i.test(color)
          ? names.map((name) => `${name}:${color} !important`)
          : [];
      },
    );
    const image = get("personalizationBackground", "").trim();
    let background = "";
    try {
      const url = new URL(image);
      if (["http:", "https:"].includes(url.protocol))
        background = `body{background-image:url(${JSON.stringify(url.href)}) !important;background-attachment:fixed !important;background-position:center !important;background-size:cover !important;background-repeat:no-repeat !important}`;
    } catch {}
    personalizationStyle.textContent = `:root{${vars.join(";")}}${background}`;
    if (!personalizationStyle.isConnected)
      document.head?.append(personalizationStyle);
  };
  applyPersonalization();
  const encodeTheme = () => {
    const theme = {
      v: 1,
      c: Object.keys(personalizationColors).map((key) =>
        (
          get(`personalization:${key}`, "") || personalizationColors[key][1]
        ).slice(1),
      ),
      b: get("personalizationBackground", ""),
      o: 1,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(theme));
    return btoa(
      Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
    );
  };
  const decodeTheme = (code) => {
    try {
      const bytes = Uint8Array.from(atob(code.trim()), (char) =>
        char.charCodeAt(0),
      );
      const theme = JSON.parse(new TextDecoder().decode(bytes));
      if (
        theme?.v !== 1 ||
        !Array.isArray(theme.c) ||
        theme.c.length !== 6 ||
        !theme.c.every((color) => /^[\da-f]{6}$/i.test(color)) ||
        typeof theme.b !== "string" ||
        (theme.b !== "" && new URL(theme.b).protocol !== "https:")
      )
        return null;
      return theme;
    } catch {
      return null;
    }
  };
  const applyTheme = (theme) => {
    Object.keys(personalizationColors).forEach((key, index) =>
      set(`personalization:${key}`, `#${theme.c[index]}`),
    );
    set("personalizationBackground", theme.b);
    set("personalizationEnabled", true);
    applyPersonalization();
  };
  const waitForDtfStyles = () => {
    const root = document.documentElement;
    if (!root) {
      const observer = new MutationObserver(() => {
        if (!document.documentElement) return;
        observer.disconnect();
        waitForDtfStyles();
      });
      observer.observe(document, { childList: true });
      return;
    }
    const className = "dtf-vm-waiting-css";
    root.classList.add(className);
    let settled = false;
    let observer;
    const timeout = setTimeout(reveal, 5000);
    function reveal() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      observer?.disconnect();
      root.classList.remove(className);
    }
    const watchStylesheet = () => {
      const link = document.querySelector(
        'link[rel="stylesheet"][href*="/assets/index-"]',
      );
      if (!link) return false;
      if (document.readyState === "complete" && link.sheet) reveal();
      else {
        link.addEventListener("load", reveal, { once: true });
        link.addEventListener("error", reveal, { once: true });
        window.addEventListener("load", reveal, { once: true });
      }
      return true;
    };
    if (!watchStylesheet()) {
      observer = new MutationObserver(() => {
        if (watchStylesheet()) observer.disconnect();
      });
      observer.observe(root, { childList: true, subtree: true });
    }
  };
  waitForDtfStyles();

  const attachStyles = () => {
    if (!document.head) return false;
    if (style.parentElement !== document.head) document.head.append(style);
    if (
      get("personalizationEnabled", false) &&
      !personalizationStyle.isConnected
    )
      applyPersonalization();
    return true;
  };
  const primeLayout = () => {
    const root = document.documentElement;
    if (!root) return;
    applySidebarClasses(root);
    root.classList.toggle("dtf-vm-stretch-right", stretchRightActive());
    attachStyles();
    const { feed, layout } = feedMetrics(
      window.innerWidth,
      get("width", 100),
      220,
      stretchRightActive() ? 0 : 320,
    );
    root.style.setProperty("--dtf-feed-width", `${feed}px`);
    root.style.setProperty("--dtf-layout-width", `${layout}px`);
  };
  primeLayout();
  window.addEventListener("resize", primeLayout);
  if (!document.head) {
    const headObserver = new MutationObserver(() => {
      if (!document.head) return;
      primeLayout();
      headObserver.disconnect();
    });
    headObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  }

  const expandComments = () => {
    const limits = new WeakSet();
    const pendingLimits = new WeakSet();
    const timers = new Set();
    let pumping = false;
    const queue = new Set();
    const hiddenSelector = ".comment--hidden";
    const branchSelector = ".link-button.link-button--small.comment__expand";
    const expandLimit = (limit, clicks = 0, misses = 0) => {
      if (
        !get("expandComments", true) ||
        !limit.isConnected ||
        document.querySelector(".comments.comments--single-thread")
      )
        return;
      if (clicks === 0 && misses === 0) {
        if (limits.has(limit) || pendingLimits.has(limit)) return;
        pendingLimits.add(limit);
      }
      const button =
        clicks < 4 &&
        limit.querySelector(
          ".link-button.link-button--default.comments-limit__expand",
        );
      if (button) {
        clicks++;
        button.click();
      } else if (clicks >= 4 || misses >= 3) {
        pendingLimits.delete(limit);
        limits.add(limit);
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!get("expandComments", true)) {
          pendingLimits.delete(limit);
          limits.delete(limit);
          return;
        }
        if (clicks >= 4) {
          pendingLimits.delete(limit);
          limits.add(limit);
          return;
        }
        expandLimit(limit, clicks, button ? 0 : misses + 1);
      }, 800);
      timers.add(timer);
    };
    const collapseHidden = (comment, attempt = 0) => {
      if (!get("skipHiddenComments", true) || !comment.isConnected) return;
      const button = comment.querySelector(branchSelector);
      if (button?.textContent.includes("Свернуть")) button.click();
      else if (attempt < 3) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          collapseHidden(comment, attempt + 1);
        }, 500);
        timers.add(timer);
      }
    };
    const drain = async () => {
      if (pumping) return;
      pumping = true;
      while (get("expandComments", true) && queue.size) {
        if (
          document.querySelector(
            ".popover, .notifications-popover.bell__popover, .account-button__menu",
          )
        ) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        const button = [...queue].find((item) => item.isConnected);
        if (!button) {
          queue.clear();
          break;
        }
        queue.delete(button);
        if (
          !button.textContent.includes("Свернуть") &&
          button.dataset.expanded !== "true" &&
          !(get("skipHiddenComments", true) && button.closest(hiddenSelector))
        ) {
          button.dataset.expanded = "true";
          button.click();
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      pumping = false;
    };
    const scan = (root, refresh = false) => {
      if (!get("expandComments", true)) return;
      const limitSelector = ".comments-limit.comments-limit--bottom";
      const limitsInRoot = [
        ...(root.matches?.(limitSelector) ? [root] : []),
        ...(root.querySelectorAll?.(limitSelector) || []),
      ];
      const addedButton = root.matches?.(".comments-limit__expand")
        ? root
        : root.querySelector?.(".comments-limit__expand");
      const limitForAddedButton = addedButton?.closest(limitSelector);
      if (limitForAddedButton) limitsInRoot.push(limitForAddedButton);
      for (const limit of limitsInRoot) {
        if (
          !pendingLimits.has(limit) &&
          (refresh || limit === limitForAddedButton)
        )
          limits.delete(limit);
        expandLimit(limit);
      }
      if (get("expandAllBranches", false)) {
        if (root.matches?.(branchSelector)) queue.add(root);
        root
          .querySelectorAll?.(branchSelector)
          .forEach((button) => queue.add(button));
        void drain();
      }
      if (get("skipHiddenComments", true)) {
        if (root.matches?.(hiddenSelector)) collapseHidden(root);
        root
          .querySelectorAll?.(hiddenSelector)
          .forEach((comment) => collapseHidden(comment));
      }
    };
    scan(document);
    const observer = new MutationObserver((records) =>
      records.forEach(({ addedNodes }) =>
        addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        }),
      ),
    );
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    if (document.readyState === "complete")
      setTimeout(() => scan(document, true), 0);
    else
      page.addEventListener("load", () => scan(document, true), { once: true });
    return () => scan(document, true);
  };
  let refreshCommentExpansion;
  let refreshCommentMedia;
  let refreshCommentOptions;
  const initCommentFeatures = () => {
    const edits = new Map();
    const processed = new WeakSet();
    const audioByComment = new Map();
    const editApi = "https://api.dtfrandomizer.xyz/api/comments/post/";
    const requestJson = (url) =>
      new Promise((resolve) =>
        GM_xmlhttpRequest({
          method: "GET",
          url,
          onload: (response) => {
            try {
              resolve(JSON.parse(response.responseText));
            } catch {
              resolve(null);
            }
          },
          onerror: () => resolve(null),
        }),
      );
    const postId = () =>
      Number(location.pathname.match(/\/[^/]+\/(\d+)(?:-|\/|$)/)?.[1]) || null;
    const showDialog = (title, content) => {
      const overlay = document.createElement("div");
      overlay.className = "dtf-vm-comment-overlay";
      const dialog = document.createElement("section");
      dialog.className = "dtf-vm-comment-dialog";
      const heading = document.createElement("header");
      heading.textContent = title;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("aria-label", "Закрыть");
      close.onclick = () => overlay.remove();
      heading.append(close);
      dialog.append(heading, content);
      overlay.append(dialog);
      overlay.onclick = (event) => {
        if (event.target === overlay) overlay.remove();
      };
      document.body.append(overlay);
    };
    const removedCommentsEnabled = () => get("showRemovedComments", true);
    const displayEdits = (comment, data) => {
      if (
        !removedCommentsEnabled() ||
        !get("showCommentEdits", true) ||
        processed.has(comment)
      )
        return;
      const versions =
        data &&
        [data.original, ...(data.edits || []).slice(0, -1)].filter(Boolean);
      const footer = comment.querySelector(".comment-footer");
      if (!versions?.length || !footer) return;
      processed.add(comment);
      const button = document.createElement("button");
      button.className = "link-button link-button--small dtf-vm-edits";
      button.type = "button";
      button.textContent = `Изменения (${versions.length})`;
      button.onclick = (event) => {
        event.stopPropagation();
        const list = document.createElement("div");
        for (const version of versions) {
          const item = document.createElement("article");
          item.textContent =
            typeof version?.data?.text === "string"
              ? version.data.text
              : typeof version?.text === "string"
                ? version.text
                : "";
          list.append(item);
        }
        showDialog("История изменений", list);
      };
      footer.append(button);
    };
    const fetchEdits = async (id) => {
      if (
        !removedCommentsEnabled() ||
        !get("showCommentEdits", true) ||
        edits.has(id)
      )
        return;
      edits.set(id, null);
      const data = await requestJson(`${editApi}${id}/edits`);
      if (data?.status === "ok" && data.data && typeof data.data === "object") {
        for (const [key, value] of Object.entries(data.data))
          edits.set(key, value);
        document
          .querySelectorAll(".comment[data-id]")
          .forEach((comment) =>
            displayEdits(comment, edits.get(comment.dataset.id)),
          );
      }
    };
    const handleComment = (comment) => {
      if (removedCommentsEnabled() && get("showCommentEdits", true)) {
        const id = comment.dataset.id;
        if (id && edits.has(id)) displayEdits(comment, edits.get(id));
        else if (id) void fetchEdits(postId());
      }
    };
    const noCommentReasons = new Map();
    const applyNoComment = (icon) => {
      const counter = icon.closest(".comments-counter");
      const id = counter
        ?.getAttribute("href")
        ?.match(/\/(\d+)(?:[-/?#]|$)/)?.[1];
      if (!id || !noCommentReasons.has(id)) return;
      const reason = noCommentReasons.get(id);
      const previous = icon.previousElementSibling;
      if (reason && get("showNoCommentIcon", true)) {
        icon.classList.add("dtf-vm-nocomment-hidden");
        if (!previous?.classList.contains("dtf-vm-nocomment")) {
          const badge = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          );
          badge.classList.add("dtf-vm-nocomment");
          badge.setAttribute("viewBox", "0 0 20 20");
          badge.setAttribute("width", "20");
          badge.setAttribute("height", "20");
          badge.setAttribute("fill", "none");
          badge.innerHTML =
            '<path d="M15.815 9.78c0-3.402-2.716-5.614-6.035-5.614s-6.03 2.21-6.03 5.613 2.712 5.614 6.03 5.614c1.017 0 1.639-.054 2.4-.357.61-.242 1.29-.194 1.82-.016l2.163.72-.729-2.185-.005-.024c-.14-.518-.206-1.28.02-1.908.236-.663.366-.953.366-1.844m.681 6.072h.002l-.008-.002zm.986-6.073c0 1.19-.213 1.703-.465 2.406-.068.191-.069.569.015.894l.831 2.49.007.024c.163.603-.115 1.141-.427 1.45-.306.305-.86.594-1.473.389l-2.498-.831c-.253-.085-.516-.08-.676-.016-1.055.42-1.928.476-3.016.476-4.052 0-7.696-2.781-7.696-7.28S5.728 2.5 9.78 2.5c4.05 0 7.702 2.78 7.702 7.28" fill="#f44336"></path><line x1="3.5" y1="16.5" x2="16.5" y2="3.5" stroke="#f44336" stroke-width="1.8" stroke-linecap="round"/>';
          icon.before(badge);
        }
        counter.title = reason;
      } else {
        icon.classList.remove("dtf-vm-nocomment-hidden");
        previous?.classList.contains("dtf-vm-nocomment") && previous.remove();
        counter.removeAttribute("title");
      }
    };
    const updateNoComment = (items) => {
      for (const item of items || []) {
        const data = item?.data;
        const editor = data?.commentEditor;
        if (data?.id && editor)
          noCommentReasons.set(
            String(data.id),
            editor.enabled === false
              ? editor.text || "Комментирование недоступно"
              : "",
          );
      }
      document
        .querySelectorAll(
          ".content.content--short .comments-counter .icon--comment",
        )
        .forEach(applyNoComment);
    };
    const onCommentResponse = ({ url, items }) => {
      if (/\/comments(?:\?|$)/.test(url))
        for (const item of items) {
          const media = item?.media?.[0]?.data;
          if (item?.id != null && media)
            audioByComment.set(String(item.id), media.has_audio ? "1" : "0");
        }
      if (/\/(?:feed|recommendations|timeline)/.test(url))
        updateNoComment(items);
      enhance();
    };
    const hiddenFetched = new Set();
    const hiddenInProgress = new Set();
    const loadHiddenComments = async () => {
      if (!removedCommentsEnabled() || !get("showHiddenComments", true)) return;
      const id = postId();
      const dropdown = document.querySelector(".comments-header .dropdown");
      if (!id || !dropdown || hiddenFetched.has(id) || hiddenInProgress.has(id))
        return;
      hiddenInProgress.add(id);
      try {
        const [visibleResponse, idsResponse] = await Promise.all([
          page
            .fetch(
              `https://api.dtf.ru/v2.10/comments?sorting=date&contentId=${id}&firstLoad=false`,
            )
            .then((response) => response.json()),
          requestJson(`${editApi}${id}/ids`),
        ]);
        const visible = visibleResponse?.result?.items || [];
        const visibleById = new Map(
          visible.map((comment) => [String(comment.id), comment]),
        );
        const childrenByParent = new Map();
        for (const comment of visible) {
          const parentId = String(comment.replyTo);
          if (parentId === "0") continue;
          if (!childrenByParent.has(parentId))
            childrenByParent.set(parentId, []);
          childrenByParent.get(parentId).push(String(comment.id));
        }
        const hidden = (comment) =>
          comment.isRemoved || Number(comment.author?.id) === -1;
        const hasVisibleDescendantCache = new Map();
        const hasVisibleDescendant = (commentId) => {
          const cached = hasVisibleDescendantCache.get(commentId);
          if (typeof cached === "boolean") return cached;
          if (cached === "visiting") return false;
          const comment = visibleById.get(commentId);
          if (!comment) {
            hasVisibleDescendantCache.set(commentId, false);
            return false;
          }
          if (!hidden(comment)) {
            hasVisibleDescendantCache.set(commentId, true);
            return true;
          }
          hasVisibleDescendantCache.set(commentId, "visiting");
          const found = (childrenByParent.get(commentId) || []).some(
            hasVisibleDescendant,
          );
          hasVisibleDescendantCache.set(commentId, found);
          return found;
        };
        const removed = visible.filter(
          (comment) =>
            hidden(comment) && !hasVisibleDescendant(String(comment.id)),
        );
        const hiddenIds = [
          ...new Set([
            ...removed.map((comment) => String(comment.id)),
            ...(idsResponse?.data || [])
              .map(String)
              .filter((commentId) => !visibleById.has(commentId)),
          ]),
        ];
        if (!hiddenIds.length) {
          hiddenFetched.add(id);
          return;
        }
        const details = await Promise.all(
          hiddenIds.map((commentId) =>
            requestJson(`${editApi.replace("/post/", "/")}${commentId}`),
          ),
        );
        const comments = details
          .map((detail) => detail?.data)
          .filter((comment) => comment?.data?.user);
        if (!comments.length) {
          hiddenFetched.add(id);
          return;
        }
        comments.sort((a, b) => a.data.date - b.data.date);
        const byId = new Map(
          comments.map((comment) => [String(comment.id), comment]),
        );
        const replyId = (comment) =>
          String(
            comment.replyTo ??
              visibleById.get(String(comment.id))?.replyTo ??
              0,
          );
        const replyIds = [
          ...new Set(
            comments
              .map(replyId)
              .filter((reply) => reply !== "0" && !byId.has(reply)),
          ),
        ];
        const parents = await Promise.all(
          replyIds.map((reply) =>
            requestJson(`${editApi.replace("/post/", "/")}${reply}`),
          ),
        );
        parents.forEach((parent) => {
          if (parent?.data?.id) byId.set(String(parent.data.id), parent.data);
        });
        hiddenFetched.add(id);
        const button = document.createElement("button");
        button.className =
          "link-button link-button--small dtf-vm-hidden-comments";
        button.title = `Скрытые комментарии (${comments.length})`;
        button.textContent = `◉ ${comments.length}`;
        button.onclick = () => {
          const list = document.createElement("div");
          comments.forEach((comment) => {
            const { data } = comment;
            const row = document.createElement("article");
            row.className = "dtf-vm-comment-row";
            const meta = document.createElement("div");
            meta.className = "dtf-vm-comment-meta";
            const addUser = (user) => {
              if (!user) return;
              const link = document.createElement("a");
              link.className = "dtf-vm-comment-author";
              link.href = `/id${user.id}`;
              if (user.avatar) {
                const avatar = document.createElement("img");
                avatar.src = `https://leonardo.osnova.io/${user.avatar}/-/scale_crop/36x36/`;
                avatar.alt = "";
                link.append(avatar);
              }
              const name = document.createElement("span");
              name.textContent = user.name || "";
              link.append(name);
              meta.append(link);
            };
            addUser(data.user);
            const parent = byId.get(replyId(comment));
            if (parent?.data?.user) {
              const arrow = document.createElement("span");
              arrow.className = "dtf-vm-comment-reply";
              arrow.textContent = "→";
              meta.append(arrow);
              addUser(parent.data.user);
            }
            const time = document.createElement("time");
            time.className = "dtf-vm-comment-date";
            time.textContent = new Date(data.date * 1000).toLocaleString(
              "ru-RU",
            );
            meta.append(time);
            row.append(meta);
            const text = document.createElement("div");
            text.className = "dtf-vm-comment-text";
            text.textContent = data.text || "";
            row.append(text);
            for (const media of data.media || []) {
              const item = media.data || media;
              if (!item.uuid) continue;
              const container = document.createElement("div");
              container.className = "dtf-vm-comment-media";
              const width = Number(item.width) > 0 ? Number(item.width) : 400;
              const height =
                Number(item.height) > 0 ? Number(item.height) : 300;
              container.style.aspectRatio = `${width} / ${height}`;
              container.style.maxWidth = `${Math.min(width, 400, Math.round((300 * width) / height))}px`;
              if (media.type === "movie" || item.isVideo) {
                const video = document.createElement("video");
                video.src = `https://leonardo.osnova.io/${item.uuid}/-/format/mp4/#t=0.1`;
                video.playsInline = true;
                if (item.has_audio) video.controls = true;
                else {
                  video.muted = true;
                  video.loop = true;
                  video.autoplay = true;
                }
                container.append(video);
              } else {
                const image = document.createElement("img");
                image.src = `https://leonardo.osnova.io/${item.uuid}/-/format/webp/`;
                image.alt = "";
                image.loading = "lazy";
                container.append(image);
              }
              row.append(container);
            }
            list.append(row);
          });
          showDialog(`Скрытые комментарии (${comments.length})`, list);
        };
        dropdown.after(button);
      } catch (error) {
        console.warn("DTF: could not load hidden comments", error);
      } finally {
        hiddenInProgress.delete(id);
      }
    };
    const restoringRemoved = new Set();
    const restoredRemoved = new Set();
    const restoredComments = new Map();
    const restoreRemovedComment = (placeholder) => {
      if (!removedCommentsEnabled()) return;
      const comment = placeholder.closest(".comment--hidden[data-id]");
      const id = comment?.dataset.id;
      const content = comment?.querySelector(".comment__content");
      const hidden = comment?.querySelector(".comment-hidden");
      const icon = comment?.querySelector(".comment__avatar--icon");
      if (
        !id ||
        !content ||
        !hidden ||
        !icon ||
        restoredRemoved.has(comment) ||
        restoringRemoved.has(id)
      )
        return;
      restoringRemoved.add(id);
      void requestJson(`${editApi.replace("/post/", "/")}${id}`)
        .then((response) => {
          const data = response?.data?.data;
          const user = data?.user;
          if (response?.status !== "ok" || !user || !removedCommentsEnabled())
            return;
          const profile = `/id${user.id}`;
          const author = document.createElement("div");
          author.className = "author";
          author.style.setProperty("--v41cb4c68", "36px");
          const avatarLink = document.createElement("a");
          avatarLink.className = "author__avatar";
          avatarLink.href = profile;
          if (user.avatar) {
            const avatar = document.createElement("img");
            avatar.src = `https://leonardo.osnova.io/${user.avatar}/-/scale_crop/36x36/`;
            avatar.width = 36;
            avatar.height = 36;
            avatar.alt = "";
            avatar.loading = "lazy";
            avatar.style.cssText = "border-radius: 50%; object-fit: cover;";
            avatarLink.append(avatar);
          }
          const main = document.createElement("div");
          main.className = "author__main";
          const name = document.createElement("a");
          name.className = "author__name";
          name.href = profile;
          name.textContent = user.name || "";
          const removedLabel = document.createElement("div");
          removedLabel.textContent = "(комментарий удалён)";
          removedLabel.style.cssText =
            "color: red; order: 4; margin-left: 4px;";
          main.append(name, removedLabel);
          const details = document.createElement("div");
          details.className = "author__details";
          const date = new Date(data.date * 1000);
          const time = document.createElement("time");
          time.title = date.toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          time.dateTime = date.toISOString();
          time.textContent = date.toLocaleDateString("ru-RU");
          details.append(time);
          author.append(avatarLink, main, details);
          const text = document.createElement("div");
          text.className = "comment-text";
          text.style.whiteSpace = "pre-wrap";
          text.textContent = data.text || "";
          const restoredMedia = [];
          restoredComments.set(comment, {
            icon,
            hidden,
            borderRight: content.style.borderRight,
            media: restoredMedia,
          });
          icon.replaceWith(author);
          hidden.replaceWith(text);
          content.style.borderRight = "3px solid red";
          for (const media of data.media || []) {
            const item = media.data || media;
            if (!item.uuid) continue;
            const width = Number(item.width) > 0 ? Number(item.width) : 400;
            const height = Number(item.height) > 0 ? Number(item.height) : 300;
            const maxWidth = Math.min(
              width,
              400,
              Math.round((300 * width) / height),
            );
            const isVideo =
              media.type === "movie" ||
              (media.type === "image" && item.isVideo);
            const frame = document.createElement("div");
            frame.className = `andropov-media andropov-media--rounded andropov-media--bordered andropov-media--has-preview ${isVideo ? "andropov-video" : "andropov-image andropov-image--zoom"}`;
            frame.style.cssText = `aspect-ratio: ${width} / ${height}; max-width: ${maxWidth}px;`;
            if (/^[\da-f]{6}$/i.test(item.color || ""))
              frame.style.setProperty("--background-color", `#${item.color}`);
            if (isVideo) {
              frame.dataset.loaded = "true";
              const player = document.createElement("div");
              player.className = `andropov-video-player${item.has_audio ? " andropov-video-player--with-controls" : ""}`;
              const video = document.createElement("video");
              video.preload = "metadata";
              video.playsInline = true;
              if (item.has_audio) video.controls = true;
              else {
                video.muted = true;
                video.loop = true;
                video.autoplay = true;
              }
              video.src = `https://leonardo.osnova.io/${item.uuid}/-/format/mp4/#t=0.1`;
              const overlay = document.createElement("div");
              overlay.className = "andropov-video-player__overlay";
              player.append(video, overlay);
              frame.append(player);
            } else {
              const base = `https://leonardo.osnova.io/${item.uuid}`;
              const small = `${base}/-/scale_crop/${maxWidth}x/`;
              const large = `${base}/-/scale_crop/${2 * maxWidth}x/`;
              const picture = document.createElement("picture");
              const source = document.createElement("source");
              source.type = "image/webp";
              source.srcset = `${small}-/format/webp/, ${large}-/format/webp/ 2x`;
              const image = document.createElement("img");
              image.src = small;
              image.srcset = `${small}, ${large} 2x`;
              image.alt = "";
              image.loading = "lazy";
              picture.append(source, image);
              frame.append(picture);
            }
            const mediaElement = document.createElement("div");
            mediaElement.className = "comment-media";
            mediaElement.append(frame);
            text.after(mediaElement);
            restoredMedia.push(mediaElement);
          }
          restoredRemoved.add(comment);
        })
        .finally(() => restoringRemoved.delete(id));
    };
    document.documentElement.classList.toggle(
      "dtf-vm-show-removed-comments",
      Boolean(get("showRemovedComments", true)),
    );
    const enhance = (root = document) => {
      const queryAll = (selector) => [
        ...(root.matches?.(selector) ? [root] : []),
        ...(root.querySelectorAll?.(selector) || []),
      ];
      queryAll(".comment[data-id]").forEach(handleComment);
      if (get("showNoCommentIcon", true))
        queryAll(
          ".content.content--short .comments-counter .icon--comment",
        ).forEach(applyNoComment);
      if (get("showRemovedComments", true))
        queryAll(".comment-hidden__text").forEach(restoreRemovedComment);
      if (get("showHiddenComments", true)) void loadHiddenComments();
      if (get("hideCommentMedia", false))
        queryAll(".comment-media").forEach((media) => {
          if (media.hasAttribute("data-dtf-vm-hidden")) return;
          const commentId = media.closest(".comment[data-id]")?.dataset.id;
          const audio = audioByComment.get(String(commentId));
          const videoMedia = media.querySelector(":scope > .andropov-video");
          const gif = Boolean(
            videoMedia &&
            (audio === "0" ||
              (!audio &&
                videoMedia.matches(
                  '[data-loaded="true"]:not(:has(.andropov-video-player--with-controls))',
                ))),
          );
          const externalVideo = media.querySelector(
            ":scope > .andropov-external-video",
          );
          const image =
            !videoMedia &&
            !externalVideo &&
            media.querySelector(".andropov-image, img, picture");
          const video =
            !gif &&
            (audio === "1" ||
              media.querySelector(
                ":scope > .andropov-external-video, .andropov-video-player--with-controls",
              ));
          if (
            !(get("hideCommentGifs", false) && gif) &&
            !(get("hideCommentImages", false) && image) &&
            !(get("hideCommentVideos", false) && video)
          )
            return;
          media.setAttribute("data-dtf-vm-hidden", "");
          if (get("showMediaRestore", true))
            media.setAttribute("data-dtf-vm-restore", "1");
          media.dataset.dtfVmLabel = gif
            ? "Показать гифку"
            : image
              ? "Показать изображение"
              : "Показать видео";
        });
    };
    refreshCommentMedia = () => {
      document.querySelectorAll(".comment-media").forEach((media) => {
        media.removeAttribute("data-dtf-vm-hidden");
        media.removeAttribute("data-dtf-vm-restore");
        delete media.dataset.dtfVmLabel;
      });
      enhance();
    };
    refreshCommentOptions = () => {
      const showRemoved = get("showRemovedComments", true);
      document.documentElement.classList.toggle(
        "dtf-vm-show-removed-comments",
        showRemoved,
      );
      if (showRemoved) {
        document
          .querySelectorAll(".dtf-vm-hidden-comments")
          .forEach((button) => {
            button.hidden = !get("showHiddenComments", true);
          });
        enhance();
        if (get("showHiddenComments", true)) void loadHiddenComments();
        if (get("showCommentEdits", true)) {
          const id = postId();
          if (id) void fetchEdits(id);
          document.querySelectorAll(".comment[data-id]").forEach(handleComment);
        }
      } else {
        for (const [comment, original] of restoredComments) {
          const author = comment.querySelector(".author");
          const text = comment.querySelector(".comment-text");
          author?.replaceWith(original.icon);
          text?.replaceWith(original.hidden);
          original.media.forEach((media) => media.remove());
          restoredRemoved.delete(comment);
          const content = comment.querySelector(".comment__content");
          if (content) content.style.borderRight = original.borderRight;
          restoredComments.delete(comment);
        }
      }
      if (!showRemoved || !get("showCommentEdits", true))
        document
          .querySelectorAll(".dtf-vm-edits")
          .forEach((button) => button.remove());
      if (!showRemoved || !get("showHiddenComments", true))
        document
          .querySelectorAll(".dtf-vm-hidden-comments")
          .forEach((button) => {
            button.hidden = true;
          });
      else
        document
          .querySelectorAll(".dtf-vm-hidden-comments")
          .forEach((button) => {
            button.hidden = false;
          });
      updateNoComment([]);
      scheduleQuote();
    };
    commentFeedListeners.add(onCommentResponse);
    recentCommentResponses.forEach(onCommentResponse);
    const observer = new MutationObserver((records) =>
      records.forEach(({ addedNodes }) =>
        addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) enhance(node);
        }),
      ),
    );
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    document.addEventListener(
      "click",
      (event) => {
        const media = event.target.closest?.(
          '[data-dtf-vm-hidden][data-dtf-vm-restore="1"]',
        );
        if (!media) return;
        event.preventDefault();
        event.stopPropagation();
        media.removeAttribute("data-dtf-vm-hidden");
        media.removeAttribute("data-dtf-vm-restore");
      },
      true,
    );
    let quoteButton;
    let quoteTimer;
    const removeQuoteButton = () => {
      quoteButton?.remove();
      quoteButton = null;
    };
    const updateQuoteButton = () => {
      if (!get("enableCommentQuote", true)) return removeQuoteButton();
      const editor = document.querySelector(".contenteditable__input");
      const selection = page.getSelection();
      if (!editor || !selection?.rangeCount || selection.isCollapsed)
        return removeQuoteButton();
      const range = selection.getRangeAt(0);
      if (
        editor.contains(range.commonAncestorContainer) ||
        document
          .querySelector(".editor__content")
          ?.contains(range.commonAncestorContainer)
      )
        return removeQuoteButton();
      const text = selection.toString().trim();
      if (!text) return removeQuoteButton();
      const rect = range.getBoundingClientRect();
      removeQuoteButton();
      quoteButton = document.createElement("button");
      quoteButton.className = "dtf-vm-quote";
      quoteButton.type = "button";
      quoteButton.textContent = "Цитировать";
      quoteButton.style.top = `${rect.bottom + page.scrollY + 5}px`;
      quoteButton.style.left = `${rect.left + page.scrollX + rect.width / 2}px`;
      quoteButton.onclick = () => {
        editor.innerText = `${editor.innerText ? `${editor.innerText.trimEnd()}\n` : ""}>${text}\n\n`;
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        removeQuoteButton();
        if (get("quoteMoveTo", false)) {
          quoteButton = document.createElement("button");
          quoteButton.className = "dtf-vm-quote";
          quoteButton.type = "button";
          quoteButton.textContent = "Перейти";
          quoteButton.onclick = () => {
            editor.scrollIntoView({ behavior: "smooth", block: "center" });
            editor.focus();
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            const selection = page.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            removeQuoteButton();
          };
          document.body.append(quoteButton);
        } else selection.removeAllRanges();
      };
      document.body.append(quoteButton);
    };
    const scheduleQuote = () => {
      clearTimeout(quoteTimer);
      quoteTimer = setTimeout(updateQuoteButton, 100);
    };
    document.addEventListener("selectionchange", scheduleQuote);
    document.addEventListener("keyup", scheduleQuote);
    document.addEventListener("mousedown", (event) => {
      if (quoteButton && !quoteButton.contains(event.target))
        removeQuoteButton();
    });
    if (get("showCommentEdits", true)) {
      const id = postId();
      if (id) void fetchEdits(id);
    }
    enhance();
    return () => {
      observer.disconnect();
      commentFeedListeners.delete(onCommentResponse);
      document.removeEventListener("selectionchange", scheduleQuote);
      document.removeEventListener("keyup", scheduleQuote);
      removeQuoteButton();
      clearTimeout(quoteTimer);
    };
  };
  let stopCommentFeatures;

  const initialize = () => {
    stopCommentFeatures = initCommentFeatures();
    refreshCommentExpansion = expandComments();
    const topButton = document.createElement("button");
    topButton.className = "dtf-vm-top";
    topButton.type = "button";
    topButton.textContent = "↑";
    topButton.setAttribute("aria-label", "Наверх");
    topButton.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
    const updateTopButton = () => {
      topButton.hidden = !get("backToTop", false) || window.scrollY < 400;
    };

    let captureMySubscriptions = false;
    let sawMySubscriptionsList = false;
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("button.link-button--small");
        if (button?.textContent.trim() === "Мои подписки") {
          captureMySubscriptions = true;
          sawMySubscriptionsList = false;
        }
      },
      true,
    );
    const syncMySubscriptions = () => {
      if (!captureMySubscriptions) return;
      const list = document.querySelector(".subsite-list");
      if (!list) {
        if (sawMySubscriptionsList) captureMySubscriptions = false;
        return;
      }
      sawMySubscriptionsList = true;
      const topics = [...list.querySelectorAll(".subsite-list__item")]
        .map((row) => {
          const link = row.querySelector(".subsite-list__link");
          const name = row
            .querySelector(".subsite-list__name")
            ?.textContent.trim();
          if (!link || !name) return null;
          return {
            href: new URL(link.href).pathname,
            name,
            image: row.querySelector("img")?.src || "",
          };
        })
        .filter(Boolean);
      if (!topics.length) return;
      subscribedTopics = topics;
      set("subscribedTopics", subscribedTopics);
      updateTopicLimitControl();
      renderTopics();
    };

    const cachedTopicCatalog = get("topicCatalogCache", []);
    let topicCatalog = Array.isArray(cachedTopicCatalog)
      ? cachedTopicCatalog.filter(
          (topic) =>
            typeof topic?.url === "string" && typeof topic?.name === "string",
        )
      : [];
    let topicsRequestStarted = false;
    let subscribedTopics = get("subscribedTopics", null);
    let topicsExpanded = false;
    let topicSearch = "";
    let draggedTopic = null;
    const topicOrderKey = () =>
      get("onlySubscribedTopics", false) ? "subscriptions" : "all";
    const topicPath = (href) =>
      new URL(href, location.origin).pathname.replace(/\/$/, "");
    const applyTopicOrder = (items) => {
      const orders = get("topicOrders", {});
      const order = orders?.[topicOrderKey()] || [];
      if (!order.length) return items;
      const positions = new Map(order.map((path, index) => [path, index]));
      return items
        .slice()
        .sort(
          (a, b) =>
            (positions.get(topicPath(a.href)) ?? Infinity) -
            (positions.get(topicPath(b.href)) ?? Infinity),
        );
    };
    const saveTopicOrder = (items) => {
      const orders = get("topicOrders", {});
      orders[topicOrderKey()] = [...items].map((item) => topicPath(item.href));
      set("topicOrders", orders);
    };
    const placeTopicLinks = (items, current, parent, before) => {
      if (items.some((item, index) => item.element !== current[index])) {
        items.forEach(({ element }) => parent.insertBefore(element, before));
      }
    };
    const enableTopicDragging = (items, parent) => {
      const enabled = Boolean(get("reorderTopics", false));
      items.forEach((item) => {
        item.draggable = enabled;
        item.ondragstart = enabled
          ? (event) => {
              draggedTopic = item;
              item.classList.add("dtf-vm-dragging");
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", item.href);
            }
          : null;
        item.ondragend = () => {
          item.classList.remove("dtf-vm-dragging");
          draggedTopic = null;
        };
        item.ondragover = enabled
          ? (event) => {
              event.preventDefault();
              if (!draggedTopic || draggedTopic === item) return;
              const { top, height } = item.getBoundingClientRect();
              parent.insertBefore(
                draggedTopic,
                event.clientY < top + height / 2 ? item : item.nextSibling,
              );
            }
          : null;
        item.ondrop = enabled
          ? (event) => {
              event.preventDefault();
              saveTopicOrder(
                parent.querySelectorAll(
                  ":scope > a[href]:not(.dtf-vm-topic-show-all)",
                ),
              );
            }
          : null;
      });
    };
    const topicNameGroup = (name) =>
      /^[A-Za-z]/u.test(name.trimStart())
        ? 0
        : /^[А-Яа-яЁё]/u.test(name.trimStart())
          ? 1
          : 2;
    const topicCollators = [
      new Intl.Collator("en", { sensitivity: "base" }),
      new Intl.Collator("ru", { sensitivity: "base" }),
    ];
    const compareTopicNames = (a, b) => {
      const groupA = topicNameGroup(a);
      const groupB = topicNameGroup(b);
      return (
        groupA - groupB || topicCollators[groupA === 1 ? 1 : 0].compare(a, b)
      );
    };
    const sortedTopicCache = new WeakMap();
    const catalogItems = () =>
      topicCatalog.map((topic) => ({
        href: new URL(topic.url).pathname.replace(/\/$/, ""),
        name: topic.name,
        image: topic.avatarUuid
          ? `https://leonardo.osnova.io/${encodeURIComponent(topic.avatarUuid)}/-/scale_crop/72x72/`
          : "",
      }));
    const topicSection = () => {
      const title = document.querySelector('[data-section="topics"]');
      const section = title?.parentElement;
      const content =
        section &&
        [...section.children].find(
          (child) => child !== title && child.querySelector("a[href]"),
        );
      return content || null;
    };
    const availableTopicCount = () =>
      get("onlySubscribedTopics", false)
        ? subscribedTopics?.length || 0
        : get("smallFixes", false)
          ? topicCatalog.length
          : topicSection()?.querySelectorAll(":scope > a[href]").length || 0;
    const updateTopicControls = () => {
      const enabled = Boolean(get("smallFixes", false));
      for (const name of ["onlySubscribedTopics", "topicLimit"]) {
        const input = document.querySelector(`.dtf-vm-dialog [name=${name}]`);
        if (!input) continue;
        input.disabled = !enabled;
        input.closest("label").classList.toggle("dtf-vm-disabled", !enabled);
      }
    };
    const updateTopicLimitControl = () => {
      const input = document.querySelector(".dtf-vm-dialog [name=topicLimit]");
      if (!input) return;
      const max = Math.max(5, availableTopicCount());
      input.max = max;
      input.value = Math.min(Number(get("topicLimit", 10)) || 10, max);
      input.closest("label").querySelector("output").value = input.value;
    };
    const renderTopics = () => {
      const content = topicSection();
      if (!content) return;
      let search = content.querySelector(".dtf-vm-topic-search");
      if (!get("topicSearchEnabled", false)) {
        search?.remove();
        topicSearch = "";
        content
          .querySelectorAll("a[href]")
          .forEach((item) =>
            item.classList.remove("dtf-vm-topic-search-hidden"),
          );
      } else if (!search) {
        search = document.createElement("input");
        search.className = "dtf-vm-topic-search";
        search.type = "search";
        search.placeholder = "Поиск по темам";
        search.setAttribute("aria-label", "Поиск по темам");
        search.value = topicSearch;
        search.oninput = () => {
          topicSearch = search.value.trim().toLocaleLowerCase();
          filterTopicSearch(content);
        };
        content.prepend(search);
      }
      const filterTopicSearch = (root) =>
        root
          .querySelectorAll("a[href]")
          .forEach((item) =>
            item.classList.toggle(
              "dtf-vm-topic-search-hidden",
              Boolean(topicSearch) &&
                !item.textContent
                  .trim()
                  .toLocaleLowerCase()
                  .includes(topicSearch),
            ),
          );
      const nativeLinks = [...content.querySelectorAll(":scope > a[href]")];
      const extra = content.querySelector(".dtf-vm-topic-extras");
      const nativeShowAll = [...content.children].find(
        (item) =>
          item.tagName !== "A" &&
          item.textContent
            .trim()
            .toLocaleLowerCase()
            .startsWith("показать все"),
      );
      if (!get("smallFixes", false)) {
        extra?.remove();
        nativeLinks.forEach((link) =>
          link.classList.remove("dtf-vm-topic-original"),
        );
        nativeShowAll?.classList.remove("dtf-vm-topic-original");
        const ordered = applyTopicOrder(
          nativeLinks.map((link) => ({ href: link.href, element: link })),
        );
        placeTopicLinks(ordered, nativeLinks, content, nativeShowAll);
        enableTopicDragging(
          ordered.map(({ element }) => element),
          content,
        );
        filterTopicSearch(content);
        return;
      }
      const onlySubscribed = get("onlySubscribedTopics", false);
      nativeLinks.forEach((link) => {
        link.hidden = false;
      });
      const mode = onlySubscribed ? "subscriptions" : "all";
      if (extra?.dataset.mode === mode) {
        nativeLinks.forEach((link) =>
          link.classList.add("dtf-vm-topic-original"),
        );
        nativeShowAll?.classList.add("dtf-vm-topic-original");
        enableTopicDragging(
          [...extra.querySelectorAll(":scope > a[href]")],
          extra,
        );
        filterTopicSearch(content);
        return;
      }
      extra?.remove();
      if (onlySubscribed && !Array.isArray(subscribedTopics)) {
        nativeLinks.forEach((link) =>
          link.classList.add("dtf-vm-topic-original"),
        );
        nativeShowAll?.classList.add("dtf-vm-topic-original");
        filterTopicSearch(content);
        return;
      }
      if (!onlySubscribed && !topicCatalog.length) {
        let fallbackLinks = nativeLinks;
        if (get("sortTopics", false)) {
          fallbackLinks = nativeLinks
            .slice()
            .sort((a, b) =>
              compareTopicNames(a.textContent.trim(), b.textContent.trim()),
            );
        }
        const orderedLinks = applyTopicOrder(
          fallbackLinks.map((link) => ({ href: link.href, element: link })),
        );
        placeTopicLinks(orderedLinks, nativeLinks, content, nativeShowAll);
        nativeLinks.forEach((link) =>
          link.classList.remove("dtf-vm-topic-original"),
        );
        nativeShowAll?.classList.remove("dtf-vm-topic-original");
        enableTopicDragging(
          orderedLinks.map(({ element }) => element),
          content,
        );
        filterTopicSearch(content);
        loadTopics();
        return;
      }
      nativeLinks.forEach((link) =>
        link.classList.add("dtf-vm-topic-original"),
      );
      nativeShowAll?.classList.add("dtf-vm-topic-original");
      const source = onlySubscribed ? subscribedTopics : topicCatalog;
      let items;
      if (get("sortTopics", false)) {
        items = sortedTopicCache.get(source);
        if (!items) {
          items = onlySubscribed ? source.slice() : catalogItems();
          items.sort((a, b) => compareTopicNames(a.name, b.name));
          sortedTopicCache.set(source, items);
        }
      } else {
        items = onlySubscribed ? source : catalogItems();
      }
      items = applyTopicOrder(items);
      const limit = Math.max(
        5,
        Math.min(
          Number(get("topicLimit", 10)) || 10,
          Math.max(5, items.length),
        ),
      );
      const list = document.createElement("div");
      list.className = "dtf-vm-topic-extras";
      list.dataset.mode = mode;
      items.forEach((topic, index) => {
        const item = document.createElement("a");
        item.className = "sidebar-item";
        item.hidden = !topicsExpanded && index >= limit;
        item.href = topic.href;
        item.setAttribute("data-router-link", "");
        if (topic.image) {
          const image = document.createElement("img");
          image.className = "sidebar-item__image";
          image.src = topic.image;
          image.alt = "";
          image.loading = "lazy";
          item.append(image);
        }
        const label = document.createElement("div");
        label.className = "sidebar-item__text";
        label.textContent = topic.name;
        item.append(label);
        list.append(item);
      });
      enableTopicDragging([...list.querySelectorAll(":scope > a[href]")], list);
      if (items.length > limit || (topicsExpanded && items.length > 0)) {
        const showAll = document.createElement("button");
        showAll.className = "sidebar-item dtf-vm-topic-show-all";
        showAll.type = "button";
        showAll.textContent = topicsExpanded ? "Скрыть все" : "Показать все";
        showAll.onclick = () => {
          topicsExpanded = !topicsExpanded;
          list.remove();
          renderTopics();
        };
        if (topicsExpanded) list.prepend(showAll);
        else list.append(showAll);
      }
      if (list.childElementCount) content.append(list);
      filterTopicSearch(content);
    };
    const loadTopics = () => {
      if (topicsRequestStarted) return;
      topicsRequestStarted = true;
      const all = new Map();
      const cursors = new Set();
      const fail = (error) =>
        error && console.warn("DTF: не удалось прочитать список тем", error);
      const finish = () => {
        const updated = [...all.values()].map((topic) => ({
          url: topic.url,
          name: topic.name,
          avatarUuid: topic.avatar?.data?.uuid || "",
        }));
        if (updated.length) {
          topicCatalog = updated;
          set("topicCatalogCache", topicCatalog);
        }
        updateTopicLimitControl();
        renderTopics();
      };
      const requestPage = (lastId, lastSortingValue, page = 0) => {
        const url = new URL("https://api.dtf.ru/v2.51/search/subsites");
        url.searchParams.set("q", "");
        url.searchParams.set("type", "2");
        if (lastId != null) url.searchParams.set("lastId", lastId);
        if (lastSortingValue != null)
          url.searchParams.set("lastSortingValue", lastSortingValue);
        GM_xmlhttpRequest({
          method: "GET",
          url: url.href,
          anonymous: true,
          onload: (response) => {
            try {
              if (response.status < 200 || response.status >= 300)
                throw new Error(`HTTP ${response.status}`);
              const result = JSON.parse(response.responseText).result;
              if (!Array.isArray(result?.items))
                throw new Error("Invalid topics response");
              for (const item of result.items) {
                const data = item.data;
                if (data?.id && data.url) all.set(data.id, data);
              }
              const cursor = `${result.lastId}:${result.lastSortingValue}`;
              if (result.items.length && page < 20 && !cursors.has(cursor)) {
                cursors.add(cursor);
                requestPage(result.lastId, result.lastSortingValue, page + 1);
              } else finish();
            } catch (error) {
              fail(error);
            }
          },
          onerror: () => fail(),
        });
      };
      requestPage();
    };
    const setQuality = (enabled) => {
      document
        .querySelectorAll(".block-wrapper--media .andropov-image")
        .forEach((media) => {
          const [w, h] = media.style.aspectRatio.split("/").map(Number);
          const rect = media.getBoundingClientRect();
          const ratio = h ? w / h : w || rect.width / rect.height;
          if (ratio <= 1 && media.dataset.dtfQualityStyle === undefined) return;

          if (!enabled) {
            if (media.dataset.dtfQualityStyle !== undefined) {
              media.setAttribute("style", media.dataset.dtfQualityStyle);
              delete media.dataset.dtfQualityStyle;
            }
            media.querySelectorAll("source, img").forEach((node) => {
              for (const attr of ["src", "srcset"]) {
                const key = `dtfQuality${attr}`;
                if (node.dataset[key] === undefined) continue;
                node.dataset[key]
                  ? node.setAttribute(attr, node.dataset[key])
                  : node.removeAttribute(attr);
                delete node.dataset[key];
              }
            });
            return;
          }

          const targetWidth = Math.min(
            2560,
            Math.ceil(media.parentElement.clientWidth),
          );
          if (targetWidth <= 0) return;
          if (media.dataset.dtfQualityStyle === undefined)
            media.dataset.dtfQualityStyle = media.getAttribute("style") || "";
          media.style.setProperty("width", "100%", "important");
          media.querySelectorAll("source, img").forEach((node) => {
            for (const attr of ["src", "srcset"]) {
              const original = node.getAttribute(attr);
              if (original === null) continue;
              const key = `dtfQuality${attr}`;
              if (node.dataset[key] === undefined) node.dataset[key] = original;
              const updated = node.dataset[key]
                .split(",")
                .map((candidate) => {
                  const [url, ...descriptor] = candidate.trim().split(/\s+/);
                  const width = Math.min(
                    2560,
                    targetWidth * (descriptor.includes("2x") ? 2 : 1),
                  );
                  return `${url.replace(/(\/-\/scale_crop\/)\d+x(?=\/)/, `$1${width}x`)} ${descriptor.join(" ")}`.trim();
                })
                .join(", ");
              if (updated !== original) node.setAttribute(attr, updated);
            }
          });
        });
    };

    const syncClassicGalleries = (enabled, limit) => {
      document
        .querySelectorAll(".block-wrapper--gallery .mvqlyolt")
        .forEach((gallery) => {
          const more =
            gallery.children.length > limit
              ? gallery.children.length - limit
              : 0;
          [...gallery.children].forEach((slot, index) => {
            if (enabled && index > limit) slot.dataset.dtfGalleryHidden = "";
            else delete slot.dataset.dtfGalleryHidden;
            if (enabled && index === limit && more)
              slot.dataset.dtfGalleryMore = `+${more}`;
            else delete slot.dataset.dtfGalleryMore;
          });
        });
    };

    const syncVideos = () => {
      const pauseByDefault = Boolean(get("pauseVideosByDefault", false));
      document.querySelectorAll("video").forEach((video) => {
        if (
          pauseByDefault &&
          !video.hasAttribute("data-dtf-vm-initial-pause")
        ) {
          video.pause();
          video.setAttribute("data-dtf-vm-initial-pause", "");
        } else if (!pauseByDefault) {
          video.removeAttribute("data-dtf-vm-initial-pause");
        }
      });
    };
    const pauseVideosOutsideViewport = () => {
      if (!get("pauseVideosOnScroll", false)) return;
      document.querySelectorAll("video").forEach((video) => {
        if (video.paused) return;
        const rect = video.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) video.pause();
      });
    };

    const apply = () => {
      document.documentElement.classList.toggle(
        "dtf-vm-header-width",
        Boolean(get("headerWidth", false)),
      );
      const plainSearch = Boolean(get("plainHeaderSearch", false));
      document
        .querySelectorAll(".quick-search-button svg use")
        .forEach((icon) => {
          icon.dataset.dtfOriginalHref ??=
            icon.getAttribute("href") || icon.getAttribute("xlink:href") || "";
          const href = plainSearch
            ? icon.dataset.dtfOriginalHref.replace(
                /#sprite-search_(?:enhanced|thin)$/,
                "#sprite-search_thin",
              )
            : icon.dataset.dtfOriginalHref;
          icon.setAttribute("href", href);
          icon.setAttribute("xlink:href", href);
        });
      syncVideos();
      syncClassicGalleries(
        Boolean(get("classicGallery", false)),
        Math.min(8, Math.max(4, Number(get("galleryPreviewCount", 4)) || 4)),
      );
      document.documentElement.classList.toggle(
        "dtf-vm-classic-gallery",
        Boolean(get("classicGallery", false)),
      );
      syncMySubscriptions();
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle(
          "dtf-vm-centered",
          Boolean(get("centered", false)),
        );
        const layout = view.closest(".layout");
        if (layout) {
          const css = getComputedStyle(layout);
          const desktop = window.innerWidth >= 1240;
          const tablet = window.innerWidth >= 925;
          const left = tablet
            ? parseFloat(css.getPropertyValue("--layout-left-aside-width")) ||
              220
            : 0;
          const right =
            desktop && !stretchRightActive()
              ? parseFloat(
                  css.getPropertyValue("--layout-right-aside-width"),
                ) || 320
              : 0;
          const columns = Number(tablet) + Number(desktop) + 1;
          const gap = parseFloat(css.columnGap) || 0;
          const metrics = feedMetrics(
            window.innerWidth,
            get("width", 100),
            left,
            right,
            gap,
          );
          layout.style.setProperty("--dtf-feed-width", `${metrics.feed}px`);
          layout.style.setProperty("--dtf-layout-width", `${metrics.layout}px`);
          document.documentElement.style.setProperty(
            "--dtf-feed-width",
            `${metrics.feed}px`,
          );
          document.documentElement.style.setProperty(
            "--dtf-layout-width",
            `${metrics.layout}px`,
          );
          const header = document.querySelector(".header__layout");
          document.documentElement.style.setProperty(
            "--dtf-header-left",
            `${view.getBoundingClientRect().left - (header?.getBoundingClientRect().left ?? 0)}px`,
          );
        }
      });
      setQuality(Boolean(get("quality", false)));
      document.documentElement.classList.toggle(
        "dtf-vm-small-fixes",
        Boolean(get("smallFixes", false)),
      );
      document.documentElement.classList.toggle(
        "dtf-vm-disable-spoiler-blur",
        Boolean(get("disableSpoilerBlur", false)),
      );
      document.documentElement.classList.toggle(
        "dtf-vm-hide-right-sidebar",
        Boolean(get("hideRightSidebar", false)),
      );
      document.documentElement.classList.toggle(
        "dtf-vm-stretch-right",
        stretchRightActive(),
      );
      applySidebarClasses(document.documentElement);
      syncPlus();
      syncLivePanel();
      syncViewedPosts();
      document.documentElement.classList.toggle(
        "dtf-vm-back-to-top",
        Boolean(get("backToTop", false)),
      );
      document.documentElement.classList.toggle(
        "dtf-vm-reorder-topics",
        Boolean(get("reorderTopics", false)),
      );
      renderTopics();
      updateTopicLimitControl();
      updateTopicControls();
      updateRightPanelControls();
      updateTopButton();
    };

    const openSettings = () => {
      if (document.querySelector(".dtf-vm-overlay")) return;
      const width = Math.min(get("width", 100), 100);
      const topicLimitMax = Math.max(5, availableTopicCount());
      const topicLimit = Math.max(
        5,
        Math.min(Number(get("topicLimit", 10)) || 10, topicLimitMax),
      );
      const galleryPreviewCount = Math.min(
        8,
        Math.max(4, Number(get("galleryPreviewCount", 4)) || 4),
      );
      const overlay = document.createElement("div");
      overlay.className = "dtf-vm-overlay";
      overlay.innerHTML = `<section class="dtf-vm-dialog" role="dialog" aria-modal="true" aria-labelledby="dtf-vm-title"><button class="dtf-vm-close" aria-label="Закрыть">×</button><h2 id="dtf-vm-title">Настройки</h2><div class="dtf-vm-settings-grid"><div class="dtf-vm-settings-column"><div class="dtf-vm-section"><h3>Лента и изображения</h3><label>Ширина ленты: <output>${width}%</output><input name="width" type="range" min="50" max="100" step="5" value="${width}"></label><label><input name="centered" type="checkbox" ${get("centered", false) ? "checked" : ""}> Центрировать изображения</label><label><input name="classicGallery" type="checkbox" ${get("classicGallery", false) ? "checked" : ""}> Классическая галерея<small class="dtf-vm-hint">Показывает галерею сеткой.</small></label><label class="dtf-vm-subsetting">Изображений до 4–8: <output>${galleryPreviewCount}</output><input name="galleryPreviewCount" type="range" min="4" max="8" step="1" value="${galleryPreviewCount}"></label><label><input name="disableSpoilerBlur" type="checkbox" ${get("disableSpoilerBlur", false) ? "checked" : ""}> Отключить размытие спойлеров</label><label><input name="quality" type="checkbox" ${get("quality", false) ? "checked" : ""}> Повысить качество</label><label><input name="pauseVideosOnScroll" type="checkbox" ${get("pauseVideosOnScroll", false) ? "checked" : ""}> Пауза при скролле<small class="dtf-vm-hint">Ставит видео на паузу, когда оно выходит из области видимости.</small></label><label><input name="pauseVideosByDefault" type="checkbox" ${get("pauseVideosByDefault", false) ? "checked" : ""}> Пауза по умолчанию<small class="dtf-vm-hint">Ставит новые видео на паузу, чтобы они не запускались сами.</small></label><label class="dtf-vm-dependent"><input name="stretchRight" type="checkbox" ${get("stretchRight", false) ? "checked" : ""}> Растянуть вправо<small class="dtf-vm-hint">Использовать место скрытой правой панели.</small></label><label><input name="hideViewedPosts" type="checkbox" ${get("hideViewedPosts", false) ? "checked" : ""}> Скрывать просмотренное<small class="dtf-vm-hint">Автоматически сворачивать просмотренные посты.</small></label><label class="dtf-vm-subsetting"><input name="showHideButton" type="checkbox" ${get("showHideButton", false) ? "checked" : ""}> Кнопки управления<small class="dtf-vm-hint">Добавить кнопки показать/скрыть на посты.</small></label></div></div><div class="dtf-vm-settings-column"><div class="dtf-vm-section"><h3>Шапка</h3><label><input name="headerWidth" type="checkbox" ${get("headerWidth", false) ? "checked" : ""}> Подогнать шапку под ширину ленты</label><label><input name="plainHeaderSearch" type="checkbox" ${get("plainHeaderSearch", false) ? "checked" : ""}> Лупа без звёздочки</label><label><input name="hideDonationsMenu" type="checkbox" ${get("hideDonationsMenu", false) ? "checked" : ""}> Скрыть «Донаты» в меню профиля</label><label><input name="hidePlusMenu" type="checkbox" ${get("hidePlusMenu", false) ? "checked" : ""}> Скрыть «Подписка Plus» в меню профиля</label></div><div class="dtf-vm-section"><h3>Интерфейс</h3><label><input name="backToTop" type="checkbox" ${get("backToTop", false) ? "checked" : ""}> Кнопка «Наверх»</label><label><input name="smallFixes" type="checkbox" ${get("smallFixes", false) ? "checked" : ""}> Улучшения интерфейса<small class="dtf-vm-hint">Добавляет темы и меняет поле комментария.</small></label></div><div class="dtf-vm-section"><h3>Комментарии</h3><label><input name="expandComments" type="checkbox" ${get("expandComments", true) ? "checked" : ""}> Раскрывать комментарии<small class="dtf-vm-hint">Автоматически раскрывает свернутый список комментариев.</small></label><label class="dtf-vm-subsetting"><input name="expandAllBranches" type="checkbox" ${get("expandAllBranches", false) ? "checked" : ""}> Раскрывать ответы<small class="dtf-vm-hint">Автоматически раскрывает ответы во всех ветках. На длинных обсуждениях может замедлить страницу.</small></label><label class="dtf-vm-subsetting"><input name="skipHiddenComments" type="checkbox" ${get("skipHiddenComments", true) ? "checked" : ""}> Не раскрывать скрытые комментарии</label><label><input name="showRemovedComments" type="checkbox" ${get("showRemovedComments", true) ? "checked" : ""}> Показывать удалённые комментарии</label><label class="dtf-vm-subsetting"><input name="showCommentEdits" type="checkbox" ${get("showCommentEdits", true) ? "checked" : ""}> Показывать историю изменений</label><label class="dtf-vm-subsetting"><input name="showHiddenComments" type="checkbox" ${get("showHiddenComments", true) ? "checked" : ""}> Показывать комментарии, скрытые модерацией</label><label><input name="hideCommentMedia" type="checkbox" ${get("hideCommentMedia", false) ? "checked" : ""}> Скрывать вложения</label><label class="dtf-vm-subsetting"><input name="hideCommentGifs" type="checkbox" ${get("hideCommentGifs", false) ? "checked" : ""}> Скрывать GIF</label><label class="dtf-vm-subsetting"><input name="hideCommentImages" type="checkbox" ${get("hideCommentImages", false) ? "checked" : ""}> Скрывать изображения</label><label class="dtf-vm-subsetting"><input name="hideCommentVideos" type="checkbox" ${get("hideCommentVideos", false) ? "checked" : ""}> Скрывать видео</label><label class="dtf-vm-subsetting"><input name="showMediaRestore" type="checkbox" ${get("showMediaRestore", true) ? "checked" : ""}> Кнопка «Показать»</label><label><input name="showNoCommentIcon" type="checkbox" ${get("showNoCommentIcon", true) ? "checked" : ""}> Показывать, почему нельзя комментировать</label><label><input name="enableCommentQuote" type="checkbox" ${get("enableCommentQuote", true) ? "checked" : ""}> Добавлять цитату в комментарий</label><label class="dtf-vm-subsetting"><input name="quoteMoveTo" type="checkbox" ${get("quoteMoveTo", false) ? "checked" : ""}> Кнопка перехода к полю комментария</label></div><div class="dtf-vm-section"><h3>Правая панель</h3><label><input name="hideRightSidebar" type="checkbox" ${get("hideRightSidebar", false) ? "checked" : ""}> Скрыть «Популярные комментарии»</label><label class="dtf-vm-dependent"><input name="livePanel" type="checkbox" ${get("livePanel", false) ? "checked" : ""}> Live-панель<small class="dtf-vm-hint">Показывает ленту с последними комментариями.</small></label></div></div><div class="dtf-vm-settings-column"><div class="dtf-vm-section"><h3>Темы</h3><label><input name="topicSearchEnabled" type="checkbox" ${get("topicSearchEnabled", false) ? "checked" : ""}> Поиск по темам</label><label><input name="onlySubscribedTopics" type="checkbox" ${get("onlySubscribedTopics", false) ? "checked" : ""}> Показывать только темы из моих подписок</label><label>Тем до «Показать все»: <output>${topicLimit}</output><input name="topicLimit" type="range" min="5" max="${topicLimitMax}" step="1" value="${topicLimit}"></label><label><input name="sortTopics" type="checkbox" ${get("sortTopics", false) ? "checked" : ""}> Сортировать темы: EN, затем RU</label><label><input name="reorderTopics" type="checkbox" ${get("reorderTopics", false) ? "checked" : ""}> Менять порядок тем<small class="dtf-vm-hint">Перетаскивайте темы в списке слева.</small></label><button class="dtf-vm-reset-topics" type="button">Сбросить сохранённый порядок</button></div><div class="dtf-vm-section"><h3>Разное</h3><label><input name="hidePlusAds" type="checkbox" ${get("hidePlusAds", false) ? "checked" : ""}> Скрывать рекламу<small class="dtf-vm-hint">Скрывает рекламные баннеры, промо и виджеты оплаты.</small></label><label><input name="plusFeatures" type="checkbox" ${get("plusFeatures", false) ? "checked" : ""}> Функции Plus<small class="dtf-vm-hint">ЛС, история GIF и скрытые комментарии. Серверные функции не гарантированы.</small></label></div></div><div class="dtf-vm-settings-column"><div class="dtf-vm-section"><h3>Левая панель</h3><label><input name="hidePopular" type="checkbox" ${get("hidePopular", false) ? "checked" : ""}> Скрыть «Популярное»</label><label><input name="hideNew" type="checkbox" ${get("hideNew", false) ? "checked" : ""}> Скрыть «Свежее»</label><label><input name="hideMy" type="checkbox" ${get("hideMy", false) ? "checked" : ""}> Скрыть «Моя лента»</label><label><input name="hideMessages" type="checkbox" ${get("hideMessages", false) ? "checked" : ""}> Скрыть «Сообщения»</label><label><input name="hideRating" type="checkbox" ${get("hideRating", false) ? "checked" : ""}> Скрыть «Рейтинг»</label><label><input name="hideGames" type="checkbox" ${get("hideGames", false) ? "checked" : ""}> Скрыть раздел «Игры»</label><label><input name="hideTopics" type="checkbox" ${get("hideTopics", false) ? "checked" : ""}> Скрыть раздел «Темы»</label><label><input name="hideFooter" type="checkbox" ${get("hideFooter", false) ? "checked" : ""}> Скрыть нижний блок меню DTF</label></div></div></div></section>`;
      const columns = overlay.querySelectorAll(".dtf-vm-settings-column");
      const sections = [
        ...overlay.querySelectorAll(
          ".dtf-vm-settings-column > .dtf-vm-section",
        ),
      ];
      columns[0].replaceChildren(sections[0], sections[1]);
      columns[1].replaceChildren(sections[2], sections[3], sections[4]);
      columns[2].replaceChildren(sections[7], sections[5], sections[6]);
      columns[3].remove();
      const sectionIcons = {
        "Лента и изображения":
          '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
        Шапка:
          '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 7h.01M10 7h.01"/>',
        Интерфейс:
          '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
        Комментарии:
          '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h8M8 14h5"/>',
        "Правая панель":
          '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
        Темы: '<path d="M4 7.5V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2.5"/><path d="M3 11h10v10H3zM6 14h4M6 17h4"/>',
        Разное:
          '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
        "Левая панель":
          '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 4v16"/>',
      };
      for (const heading of overlay.querySelectorAll(".dtf-vm-section h3")) {
        const icon = document.createElement("span");
        icon.className = "dtf-vm-section-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = `<svg viewBox="0 0 24 24">${sectionIcons[heading.textContent] || sectionIcons["Разное"]}</svg>`;
        heading.prepend(icon);
      }
      const subsettingGroups = {
        classicGallery: ["galleryPreviewCount"],
        hideViewedPosts: ["showHideButton"],
        expandComments: ["expandAllBranches", "skipHiddenComments"],
        showRemovedComments: ["showCommentEdits", "showHiddenComments"],
        hideCommentMedia: [
          "hideCommentGifs",
          "hideCommentImages",
          "hideCommentVideos",
          "showMediaRestore",
        ],
        enableCommentQuote: ["quoteMoveTo"],
        hideRightSidebar: ["livePanel"],
      };
      for (const [parentName, childNames] of Object.entries(subsettingGroups)) {
        const parent = overlay
          .querySelector(`[name="${parentName}"]`)
          ?.closest("label");
        const children = childNames
          .map((name) =>
            overlay.querySelector(`[name="${name}"]`)?.closest("label"),
          )
          .filter(Boolean);
        if (!parent || !children.length) continue;
        const group = document.createElement("details");
        group.className = "dtf-vm-subsettings";
        const summary = document.createElement("summary");
        summary.textContent = "Дополнительные настройки";
        group.append(summary, ...children);
        parent.after(group);
      }
      const personalization = document.createElement("div");
      personalization.className = "dtf-vm-section dtf-vm-personalization";
      personalization.innerHTML = `<div class="dtf-vm-personalization-header"><h3>Персонализация</h3><label><input name="personalizationEnabled" type="checkbox" aria-label="Включить персонализацию"></label></div>`;
      const colorGrid = document.createElement("div");
      colorGrid.className = "dtf-vm-personalization-colors";
      for (const [key, [label, fallback]] of Object.entries(
        personalizationColors,
      )) {
        const row = document.createElement("label");
        const title = document.createElement("span");
        title.textContent = label;
        const input = document.createElement("input");
        input.type = "color";
        input.name = `personalization:${key}`;
        input.value = /^#[\da-f]{6}$/i.test(get(input.name, ""))
          ? get(input.name, "")
          : fallback;
        row.append(input, title);
        colorGrid.append(row);
      }
      personalization.append(colorGrid);
      const themeActions = document.createElement("div");
      themeActions.className = "dtf-vm-theme-actions";
      const themeCode = document.createElement("input");
      themeCode.type = "text";
      themeCode.placeholder = "Вставьте код темы…";
      themeCode.setAttribute("aria-label", "Код темы");
      const shareTheme = document.createElement("button");
      shareTheme.type = "button";
      shareTheme.textContent = "Поделиться";
      shareTheme.onclick = async () => {
        try {
          await navigator.clipboard.writeText(encodeTheme());
          shareTheme.textContent = "Скопировано";
          setTimeout(() => {
            shareTheme.textContent = "Поделиться";
          }, 1500);
        } catch {
          themeCode.value = encodeTheme();
          themeCode.focus();
          themeCode.select();
        }
      };
      const pasteTheme = document.createElement("button");
      pasteTheme.type = "button";
      pasteTheme.textContent = "Вставить";
      pasteTheme.onclick = async () => {
        try {
          themeCode.value = await navigator.clipboard.readText();
        } catch {
          themeCode.focus();
        }
      };
      const applyThemeButton = document.createElement("button");
      applyThemeButton.type = "button";
      applyThemeButton.textContent = "✓";
      applyThemeButton.setAttribute("aria-label", "Применить тему");
      applyThemeButton.onclick = () => {
        const theme = decodeTheme(themeCode.value);
        if (!theme) return window.alert("Некорректный код темы.");
        applyTheme(theme);
        enabledInput.checked = true;
        personalization
          .querySelectorAll('input[type="color"]')
          .forEach((input) => {
            input.value = get(input.name, "");
          });
        backgroundInput.value = theme.b;
      };
      themeActions.append(shareTheme, pasteTheme, themeCode, applyThemeButton);
      personalization.append(themeActions);
      const backgroundRow = document.createElement("label");
      backgroundRow.className = "dtf-vm-personalization-background";
      backgroundRow.append(document.createTextNode("Фоновое изображение:"));
      const backgroundInput = document.createElement("input");
      backgroundInput.type = "url";
      backgroundInput.name = "personalizationBackground";
      backgroundInput.placeholder = "https://…";
      backgroundInput.value = get(backgroundInput.name, "");
      backgroundRow.append(backgroundInput);
      personalization.append(backgroundRow);
      overlay.querySelector(".dtf-vm-settings-grid").after(personalization);
      const enabledInput = personalization.querySelector(
        '[name="personalizationEnabled"]',
      );
      enabledInput.checked = Boolean(get(enabledInput.name, false));
      enabledInput.onchange = () => {
        set(enabledInput.name, enabledInput.checked);
        applyPersonalization();
      };
      for (const input of personalization.querySelectorAll(
        'input[type="color"], input[type="url"]',
      ))
        input.onchange = () => {
          set(input.name, input.value);
          applyPersonalization();
        };
      const close = () => overlay.remove();
      overlay.querySelector(".dtf-vm-close").onclick = close;
      overlay.onclick = (event) => {
        if (event.target === overlay) close();
      };
      overlay.querySelector("[name=width]").oninput = (event) => {
        set("width", Number(event.target.value));
        event.target.closest("label").querySelector("output").value =
          `${event.target.value}%`;
        apply();
      };
      overlay.querySelector("[name=galleryPreviewCount]").oninput = (event) => {
        set("galleryPreviewCount", Number(event.target.value));
        event.target.closest("label").querySelector("output").value =
          event.target.value;
        apply();
      };
      overlay.querySelector("[name=topicLimit]").oninput = (event) => {
        set("topicLimit", Number(event.target.value));
        topicsExpanded = false;
        event.target.closest("label").querySelector("output").value =
          event.target.value;
        document.querySelector(".dtf-vm-topic-extras")?.remove();
        renderTopics();
      };
      const dependencies = {
        classicGallery: ["galleryPreviewCount"],
        expandComments: ["expandAllBranches", "skipHiddenComments"],
        showRemovedComments: ["showCommentEdits", "showHiddenComments"],
        hideCommentMedia: [
          "hideCommentGifs",
          "hideCommentImages",
          "hideCommentVideos",
          "showMediaRestore",
        ],
        enableCommentQuote: ["quoteMoveTo"],
      };
      const syncDependencies = () => {
        for (const [parent, children] of Object.entries(dependencies)) {
          const enabled = overlay.querySelector(`[name=${parent}]`).checked;
          for (const name of children) {
            const input = overlay.querySelector(`[name=${name}]`);
            input.disabled = !enabled;
            input
              .closest("label")
              .classList.toggle("dtf-vm-disabled", !enabled);
          }
        }
      };
      syncDependencies();
      for (const name of [
        "centered",
        "classicGallery",
        "disableSpoilerBlur",
        "quality",
        "pauseVideosOnScroll",
        "pauseVideosByDefault",
        "stretchRight",
        "hideViewedPosts",
        "showHideButton",
        "headerWidth",
        "plainHeaderSearch",
        "backToTop",
        "hideRightSidebar",
        "livePanel",
        "smallFixes",
        "expandComments",
        "expandAllBranches",
        "skipHiddenComments",
        "showRemovedComments",
        "showCommentEdits",
        "showHiddenComments",
        "hideCommentMedia",
        "hideCommentGifs",
        "hideCommentImages",
        "hideCommentVideos",
        "showMediaRestore",
        "showNoCommentIcon",
        "enableCommentQuote",
        "quoteMoveTo",
        "onlySubscribedTopics",
        "topicSearchEnabled",
        "sortTopics",
        "reorderTopics",
        "hidePlusAds",
        "plusFeatures",
        "hideFooter",
        "hidePopular",
        "hideNew",
        "hideMy",
        "hideMessages",
        "hideRating",
        "hideGames",
        "hideTopics",
        "hideDonationsMenu",
        "hidePlusMenu",
      ])
        overlay.querySelector(`[name=${name}]`).onchange = (event) => {
          set(name, event.target.checked);
          syncDependencies();
          if (
            [
              "expandComments",
              "expandAllBranches",
              "skipHiddenComments",
            ].includes(name)
          ) {
            refreshCommentExpansion();
            return;
          }
          if (
            [
              "hideCommentMedia",
              "hideCommentGifs",
              "hideCommentImages",
              "hideCommentVideos",
              "showMediaRestore",
            ].includes(name)
          ) {
            refreshCommentMedia();
            return;
          }
          if (
            [
              "showRemovedComments",
              "showCommentEdits",
              "showHiddenComments",
              "showNoCommentIcon",
              "enableCommentQuote",
              "quoteMoveTo",
            ].includes(name)
          ) {
            refreshCommentOptions();
            return;
          }
          if (name === "onlySubscribedTopics") topicsExpanded = false;
          if (name === "sortTopics")
            document.querySelector(".dtf-vm-topic-extras")?.remove();
          apply();
        };
      overlay.querySelector(".dtf-vm-reset-topics").onclick = () => {
        const orders = get("topicOrders", {});
        delete orders[topicOrderKey()];
        set("topicOrders", orders);
        document.querySelector(".dtf-vm-topic-extras")?.remove();
        renderTopics();
      };
      document.body.append(overlay);
      updateRightPanelControls();
    };

    GM_registerMenuCommand("Настройки", openSettings);
    document.body.append(topButton);
    window.addEventListener("scroll", updateTopButton, { passive: true });
    window.addEventListener("scroll", pauseVideosOutsideViewport, {
      passive: true,
    });
    apply();
    window.addEventListener("resize", apply);
    let applyFrame = null;
    const scheduleApply = () => {
      if (applyFrame !== null) return;
      applyFrame = requestAnimationFrame(() => {
        applyFrame = null;
        apply();
      });
    };
    new MutationObserver(scheduleApply).observe(document.body, {
      childList: true,
      subtree: true,
    });
  };
  if (document.body) initialize();
  else {
    const bodyObserver = new MutationObserver(() => {
      if (!document.body) return;
      bodyObserver.disconnect();
      initialize();
    });
    bodyObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  }
})();
