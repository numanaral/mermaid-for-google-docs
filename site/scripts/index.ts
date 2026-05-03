import { inject } from "@vercel/analytics";

inject();

document.documentElement.classList.add("js");

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector<HTMLButtonElement>(".nav-toggle");
  const links = document.querySelector<HTMLElement>(".nav-links");
  if (toggle && links) {
    const closeMenu = () => {
      links.classList.remove("open");
      toggle.classList.remove("open");
    };
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      links.classList.toggle("open");
      toggle.classList.toggle("open");
    });
    links
      .querySelectorAll("a")
      .forEach((a) => a.addEventListener("click", closeMenu));
    document.addEventListener("click", (e) => {
      if (
        links.classList.contains("open") &&
        !links.contains(e.target as Node) &&
        !toggle.contains(e.target as Node)
      ) {
        closeMenu();
      }
    });
  }

  const howTabs = document.querySelectorAll<HTMLButtonElement>(".how-tab");
  const howPanels = document.querySelectorAll<HTMLElement>(".how-panel");
  if (howTabs.length && howPanels.length) {
    howTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab");
        howTabs.forEach((t) => {
          t.classList.remove("active");
          t.setAttribute("aria-selected", "false");
        });
        howPanels.forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        const panel = document.getElementById(`how-panel-${target}`);
        if (panel) {
          panel.classList.add("active");
          const videoPlayer = panel.querySelector(".video-player");
          if (videoPlayer) {
            videoPlayer.classList.remove("video-slide-in");
            void (videoPlayer as HTMLElement).offsetWidth;
            videoPlayer.classList.add("video-slide-in");
            const vid = videoPlayer.querySelector<HTMLVideoElement>("video");
            if (vid) {
              vid.currentTime = 0;
              vid.play().catch(() => {});
            }
          }
        }
      });
    });
  }

  const navLinks = document.querySelectorAll<HTMLAnchorElement>(".nav-links a");
  const path =
    location.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "") || "/";

  navLinks.forEach((a) => {
    const href = a.getAttribute("href");
    if (href && !href.startsWith("#") && !href.startsWith("/#")) {
      const hrefNorm = href.replace(/\/$/, "") || "/";
      if (hrefNorm === path) a.classList.add("active");
    }
  });

  const sections = document.querySelectorAll<HTMLElement>("section[id]");
  if (sections.length) {
    const observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        entries.forEach((entry) => {
          const { id } = entry.target;
          const link =
            document.querySelector<HTMLAnchorElement>(
              `.nav-links a[href="#${id}"]`,
            ) ||
            document.querySelector<HTMLAnchorElement>(
              `.nav-links a[href="/#${id}"]`,
            );
          if (!link) return;
          if (entry.isIntersecting) {
            navLinks.forEach((a) => {
              const h = a.getAttribute("href")!;
              if (h.startsWith("#") || h.startsWith("/#"))
                a.classList.remove("active");
            });
            link.classList.add("active");
          }
        });
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );

    sections.forEach((s) => observer.observe(s));
  }

  document
    .querySelectorAll(".gallery-item")
    .forEach((el) => el.classList.add("reveal"));

  const hasVideos = document.querySelectorAll(".video-player").length > 0;

  let videoModal: HTMLDivElement | null = null;
  let modalVideo: HTMLVideoElement | null = null;

  if (hasVideos) {
    videoModal = document.createElement("div");
    videoModal.className = "video-modal-overlay";
    videoModal.innerHTML = `<video autoplay loop muted playsinline></video>
      <div class="video-modal-controls">
        <button class="video-modal-reset" title="Replay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
        <button class="video-modal-close" title="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>`;
    document.body.appendChild(videoModal);

    modalVideo = videoModal.querySelector<HTMLVideoElement>("video")!;
    const modalReset =
      videoModal.querySelector<HTMLButtonElement>(".video-modal-reset")!;
    const modalClose =
      videoModal.querySelector<HTMLButtonElement>(".video-modal-close")!;

    const closeVideoModal = () => {
      videoModal!.classList.remove("visible");
      modalVideo!.pause();
      modalVideo!.removeAttribute("src");
      modalVideo!.load();
    };

    modalClose.addEventListener("click", closeVideoModal);
    videoModal.addEventListener("click", (e) => {
      if (e.target === videoModal) closeVideoModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && videoModal!.classList.contains("visible"))
        closeVideoModal();
    });
    modalReset.addEventListener("click", () => {
      modalVideo!.currentTime = 0;
      modalVideo!.play().catch(() => {});
    });
  }

  const videoAutoplayObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const vid = (
          entry.target as HTMLElement
        ).querySelector<HTMLVideoElement>("video");
        if (!vid) return;
        if (entry.isIntersecting) {
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      });
    },
    { threshold: 0.25 },
  );

  document.querySelectorAll<HTMLElement>(".video-player").forEach((player) => {
    const vid = player.querySelector<HTMLVideoElement>("video");
    if (!vid) return;

    const skeleton = document.createElement("div");
    skeleton.className = "video-skeleton";
    if (vid.readyState < 2) {
      vid.setAttribute("data-loading", "true");
      player.insertBefore(skeleton, vid);
      vid.addEventListener(
        "loadeddata",
        () => {
          vid.removeAttribute("data-loading");
          skeleton.remove();
        },
        { once: true },
      );
    }

    videoAutoplayObserver.observe(player);

    const resetBtn = player.querySelector<HTMLButtonElement>(".video-reset");
    const fsBtn = player.querySelector<HTMLButtonElement>(".video-fullscreen");

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        vid.currentTime = 0;
        vid.play().catch(() => {});
      });
    }
    if (fsBtn && videoModal && modalVideo) {
      const vm = videoModal;
      const mv = modalVideo;
      const isMobile = () => window.matchMedia("(max-width: 768px)").matches;
      fsBtn.addEventListener("click", () => {
        if (isMobile() && vid.requestFullscreen) {
          vid.currentTime = 0;
          vid.play().catch(() => {});
          vid.requestFullscreen().catch(() => {});
        } else {
          mv.src = vid.src;
          mv.currentTime = 0;
          mv.play().catch(() => {});
          vm.classList.add("visible");
        }
      });
    }
  });

  const reveals = document.querySelectorAll(".reveal, .reveal-stagger");
  if (reveals.length) {
    const revealObserver = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    reveals.forEach((el) => revealObserver.observe(el));
  }

  const linkSvg =
    '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
  // Any h2 inside <main> gets an auto-injected anchor link. The h2's
  // existing children are moved into an inline-block `.h2-inner` span
  // so the anchor icon can be positioned relative to the *text* width
  // (not the h2's full-width container), keeping it snugly left of
  // the heading text regardless of section centering/padding.
  document.querySelectorAll("main h2").forEach((h2) => {
    const text = (h2.textContent || "").trim();
    const id =
      h2.id ||
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    if (!id || !text) return;
    h2.id = id;
    if (h2.querySelector(".anchor-link")) return;

    const inner = document.createElement("span");
    inner.className = "h2-inner";
    while (h2.firstChild) inner.appendChild(h2.firstChild);

    const a = document.createElement("a");
    a.href = `#${id}`;
    a.className = "anchor-link";
    a.setAttribute("aria-label", `Link to ${text}`);
    a.innerHTML = linkSvg;
    inner.prepend(a);

    h2.appendChild(inner);
  });
});
