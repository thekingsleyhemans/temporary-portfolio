console.log("SPLIT ENGINE LOADED");

const gsap = globalThis.gsap;

if (!gsap) {
  throw new Error("GSAP is required. Load the GSAP script before split-engine.js.");
}

if (globalThis.ScrollTrigger) {
  gsap.registerPlugin(globalThis.ScrollTrigger);
}

class Animator {
  to(target, config) {
    return gsap.to(target, config);
  }

  set(target, config) {
    return gsap.set(target, config);
  }

  timeline(config = {}) {
    return gsap.timeline(config);
  }
}

class SplitEngine {
  constructor() {
    this.instances = [];
    this.animator = new Animator();

    this.ready = this.init(); // callers can await this before playGroup/play
  }

  init() {
    const elements = [...document.querySelectorAll("[data-split]")];

    return new Promise((resolve) => {
      const runSplit = () => {
        requestAnimationFrame(() => {
          elements.forEach((element) => {
            if (element.dataset.splitProcessed === "true") return;

            this.processElement(element);
            element.dataset.splitProcessed = "true";
          });
          resolve();
        });
      };

      if (document.fonts && typeof document.fonts.ready?.then === "function") {
        document.fonts.ready.then(runSplit);
      } else {
        window.addEventListener("load", runSplit, { once: true });
        runSplit();
      }
    });
  }

  processElement(element) {
    const splitType = element.dataset.split;

    let targets = [];

    switch (splitType) {
      case "lines":
        targets = this.splitLines(element);
        break;

      case "words":
        targets = this.splitWords(element);
        break;

      default:
        console.warn(`Unknown split type: ${splitType}`);
        return;
    }

    const config = this.getConfig(element);

    this.animator.set(targets, {
      yPercent: 100,
    });

    const instance = {
      element,
      targets,
      config,
    };

    this.instances.push(instance);

    switch (config.trigger) {
      case "load":
        this.animate(instance);
        break;

      case "scroll":
        this.scrollAnimation(instance);
        break;

      case "view":
        this.viewAnimation(instance);
        break;

      case "manual":
        break;
    }
  }

  getConfig(element) {
    return {
      trigger: element.dataset.trigger || "load",
      id: element.dataset.engine || null,
      delay: parseFloat(element.dataset.delay) || 0,
      stagger: parseFloat(element.dataset.stagger) || 0.1,
      duration: parseFloat(element.dataset.duration) || 1,
      ease: element.dataset.ease || "power4.out",
    };
  }

  splitLines(element) {
    const originalText = element.textContent.trim();

    element.setAttribute("aria-label", originalText);

    const words = originalText.split(" ");

    element.innerHTML = words
      .map((word) => `<span class="word-temp">${word}</span>`)
      .join(" ");

    const tempWords = [...element.querySelectorAll(".word-temp")];

    let lines = [];
    let currentLine = [];
    let currentTop = tempWords[0].offsetTop;

    tempWords.forEach((word) => {
      if (word.offsetTop !== currentTop) {
        lines.push(currentLine);
        currentLine = [];
        currentTop = word.offsetTop;
      }

      currentLine.push(word);
    });

    lines.push(currentLine);

    element.innerHTML = "";

    lines.forEach((lineWords) => {
      const lineWrapper = document.createElement("span");
      lineWrapper.classList.add("line-wrap");
      lineWrapper.style.overflow = "hidden";
      lineWrapper.style.display = "block";

      const line = document.createElement("span");
      line.classList.add("line");
      line.style.display = "block";
      line.style.willChange = "transform";

      line.innerHTML = lineWords.map((word) => word.textContent).join(" ");

      lineWrapper.appendChild(line);
      element.appendChild(lineWrapper);
    });

    return [...element.querySelectorAll(".line")];
  }

  splitWords(element) {
    const originalText = element.textContent.trim();

    element.setAttribute("aria-label", originalText);

    const words = originalText.split(" ");

    element.innerHTML = "";

    words.forEach((word) => {
      const wordWrapper = document.createElement("span");
      wordWrapper.classList.add("word-wrap");

      wordWrapper.style.overflow = "hidden";
      wordWrapper.style.display = "inline-block";
      wordWrapper.style.verticalAlign = "top";
      wordWrapper.style.marginRight = "0.25em";

      const wordElement = document.createElement("span");
      wordElement.classList.add("word");

      wordElement.style.display = "inline-block";
      wordElement.style.verticalAlign = "top";
      wordElement.style.willChange = "transform";

      wordElement.textContent = word;

      wordWrapper.appendChild(wordElement);
      element.appendChild(wordWrapper);
    });

    return [...element.querySelectorAll(".word")];
  }

  animate(instance) {
    this.animator.to(instance.targets, {
      yPercent: 0,
      duration: instance.config.duration,
      stagger: instance.config.stagger,
      ease: instance.config.ease,
      delay: instance.config.delay,
    });
  }

  scrollAnimation(instance) {
    gsap.fromTo(
      instance.targets,
      { yPercent: 100 },
      {
        yPercent: 0,
        duration: instance.config.duration,
        stagger: instance.config.stagger,
        ease: instance.config.ease,
        delay: instance.config.delay,
        scrollTrigger: {
          trigger: instance.element,
          start: "top 80%",
          once: true,
        },
      }
    );
  }

  viewAnimation(instance) {
    if (!("IntersectionObserver" in window)) {
      this.animate(instance);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          this.animate(instance);
          observer.disconnect();
        });
      },
      {
        threshold: 0.2,
        rootMargin: "0px 0px -10% 0px",
      }
    );

    observer.observe(instance.element);
  }

  play(id) {
    const instance = this.instances.find((item) => item.config.id === id);

    if (!instance) return;

    this.animate(instance);
  }

  reverse(id) {
    const instance = this.instances.find((item) => item.config.id === id);

    if (!instance) return;

    this.animator.to(instance.targets, {
      yPercent: 100,
      duration: 0.8,
    });
  }

  getGroupTargets(container) {
    const elements = document.querySelectorAll(`${container} [data-engine]`);

    let allTargets = [];

    elements.forEach((element) => {
      const id = element.dataset.engine;

      const instance = this.instances.find((item) => item.config.id === id);

      if (instance) {
        allTargets.push(...instance.targets);
      }
    });

    return allTargets;
  }

  playGroup(container) {
    const allTargets = this.getGroupTargets(container);

    if (!allTargets.length) return;

    this.animator.to(allTargets, {
      yPercent: 0,
      duration: 1,
      stagger: 0.08,
      ease: "power4.out",
    });
  }

  reverseGroup(container) {
    const allTargets = this.getGroupTargets(container);

    if (!allTargets.length) return;

    this.animator.to(allTargets, {
      yPercent: 100,
      duration: 0.5,
    });
  }

  getTween(id) {
    const instance = this.instances.find((item) => item.config.id === id);

    if (!instance) return null;

    return gsap.to(instance.targets, {
      yPercent: 0,
      duration: instance.config.duration,
      stagger: instance.config.stagger,
      ease: instance.config.ease,
      paused: true,
    });
  }
}

let TextEngine = null;

export function initSplitEngine() {
  TextEngine = new SplitEngine();
  return TextEngine;
}

export { TextEngine };