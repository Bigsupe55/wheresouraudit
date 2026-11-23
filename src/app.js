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
  var render = function () { out.value = L.state === "FL" ? florida() : maine(); };
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
