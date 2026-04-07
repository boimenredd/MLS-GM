import { randInt } from "./utils.js";

let namesDb = null;
let injuryDb = null;

const COUNTRY_NAME_MAP = {
  "USA": "USA",
  "Canada": "Canada",
  "Mexico": "Mexico",
  "Argentina": "Argentina",
  "Brazil": "Brazil",
  "Colombia": "Colombia",
  "Uruguay": "Uruguay",
  "Venezuela": "Venezuela",
  "Paraguay": "Paraguay",
  "Chile": "Chile",
  "Peru": "Peru",
  "Costa Rica": "Costa Rica",
  "Honduras": "Honduras",
  "Panama": "Panama",
  "Jamaica": "Jamaica",
  "Germany": "Germany",
  "Spain": "Spain",
  "France": "France",
  "England": "England",
  "Netherlands": "Netherlands",
  "Belgium": "Belgium",
  "Croatia": "Croatia",
  "Serbia": "Serbia",
  "Nigeria": "Nigeria",
  "Ghana": "Ghana",
  "Ivory Coast": "Ivory Coast",
  "Japan": "Japan",
  "South Korea": "South Korea",
  "Australia": "Australia",
  "Algeria": "Algeria",
  "Armenia": "Armenia",
  "Albania": "Albania",
  "Austria": "Austria",
  "American Samoa": "American Samoa",
  "Angola": "Angola",
};

function normalizeCountryName(country) {
  return COUNTRY_NAME_MAP[country] || country || "USA";
}

const FALLBACK_NAMES = {
  USA: {
    first: { Alex: 8, Jordan: 7, Mason: 7, Tyler: 5, Ben: 4, Chris: 4, Daniel: 5, Owen: 4 },
    last: { Smith: 12, Johnson: 9, Miller: 8, Brown: 7, White: 6, Hall: 5, Wright: 5, Bennett: 4 },
  },
  Canada: {
    first: { Liam: 7, Noah: 6, Ethan: 5, Owen: 5, Lucas: 5, Alex: 4 },
    last: { Smith: 9, Martin: 7, Roy: 5, Tremblay: 6, Gagnon: 5, Wilson: 5 },
  },
  England: {
    first: { Jack: 8, Harry: 8, Ben: 7, James: 6, Tom: 6, Daniel: 5 },
    last: { Smith: 11, Jones: 9, Taylor: 6, Brown: 6, Wilson: 6, Clark: 5 },
  },
};

const FALLBACK_INJURIES = [
  { type: "Knock", severity: "Short-term", minDays: 4, maxDays: 10, weight: 30 },
  { type: "Hamstring strain", severity: "Short-term", minDays: 7, maxDays: 18, weight: 20 },
  { type: "Ankle sprain", severity: "Medium-term", minDays: 14, maxDays: 35, weight: 15 },
  { type: "Groin strain", severity: "Medium-term", minDays: 10, maxDays: 28, weight: 12 },
  { type: "Knee sprain", severity: "Medium-term", minDays: 21, maxDays: 49, weight: 10 },
  { type: "Shoulder injury", severity: "Medium-term", minDays: 14, maxDays: 42, weight: 6 },
  { type: "ACL tear", severity: "Season-ending", minDays: 180, maxDays: 320, weight: 3 },
  { type: "Achilles rupture", severity: "Season-ending", minDays: 150, maxDays: 280, weight: 2 },
  { type: "Broken foot", severity: "Season-ending", minDays: 90, maxDays: 180, weight: 2 },
];

function normalizeCountry(country) {
  return COUNTRY_NAME_MAP[country] || country || "USA";
}

function weightedPickFromObject(obj) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return null;

  const total = entries.reduce((sum, [, weight]) => sum + Number(weight || 1), 0);
  let roll = Math.random() * total;

  for (const [name, weight] of entries) {
    roll -= Number(weight || 1);
    if (roll <= 0) return name;
  }

  return entries[entries.length - 1][0];
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstMatchKey(row, aliases) {
  const keys = Object.keys(row || {});
  for (const key of keys) {
    const norm = normalizeHeader(key);
    if (aliases.some(alias => norm === alias || norm.includes(alias))) {
      return key;
    }
  }
  return null;
}

