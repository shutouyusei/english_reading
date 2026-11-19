"use strict";

/* Collapsing of the disclaimer footer. Builds a close button and a one-line version from
   the existing footer HTML. With JS disabled the footer stays shown in full. */

const FOOTER_KEY = "settings.footer";
const FOOTER_MINI_LABEL = "⚠️ AI-generated content (unofficial)";

function footerCollapsed() {
  try {
    const saved = JSON.parse(localStorage.getItem(FOOTER_KEY));
    return Boolean(saved && saved.collapsed);
  } catch (_) {
    return false;
  }
}

function saveFooterCollapsed(collapsed) {
  try {
    localStorage.setItem(FOOTER_KEY, JSON.stringify({ collapsed }));
  } catch (_) { /* cannot save in private mode etc.; ignore */ }
}

function makeFooterButton(className, label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}

function initFooter() {
  const footer = document.querySelector(".site-footer");
  if (!footer) return;
  const linksLine = footer.querySelector("p:last-of-type");
  if (!linksLine) return;
  const linksHtml = linksLine.innerHTML;

  const full = document.createElement("div");
  full.className = "footer-full";
  while (footer.firstChild) full.appendChild(footer.firstChild);
  const collapseBtn = makeFooterButton("footer-toggle", "✕", "Collapse the disclaimer to one line");
  full.appendChild(collapseBtn);

  const mini = document.createElement("p");
  mini.className = "footer-mini";
  const expandBtn = makeFooterButton("footer-expand", FOOTER_MINI_LABEL, "Show the full disclaimer");
  mini.appendChild(expandBtn);
  // linksHtml is our own static HTML (it contains no user input)
  mini.insertAdjacentHTML("beforeend", ` · ${linksHtml}`);

  footer.append(full, mini);

  const apply = (collapsed) => footer.classList.toggle("collapsed", collapsed);
  apply(footerCollapsed());
  collapseBtn.addEventListener("click", () => {
    apply(true);
    saveFooterCollapsed(true);
  });
  expandBtn.addEventListener("click", () => {
    apply(false);
    saveFooterCollapsed(false);
  });
}

document.addEventListener("DOMContentLoaded", initFooter);
