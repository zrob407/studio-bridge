document.documentElement.classList.add("js");

document.addEventListener("DOMContentLoaded", function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var revealed = document.querySelectorAll("[data-reveal]");
  function show(element) {
    var delay = Number(element.getAttribute("data-delay")) || 0;
    if (delay && !reduce) {
      setTimeout(function () {
        element.classList.add("in");
      }, delay);
    } else {
      element.classList.add("in");
    }
  }
  if ("IntersectionObserver" in window) {
    var seen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            show(entry.target);
            seen.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealed.forEach(function (element) {
      seen.observe(element);
    });
  } else {
    revealed.forEach(show);
  }

  var bar = document.querySelector(".progress i");
  var top = document.querySelector(".totop");
  function onScroll() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var y = window.scrollY || document.documentElement.scrollTop;
    if (bar) bar.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + "%";
    if (top) top.classList.toggle("show", y > 600);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();
  if (top) {
    top.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
  }

  document.querySelectorAll("pre").forEach(function (block) {
    if (!navigator.clipboard) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "copy";
    button.setAttribute("aria-label", "Copy this code");
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(block.querySelector("code").textContent.trim()).then(function () {
        button.textContent = "copied";
        setTimeout(function () {
          button.textContent = "copy";
        }, 1500);
      });
    });
    block.appendChild(button);
  });

  var search = document.querySelector("[data-tool-search]");
  if (search) {
    var items = document.querySelectorAll(".tool-list li");
    var groups = document.querySelectorAll("[data-group]");
    var count = document.querySelector("[data-tool-count]");
    var none = document.querySelector("[data-tool-none]");
    var apply = function () {
      var query = search.value.trim().toLowerCase();
      var terms = query.split(/\s+/).filter(Boolean);
      var shown = 0;
      items.forEach(function (item) {
        var text = item.textContent.toLowerCase();
        var hit = terms.every(function (term) {
          return text.indexOf(term) >= 0;
        });
        item.hidden = !hit;
        if (hit) shown++;
      });
      groups.forEach(function (group) {
        group.hidden = !group.querySelector("li:not([hidden])");
      });
      if (count) count.textContent = query ? shown + " of " + items.length + " tools match" : "";
      if (none) none.hidden = shown > 0;
    };
    search.addEventListener("input", apply);
    if (location.hash.indexOf("#q=") === 0) {
      search.value = decodeURIComponent(location.hash.slice(3));
      apply();
    }
  }

  var widget = document.querySelector("[data-widget]");
  if (!widget) return;

  var fills = widget.querySelectorAll("[data-fill]");
  function fill() {
    fills.forEach(function (element) {
      element.style.width = element.getAttribute("data-fill") + "%";
    });
  }
  setTimeout(fill, reduce ? 0 : 500);

  var log = widget.querySelector("[data-log]");
  var lines = [
    ["batch", "12 edits, one undo step"],
    ["terrain", "generate hills with a lake"],
    ["ui_responsive_check", "iPhone, iPad, Xbox"],
    ["run_test", "playtest, report errors"],
    ["snapshot_diff", "what changed since the save"],
  ];
  if (!log) return;

  function row(call, text, done) {
    var line = document.createElement("div");
    var prompt = document.createElement("span");
    prompt.className = "p";
    prompt.textContent = "> ";
    line.appendChild(prompt);
    line.appendChild(document.createTextNode(call + "  " + text));
    if (done) {
      var tick = document.createElement("span");
      tick.className = "ok";
      tick.textContent = "  ok";
      line.appendChild(tick);
    }
    return line;
  }

  var index = 0;
  function render() {
    log.textContent = "";
    for (var i = 0; i < 4; i++) {
      var entry = lines[(index + i) % lines.length];
      log.appendChild(row(entry[0], entry[1], i < 3));
    }
  }
  render();
  if (!reduce) {
    setInterval(function () {
      index = (index + 1) % lines.length;
      render();
    }, 1800);
  }
});
