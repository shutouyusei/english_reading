"use strict";

/* Neutralizes special characters before insertion into HTML.
   Shared by reading on the public site and writing in the local app.
   Some places embed data whose content has not been checked, such as grading results,
   so the rendering side must always pass it through this. */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

if (typeof module !== "undefined") {
  module.exports = { escapeHtml };
}
