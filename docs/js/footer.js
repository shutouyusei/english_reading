"use strict";

/* 免責フッターの折りたたみ。既存のフッターHTMLを元に、閉じるボタンと
   1行版を組み立てる。JSが無効でもフッターは全文表示のまま残る。 */

const FOOTER_KEY = "settings.footer";
const FOOTER_MINI_LABEL = "⚠️ AI生成コンテンツ(非公式)";

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
  } catch (_) { /* プライベートモード等では保存しない */ }
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
  const collapseBtn = makeFooterButton("footer-toggle", "✕", "免責表示を1行に縮める");
  full.appendChild(collapseBtn);

  const mini = document.createElement("p");
  mini.className = "footer-mini";
  const expandBtn = makeFooterButton("footer-expand", FOOTER_MINI_LABEL, "免責表示を開く");
  mini.appendChild(expandBtn);
  // linksHtml は自前の静的HTML(ユーザー入力を含まない)
  mini.insertAdjacentHTML("beforeend", ` ・ ${linksHtml}`);

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
