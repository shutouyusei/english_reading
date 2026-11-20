"use strict";

/* Turns saved records into one common shape, {at, ratio, label}, newest first as the
   stores return them. Shared by the dashboard and the section lists so that both count
   the same attempts. Pure functions: no DOM, no storage. */

// An attempt finished faster than this cannot have been read and answered for real
// (trial clicks while testing the app, for example), so it is left out of the analysis.
const RUSHED_SECONDS_PER_QUESTION = 15;

function isRushed(attempt) {
  return typeof attempt.elapsedSec === "number" && typeof attempt.total === "number" &&
         attempt.total > 0 && attempt.elapsedSec < RUSHED_SECONDS_PER_QUESTION * attempt.total;
}

/** attempts is newest first. Returns the latest one that was not rushed, or null. */
function latestUsableAttempt(attempts) {
  return attempts.find((attempt) => !isRushed(attempt)) || null;
}

function isNumberInRange(value, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}

// Saved records have no schema guarantee, so a record without a usable score keeps its
// date (it still counts as done) but gets ratio null and is left out of the average.
function attemptRecord(attempt) {
  const valid = isNumberInRange(attempt.total, Infinity) && attempt.total > 0 &&
                isNumberInRange(attempt.score, attempt.total);
  return {
    at: String(attempt.finishedAt || ""),
    ratio: valid ? attempt.score / attempt.total : null,
    label: valid ? `${attempt.score}/${attempt.total}` : "No score",
  };
}

function essayRecord(entry) {
  const overall = entry.grade ? entry.grade.overall : null;
  const valid = isNumberInRange(overall, 5);
  return {
    at: String(entry.essay.writtenAt || ""),
    ratio: valid ? overall / 5 : null,
    label: valid ? `${overall}/5` : "Awaiting grading",
  };
}

// A rushed attempt still shows the set as touched, but its score is not counted.
function countedRecord(attempt) {
  const record = attemptRecord(attempt);
  return isRushed(attempt) ? { ...record, ratio: null, label: "Too fast to count" } : record;
}

if (typeof module !== "undefined") {
  module.exports = { isRushed, latestUsableAttempt, attemptRecord, essayRecord, countedRecord };
}
