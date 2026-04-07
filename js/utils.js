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

export function deepClone(obj) {
  return structuredClone(obj);
}

export function formatNumber(n, options = {}) {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return "0";
  const maximumFractionDigits = Number.isInteger(value) ? 0 : 2;
  return value.toLocaleString("en-US", { maximumFractionDigits, ...options });
}

export function formatMoney(n) {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return "$0";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
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
  setTimeout(() => div.remove(), 3000);
}
