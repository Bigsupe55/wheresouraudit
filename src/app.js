// Where's Our Audit? Browser code: town search and the request letter. No tracking, no cookies.
(function () {
  "use strict";

  // ---------- search ----------
  var box = document.querySelector("[data-search]");
  if (box) {
    var input = box.querySelector("input"), list = box.querySelector("ul"), index = null;
    var load = function () {
      if (index) return Promise.resolve(index);
      return fetch(box.getAttribute("data-search")).then(function (r) { return r.json(); }).then(function (j) { index = j; return j; });
    };
    var norm = function (s) { return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""); };
    input.addEventListener("input", function () {
      var q = norm(input.value.trim());
      if (q.length < 2) { list.classList.add("hidden"); list.innerHTML = ""; return; }
      load().then(function (idx) {
        var hits = idx.filter(function (e) { return norm(e.n).indexOf(q) !== -1; })
          .sort(function (a, b) { return (norm(a.n).indexOf(q) === 0 ? 0 : 1) - (norm(b.n).indexOf(q) === 0 ? 0 : 1) || a.n.localeCompare(b.n); })
          .slice(0, 12);
        list.innerHTML = hits.length ? hits.map(function (e) {
          return '<li><a href="' + e.u + '">' + e.n.replace(/</g, "&lt;") + ", " + e.s + ' <span class="muted small">' + e.t + "</span></a></li>";
        }).join("") : '<li><a href="#" onclick="return false">No match yet. We cover Maine and Florida today.</a></li>';
        list.classList.remove("hidden");
      });
    });
  }

  // ---------- other states: list, search, detail (data from /data/us/<st>.json) ----------
  var us = document.querySelector("[data-us]");
  if (us) {
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var LABEL = { on_time: "Filed on time", late: "Filed late", none: "No federal audit on file" };
    var CLS = { on_time: "good", late: "warn", none: "none" };
    var mailto = us.getAttribute("data-mailto");
    var listEl = us.querySelector("[data-us-list]"), detailEl = us.querySelector("[data-us-detail]"), countEl = us.querySelector("[data-us-count]"), qEl = us.querySelector("#usq");
    var D = null, byId = {};
    var fmt = function (iso) { if (!iso) return ""; var p = iso.split("-"); return ["January","February","March","April","May","June","July","August","September","October","November","December"][+p[1] - 1] + " " + (+p[2]) + ", " + p[0]; };
    var drawList = function () {
      var q = (qEl.value || "").toLowerCase().trim();
      var hits = D.e.filter(function (e) { return !q || e.n.toLowerCase().indexOf(q) !== -1 || (e.c || "").toLowerCase().indexOf(q) !== -1; });
      var order = { late: 0, on_time: 1, none: 2 };
      hits.sort(function (a, b) { return q ? a.n.localeCompare(b.n) : (order[a.s] - order[b.s]) || a.n.localeCompare(b.n); });
      countEl.textContent = (q ? hits.length + " matching" : D.e.length + " local governments and filers") + (hits.length > 300 ? ". Showing the first 300; type to narrow." : ".");
      listEl.innerHTML = hits.slice(0, 300).map(function (e) {
        return '<tr><td><a href="#' + e.i + '">' + esc(e.n) + "</a>" + (e.c ? ' <span class="muted small">' + esc(e.c) + " County</span>" : "") + "</td><td>" + esc(e.t) + '</td><td><span class="pill s-' + CLS[e.s] + '">' + LABEL[e.s] + '</span></td><td class="small">' + esc(e.h) + "</td></tr>";
      }).join("") || '<tr><td colspan="4" class="muted">No match.</td></tr>';
    };
    var letterFor = function (e) {
      var y = e.y.length ? e.y[e.y.length - 1] : null;
      var fy = y ? String(+y[0] + (e.s === "none" ? 0 : 0)) : "[FISCAL YEAR]";
      return ["Subject: Public records request: " + e.n + " annual audit for fiscal year " + fy, "",
        "To the Records Custodian of " + e.n + ",", "",
        "Under the public records law of " + D.name + ", I am asking for copies of these public records:", "",
        "1. The annual financial audit or annual financial report of " + e.n + " for the most recent fiscal year that has ended" + (y ? " (fiscal year " + fy + " or later)" : "") + ".",
        "2. If " + e.n + " spent $1,000,000 or more in federal awards that year ($750,000 for fiscal years that began before October 1, 2024): the single audit report and the data collection form filed with the Federal Audit Clearinghouse.",
        "3. If the audit or report is not finished: the engagement letter or contract with the auditor, and any record that gives the expected completion date.", "",
        "Please send the records electronically, as PDF files by email to [YOUR EMAIL]. If a record is already online, a link is enough.", "",
        "Please confirm you received this request and tell me when you expect to respond. Please contact me before charging more than $25. I ask that fees be waived because this request serves the public interest and is not for commercial use.", "",
        "If you withhold any part, please cite the specific exemption you rely on and release all parts that are not exempt.", "",
        "Thank you,", "", "[YOUR NAME]", "[YOUR EMAIL]"].join("\n");
    };
    var drawDetail = function () {
      var id = decodeURIComponent(location.hash.slice(1)), e = byId[id];
      if (!e) { detailEl.classList.add("hidden"); detailEl.innerHTML = ""; return; }
      var flags = e.f.map(function (f) {
        return '<div class="flag ' + f.c + '"><span class="pill s-' + f.c + '">' + esc(f.l) + '</span><div class="sentence">' + esc(f.x) + '</div><div class="meta"><span>Rule: ' + esc(D.rule) + '</span><a href="' + esc(f.u) + '" rel="noopener" aria-label="Source for: ' + esc(f.l) + '">Source</a><span>As of ' + esc(D.asOf) + '</span><a href="mailto:' + esc(mailto) + "?subject=" + encodeURIComponent("Correction: " + e.i) + '">Something wrong? Report a correction</a></div></div>';
      }).join("") || '<div class="flag none"><span class="pill s-none">No federal audit on file</span><div class="sentence">We found no federal single audit for ' + esc(e.n) + " since 2021. That is normal if it spent less than $1 million in federal money in a year. It only matters if it spent more. You can ask.</div></div>";
      var years = e.y.length ? '<table><tr><th>Fiscal year</th><th>Year ended</th><th>Due</th><th>Filed</th><th>Federal money spent</th></tr>' + e.y.map(function (y) {
        return "<tr><td>" + y[0] + "</td><td>" + fmt(y[1]) + "</td><td>" + fmt(y[2]) + "</td><td>" + fmt(y[3]) + (y[4] === "late" ? ' <span class="pill s-warn">' + y[5] + " days late</span>" : "") + (y[6] ? ' <a class="small" href="https://app.fac.gov/dissemination/summary/' + esc(y[6]) + '" aria-label="Federal audit report for fiscal year ' + esc(y[0]) + '">report</a>' : "") + "</td><td>$" + (+y[7]).toLocaleString("en-US") + "</td></tr>";
      }).join("") + "</table>" : "";
      detailEl.innerHTML = '<div class="card" style="margin:16px 0"><p class="crumb">' + esc(D.name) + " › " + esc(e.t) + (e.c ? " · " + esc(e.c) + " County" : "") + '</p><h2 style="margin:0 0 6px">' + esc(e.n) + ", " + D.st + '</h2><span class="pill s-' + CLS[e.s] + '">' + LABEL[e.s] + '</span><p>' + esc(e.h) + ".</p>" +
        (e.p ? '<p class="small muted">Population ' + (+e.p).toLocaleString("en-US") + (e.w ? ' · <a href="' + esc(/^https?:/.test(e.w) ? e.w : "http://" + e.w) + '" rel="noopener nofollow">Website</a>' : "") + "</p>" : "") +
        "<h3>What we found</h3>" + flags + years +
        '<h3>Report card</h3><p class="small muted">Not graded yet. We grade Maine and Florida so far.</p>' +
        '<h3>Ask for it</h3><p class="small muted">Send it yourself. We never send anything for you. Fill in the bracketed parts, then copy it into an email to the records office.</p><textarea readonly>' + esc(letterFor(e)) + '</textarea><div class="actions"><button type="button" data-us-copy>Copy letter</button></div>' +
        '<p class="small"><a href="#">Back to the list</a></p></div>';
      detailEl.classList.remove("hidden");
      detailEl.querySelector("[data-us-copy]").addEventListener("click", function () {
        var t = detailEl.querySelector("textarea"); t.select();
        (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).catch(function () { document.execCommand("copy"); });
        this.textContent = "Copied. Paste it into an email.";
        var f = document.createElement("iframe"); f.hidden = true; f.src = "/sent/?via=copy-us"; document.body.appendChild(f); setTimeout(function () { f.remove(); }, 8000);
      });
      detailEl.scrollIntoView({ block: "start" });
    };
    fetch(us.getAttribute("data-us")).then(function (r) { return r.json(); }).then(function (j) {
      D = j; j.e.forEach(function (e) { byId[e.i] = e; });
      drawList(); drawDetail();
      qEl.addEventListener("input", drawList);
      window.addEventListener("hashchange", drawDetail);
    });
  }

  // ---------- request letter ----------
  var form = document.querySelector("[data-letter]");
  if (!form) return;
  var L = JSON.parse(document.getElementById("letter-data").textContent);
  var out = form.querySelector("textarea");
  var val = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el.type === "checkbox" ? el.checked : el.value.trim(); };
  var today = function () { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  function maine() {
    var name = val("name") || "[YOUR NAME]", email = val("email") || "[YOUR EMAIL]", cap = val("cap") || "25";
    var item2 = L.missing
      ? "2. If the audit is not finished: the engagement letter or contract with the auditor, the notice sent to the State Auditor naming the auditor, and any letter, email or memo that gives the expected completion date."
      : "2. If the audit is already posted online, a link is enough.";
    var found = L.missing
      ? "As of " + today() + ", I could not find this audit on the State Auditor's list of audit reports (" + L.sourcePage + ")."
      : "";
    return [
      "Subject: Freedom of Access Act request: " + L.entity + " annual audit for fiscal year " + L.fy,
      "",
      "To the Public Access Officer or Clerk of " + L.entity + ",",
      "",
      "Under Maine's Freedom of Access Act, 1 M.R.S. section 408-A, I am asking for copies of these public records:",
      "",
      "1. The annual audit (postaudit) of " + L.entity + " for the fiscal year that ended " + L.fyeText + ", required by " + (L.type === "county" ? "30-A M.R.S. sections 951 and 5823" : "30-A M.R.S. section 5823") + ".",
      item2,
      "",
    ].concat(found ? [found, ""] : []).concat([
      "Please send the records electronically, as PDF files by email to " + email + ". Under section 408-A(7) I may choose an electronic copy, and under section 408-A(8)(A) no per-page fee applies to electronic copies.",
      "",
      "The law asks you to acknowledge this request within 5 working days and to give me a good faith estimate of time and cost (section 408-A(3)). Please tell me before any charge over $" + cap + "." +
        (val("waive") ? " I ask that any fee be waived because these records help the public understand how " + L.entity + " manages its money and I have no commercial interest (section 408-A(11))." : ""),
      "",
      "If you deny any part, please tell me in writing within 5 working days and cite the statute you rely on (section 408-A(4)).",
      "",
      "Thank you,",
      "",
      name,
      email,
      today(),
    ]).join("\n");
  }
  function florida() {
    var name = val("name"), email = val("email") || "[YOUR EMAIL]", cap = val("cap") || "25";
    return [
      "Subject: Public records request: " + L.entity + " audit and annual financial report for fiscal year " + L.fy,
      "",
      "To the Records Custodian of " + L.entity + ",",
      "",
      "Under Article I, Section 24 of the Florida Constitution and Chapter 119, Florida Statutes, I am asking for copies of these public records:",
      "",
      "1. The independent annual financial audit report of " + L.entity + " for the fiscal year that ended " + L.fyeText + ", required by section 218.39, Florida Statutes, if an audit was required for that year.",
      "2. The annual financial report for the same fiscal year submitted to the Florida Department of Financial Services under section 218.32, Florida Statutes.",
      "3. If either report is not finished: the engagement letter or contract with the auditor, and any letter, email or memo that gives the expected completion date or explains the delay.",
      "",
      "Florida law requires these reports within 9 months after the end of the fiscal year (sections 218.39(1) and 218.32(1)). By my count that date was " + L.dueText + ".",
      "",
      "Please send the records electronically, as PDF files by email to " + email + ", if you keep them in that form (section 119.01(2)(f)). If a report is already posted online, a link is enough.",
      "",
      "Please confirm you received this request. If you expect any charge, tell me the estimate first; please contact me before charging more than $" + cap + "." +
        (val("waive") ? " Because these reports are already required by law and serve the public, I ask that any fee be waived." : ""),
      "",
      "If you withhold any part, please redact only that part, release the rest, and cite the exact statute you rely on (section 119.07(1)(d) and (e)).",
      "",
      "Thank you,",
      "",
    ].concat(name ? [name] : []).concat([email, today()]).join("\n");
  }
  function generic() {
    var name = val("name") || "[YOUR NAME]", email = val("email") || "[YOUR EMAIL]", cap = val("cap") || "25";
    return [
      "Subject: Public records request: " + L.entity + " annual audit" + (L.fy ? " for fiscal year " + L.fy : ""),
      "",
      "To the Records Custodian of " + L.entity + ",",
      "",
      "Under the public records law of " + L.stateName + ", I am asking for copies of these public records:",
      "",
      "1. The annual financial audit or annual financial report of " + L.entity + " for the most recent fiscal year that has ended" + (L.fyeText ? " (the year that ended " + L.fyeText + " or later)" : "") + ".",
      "2. If " + L.entity + " spent $1,000,000 or more in federal awards that year ($750,000 for fiscal years that began before October 1, 2024): the single audit report and the data collection form filed with the Federal Audit Clearinghouse.",
      "3. If the audit or report is not finished: the engagement letter or contract with the auditor, and any record that gives the expected completion date.",
      "",
      "Please send the records electronically, as PDF files by email to " + email + ". If a record is already online, a link is enough.",
      "",
      "Please confirm you received this request and tell me when you expect to respond. Please contact me before charging more than $" + cap + "." +
        (val("waive") ? " I ask that fees be waived because this request serves the public interest and is not for commercial use." : ""),
      "",
      "If you withhold any part, please cite the specific exemption you rely on and release all parts that are not exempt.",
      "",
      "Thank you,",
      "",
      name,
      email,
      today(),
    ].join("\n");
  }
  var render = function () { out.value = L.state === "GEN" ? generic() : L.state === "FL" ? florida() : maine(); };
  form.addEventListener("input", render);
  render();

  // Count a letter as "sent" by loading the /sent/ page in a hidden frame (cookie-free page view; nothing about you is sent).
  var count = function (via) {
    var f = document.createElement("iframe"); f.hidden = true; f.src = "/sent/?via=" + via; document.body.appendChild(f);
    setTimeout(function () { f.remove(); }, 8000);
  };
  form.querySelector("[data-copy]").addEventListener("click", function () {
    out.select();
    (navigator.clipboard ? navigator.clipboard.writeText(out.value) : Promise.reject()).catch(function () { document.execCommand("copy"); });
    this.textContent = "Copied. Paste it into an email.";
    count("copy");
  });
  form.querySelector("[data-mail]").addEventListener("click", function () {
    var lines = out.value.split("\n"), subj = lines[0].replace(/^Subject: /, "");
    count("email");
    location.href = "mailto:?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(lines.slice(2).join("\n"));
  });
  form.querySelector("[data-print]").addEventListener("click", function () { count("print"); window.print(); });
})();
