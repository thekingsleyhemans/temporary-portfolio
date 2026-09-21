/*!
 * Marquee Engine
 * An infinite-scroll marquee engine driven entirely by HTML attributes.
 * No build step, no dependencies. One shared requestAnimationFrame loop
 * drives every instance on the page for predictable, framerate-independent motion.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 * Add `data-marquee` to any element that wraps the content you want to scroll:
 *
 *   <div data-marquee>
 *     <span>Breaking news</span>
 *     <span>Another headline</span>
 *   </div>
 *
 * The engine auto-initializes everything matching [data-marquee] on
 * DOMContentLoaded, and keeps watching the DOM for elements added later.
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTES  (all optional except data-marquee itself)
 * ---------------------------------------------------------------------------
 * data-marquee                          presence activates the engine
 * data-marquee-direction   left|right|up|down     default: left
 * data-marquee-speed       number (px/second)     default: 50
 * data-marquee-gap         number (px)             default: 24
 * data-marquee-pause-on-hover   true|false         default: false
 * data-marquee-reverse-on-hover true|false         default: false
 * data-marquee-fade             true|false         default: false
 * data-marquee-fade-size        number (px)        default: 48
 * data-marquee-delay            number (ms)        default: 0
 * data-marquee-force-motion     true|false         default: false
 *                                (ignore prefers-reduced-motion)
 *
 * ---------------------------------------------------------------------------
 * JS API
 * ---------------------------------------------------------------------------
 *   MarqueeEngine.init(root?)        scan (root||document) for [data-marquee]
 *   MarqueeEngine.get(el)            -> instance or null
 *   MarqueeEngine.refresh(el)        remeasure + rebuild clones (call after
 *                                     content changes)
 *   MarqueeEngine.pause(el)
 *   MarqueeEngine.play(el)
 *   MarqueeEngine.destroy(el)        tear down a single instance
 *   MarqueeEngine.destroyAll()
 *   MarqueeEngine.update(el, opts)   change config at runtime, e.g.
 *                                     { speed: 120, direction: 'right' }
 *
 * Events dispatched on the element itself (bubbling):
 *   marquee:init, marquee:destroy, marquee:play, marquee:pause
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  var SELECTOR = '[data-marquee]';
  var AXIS_FOR_DIRECTION = { left: 'x', right: 'x', up: 'y', down: 'y' };
  var SIGN_FOR_DIRECTION = { left: -1, right: 1, up: -1, down: 1 };

  var instances = new Map(); // element -> instance record
  var rafId = null;
  var lastTimestamp = null;
  var reduceMotionQuery = (global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)')
    : null);

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  function toBool(value, fallback) {
    if (value == null) return fallback;
    return value === '' || value === 'true';
  }

  function toNumber(value, fallback) {
    var n = parseFloat(value);
    return isFinite(n) ? n : fallback;
  }

  function readConfig(el) {
    var d = el.dataset;
    var direction = d.marqueeDirection || 'left';
    if (!AXIS_FOR_DIRECTION[direction]) direction = 'left';
    return {
      direction: direction,
      speed: Math.max(0, toNumber(d.marqueeSpeed, 50)),
      gap: Math.max(0, toNumber(d.marqueeGap, 24)),
      pauseOnHover: toBool(d.marqueePauseOnHover, false),
      reverseOnHover: toBool(d.marqueeReverseOnHover, false),
      fade: toBool(d.marqueeFade, false),
      fadeSize: Math.max(0, toNumber(d.marqueeFadeSize, 48)),
      delay: Math.max(0, toNumber(d.marqueeDelay, 0)),
      forceMotion: toBool(d.marqueeForceMotion, false)
    };
  }

  function prefersReducedMotion(cfg) {
    return !cfg.forceMotion && !!reduceMotionQuery && reduceMotionQuery.matches;
  }

  function dispatch(el, name, detail) {
    el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || null }));
  }

  // ---------------------------------------------------------------------
  // DOM construction
  //
  // Structure built from:
  //   <div data-marquee>              (container, overflow hidden)
  //     <div class="marquee-track">   (the element we translate)
  //       <div class="marquee-set">...original children...</div>
  //       <div class="marquee-set" aria-hidden="true">...clone...</div>
  //       <div class="marquee-set" aria-hidden="true">...clone...</div>
  //     </div>
  //   </div>
  //
  // Enough sets are cloned so the track's total length is at least twice
  // the container's viewport length. That guarantees that as one set
  // scrolls fully out of view, another is already in place -- the loop
  // resets the offset by exactly one set's length, which is invisible.
  // ---------------------------------------------------------------------

  function buildStructure(el, cfg) {
    var axis = AXIS_FOR_DIRECTION[cfg.direction];
    var flexDir = axis === 'x' ? 'row' : 'column';

    // Only build once; re-use the original set's children on rebuilds.
    var track = el.querySelector(':scope > .marquee-track');
    var originalSet;

    if (!track) {
      // First-time setup: move the container's existing children into
      // a "set" wrapper. If the marquee only contains a text node, wrap
      // it in an element first so the engine has a real node to clone.
      var children = Array.prototype.slice.call(el.children);
      if (!children.length) {
        var textNode = el.firstChild;
        if (textNode && textNode.nodeType === 3 && textNode.textContent.trim()) {
          var textWrap = document.createElement('span');
          textWrap.textContent = textNode.textContent.trim();
          el.textContent = '';
          el.appendChild(textWrap);
          children = [textWrap];
        }
      }

      originalSet = document.createElement('div');
      originalSet.className = 'marquee-set';
      children.forEach(function (child) { originalSet.appendChild(child); });

      track = document.createElement('div');
      track.className = 'marquee-track';
      track.appendChild(originalSet);

      el.innerHTML = '';
      el.appendChild(track);

      el.classList.add('marquee-root');
      if (!el.style.position) el.style.position = 'relative';
      el.style.overflow = 'hidden';
    } else {
      // Rebuild: strip clones, keep only the first (original) set.
      var sets = track.querySelectorAll(':scope > .marquee-set');
      sets.forEach(function (set, i) { if (i > 0) set.remove(); });
      originalSet = track.querySelector(':scope > .marquee-set');
    }

    el.style.display = 'block';
    el.style.minWidth = '0';
    el.style.whiteSpace = 'nowrap';
    el.style.maxWidth = '100%';

    track.style.display = 'inline-flex';
    track.style.flexDirection = flexDir;
    track.style.gap = cfg.gap + 'px';
    track.style.willChange = 'transform';
    track.style.whiteSpace = 'nowrap';
    track.style.minWidth = 'max-content';
    track.style.flexShrink = '0';

    originalSet.style.display = 'inline-flex';
    originalSet.style.flexDirection = flexDir;
    originalSet.style.gap = cfg.gap + 'px';
    originalSet.style.flexShrink = '0';
    originalSet.style.whiteSpace = 'nowrap';
    originalSet.style.minWidth = 'max-content';

    if (axis === 'y') {
      el.style.display = el.style.display || 'block';
    }

    return { track: track, originalSet: originalSet, axis: axis };
  }

  function measure(el, axis) {
    return axis === 'x' ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
  }

  function cloneSets(track, originalSet, cfg, axis, containerSize) {
    var setSize = measure(originalSet, axis);
    if (setSize <= 0) return { setSize: 0, count: 1 };

    // Total length needed so the track always covers at least 2x the
    // container, leaving comfortable buffer either side.
    var targetTotal = containerSize * 2 + setSize;
    var currentTotal = setSize;
    var count = 1;

    while (currentTotal < targetTotal && count < 50) {
      var clone = originalSet.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      // Reduced-motion / static fallback still shouldn't show duplicate
      // focusable content to assistive tech.
      clone.querySelectorAll('a, button, input, select, textarea, [tabindex]')
        .forEach(function (node) { node.setAttribute('tabindex', '-1'); });
      track.appendChild(clone);
      currentTotal += setSize + cfg.gap;
      count += 1;
    }

    return { setSize: setSize + cfg.gap, count: count };
  }

  // ---------------------------------------------------------------------
  // instance lifecycle
  // ---------------------------------------------------------------------

  function createInstance(el, overrides) {
    var cfg = Object.assign(readConfig(el), overrides || {});
    var built = buildStructure(el, cfg);
    var containerSize = measure(el, built.axis);
    var cloneInfo = cloneSets(built.track, built.originalSet, cfg, built.axis, containerSize);

    var sign = SIGN_FOR_DIRECTION[cfg.direction];
    var startPos = sign > 0 ? -cloneInfo.setSize : 0;

    var record = {
      el: el,
      cfg: cfg,
      axis: built.axis,
      track: built.track,
      originalSet: built.originalSet,
      setSize: cloneInfo.setSize,
      sign: sign,
      pos: startPos,
      userPaused: false,
      hoverPaused: false,
      hoverReversed: false,
      visible: true,
      elapsedDelay: 0,
      resizeObserver: null,
      intersectionObserver: null,
      onEnter: null,
      onLeave: null
    };

    applyFade(el, cfg);
    applyTransform(record);
    attachInteractionHandlers(record);
    attachObservers(record);

    instances.set(el, record);
    dispatch(el, 'marquee:init', { config: cfg });

    if (prefersReducedMotion(cfg)) {
      record.userPaused = true;
      record.pos = 0;
      applyTransform(record);
    }

    ensureLoopRunning();
    return record;
  }

  function applyFade(el, cfg) {
    el.classList.toggle('marquee-fade', !!cfg.fade);
    if (cfg.fade) {
      el.style.setProperty('--marquee-fade-size', cfg.fadeSize + 'px');
      if (!el.style.maskImage && !el.style.webkitMaskImage) {
        var axis = AXIS_FOR_DIRECTION[cfg.direction];
        var gradient = axis === 'x'
          ? 'linear-gradient(to right, transparent, #000 var(--marquee-fade-size), #000 calc(100% - var(--marquee-fade-size)), transparent)'
          : 'linear-gradient(to bottom, transparent, #000 var(--marquee-fade-size), #000 calc(100% - var(--marquee-fade-size)), transparent)';
        el.style.webkitMaskImage = gradient;
        el.style.maskImage = gradient;
      }
    }
  }

  function attachInteractionHandlers(record) {
    var el = record.el;
    var cfg = record.cfg;
    if (!cfg.pauseOnHover && !cfg.reverseOnHover) return;

    record.onEnter = function () {
      if (cfg.pauseOnHover) record.hoverPaused = true;
      if (cfg.reverseOnHover) record.hoverReversed = true;
    };
    record.onLeave = function () {
      record.hoverPaused = false;
      record.hoverReversed = false;
    };
    el.addEventListener('mouseenter', record.onEnter);
    el.addEventListener('mouseleave', record.onLeave);
    el.addEventListener('focusin', record.onEnter);
    el.addEventListener('focusout', record.onLeave);
  }

  function detachInteractionHandlers(record) {
    var el = record.el;
    if (!record.onEnter) return;
    el.removeEventListener('mouseenter', record.onEnter);
    el.removeEventListener('mouseleave', record.onLeave);
    el.removeEventListener('focusin', record.onEnter);
    el.removeEventListener('focusout', record.onLeave);
  }

  function attachObservers(record) {
    var el = record.el;

    if ('ResizeObserver' in global) {
      var pending = null;
      // ResizeObserver invokes its callback once immediately when observe()
      // is first called, even though nothing has actually resized -- so we
      // compare against a "last known size" and ignore no-op firings.
      //
      // FIX: that comparison must use the same box model on both sides.
      // entries[0].contentRect is a content-box measurement (excludes
      // padding/border), but `measure()` uses getBoundingClientRect, which
      // is border-box (includes them). Any marquee with padding or a
      // border -- extremely common -- reported a permanent phantom size
      // difference between the two, which tripped the "changed" check on
      // literally every observation, including the mandatory initial one.
      // That scheduled a rebuild, which created a new observer, which
      // fired again... the track kept resetting to its start position
      // every ~120ms and never visibly moved. Re-measuring with the same
      // function on both sides removes the mismatch entirely.
      var lastSize = measure(el, record.axis);
      record.resizeObserver = new ResizeObserver(function () {
        var newSize = measure(el, record.axis);
        if (Math.abs(newSize - lastSize) < 1) return;
        lastSize = newSize;
        clearTimeout(pending);
        pending = setTimeout(function () {
          if (instances.has(el)) rebuild(el);
        }, 120);
      });
      record.resizeObserver.observe(el);
    }

    if ('IntersectionObserver' in global) {
      record.intersectionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { record.visible = entry.isIntersecting; });
      }, { threshold: 0 });
      record.intersectionObserver.observe(el);
    }
  }

  function detachObservers(record) {
    if (record.resizeObserver) record.resizeObserver.disconnect();
    if (record.intersectionObserver) record.intersectionObserver.disconnect();
  }

  function applyTransform(record) {
    var value = record.axis === 'x'
      ? 'translate3d(' + record.pos + 'px,0,0)'
      : 'translate3d(0,' + record.pos + 'px,0)';
    record.track.style.transform = value;
  }

  function rebuild(el) {
    var record = instances.get(el);
    if (!record) return;
    var wasPaused = record.userPaused;
    destroyInstance(el, /* keepDom */ false, /* silent */ true);
    var fresh = createInstance(el);
    fresh.userPaused = wasPaused;
  }

  function destroyInstance(el, keepDom, silent) {
    var record = instances.get(el);
    if (!record) return;

    detachInteractionHandlers(record);
    detachObservers(record);
    instances.delete(el);

    if (!keepDom) {
      // Flatten back to the original, single set of children.
      var original = record.originalSet;
      var frag = document.createDocumentFragment();
      Array.prototype.slice.call(original.children).forEach(function (child) {
        frag.appendChild(child);
      });
      el.innerHTML = '';
      el.appendChild(frag);
      el.classList.remove('marquee-root', 'marquee-fade');
      el.style.transform = '';
      el.style.overflow = '';
      el.style.webkitMaskImage = '';
      el.style.maskImage = '';
    }

    if (!silent) dispatch(el, 'marquee:destroy');
  }

  // ---------------------------------------------------------------------
  // shared RAF loop -- one loop drives every instance
  // ---------------------------------------------------------------------

  function ensureLoopRunning() {
    if (rafId != null) return;
    lastTimestamp = null;
    rafId = global.requestAnimationFrame(tick);
  }

  function stopLoopIfIdle() {
    if (instances.size === 0 && rafId != null) {
      global.cancelAnimationFrame(rafId);
      rafId = null;
      lastTimestamp = null;
    }
  }

  function tick(timestamp) {
    if (lastTimestamp == null) lastTimestamp = timestamp;
    var dt = Math.min(timestamp - lastTimestamp, 100); // clamp to avoid big jumps on tab refocus
    lastTimestamp = timestamp;

    instances.forEach(function (record) {
      stepInstance(record, dt);
    });

    if (instances.size > 0) {
      rafId = global.requestAnimationFrame(tick);
    } else {
      rafId = null;
      lastTimestamp = null;
    }
  }

  function stepInstance(record, dt) {
    if (record.setSize <= 0) return;

    if (record.cfg.delay > 0 && record.elapsedDelay < record.cfg.delay) {
      record.elapsedDelay += dt;
      return;
    }

    var paused = record.userPaused || record.hoverPaused || !record.visible;
    if (paused) return;

    var direction = record.hoverReversed ? -record.sign : record.sign;
    var distance = (record.cfg.speed * dt) / 1000;
    record.pos += direction * distance;

    if (record.sign > 0) {
      while (record.pos >= 0) record.pos -= record.setSize;
    } else if (record.sign < 0) {
      while (record.pos <= -record.setSize) record.pos += record.setSize;
    }

    applyTransform(record);
  }

  // ---------------------------------------------------------------------
  // DOM discovery -- initial scan + MutationObserver for late-added nodes
  // ---------------------------------------------------------------------

  function init(root) {
    var scope = root || document;
    var found = scope.querySelectorAll
      ? scope.querySelectorAll(SELECTOR)
      : [];
    found.forEach(function (el) {
      if (!instances.has(el)) createInstance(el);
    });
    return found.length;
  }

  var mutationObserver = null;
  function watchDom() {
    if (mutationObserver || !('MutationObserver' in global)) return;
    mutationObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches(SELECTOR) && !instances.has(node)) {
            createInstance(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll(SELECTOR).forEach(function (el) {
              if (!instances.has(el)) createInstance(el);
            });
          }
        });
        mutation.removedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (instances.has(node)) destroyInstance(node, true, false);
          if (node.querySelectorAll) {
            node.querySelectorAll(SELECTOR).forEach(function (el) {
              if (instances.has(el)) destroyInstance(el, true, false);
            });
          }
        });
      });
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------

  var MarqueeEngine = {
    init: init,

    get: function (el) {
      return instances.get(el) || null;
    },

    refresh: function (el) {
      if (el) { rebuild(el); return; }
      instances.forEach(function (_, key) { rebuild(key); });
    },

    pause: function (el) {
      var record = instances.get(el);
      if (!record) return;
      record.userPaused = true;
      dispatch(el, 'marquee:pause');
    },

    play: function (el) {
      var record = instances.get(el);
      if (!record) return;
      record.userPaused = false;
      dispatch(el, 'marquee:play');
    },

    update: function (el, overrides) {
      var record = instances.get(el);
      if (!record) return;
      Object.keys(overrides || {}).forEach(function (key) {
        var attr = 'marquee' + key.charAt(0).toUpperCase() + key.slice(1);
        el.dataset[attr] = overrides[key];
      });
      rebuild(el);
    },

    destroy: function (el) {
      destroyInstance(el, false, false);
      stopLoopIfIdle();
    },

    destroyAll: function () {
      Array.prototype.slice.call(instances.keys()).forEach(function (el) {
        destroyInstance(el, false, false);
      });
      stopLoopIfIdle();
    },

    _instances: instances // exposed for debugging/tests only
  };

  global.MarqueeEngine = MarqueeEngine;

  if (typeof document !== 'undefined') {
    var start = function () {
      init(document);
      watchDom();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MarqueeEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);