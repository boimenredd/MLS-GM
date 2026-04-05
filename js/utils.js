export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function uuid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function formatMoney(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${n < 0 ? "-" : ""}$${(abs / 1_000).toFixed(0)}K`;
  return `${n < 0 ? "-" : ""}$${abs.toFixed(0)}`;
}

export function deepClone(obj) {
  return structuredClone(obj);
}

export function weightedRandom(items) {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

export function sortStandingsRows(a, b) {
  const keys = [
    "pointsDesc",
    "winsDesc",
    "gdDesc",
    "gfDesc",
    "disciplineAsc",
    "awayGdDesc",
    "awayGfDesc",
    "homeGdDesc",
    "homeGfDesc",
  ];

  for (const key of keys) {
    const diff = {
      pointsDesc: b.points - a.points,
      winsDesc: b.wins - a.wins,
      gdDesc: b.gd - a.gd,
      gfDesc: b.gf - a.gf,
      disciplineAsc: a.disciplinePoints - b.disciplinePoints,
      awayGdDesc: b.awayGd - a.awayGd,
      awayGfDesc: b.awayGf - a.awayGf,
      homeGdDesc: b.homeGd - a.homeGd,
      homeGfDesc: b.homeGf - a.homeGf,
    }[key];
    if (diff !== 0) return diff;
  }
  return a.randomTiebreak - b.randomTiebreak;
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function readJSONFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function toast(message, type = "") {
  const wrap = document.querySelector("#toastWrap");
  if (!wrap) return;
  const div = document.createElement("div");
  div.className = `toast ${type}`.trim();
  div.textContent = message;
  wrap.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}