function parseInjuryRows(rows) {
  const parsed = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const typeKey = firstMatchKey(row, ["type", "injury", "name", "injury type"]);
    const severityKey = firstMatchKey(row, ["severity", "class", "grade"]);
    const minDaysKey = firstMatchKey(row, ["min days", "minimum days", "days min"]);
    const maxDaysKey = firstMatchKey(row, ["max days", "maximum days", "days max"]);
    const minWeeksKey = firstMatchKey(row, ["min weeks", "minimum weeks", "weeks min"]);
    const maxWeeksKey = firstMatchKey(row, ["max weeks", "maximum weeks", "weeks max"]);
    const weightKey = firstMatchKey(row, ["weight", "probability", "chance", "freq", "frequency"]);

    const type = String(typeKey ? row[typeKey] : "").trim();
    if (!type) continue;

    let minDays = minDaysKey ? Number(row[minDaysKey]) : null;
    let maxDays = maxDaysKey ? Number(row[maxDaysKey]) : null;

    if ((!minDays || !maxDays) && minWeeksKey && maxWeeksKey) {
      minDays = Number(row[minWeeksKey]) * 7;
      maxDays = Number(row[maxWeeksKey]) * 7;
    }

    if (!Number.isFinite(minDays) || minDays <= 0) minDays = randInt(5, 14);
    if (!Number.isFinite(maxDays) || maxDays < minDays) maxDays = minDays + randInt(3, 18);

    let severity = severityKey ? String(row[severityKey]).trim() : "";
    if (!severity) {
      if (maxDays <= 18) severity = "Short-term";
      else if (maxDays <= 70) severity = "Medium-term";
      else severity = "Season-ending";
    }

    let weight = weightKey ? Number(row[weightKey]) : 1;
    if (!Number.isFinite(weight) || weight <= 0) weight = 1;

    parsed.push({
      type,
      severity,
      minDays: Math.round(minDays),
      maxDays: Math.round(maxDays),
      weight,
    });
  }

  return parsed;
}

export async function loadExternalData() {
  const tasks = [
    fetch("./names.json")
      .then(async (r) => {
        if (!r.ok) throw new Error("names.json not found");
        return r.json();
      })
      .then((json) => {
        namesDb = json?.countries || null;
      })
      .catch(() => {
        namesDb = null;
      }),

    fetch("./injuries.ods")
      .then(async (r) => {
        if (!r.ok) throw new Error("injuries.ods not found");
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (!window.XLSX) throw new Error("XLSX not available");
        const workbook = window.XLSX.read(buf, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const parsed = parseInjuryRows(rows);
        injuryDb = parsed.length ? parsed : null;
      })
      .catch(() => {
        injuryDb = null;
      }),
  ];

  await Promise.all(tasks);
}

export function generateNameForCountry(country) {
  const key = normalizeCountry(country);
  const source = namesDb?.[key] || FALLBACK_NAMES[key] || FALLBACK_NAMES.USA;

  const first = weightedPickFromObject(source.first);
  const last = weightedPickFromObject(source.last);

  return `${first || "Alex"} ${last || "Smith"}`;
}

export function rollInjury(injuryProne = false) {
  const source = injuryDb?.length ? injuryDb : FALLBACK_INJURIES;

  const weighted = source.map(item => ({
    value: item,
    weight: Math.max(1, Number(item.weight || 1) * (injuryProne && item.maxDays > 40 ? 1.2 : 1)),
  }));

  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  let chosen = weighted[0].value;

  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) {
      chosen = item.value;
      break;
    }
  }

  const days = randInt(chosen.minDays, chosen.maxDays);

  return {
    type: chosen.type,
    severity: chosen.severity,
    days,
  };
}

export function externalDataStatus() {
  return {
    namesLoaded: !!namesDb,
    injuriesLoaded: !!injuryDb,
  };
}
