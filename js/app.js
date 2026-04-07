import { $, $$, formatMoney, formatNumber, downloadJSON, readJSONFile, toast, pick, randInt } from "./utils.js";
import { saveSlot, loadSlot, listSlots, deleteSlot } from "./db.js";
import { loadExternalData } from "./assets.js";
import {
  createNewState,
  getUserTeam,
  getTeamPlayers,
  getTeamAcademy,
  getCapSummary,
  teamOverall,
  signFreeAgent,
  callUpAcademyPlayer,
  acceptPendingOffer,
  rejectPendingOffer,
  advanceOneWeek,
  simulateToSeasonEnd,
  simulateMatch,
  initializeDraft,
  startDraft,
  getCurrentDraftPick,
  advanceDraftUntilUserOrEnd,
  makeUserDraftPick,
  proposeTrade,
  updateTeamBudget,
  setPlayerDesignation,
  renegotiateContract,
  getContractDemand,
  getExpiringPlayers,
  hydratePlayer,
  autoAssignAllDesignations,
  ensureOpenCupState,
} from "./sim.js";
import { CONFERENCES, TEAM_LOGOS, TEAM_COLORS } from "./data.js";

let state       = null;
let currentPage = "dashboard";

const SIM_SPEEDS = { slow: 1200, normal: 600, fast: 220, turbo: 80 };
let simSpeedKey   = "normal";
let simSpeed      = SIM_SPEEDS.normal;
let simPaused     = false;
let simSkipped    = false;
let simInProgress = false;
let overlayButtonsBound = false;

let tactics = {
  formation: "4-3-3",
  mentality: "Balanced",
  pressingIntensity: "Medium",
  defensiveLine: "Mid Block",
  notes: "",
  lineup: [],
};

let tradePartnerTeamId = "";
let selectedTeamId = "";
let simAbortRequested = false;
let pendingOpenInNewTab = null;
let simView = "fitness";
let simLeftView = "home";
let simRightView = "away";
let livePitchScene = null;
let weeklyScheduleWeek = 1;

const tableSortState = {
  roster:        { key: "positionOrder", dir: "asc" },
  standingsEast: { key: "points",        dir: "desc" },
  standingsWest: { key: "points",        dir: "desc" },
  stats:         { key: "goals",         dir: "desc" },
  leaders:       { key: "value",         dir: "desc" },
};


const INITIAL_MLS_COACHES = [
  ["Gerardo Martino","Argentina",63,"Atlanta United","2025-11-06","N/A"],
  ["Nico Estévez","Spain",46,"Austin FC","2024-10-25","N/A"],
  ["Dean Smith","England",55,"Charlotte FC","2023-12-12","N/A"],
  ["Gregg Berhalter","United States",52,"Chicago Fire FC","2024-10-08","2009–2011"],
  ["Pat Noonan","United States",45,"FC Cincinnati","2021-12-14","2003–2007, 2008–2012"],
  ["Matt Wells","England",37,"Colorado Rapids","2025-12-23","N/A"],
  ["Henrik Rydström","Sweden",50,"Columbus Crew","2025-12-31","N/A"],
  ["Eric Quill","United States",48,"FC Dallas","2024-11-21","1997–2005"],
  ["René Weiler","Switzerland",52,"D.C. United","2025-07-16","N/A"],
  ["Ben Olsen","United States",48,"Houston Dynamo FC","2022-11-08","1998–2009"],
  ["Javier Mascherano","Argentina",41,"Inter Miami CF","2024-11-26","N/A"],
  ["Greg Vanney","United States",51,"LA Galaxy","2021-01-05","1996–2001, 2005–2008"],
  ["Marc Dos Santos","Canada",48,"Los Angeles FC","2025-12-05","N/A"],
  ["Cameron Knowles","New Zealand",43,"Minnesota United FC","2026-01-12","2005–2011"],
  ["Marco Donadel","Italy",42,"CF Montréal","2025-03-24","N/A"],
  ["B. J. Callaghan","United States",44,"Nashville SC","2024-07-22","N/A"],
  ["Marko Mitrović","Serbia",47,"New England Revolution","2025-11-07","N/A"],
  ["Pascal Jansen","Netherlands",53,"New York City FC","2025-01-06","N/A"],
  ["Michael Bradley","United States",38,"New York Red Bulls","2025-12-15","2004–2005, 2014–2023"],
  ["Óscar Pareja","Colombia",57,"Orlando City SC","2019-12-04","1998–2005"],
  ["Bradley Carnell","South Africa",49,"Philadelphia Union","2025-01-02","N/A"],
  ["Phil Neville","England",49,"Portland Timbers","2023-11-06","N/A"],
  ["Pablo Mastroeni","United States",49,"Real Salt Lake","2021-08-27","1998–2013"],
  ["Mikey Varas","United States",43,"San Diego FC","2024-09-16","N/A"],
  ["Bruce Arena","United States",74,"San Jose Earthquakes","2024-11-07","N/A"],
  ["Brian Schmetzer","United States",63,"Seattle Sounders FC","2016-07-26","N/A"],
  ["Raphaël Wicky","Switzerland",48,"Sporting Kansas City","2026-01-05","2008"],
  ["Yoann Damet","France",36,"St. Louis CITY SC","2025-12-16","N/A"],
  ["Robin Fraser","United States",59,"Toronto FC","2025-01-10","1996–2005"],
  ["Jesper Sørensen","Denmark",52,"Vancouver Whitecaps FC","2025-01-14","N/A"],
];

const GLOBAL_FREE_AGENT_COACHES = [
  ["Xavi Hernández","Spain",46],["Edin Terzić","Germany",43],["Massimiliano Allegri","Italy",58],["Julen Lopetegui","Spain",59],
  ["Mauricio Pochettino","Argentina",54],["Graham Potter","England",51],["Ralph Hasenhüttl","Austria",58],["Roger Schmidt","Germany",58],
  ["Bo Svensson","Denmark",46],["Nuri Şahin","Turkey",38],["Matías Almeyda","Argentina",52],["Marcelo Gallardo","Argentina",50],
  ["Gabriel Heinze","Argentina",48],["Diego Alonso","Uruguay",50],["Guillermo Barros Schelotto","Argentina",52],["Miguel Herrera","Mexico",58],
  ["Juan Reynoso","Peru",55],["Vanderlei Luxemburgo","Brazil",73],["Tite","Brazil",65],["Fernando Diniz","Brazil",52],
  ["Renato Paiva","Portugal",55],["Carlos Carvalhal","Portugal",60],["Abel Ferreira","Portugal",47],["Marco Rose","Germany",49],
  ["Bruno Génésio","France",59],["Claude Puel","France",64],["Lucien Favre","Switzerland",68],["Peter Bosz","Netherlands",62],
  ["Kasper Hjulmand","Denmark",54],["Ståle Solbakken","Norway",57],["Åge Hareide","Norway",72],["Roberto Donadoni","Italy",62],
  ["Aitor Karanka","Spain",52],["Quique Setién","Spain",67],["Domenico Tedesco","Germany",40],["Gennaro Gattuso","Italy",48],
  ["Ole Gunnar Solskjær","Norway",53],["Paulo Bento","Portugal",57],["Hervé Renard","France",57],["Siniša Oreščanin","Croatia",53],
  ["Rodolfo Arruabarrena","Argentina",49],["Vitor Pereira","Portugal",57],["Albert Celades","Spain",50],["Marcelino","Spain",60],
  ["Joachim Löw","Germany",66],["Slaven Bilić","Croatia",57],["Chris Wilder","England",58],["Jesualdo Ferreira","Portugal",79],
  ["Rui Vitória","Portugal",55],["Karel Geraerts","Belgium",43],["Adi Hütter","Austria",55],["Urs Fischer","Switzerland",60],
  ["Míchel Sánchez","Spain",50],["Sérgio Conceição","Portugal",51],["Paulo Fonseca","Portugal",53],["Roberto Martínez","Spain",52],
  ["Felix Magath","Germany",72],["Vahid Halilhodžić","Bosnia and Herzegovina",73],["Pizzi","Argentina",57],["Hugo Ibarra","Argentina",51],
  ["Alexander Blessin","Germany",52],["Paco Jémez","Spain",56],["Giovanni van Bronckhorst","Netherlands",50],["Lee Carsley","England",51],
  ["Tony Popovic","Australia",52],["Kevin Muscat","Australia",52],["Ange Postecoglou","Australia",60],["John Herdman","Canada",50],
  ["Jesse Marsch","United States",52],["Tab Ramos","United States",59],["Bob Bradley","United States",67],["Jim Curtin","United States",45],
  ["Wilfried Nancy","Canada",48],["Robin Dutt","Germany",60],["Gerardo Seoane","Switzerland",47],["Luciano Spalletti","Italy",67]
];

const COACH_STAT_DEFS = [
  ["wins", "Wins"], ["draws", "Draws"], ["losses", "Losses"], ["points", "Points"], ["winPct", "Win %"],
  ["gf", "GF"], ["ga", "GA"], ["gd", "GD"]
];

const COACH_HEADSHOTS = {
  "Gerardo Martino": "https://img.a.transfermarkt.technology/portrait/big/5616-1668455123.jpg?lm=1",
  "Nico Estévez": "https://img.a.transfermarkt.technology/portrait/big/23840-1757577902.jpg?lm=1",
  "Dean Smith": "https://img.a.transfermarkt.technology/portrait/big/15315-1757753322.jpg?lm=1",
  "Gregg Berhalter": "https://img.a.transfermarkt.technology/portrait/header/22272-1757579265.jpg?lm=1",
  "Pat Noonan": "https://img.a.transfermarkt.technology/portrait/big/27429-1757575322.jpg?lm=1",
  "Matt Wells": "https://i.namu.wiki/i/BSBgc8l5k5121dnVaf3NXvmyM36zWNpSd8rfnJ-X6l2Kf3fIJGUXFHoLtZxNdz3NFcx-xFCfdtqLRGpC9DXMmg.webp",
  "Henrik Rydström": "https://images.mlssoccer.com/image/private/t_keep-aspect-ratio-e-mobile/f_auto/mls-clb/fwcjvplrtfzk9wk2vnj0.jpg",
  "Eric Quill": "https://img.a.transfermarkt.technology/portrait/big/66798-1757774436.jpg?lm=1",
  "René Weiler": "https://img.a.transfermarkt.technology/portrait/big/5311-1774731065.jpg?lm=1",
  "Ben Olsen": "https://img.a.transfermarkt.technology/portrait/big/15012-1773860816.jpg?lm=1",
  "Javier Mascherano": "https://img.a.transfermarkt.technology/portrait/big/95593-1775232637.jpg?lm=1",
  "Greg Vanney": "https://img.a.transfermarkt.technology/portrait/big/17495-1774731449.jpg?lm=1",
  "Marc Dos Santos": "https://img.a.transfermarkt.technology/portrait/big/13259-1520888646.jpg?lm=1",
  "Cameron Knowles": "https://img.a.transfermarkt.technology/portrait/big/22827-1583013214.jpg?lm=1",
  "Marco Donadel": "https://img.a.transfermarkt.technology/portrait/big/84217-1757775447.jpg?lm=1",
  "B. J. Callaghan": "https://img.a.transfermarkt.technology/portrait/big/116289-1757771791.jpg?lm=1",
  "Marko Mitrović": "https://img.a.transfermarkt.technology/portrait/big/24972-1722007384.jpg?lm=1",
  "Pascal Jansen": "https://img.a.transfermarkt.technology/portrait/header/18820-1757579984.jpg?lm=1",
  "Michael Bradley": "https://img.a.transfermarkt.technology/portrait/header/122177-1775235759.jpg?lm=1",
  "Óscar Pareja": "https://img.a.transfermarkt.technology/portrait/header/22583-1757584443.jpg?lm=1",
  "Bradley Carnell": "https://img.a.transfermarkt.technology/portrait/header/44287-1775234589.jpg?lm=1",
  "Phil Neville": "https://img.a.transfermarkt.technology/portrait/header/29695-1775235674.jpg?lm=1",
  "Pablo Mastroeni": "https://img.a.transfermarkt.technology/portrait/header/32926-1775235861.jpg?lm=1",
  "Mikey Varas": "https://img.a.transfermarkt.technology/portrait/header/75877-1775236083.jpg?lm=1",
  "Bruce Arena": "https://img.a.transfermarkt.technology/portrait/header/2544-1774652508.jpg?lm=1",
  "Brian Schmetzer": "https://img.a.transfermarkt.technology/portrait/header/8116-1775236368.jpg?lm=1",
  "Raphaël Wicky": "https://img.a.transfermarkt.technology/portrait/header/23140-1775236944.jpg?lm=1",
  "Yoann Damet": "https://img.a.transfermarkt.technology/portrait/header/69476-1618656745.jpg?lm=1",
  "Robin Fraser": "https://img.a.transfermarkt.technology/portrait/header/17473-1775237375.jpg?lm=1",
  "Jesper Sørensen": "https://img.a.transfermarkt.technology/portrait/header/10705-1757576779.jpg?lm=1"
};

const COACH_MANAGER_STARS = {
  "Gerardo Martino": 5,
  "Nico Estévez": 3,
  "Dean Smith": 4,
  "Gregg Berhalter": 4,
  "Pat Noonan": 4,
  "Matt Wells": 2,
  "Henrik Rydström": 4,
  "Eric Quill": 3,
  "René Weiler": 4,
  "Ben Olsen": 4,
  "Javier Mascherano": 3,
  "Greg Vanney": 4,
  "Marc Dos Santos": 3,
  "Cameron Knowles": 2,
  "Marco Donadel": 2,
  "B. J. Callaghan": 3,
  "Marko Mitrović": 3,
  "Pascal Jansen": 4,
  "Michael Bradley": 2,
  "Óscar Pareja": 5,
  "Bradley Carnell": 4,
  "Phil Neville": 3,
  "Pablo Mastroeni": 4,
  "Mikey Varas": 3,
  "Bruce Arena": 5,
  "Brian Schmetzer": 5,
  "Raphaël Wicky": 4,
  "Yoann Damet": 2,
  "Robin Fraser": 3,
  "Jesper Sørensen": 4
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function byTeamId(id, st = state) {
  return (st?.teams || []).find(t => t.id === id) || null;
}
function byPlayerId(id, st = state) {
  return (st?.players || []).find(p => p.id === id)
      || (st?.freeAgents || []).find(p => p.id === id)
      || null;
}

function byDraftPickId(id) {
  return state?.draft?.picks?.find(p => p.id === id) || null;
}

function teamLogoUrl(teamOrName) {
  const name = typeof teamOrName === "string" ? teamOrName : teamOrName?.name;
  return TEAM_LOGOS[name] || "";
}

function teamLogoMark(team, cls = "team-logo") {
  const src = teamLogoUrl(team);
  return src ? `<img src="${src}" alt="${escapeHtml(team.name)} logo" class="${cls}" />` : "";
}

function teamLink(teamId, label) {
  const text = label || byTeamId(teamId)?.name || "Unknown";
  return `<a href="${escapeAttr(buildRouteHref('team', teamId))}" class="text-link team-link" data-id="${teamId}">${escapeHtml(text)}</a>`;
}

function teamColors(teamOrId) {
  const team = typeof teamOrId === "string" ? byTeamId(teamOrId) : teamOrId;
  return TEAM_COLORS[team?.name] || { primary: "#6ab2e7", secondary: "#0b1f41", text: "#ffffff" };
}

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function ensureJerseyNumbers(st) {
  if (!st?.players) return;
  const defaultsByPos = { GK: [1, 12, 18, 99], RB: [2, 22, 14], CB: [4, 5, 13, 15], LB: [3, 16, 21], CDM: [6, 20, 28], CM: [8, 10, 17, 23], CAM: [10, 11, 19], RM: [7, 17, 27], LM: [11, 14, 21], RW: [7, 11, 77], LW: [11, 17, 27], ST: [9, 19, 29] };
  for (const team of st.teams || []) {
    const roster = (st.players || []).filter(p => p.clubId === team.id);
    const used = new Set();
    roster.sort((a,b) => (b.overall - a.overall) || (a.age - b.age));
    for (const p of roster) {
      if (Number.isInteger(p.jerseyNumber) && !used.has(p.jerseyNumber)) { used.add(p.jerseyNumber); continue; }
      const prefs = defaultsByPos[p.position] || [30,31,32,33];
      let num = prefs.find(n => !used.has(n));
      if (!num) { for (let i = 2; i <= 99; i++) if (!used.has(i)) { num = i; break; } }
      p.jerseyNumber = num || 99;
      used.add(p.jerseyNumber);
    }
  }
}

function openCupEntryByRef(ref) {
  const [kind, ...rest] = String(ref || "").split(":");
  const id = rest.join(":");
  if (kind === "mls") return byTeamId(id);
  return state?.openCup?.guestTeams?.find(t => t.id === id) || null;
}

function openCupEntryLabel(ref) {
  const entry = openCupEntryByRef(ref);
  if (!entry) return "—";
  if (String(ref).startsWith("mls:")) return teamLink(entry.id, entry.name);
  return escapeHtml(entry.name);
}

function renderSimClubChip(team, side = "home") {
  const src = teamLogoUrl(team);
  const cls = side === "away" ? "away" : "home";
  return `<span class="msim-team-chip ${cls}">${src ? `<img src="${src}" alt="${escapeHtml(team.name)} logo" class="msim-team-logo" />` : `<span class="msim-team-logo msim-team-logo-fallback">${escapeHtml((team.shortName || team.name).slice(0, 2).toUpperCase())}</span>`}<span class="msim-team-text">${escapeHtml(team.shortName || team.name)}</span></span>`;
}

function normalizeLegacyPosition(player) {
  if (!player) return;
  if (player.position === "FB") {
    player.position = (player.preferredFoot || "Right") === "Left" ? "LB" : "RB";
  } else if (player.position === "Winger") {
    player.position = (player.preferredFoot || "Right") === "Left" ? "LW" : "RW";
  }
  if (!player.side && ["LB","LM","LW"].includes(player.position)) player.side = "Left";
  if (!player.side && ["RB","RM","RW"].includes(player.position)) player.side = "Right";
}

function currentTheme() {
  return state?.settings?.theme || localStorage.getItem("mls-gm-theme") || "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  localStorage.setItem("mls-gm-theme", theme === "light" ? "light" : "dark");
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.textContent = theme === "light" ? "Dark" : "Light";
}

function setSelectedTeam(teamId) {
  selectedTeamId = teamId;
  currentPage = "team";
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === currentPage));
  renderPage();
}

function clearPendingNewTabTarget() {
  pendingOpenInNewTab = null;
  document.querySelectorAll(".open-in-new-tab-armed").forEach(el => el.classList.remove("open-in-new-tab-armed"));
}

function armOpenInNewTab(el, type, id) {
  clearPendingNewTabTarget();
  pendingOpenInNewTab = { type, id };
  el.classList.add("open-in-new-tab-armed");
  toast("Click again to open in a new tab.", "warn");
}

function shouldOpenInNewTab(type, id) {
  return !!pendingOpenInNewTab && pendingOpenInNewTab.type === type && pendingOpenInNewTab.id === id;
}

async function openInNewTab(type, id) {
  if (!state) return;
  await persist();
  const targetUrl = buildRouteHref(type, id);
  window.open(targetUrl, "_blank", "noopener,noreferrer");
  clearPendingNewTabTarget();
}

function parseHashLaunch() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const slot = params.get("slot");
  const route = params.get("route");
  const id = params.get("id");
  if (!slot || !route) return null;
  return { slot, route, id };
}

async function applyHashLaunch() {
  const launch = parseHashLaunch();
  if (!launch) return false;
  const loaded = await loadSlot(launch.slot);
  if (!loaded) return false;
  state = normalizeState(loaded);
  initGreenCards(state);
  setAppVisible(true);
  if (launch.route === "team") {
    selectedTeamId = launch.id || state.userTeamId;
    currentPage = "team";
  } else {
    currentPage = "dashboard";
  }
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === currentPage));
  await renderPage();
  if (launch.route === "player" && launch.id) openPlayerProfile(launch.id);
  if (launch.route === "coach" && launch.id) renderCoachProfile(launch.id);
  return true;
}


function getTeamRecord(teamId) {
  const team = byTeamId(teamId);
  const rows = state?.standings?.[team?.conference] || [];
  return rows.find(r => r.teamId === teamId) || null;
}

function buildRouteHref(type, id) {
  const params = new URLSearchParams();
  params.set("slot", state?.saveSlot || parseHashLaunch()?.slot || "slot1");
  params.set("route", type);
  if (id != null) params.set("id", id);
  return `${location.pathname}${location.search}#${params.toString()}`;
}


function roundMarketValue(value, step = 50000) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n / step) * step;
}

function formatMarketValue(value) {
  return formatMoney(roundMarketValue(value));
}


function clampRating(value, min = 1, max = 99) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function averageRatings(values) {
  const nums = values.map(v => Number(v)).filter(v => Number.isFinite(v));
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function parseHeightInches(heightText) {
  if (!heightText) return null;
  const m = String(heightText).match(/(\d+)\s*'\s*(\d+)/);
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]);
}

function heightToRating(heightText) {
  const inches = parseHeightInches(heightText);
  if (!inches) return 60;
  return clampRating(48 + (inches - 62) * 2.35, 40, 95);
}

function getPlayerStatProfile(player) {
  const a = player?.attributes || {};
  const d = player?.detailed || {};
  const physical = d.physical || {};
  const technical = d.technical || {};
  const defending = d.defending || {};
  const goalkeeping = d.goalkeeping || {};
  const basePass = Number(a.passing || 60);
  const baseShoot = Number(a.shooting || 55);
  const baseDrib = Number(a.dribbling || 58);
  const baseDef = Number(a.defense || 45);
  const basePhys = Number(a.physical || 58);
  const basePace = Number(a.pace || 60);

  const stats = {
    physical: {
      Height: heightToRating(player?.height),
      Strength: clampRating(physical.strength ?? basePhys),
      'Sprint Speed': clampRating(physical.sprintSpeed ?? basePace),
      Acceleration: clampRating(physical.acceleration ?? basePace),
      Endurance: clampRating(physical.stamina ?? ((basePhys + basePace) / 2)),
    },
    passing: {
      Vision: clampRating(technical.vision ?? basePass),
      Power: clampRating(((technical.shortPassing ?? basePass) + (physical.strength ?? basePhys)) / 2),
      Accuracy: clampRating(technical.shortPassing ?? basePass),
      Crossing: clampRating(technical.crossing ?? ((basePass + baseDrib) / 2)),
      'Long Passing': clampRating(((technical.vision ?? basePass) + (technical.shortPassing ?? basePass) + (technical.setPieces ?? basePass)) / 3),
    },
    shooting: {
      'Shot Power': clampRating(technical.longShots ?? baseShoot),
      'Heading Accuracy': clampRating(defending.heading ?? ((baseDef + basePhys) / 2)),
      Volleys: clampRating(((technical.finishing ?? baseShoot) + (technical.firstTouch ?? baseDrib)) / 2),
      'Free Kick Accuracy': clampRating(technical.setPieces ?? ((basePass + baseShoot) / 2)),
      Curve: clampRating(((technical.setPieces ?? basePass) + (technical.crossing ?? basePass) + (technical.vision ?? basePass)) / 3),
    },
    skill: {
      Dribbling: clampRating(technical.dribbling ?? baseDrib),
      'Ball Control': clampRating(technical.firstTouch ?? ((baseDrib + basePass) / 2)),
      'Skill Moves': clampRating(((technical.dribbling ?? baseDrib) + (physical.acceleration ?? basePace)) / 2),
    },
    mentality: {
      Aggression: clampRating(((physical.strength ?? basePhys) + (defending.tackling ?? baseDef)) / 2),
      Positioning: clampRating(player?.position === 'GK'
        ? (goalkeeping.command ?? baseDef)
        : (((technical.finishing ?? baseShoot) + (technical.vision ?? basePass) + (defending.positioning ?? baseDef)) / 3)),
      Penalties: clampRating(((technical.finishing ?? baseShoot) + (technical.setPieces ?? basePass)) / 2),
      Composure: clampRating(((technical.firstTouch ?? baseDrib) + (technical.vision ?? basePass) + (physical.strength ?? basePhys)) / 3),
    },
    defense: {
      Awareness: clampRating(((defending.marking ?? baseDef) + (defending.positioning ?? baseDef)) / 2),
      'Standing Tackle': clampRating(defending.tackling ?? baseDef),
      'Sliding Tackle': clampRating((defending.tackling ?? baseDef) - 4),
      Interceptions: clampRating(defending.interceptions ?? baseDef),
    },
    goalkeeping: {
      Diving: clampRating(((goalkeeping.reflexes ?? 12) + (goalkeeping.oneOnOnes ?? 12)) / 2),
      Handling: clampRating(goalkeeping.handling ?? 12),
      Kicking: clampRating(goalkeeping.kicking ?? 12),
      Positioning: clampRating(goalkeeping.command ?? 12),
      Reflexes: clampRating(goalkeeping.reflexes ?? 12),
    },
  };

  const categoryRatings = Object.fromEntries(Object.entries(stats).map(([key, group]) => [key, averageRatings(Object.values(group))]));
  const weightsByPos = {
    GK: { goalkeeping: 0.62, physical: 0.14, mentality: 0.12, passing: 0.08, defense: 0.04 },
    CB: { defense: 0.42, physical: 0.26, mentality: 0.12, passing: 0.1, skill: 0.05, shooting: 0.05 },
    LB: { defense: 0.26, physical: 0.22, passing: 0.18, skill: 0.16, mentality: 0.1, shooting: 0.08 },
    RB: { defense: 0.26, physical: 0.22, passing: 0.18, skill: 0.16, mentality: 0.1, shooting: 0.08 },
    CDM: { defense: 0.26, passing: 0.22, physical: 0.18, mentality: 0.16, skill: 0.12, shooting: 0.06 },
    CM: { passing: 0.24, skill: 0.22, mentality: 0.18, physical: 0.16, defense: 0.12, shooting: 0.08 },
    CAM: { passing: 0.26, skill: 0.24, mentality: 0.16, shooting: 0.16, physical: 0.1, defense: 0.08 },
    LM: { skill: 0.24, passing: 0.2, physical: 0.18, shooting: 0.16, mentality: 0.12, defense: 0.1 },
    RM: { skill: 0.24, passing: 0.2, physical: 0.18, shooting: 0.16, mentality: 0.12, defense: 0.1 },
    LW: { skill: 0.26, shooting: 0.2, passing: 0.18, physical: 0.16, mentality: 0.12, defense: 0.08 },
    RW: { skill: 0.26, shooting: 0.2, passing: 0.18, physical: 0.16, mentality: 0.12, defense: 0.08 },
    ST: { shooting: 0.32, skill: 0.2, physical: 0.18, mentality: 0.14, passing: 0.1, defense: 0.06 },
  };
  const weights = weightsByPos[player?.position] || { physical: .17, passing: .17, shooting: .17, skill: .17, mentality: .16, defense: .16 };
  const positionRating = clampRating(Object.entries(weights).reduce((sum, [key, wt]) => sum + (categoryRatings[key] || 0) * wt, 0));
  return { stats, categoryRatings, positionRating };
}

function renderPlayerStatCard(title, rating, statMap) {
  const rows = Object.entries(statMap).map(([label, value]) => `
    <div class="player-stat-row">
      <span class="player-stat-label">${escapeHtml(label)}</span>
      <div class="player-stat-bar"><i style="width:${Math.max(0, Math.min(100, Number(value) || 0))}%"></i></div>
      <strong class="player-stat-value">${Math.round(Number(value) || 0)}</strong>
    </div>`).join('');
  return `<section class="panel player-stat-card"><div class="panel-head"><h3>${escapeHtml(title)}</h3><span>${rating}</span></div><div class="player-stat-list">${rows}</div></section>`;
}

function playerLink(id, label) {
  const text = label || byPlayerId(id)?.name || "Unknown Player";
  return `<a href="${escapeAttr(buildRouteHref('player', id))}" class="text-link player-link" data-id="${id}">${escapeHtml(text)}</a>`;
}

function coachLink(coachId, label) {
  const coach = state?.coaches?.find(c => c.id === coachId) || state?.coachCarousel?.freeAgents?.find(c => c.id === coachId);
  const text = label || coach?.name || "Unknown Coach";
  return `<a href="${escapeAttr(buildRouteHref('coach', coachId))}" class="text-link coach-link" data-id="${coachId}">${escapeHtml(text)}</a>`;
}


function renderCoachStars(value = 3) {
  const n = Math.max(1, Math.min(5, Number(value) || 3));
  return `<span class="coach-stars" aria-label="${n} star coach">${Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
}

function coachPhoto(coach, cls = "coach-photo") {
  const src = coach?.headshot;
  if (src) return `<img src="${src}" alt="${escapeHtml(coach?.name || 'Coach')}" class="${cls}" loading="lazy" referrerpolicy="no-referrer" />`;
  return `<span class="${cls} coach-photo-fallback">${escapeHtml((coach?.name || 'C').split(' ').map(x => x[0]).slice(0,2).join(''))}</span>`;
}

function coachMetaLine(coach, showStars = true) {
  if (!coach) return 'No coach';
  return `${coachLink(coach.id, coach.name)}${showStars ? ` <span class="coach-meta-stars">${renderCoachStars(coach.managerStars || 3)}</span>` : ``}`;
}

function getTeamCoach(teamId) {
  return (state?.coaches || []).find(c => c.teamId === teamId) || null;
}

function getCoachCurrentRecord(coach) {
  if (!coach) return { matches: 0, wins: 0, draws: 0, losses: 0, points: 0, gf: 0, ga: 0, gd: 0, winPct: 0 };
  const team = coach.teamId ? byTeamId(coach.teamId) : null;
  if (!team) return { matches: coach.careerTotals?.matches || 0, wins: coach.careerTotals?.wins || 0, draws: coach.careerTotals?.draws || 0, losses: coach.careerTotals?.losses || 0, points: coach.careerTotals?.points || 0, gf: coach.careerTotals?.gf || 0, ga: coach.careerTotals?.ga || 0, gd: (coach.careerTotals?.gf || 0) - (coach.careerTotals?.ga || 0), winPct: coach.careerTotals?.matches ? Math.round((coach.careerTotals.wins / coach.careerTotals.matches) * 100) : 0 };
  const row = getTeamRecord(team.id) || {};
  const matches = row.played || 0;
  return {
    matches,
    wins: row.wins || 0,
    draws: row.draws || 0,
    losses: row.losses || 0,
    points: row.points || 0,
    gf: row.gf || 0,
    ga: row.ga || 0,
    gd: row.gd || 0,
    winPct: matches ? Math.round(((row.wins || 0) / matches) * 100) : 0,
  };
}

function ensureCoachState(st) {
  st.coaches ||= [];
  st.coachCarousel ||= { freeAgents: [] };
  if (!st.coaches.length) {
    st.coaches = INITIAL_MLS_COACHES.map(([name, nationality, age, clubName, appointed, playedInMLS]) => {
      const team = (st.teams || []).find(t => t.name === clubName);
      const managerStars = COACH_MANAGER_STARS[name] || randInt(2, 4);
      return {
        id: `coach_${Math.random().toString(36).slice(2, 10)}`,
        name, nationality, age, teamId: team?.id || null,
        appointed,
        playedInMLS,
        style: pick(["Pressing", "Possession", "Balanced", "Counter", "Direct"]),
        contractThrough: (st.season?.year || 2026) + randInt(2, 4),
        career: [{ club: clubName, start: appointed, end: "now" }],
        sackShield: Math.max(randInt(2, 4), managerStars >= 4 ? 4 : 2),
        managerStars,
        headshot: COACH_HEADSHOTS[name] || null,
        careerTotals: { matches: 0, wins: 0, draws: 0, losses: 0, points: 0, gf: 0, ga: 0 },
      };
    });
  }
  if (!st.coachCarousel.freeAgents.length) {
    st.coachCarousel.freeAgents = GLOBAL_FREE_AGENT_COACHES.map(([name, nationality, age]) => {
      const reputation = randInt(64, 91);
      return {
        id: `fac_${Math.random().toString(36).slice(2, 10)}`,
        name, nationality, age,
        teamId: null,
        appointed: null,
        playedInMLS: "N/A",
        style: pick(["Pressing", "Possession", "Balanced", "Counter", "Direct"]),
        career: [],
        headshot: COACH_HEADSHOTS[name] || null,
        managerStars: Math.max(2, Math.min(5, COACH_MANAGER_STARS[name] || Math.round((reputation - 55) / 10))),
        careerTotals: { matches: randInt(180, 540), wins: randInt(60, 240), draws: randInt(35, 120), losses: randInt(45, 180), points: randInt(220, 760), gf: randInt(180, 680), ga: randInt(140, 520) },
        reputation,
        sackShield: randInt(1, 3),
      };
    });
  }
  for (const coach of st.coaches) {
    coach.headshot ||= COACH_HEADSHOTS[coach.name] || null;
    coach.managerStars ||= COACH_MANAGER_STARS[coach.name] || randInt(2, 4);
    coach.style ||= "Balanced";
    coach.sackShield ||= Math.max(2, coach.managerStars >= 4 ? 4 : 2);
    coach.career ||= coach.teamId ? [{ club: byTeamId(coach.teamId, st)?.name || "Unknown Club", start: coach.appointed || `${st.season?.year || 2026}-01-01`, end: "now" }] : [];
    coach.careerTotals ||= { matches: 0, wins: 0, draws: 0, losses: 0, points: 0, gf: 0, ga: 0 };
  }
  for (const coach of st.coachCarousel.freeAgents) {
    coach.headshot ||= COACH_HEADSHOTS[coach.name] || null;
    coach.managerStars ||= COACH_MANAGER_STARS[coach.name] || Math.max(2, Math.min(5, Math.round(((coach.reputation || 72) - 55) / 10)));
    coach.style ||= "Balanced";
    coach.career ||= [];
    coach.careerTotals ||= { matches: randInt(180, 540), wins: randInt(60, 240), draws: randInt(35, 120), losses: randInt(45, 180), points: randInt(220, 760), gf: randInt(180, 680), ga: randInt(140, 520) };
  }
  for (const team of st.teams || []) {
    if (!st.coaches.find(c => c.teamId === team.id)) {
      const fallback = st.coachCarousel.freeAgents.shift();
      if (fallback) {
        st.coaches.push({ ...fallback, teamId: team.id, appointed: `${st.season?.year || 2026}-01-01`, career: [{ club: team.name, start: `${st.season?.year || 2026}-01-01`, end: "now" }] });
      }
    }
  }
}

function renderCoachProfile(coachId) {
  const coach = (state?.coaches || []).find(c => c.id === coachId) || (state?.coachCarousel?.freeAgents || []).find(c => c.id === coachId);
  if (!coach) return;
  const team = coach.teamId ? byTeamId(coach.teamId) : null;
  const rec = getCoachCurrentRecord(coach);
  const palette = team ? teamColors(team.id) : { primary: "#b59b62", secondary: "#131722", text: "#ffffff" };
  const jobs = (coach.career || []).map(job => `<div class="coach-career-row"><div><strong>${escapeHtml(job.club)}</strong><span>${escapeHtml(job.start || "—")} — ${escapeHtml(job.end || "now")}</span></div><em>${job.end === 'now' ? 'Active' : 'Past'}</em></div>`).join("") || `<div class="note">No career history yet.</div>`;
  const html = `<div id="coachProfileOverlay" class="pp-overlay">
    <div class="pp-modal coach-profile-shell">
      <button class="pp-close" id="coachProfileClose">×</button>
      <div class="coach-hero-card coach-hero-card-clean" style="background:linear-gradient(180deg, ${palette.primary} 0 92px, #141820 92px 100%); color:${palette.text === '#111111' ? '#ffffff' : palette.text};">
        <div class="coach-hero-main coach-hero-main-clean">
          <div class="coach-hero-id">
            ${coachPhoto(coach, 'coach-photo-xl')}
            <div class="coach-title-stack">
              <div class="coach-name">${escapeHtml(coach.name)}</div>
              <div class="coach-subline">${team ? teamLink(team.id, team.name) : 'Free Agent'} · ${escapeHtml(coach.nationality)}</div>
              <div class="coach-rating-row">${renderCoachStars(coach.managerStars || 3)}<span>Manager rating</span></div>
            </div>
          </div>
          <div class="coach-hero-metrics">
            <div><span>Age</span><strong>${coach.age}</strong></div>
            <div><span>Matches</span><strong>${rec.matches}</strong></div>
            <div><span>Points</span><strong>${rec.points}</strong></div>
            <div><span>Win %</span><strong>${rec.winPct}%</strong></div>
          </div>
        </div>
      </div>
      <div class="coach-profile-grid coach-profile-grid-clean">
        <section class="panel coach-overview-panel-clean">
          <div class="panel-head"><h3>Overview</h3><span>${team ? 'Active MLS coach' : 'Free agent coach'}</span></div>
          <div class="coach-overview-topgrid">
            <div class="pp-info-box"><div class="pp-info-lbl">Country</div><div class="pp-info-val">${escapeHtml(coach.nationality)}</div></div>
            <div class="pp-info-box"><div class="pp-info-lbl">Style</div><div class="pp-info-val">${escapeHtml(coach.style || 'Balanced')}</div></div>
            <div class="pp-info-box"><div class="pp-info-lbl">Appointed</div><div class="pp-info-val">${escapeHtml(coach.appointed || 'Available')}</div></div>
            <div class="pp-info-box"><div class="pp-info-lbl">Played in MLS</div><div class="pp-info-val">${escapeHtml(coach.playedInMLS || 'N/A')}</div></div>
          </div>
          <div class="coach-overview-bottom">
            <div class="coach-bars coach-bars-clean">
              <div class="coach-bar-row"><span>Won</span><div class="coach-bar"><i style="width:${Math.max(8, Math.min(100, rec.matches ? (rec.wins/rec.matches)*100 : 0))}%"></i></div><strong>${rec.wins}</strong></div>
              <div class="coach-bar-row"><span>Drawn</span><div class="coach-bar neutral"><i style="width:${Math.max(8, Math.min(100, rec.matches ? (rec.draws/rec.matches)*100 : 0))}%"></i></div><strong>${rec.draws}</strong></div>
              <div class="coach-bar-row"><span>Lost</span><div class="coach-bar loss"><i style="width:${Math.max(8, Math.min(100, rec.matches ? (rec.losses/rec.matches)*100 : 0))}%"></i></div><strong>${rec.losses}</strong></div>
            </div>
            <div class="panel-lite coach-stat-table-wrap coach-stat-table-wrap-clean">
              <table class="tight-table"><thead><tr><th>Stat</th><th class="num">Value</th></tr></thead><tbody>
                ${COACH_STAT_DEFS.map(([key,label]) => `<tr><td>${label}</td><td class="num">${key === 'winPct' ? `${rec[key]}%` : formatNumber(rec[key] || 0)}</td></tr>`).join('')}
              </tbody></table>
            </div>
          </div>
        </section>
        <aside class="panel coach-career-panel-clean">
          <div class="panel-head"><h3>Career</h3><span>Sim tracking</span></div>
          <div class="coach-career-list coach-career-list-clean">${jobs}</div>
        </aside>
      </div>
    </div>
  </div>`;

  document.getElementById("coachProfileOverlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("coachProfileClose")?.addEventListener("click", () => document.getElementById("coachProfileOverlay")?.remove());
  document.getElementById("coachProfileOverlay")?.addEventListener("click", e => { if (e.target.id === "coachProfileOverlay") document.getElementById("coachProfileOverlay")?.remove(); });
  document.querySelectorAll("#coachProfileOverlay .team-link").forEach(el => {
    el.addEventListener("click", async e => {
      e.preventDefault();
      document.getElementById("coachProfileOverlay")?.remove();
      setSelectedTeam(el.dataset.id);
    });
  });
}

function syncCoachStats(st) {
  ensureCoachState(st);
  for (const coach of st.coaches || []) {
    if (!coach.teamId) continue;
    const team = byTeamId(coach.teamId, st);
    const row = (st.standings?.[team?.conference] || []).find(r => r.teamId === coach.teamId);
    if (!row) continue;
    coach.careerTotals = {
      matches: row.played || 0,
      wins: row.wins || 0,
      draws: row.draws || 0,
      losses: row.losses || 0,
      points: row.points || 0,
      gf: row.gf || 0,
      ga: row.ga || 0,
    };
  }
}

function renderCoachCarousel() {
  const free = (state?.coachCarousel?.freeAgents || []).slice().sort((a,b) => ((b.managerStars || 0) - (a.managerStars || 0)) || ((b.reputation || 0) - (a.reputation || 0))).slice(0, 18);
  return `<div class="panel"><div class="panel-head"><h3>Coaching Carousel</h3><span>Stable by design · openings only after long poor runs</span></div>
    <div class="coach-carousel-strip coach-carousel-strip-rich">${free.map(c => `<div class="coach-pill coach-pill-rich"><div class="coach-pill-head">${coachPhoto(c, 'coach-pill-photo')}<div><button type="button" class="coach-link coach-pill-name" data-id="${c.id}">${escapeHtml(c.name)}</button><div class="note">${escapeHtml(c.nationality)} · ${c.age}</div></div></div><div class="coach-pill-foot">${renderCoachStars(c.managerStars || 3)}<span>${escapeHtml(c.style || 'Balanced')}</span></div></div>`).join("")}</div>
  </div>`;
}

function rebalanceLiveStateForModernRules(st) {
  if (!st?.players || st._ratingsBalancedV9) return;
  for (const team of st.teams || []) {
    const roster = (st.players || []).filter(p => p.clubId === team.id).sort((a,b) => (b.overall - a.overall) || (a.age - b.age));
    roster.forEach((p, idx) => {
      const ageCap = p.age <= 18 ? 54 : p.age <= 20 ? 58 : p.age <= 22 ? 63 : p.age <= 24 ? 69 : p.age <= 27 ? 75 : p.age <= 30 ? 77 : p.age <= 33 ? 74 : 70;
      const eliteAllowance = idx < 2 ? 4 : idx < 5 ? 2 : 0;
      const cap = ageCap + eliteAllowance;
      if (p.overall > cap) {
        const delta = p.overall - cap;
        for (const key of Object.keys(p.attributes || {})) p.attributes[key] = Math.max(28, Math.round(p.attributes[key] - delta * 0.9));
        p.overall = cap;
      }
      const growthHeadroom = p.age <= 18 ? 17 : p.age <= 20 ? 14 : p.age <= 22 ? 11 : p.age <= 24 ? 7 : p.age <= 28 ? 4 : 1;
      p.potential = Math.max(p.overall, Math.min(90, Math.max(p.overall + 1, p.overall + growthHeadroom - randInt(0, 4))));
    });
  }
  st._ratingsBalancedV9 = true;
}

function rebalanceTeamBudgetView(st) {
  if (st._budgetBalancedV9) return;
  for (const team of st.teams || []) {
    const roster = (st.players || []).filter(p => p.clubId === team.id).sort((a,b) => (b.contract?.salary || 0) - (a.contract?.salary || 0));
    roster.forEach((p, idx) => {
      if (!p.contract) return;
      if (idx < 2) p.contract.salary = Math.max(p.contract.salary, randInt(2400000, 6800000));
      else if (idx === 2 && p.overall >= 70) p.contract.salary = Math.max(p.contract.salary, randInt(1700000, 4200000));
      else if (p.overall >= 68) p.contract.salary = Math.max(p.contract.salary, randInt(350000, 1200000));
    });
    const intl = roster.filter(p => takesIntlSlot(p));
    while (intl.length > (team.internationalSlots || 8)) {
      const player = intl.pop();
      if (player) player.hasGreenCard = true;
    }
  }
  st._budgetBalancedV9 = true;
}

function normalizeState(st) {
  if (!st) return st;
  st.version = Math.max(st.version || 0, 10);
  st.season ||= { year: 2026, phase: "Regular Season" };
  st.calendar ||= { week: 1, absoluteDay: 0 };
  st.settings ||= {};
  st.settings.salaryBudget ||= 6425000;
  st.settings.gamAnnual ||= 3280000;
  st.settings.tamAnnual ||= 2125000;
  st.settings.academyPerTeam ||= 8;
  st.settings.leagueMode ||= "generated";
  st.settings.theme ||= localStorage.getItem("mls-gm-theme") || "dark";

  for (const team of st.teams || []) {
    team.salaryBudget ??= st.settings.salaryBudget;
    team.gam ??= st.settings.gamAnnual;
    team.tam ??= st.settings.tamAnnual;
    team.internationalSlots ??= 8;
    team.dpSlots ??= 3;
    team.u22Slots ??= 3;
    team.finances ||= { cash: 10000000, ticketBase: 22000, sponsor: 12000000 };
  }

  const seasonYear = st.season.year || 2026;
  for (const player of [...(st.players || []), ...(st.freeAgents || [])]) {
    normalizeLegacyPosition(player);
    hydratePlayer(player, seasonYear);
  }
  for (const teamId of Object.keys(st.academies || {})) {
    st.academies[teamId] = (st.academies[teamId] || []).map(p => {
      normalizeLegacyPosition(p);
      return hydratePlayer(p, seasonYear);
    });
  }

  ensureJerseyNumbers(st);
  ensureOpenCupState(st);
  ensureCoachState(st);

  st.draft ||= {};
  st.draft.pool ||= [];
  st.draft.pool = st.draft.pool.map(p => {
    normalizeLegacyPosition(p);
    return hydratePlayer(p, seasonYear);
  });
  st.draft.picks ||= [];
  st.draft.order ||= [];
  st.draft.history ||= [];
  st.draft.started ||= false;
  st.draft.completed ||= false;
  st.draft.year ||= (st.season.year || 2026) + 1;
  st.draft.currentPickIndex ||= 0;
  st.draft.currentRound ||= 1;

  const startYear = (st.season.year || 2026) + 1;
  for (let year = startYear; year < startYear + 3; year++) {
    for (const team of st.teams || []) {
      for (let round = 1; round <= 3; round++) {
        const exists = st.draft.picks.find(
          p => p.year === year && p.round === round && p.originalTeamId === team.id
        );
        if (!exists) {
          st.draft.picks.push({
            id: `pick_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
            year,
            round,
            originalTeamId: team.id,
            ownerTeamId: team.id,
          });
        }
      }
    }
  }

  rebalanceLiveStateForModernRules(st);
  rebalanceTeamBudgetView(st);
  autoAssignAllDesignations(st);
  syncCoachStats(st);
  selectedTeamId ||= st.userTeamId;
  applyTheme(st.settings.theme);
  return st;
}

function getUserDraftPicks(years = [state?.season?.year + 1, state?.season?.year + 2]) {
  const set = new Set(years.filter(Boolean));
  return (state?.draft?.picks || [])
    .filter(p => p.ownerTeamId === state.userTeamId && set.has(p.year))
    .sort((a, b) => a.year - b.year || a.round - b.round || byTeamId(a.originalTeamId).name.localeCompare(byTeamId(b.originalTeamId).name));
}

function escapeHtml(v) {
  return String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function setAppVisible(v) {
  $("#homeScreen").classList.toggle("hidden", v);
  $("#appShell").classList.toggle("hidden", !v);
}

function openOverlay(el)  { if (el) el.classList.add("open"); }
function closeOverlay(el) { if (el) el.classList.remove("open"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getPositionOrder(pos) {
  return { GK:1, LB:2, CB:3, RB:4, LM:5, RM:6, CDM:7, CM:8, CAM:9, LW:10, RW:11, ST:12 }[pos] || 99;
}

function sortRows(rows, cfg) {
  const { key, dir } = cfg;
  const m = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * m;
    return String(av).localeCompare(String(bv)) * m;
  });
}

// ── International slot logic ─────────────────────────────────────────────────

function isUSOrCanadian(p) {
  return p.nationality === "USA" || p.nationality === "Canada";
}

function takesIntlSlot(p) {
  if (isUSOrCanadian(p)) return false;
  if (p.hasGreenCard) return false;
  return true;
}

function initGreenCards(st) {
  const all = [...(st.players || []), ...(st.freeAgents || [])];
  for (const p of all) {
    if (isUSOrCanadian(p)) { p.hasGreenCard = false; p.domestic = true; }
    else if (p.hasGreenCard === undefined) { p.hasGreenCard = Math.random() < 0.45; }
  }
}

function runGreenCardOffseason(st) {
  const all = [...(st.players || []), ...(st.freeAgents || [])];
  for (const p of all) {
    if (isUSOrCanadian(p)) { p.hasGreenCard = false; p.domestic = true; continue; }
    if (p.hasGreenCard === undefined) { p.hasGreenCard = Math.random() < 0.45; continue; }
    if (!p.hasGreenCard && Math.random() < 0.10) p.hasGreenCard = true;
  }
}

function getPlayerTag(p) {
  if (p.designation) return p.designation;
  if (p.homegrown)   return "HG";
  if (isUSOrCanadian(p)) return "DOM";
  if (p.hasGreenCard)    return "GC";
  return "INTL";
}


function positionSortValue(pos) {
  const order = { GK: 1, LB: 2, CB: 3, RB: 4, CDM: 5, CM: 6, CAM: 7, LW: 8, RW: 9, ST: 10 };
  return order[pos] || 99;
}

// ── Sim speed / pause ────────────────────────────────────────────────────────

function setSimSpeed(key) {
  if (!SIM_SPEEDS[key]) return;
  simSpeedKey = key; simSpeed = SIM_SPEEDS[key];
  document.querySelectorAll(".sim-speed-opt").forEach(b =>
    b.classList.toggle("active", b.dataset.speed === key));
}

function toggleSimPause() {
  simPaused = !simPaused;
  const btn = document.getElementById("sim-pause-btn");
  if (btn) btn.textContent = simPaused ? "▶ Resume" : "⏸ Pause";
}

// ── Overlay button wiring (runs once) ────────────────────────────────────────

function bindOverlayButtons() {
  if (overlayButtonsBound) return;
  overlayButtonsBound = true;

  document.querySelectorAll(".sim-speed-opt").forEach(b =>
    b.addEventListener("click", () => setSimSpeed(b.dataset.speed)));

  document.getElementById("sim-pause-btn")
    ?.addEventListener("click", toggleSimPause);

  document.getElementById("sim-skip-btn")
    ?.addEventListener("click", () => { simSkipped = true; simPaused = false; });

  document.querySelectorAll(".msim-tab-btn").forEach(btn => btn.addEventListener("click", () => {
    simView = btn.dataset.view || "fitness";
    document.querySelectorAll(".msim-tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    if (livePitchScene) renderLiveStatBars(livePitchScene.lastStats || {}, livePitchScene.lastMatch || null, livePitchScene.lastMinute || 1);
  }));

  document.querySelectorAll(".msim-side-tab").forEach(btn => btn.addEventListener("click", () => {
    const parent = btn.closest('.msim-side-switcher');
    parent?.querySelectorAll('.msim-side-tab').forEach(b => b.classList.toggle('active', b === btn));
    if (btn.dataset.sideView === 'events' || btn.dataset.sideView === 'home') simLeftView = btn.dataset.sideView;
    else simRightView = btn.dataset.sideView;
    if (livePitchScene?.lastMatch) renderMiniLineups(livePitchScene.lastMatch, livePitchScene.lastMinute || 1);
  }));

  const overlay = document.getElementById("match-sim-overlay");
  if (overlay && !document.getElementById("sim-close-btn")) {
    const cb = document.createElement("button");
    cb.id = "sim-close-btn";
    cb.className = "sim-close-btn";
    cb.textContent = "✕ Exit";
    cb.addEventListener("click", () => {
      simAbortRequested = true;
      simPaused = false;
      simInProgress = false;
      overlay.classList.remove("open");
      document.getElementById("goal-replay-overlay")?.classList.remove("open");
      document.getElementById("var-overlay")?.classList.remove("open");
    });
    const box = document.getElementById("match-sim-box") || overlay;
    box.style.position = "relative";
    box.appendChild(cb);
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      simAbortRequested = true;
      simPaused = false;
      simInProgress = false;
      document.getElementById("match-sim-overlay")?.classList.remove("open");
      document.getElementById("goal-replay-overlay")?.classList.remove("open");
      document.getElementById("var-overlay")?.classList.remove("open");
    }
  });
}

// ── Live sim helpers ─────────────────────────────────────────────────────────

function addSimEvent(minute, html, style = "") {
  const wrap = document.getElementById("sim-events");
  if (!wrap) return;
  const row = document.createElement("div");
  row.className = "ev";
  row.style.cssText = `padding:6px 0;border-bottom:1px solid var(--line);${style}`;
  row.innerHTML = `<span style="display:inline-block;width:34px;font-family:var(--mono);color:var(--accent);">${minute}'</span> ${html}`;
  wrap.prepend(row);
}

function defaultLiveFormation(teamId) {
  const pool = ["4-3-3", "4-2-3-1", "4-4-2", "4-1-4-1", "3-5-2"];
  const n = String(teamId || "").split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return pool[n % pool.length];
}

function getLiveFormation(teamId) {
  return teamId === state?.userTeamId ? (tactics?.formation || "4-3-3") : defaultLiveFormation(teamId);
}

function getLineupForFormation(teamId, formation, benchCount = 7) {
  const players = [...getTeamPlayers(state, teamId)].sort((a, b) => (b.overall - a.overall) || (b.potential - a.potential));
  const positions = FORMATIONS[formation] || FORMATIONS["4-3-3"];
  const used = new Set();
  const xi = positions.map(pos => {
    let player = players.find(p => !used.has(p.id) && p.position === pos);
    if (!player) {
      const fallbackMap = {
        LB: ["LM", "CB", "RB"], RB: ["RM", "CB", "LB"],
        LM: ["LW", "CM", "LB"], RM: ["RW", "CM", "RB"],
        CDM: ["CM", "CB"], CM: ["CDM", "CAM", "LM", "RM"], CAM: ["CM", "ST", "LW", "RW"],
        LW: ["LM", "RW", "ST"], RW: ["RM", "LW", "ST"], ST: ["CAM", "LW", "RW"], CB: ["CDM", "LB", "RB"], GK: []
      };
      const fallbacks = fallbackMap[pos] || [];
      player = players.find(p => !used.has(p.id) && fallbacks.includes(p.position));
    }
    if (!player) player = players.find(p => !used.has(p.id));
    if (player) used.add(player.id);
    return { position: pos, player };
  });
  const bench = players.filter(p => !used.has(p.id)).slice(0, benchCount);
  return { xi, bench };
}

function getLivePlayerEnergy(player, minute) {
  const stamina = player?.detailed?.physical?.stamina ?? player?.attributes?.physical ?? 62;
  const baseDrop = minute * (0.36 + Math.max(0, 72 - stamina) / 240);
  return Math.max(36, Math.min(100, Math.round(100 - baseDrop + Math.sin((minute + (player?.overall || 60)) * 0.12) * 5)));
}

function getLivePlayerRating(player, minute) {
  const base = livePitchScene?.playerRatings?.[player?.id] ?? (6.0 + Math.max(0, (player?.overall || 58) - 58) * 0.035);
  const energyAdj = ((getLivePlayerEnergy(player, minute) || 75) - 74) / 115;
  return Math.max(5.4, Math.min(9.8, base + energyAdj));
}

function bumpLiveRating(playerId, amount) {
  if (!livePitchScene?.playerRatings || !playerId) return;
  livePitchScene.playerRatings[playerId] = Math.max(5.2, Math.min(9.8, (livePitchScene.playerRatings[playerId] || 6.2) + amount));
}

function renderLineupRows(entries, minute = 1) {
  return entries.map(({ position, player }) => {
    if (!player) return `<div class="msim-lineup-row"><div class="msim-lineup-pos">${escapeHtml(position || "—")}</div><div class="msim-lineup-name">Open Slot</div><div class="msim-lineup-meta">—</div></div>`;
    const energy = getLivePlayerEnergy(player, minute);
    const rating = getLivePlayerRating(player, minute).toFixed(1);
    return `<div class="msim-lineup-row"><div class="msim-lineup-pos">${escapeHtml(position || player.position || "—")}</div><div class="msim-lineup-name">${escapeHtml(player.position)} · ${escapeHtml(player.name)}</div><div class="msim-lineup-meta">${rating}</div><div class="msim-energy"><div class="msim-energy-fill" style="width:${energy}%"></div></div></div>`;
  }).join("");
}

function renderBenchRows(players, minute = 1) {
  return players.map(player => {
    const energy = getLivePlayerEnergy(player, minute);
    const rating = getLivePlayerRating(player, minute).toFixed(1);
    return `<div class="msim-bench-row"><div class="msim-lineup-pos">${escapeHtml(player.position)}</div><div class="msim-lineup-name">${escapeHtml(player.position)} · ${escapeHtml(player.name)}</div><div class="msim-lineup-meta">${rating}</div><div class="msim-energy"><div class="msim-energy-fill" style="width:${energy}%"></div></div></div>`;
  }).join("") || `<div class="note">No bench players listed.</div>`;
}

function renderMiniLineups(match, minute = 1) {
  const ht = byTeamId(match.homeTeamId);
  const at = byTeamId(match.awayTeamId);
  const homePack = livePitchScene?.homePack || getLineupForFormation(ht.id, getLiveFormation(ht.id));
  const awayPack = livePitchScene?.awayPack || getLineupForFormation(at.id, getLiveFormation(at.id));
  const hTitle = document.getElementById("msim-home-lineup-title");
  const aTitle = document.getElementById("msim-away-lineup-title");
  const hList  = document.getElementById("msim-home-lineup");
  const aList  = document.getElementById("msim-away-lineup");
  const eventsWrap = document.getElementById("sim-events-wrap");
  if (hTitle) hTitle.textContent = `${ht.shortName || ht.name} XI`;
  if (aTitle) aTitle.textContent = simRightView === "bench" ? `${at.shortName || at.name} Bench` : `${at.shortName || at.name} XI`;
  if (eventsWrap) eventsWrap.classList.toggle("hidden", simLeftView !== "events");
  if (hList) hList.innerHTML = simLeftView === "events" ? "" : renderLineupRows(homePack.xi, minute);
  if (aList) aList.innerHTML = simRightView === "bench" ? renderBenchRows(awayPack.bench, minute) : renderLineupRows(awayPack.xi, minute);
}

function buildStatCard(label, left, right, leftPct = 50) {
  const pct = Math.max(0, Math.min(100, Number(leftPct) || 50));
  return `<div class="msim-stat-card"><div class="lbl">${escapeHtml(label)}</div><div class="vals"><strong>${escapeHtml(String(left))}</strong><span>vs</span><strong>${escapeHtml(String(right))}</strong></div><div class="msim-compare-bar"><span style="width:${pct}%"></span><span style="width:${100 - pct}%"></span></div></div>`;
}

function renderLiveStatBars(stats, match = null, minute = 1) {
  const el = document.getElementById("msim-live-stats");
  if (!el) return;
  const hp = livePitchScene?.homePack;
  const ap = livePitchScene?.awayPack;
  const avg = arr => arr.length ? (arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
  const homeEnergy = hp ? Math.round(avg(hp.xi.map(({ player }) => getLivePlayerEnergy(player, minute)))) : 78;
  const awayEnergy = ap ? Math.round(avg(ap.xi.map(({ player }) => getLivePlayerEnergy(player, minute)))) : 78;
  const homeAvg = hp ? avg(hp.xi.map(({ player }) => player?.overall || 0)).toFixed(1) : "0.0";
  const awayAvg = ap ? avg(ap.xi.map(({ player }) => player?.overall || 0)).toFixed(1) : "0.0";
  const homePress = state?.userTeamId === match?.homeTeamId ? (tactics?.pressingIntensity || "Medium") : "Balanced";
  const awayPress = state?.userTeamId === match?.awayTeamId ? (tactics?.pressingIntensity || "Medium") : "Balanced";
  const poss = stats.homePoss || 50;
  const xgTotal = (stats.homeXg || 0) + (stats.awayXg || 0) || 1;
  if (simView === "ratings") {
    const homeTop = hp?.xi.slice().sort((a, b) => getLivePlayerRating(b.player, minute) - getLivePlayerRating(a.player, minute)).slice(0, 3).map(({ player }) => `${player?.name?.split(" ").pop() || "—"} ${getLivePlayerRating(player, minute).toFixed(1)}`).join(" · ") || "—";
    const awayTop = ap?.xi.slice().sort((a, b) => getLivePlayerRating(b.player, minute) - getLivePlayerRating(a.player, minute)).slice(0, 3).map(({ player }) => `${player?.name?.split(" ").pop() || "—"} ${getLivePlayerRating(player, minute).toFixed(1)}`).join(" · ") || "—";
    const homeAvgRating = hp ? avg(hp.xi.map(({ player }) => getLivePlayerRating(player, minute))).toFixed(1) : "0.0";
    const awayAvgRating = ap ? avg(ap.xi.map(({ player }) => getLivePlayerRating(player, minute))).toFixed(1) : "0.0";
    el.innerHTML = [
      buildStatCard("Live Rating", homeAvgRating, awayAvgRating, (Number(homeAvgRating) / (Number(homeAvgRating) + Number(awayAvgRating) || 1)) * 100),
      buildStatCard("Top 3", homeTop, awayTop, 50),
      buildStatCard("Chance Creation", `${stats.homeSot || 0} SOT`, `${stats.awaySot || 0} SOT`, ((stats.homeSot || 0) / (((stats.homeSot || 0) + (stats.awaySot || 0)) || 1)) * 100),
    ].join("");
  } else if (simView === "gameplan") {
    el.innerHTML = [
      buildStatCard("Formation", getLiveFormation(match?.homeTeamId), getLiveFormation(match?.awayTeamId), 50),
      buildStatCard("Pressing", homePress, awayPress, 50),
      buildStatCard("Attack Flow", document.getElementById("msim-attack-chip")?.textContent || "Build-up play", document.getElementById("msim-possession-chip")?.textContent || "Balanced", 50),
    ].join("");
  } else if (simView === "stats") {
    el.innerHTML = [
      buildStatCard("Possession", `${stats.homePoss || 50}%`, `${stats.awayPoss || 50}%`, poss),
      buildStatCard("Shots", stats.homeShots || 0, stats.awayShots || 0, ((stats.homeShots || 0) / (((stats.homeShots || 0) + (stats.awayShots || 0)) || 1)) * 100),
      buildStatCard("xG", (stats.homeXg || 0).toFixed(2), (stats.awayXg || 0).toFixed(2), ((stats.homeXg || 0) / xgTotal) * 100),
      buildStatCard("Cards", `${stats.homeYellows || 0}Y ${stats.homeReds || 0}R`, `${stats.awayYellows || 0}Y ${stats.awayReds || 0}R`, 50),
      buildStatCard("Pass Momentum", document.getElementById("msim-possession-chip")?.textContent || "Balanced", document.getElementById("msim-attack-chip")?.textContent || "Build-up play", 50),
      buildStatCard("Minute", `${minute}'`, `${minute}'`, 50),
    ].join("");
  } else {
    el.innerHTML = [
      buildStatCard("Fitness", `${homeEnergy}%`, `${awayEnergy}%`, homeEnergy),
      buildStatCard("Possession", `${stats.homePoss || 50}%`, `${stats.awayPoss || 50}%`, poss),
      buildStatCard("Shots", stats.homeShots || 0, stats.awayShots || 0, ((stats.homeShots || 0) / (((stats.homeShots || 0) + (stats.awayShots || 0)) || 1)) * 100),
    ].join("");
  }
}

function buildLivePitchScene(match) {
  const ht = byTeamId(match.homeTeamId);
  const at = byTeamId(match.awayTeamId);
  const homeFormation = getLiveFormation(ht.id);
  const awayFormation = getLiveFormation(at.id);
  const homePack = getLineupForFormation(ht.id, homeFormation);
  const awayPack = getLineupForFormation(at.id, awayFormation);
  const baselineRatings = {};
  [...homePack.xi, ...awayPack.xi, ...homePack.bench, ...awayPack.bench].forEach(entry => {
    const p = entry.player || entry;
    if (p?.id) baselineRatings[p.id] = Number((6.0 + Math.max(0, p.overall - 58) * 0.035 + Math.random() * 0.35).toFixed(2));
  });
  return {
    matchId: match.id,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeFormation,
    awayFormation,
    homePack,
    awayPack,
    phase: 0,
    momentum: "balanced",
    ballOwner: "home",
    lastEventText: "Build-up play",
    ballSequence: [5, 6, 8, 10],
    playerRatings: baselineRatings,
  };
}

function drawHumanoid(ctx, x, y, palette, facing = 1, withBall = false, number = "") {
  const { primary, secondary, text } = palette || { primary: "#59a8ff", secondary: "#0b1f41", text: "#ffffff" };
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.beginPath();
  ctx.ellipse(0, 22, 11, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#f2d3bc";
  ctx.beginPath();
  ctx.arc(0, -13, 7.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.roundRect(-8.5, -6, 17, 22, 4);
  ctx.fill();
  ctx.fillStyle = secondary;
  ctx.fillRect(-8.5, -6, 3, 22);
  ctx.fillRect(5.5, -6, 3, 22);
  ctx.fillRect(-8.5, 8, 17, 3.2);
  ctx.strokeStyle = "rgba(10,14,25,.75)";
  ctx.lineWidth = 2.3;
  const armSwing = Math.sin((livePitchScene?.phase || 0) * 3 + x * 0.01) * 5.5;
  const legSwing = Math.sin((livePitchScene?.phase || 0) * 4 + y * 0.01) * 7;
  ctx.beginPath();
  ctx.moveTo(-7, -1); ctx.lineTo(-14 * facing, 5 + armSwing * 0.25);
  ctx.moveTo(7, -1); ctx.lineTo(14 * facing, 5 - armSwing * 0.25);
  ctx.moveTo(-4, 16); ctx.lineTo(-7 * facing, 28 + legSwing * 0.25);
  ctx.moveTo(4, 16); ctx.lineTo(7 * facing, 28 - legSwing * 0.25);
  ctx.stroke();
  ctx.fillStyle = text || "#ffffff";
  ctx.font = "800 8px sans-serif";
  ctx.textAlign = "center";
  if (number) ctx.fillText(number, 0, 4);
  if (withBall) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(12 * facing, 19, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLivePitch(scene, minute, event = null) {
  const canvas = document.getElementById("msim-pitch-canvas");
  if (!canvas || !scene) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const fieldX = 70, fieldY = 60, fieldW = w - 140, fieldH = h - 120;
  const stripeW = fieldW / 12;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#102c35" : "#0b2330";
    ctx.fillRect(fieldX + i * stripeW, fieldY, stripeW, fieldH);
  }
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 2;
  ctx.strokeRect(fieldX, fieldY, fieldW, fieldH);
  ctx.beginPath();
  ctx.moveTo(fieldX + fieldW / 2, fieldY); ctx.lineTo(fieldX + fieldW / 2, fieldY + fieldH); ctx.stroke();
  ctx.beginPath();
  ctx.arc(fieldX + fieldW / 2, fieldY + fieldH / 2, 64, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.arc(fieldX + fieldW / 2, fieldY + fieldH / 2, 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fill();
  const boxW = 172, boxH = 220;
  ctx.strokeRect(fieldX, fieldY + fieldH / 2 - boxH / 2, boxW, boxH);
  ctx.strokeRect(fieldX + fieldW - boxW, fieldY + fieldH / 2 - boxH / 2, boxW, boxH);
  ctx.strokeRect(fieldX, fieldY + fieldH / 2 - 110 / 2, 62, 110);
  ctx.strokeRect(fieldX + fieldW - 62, fieldY + fieldH / 2 - 110 / 2, 62, 110);
  ctx.beginPath(); ctx.arc(fieldX + 108, fieldY + fieldH / 2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(fieldX + fieldW - 108, fieldY + fieldH / 2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(fieldX + 108, fieldY + fieldH / 2, 60, -0.92, 0.92); ctx.stroke();
  ctx.beginPath(); ctx.arc(fieldX + fieldW - 108, fieldY + fieldH / 2, 60, Math.PI - 0.92, Math.PI + 0.92); ctx.stroke();

  const homePalette = teamColors(scene.homeTeamId);
  const awayPalette = teamColors(scene.awayTeamId);

  const homeLayout = FORMATION_LAYOUT[scene.homeFormation] || FORMATION_LAYOUT["4-3-3"];
  const awayLayout = FORMATION_LAYOUT[scene.awayFormation] || FORMATION_LAYOUT["4-3-3"];
  const phase = scene.phase;
  const homeAttackBias = scene.momentum === "homeAttack" ? 0.11 : scene.momentum === "awayAttack" ? -0.04 : 0.03;
  const awayAttackBias = scene.momentum === "awayAttack" ? 0.11 : scene.momentum === "homeAttack" ? -0.04 : 0.03;

  const mapHome = (slot, idx) => {
    const baseX = fieldX + (1 - slot.y) * fieldW;
    const baseY = fieldY + slot.x * fieldH;
    const wave = Math.sin(phase * 2.2 + idx) * 9;
    const drift = Math.cos(phase * 1.7 + idx * 0.7) * 7;
    const press = homeAttackBias * fieldW;
    return { x: baseX + press + wave, y: baseY + drift };
  };
  const mapAway = (slot, idx) => {
    const baseX = fieldX + slot.y * fieldW;
    const baseY = fieldY + (1 - slot.x) * fieldH;
    const wave = Math.sin(phase * 2.1 + idx) * 9;
    const drift = Math.cos(phase * 1.8 + idx * 0.55) * 7;
    const press = awayAttackBias * fieldW;
    return { x: baseX - press + wave, y: baseY + drift };
  };

  const homeActors = scene.homePack.xi.map((entry, idx) => ({ ...entry, ...mapHome(homeLayout[idx] || { x: .5, y: .5 }, idx) }));
  const awayActors = scene.awayPack.xi.map((entry, idx) => ({ ...entry, ...mapAway(awayLayout[idx] || { x: .5, y: .5 }, idx) }));
  const attackSide = event?.side || (scene.ballOwner === "away" ? "away" : "home");
  const attackingActors = attackSide === "home" ? homeActors : awayActors;
  const seq = (scene.ballSequence || [5, 6, 8, 10]).map(i => Math.max(0, Math.min(attackingActors.length - 1, i)));
  const segCount = Math.max(1, seq.length - 1);
  const phaseLoop = (scene.phase * 0.95) % segCount;
  const segIdx = Math.min(segCount - 1, Math.floor(phaseLoop));
  const segProg = phaseLoop - segIdx;
  const from = attackingActors[seq[segIdx]] || attackingActors[0];
  const to = event?.type === "goal"
    ? { x: attackSide === "home" ? fieldX + fieldW - 36 : fieldX + 36, y: fieldY + fieldH / 2 - 8 }
    : (attackingActors[seq[segIdx + 1]] || attackingActors[attackingActors.length - 1] || from);
  const ballX = from.x + (to.x - from.x) * segProg;
  const ballY = from.y + (to.y - from.y) * segProg - Math.sin(segProg * Math.PI) * (event?.type === "goal" ? 26 : 12);
  const activeIdx = seq[Math.min(seq.length - 1, Math.round(phaseLoop))];
  const ballTrail = [];
  for (let i = 0; i < 10; i++) ballTrail.push({ x: ballX - (attackSide === "home" ? i * 9 : -i * 9), y: ballY + Math.sin(phase * 4 + i * 0.3) * 2, a: 0.16 - i * 0.014 });
  ctx.strokeStyle = attackSide === "home" ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.12)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  for (const pt of ballTrail.reverse()) {
    ctx.fillStyle = `rgba(255,255,255,${Math.max(pt.a, 0)})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  homeActors.forEach((actor, idx) => drawHumanoid(ctx, actor.x, actor.y, homePalette, 1, attackSide === "home" && idx === activeIdx, String(actor.player?.jerseyNumber || idx + 1)));
  awayActors.forEach((actor, idx) => drawHumanoid(ctx, actor.x, actor.y, awayPalette, -1, attackSide === "away" && idx === activeIdx, String(actor.player?.jerseyNumber || idx + 1)));

  ctx.fillStyle = "rgba(255,255,255,.98)";
  ctx.beginPath();
  ctx.arc(ballX, ballY, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(17,24,39,.9)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const possessionText = scene.ballOwner === "home" ? `${byTeamId(scene.homeTeamId)?.shortName || 'Home'} in possession` : `${byTeamId(scene.awayTeamId)?.shortName || 'Away'} in possession`;
  const attackText = event?.type === "goal" ? `${event.scorer || 'Attacker'} breaks through` : scene.lastEventText || "Build-up play";
  const possChip = document.getElementById("msim-possession-chip");
  const attackChip = document.getElementById("msim-attack-chip");
  if (possChip) possChip.textContent = possessionText;
  if (attackChip) attackChip.textContent = attackText;
}

async function animateLiveSegment(scene, minute, stats, match, event = null) {
  const frames = simSpeedKey === "turbo" ? 2 : simSpeedKey === "fast" ? 4 : simSpeedKey === "normal" ? 8 : 11;
  const wait = Math.max(16, Math.round(simSpeed / Math.max(1, frames)));
  const biasRoll = Math.random();
  scene.ballOwner = event?.side || (biasRoll < ((stats.homePoss || 50) / 100) ? "home" : "away");
  scene.momentum = event?.type === "goal" ? `${scene.ballOwner}Attack` : (scene.ballOwner === "home" ? (biasRoll > 0.72 ? "awayAttack" : "homeAttack") : (biasRoll > 0.72 ? "homeAttack" : "awayAttack"));
  scene.lastEventText = event?.type === "goal" ? `Final third attack` : ["Patient circulation", "Progressive carry", "Wing combination", "Half-space overload", "Counter-press sequence", "Direct ball in behind"][Math.floor(Math.random() * 6)];
  scene.ballSequence = scene.ballOwner === 'home' ? [5, 6, 8, 10] : [5, 6, 8, 10];
  for (let i = 0; i < frames; i++) {
    if (simAbortRequested || simSkipped) break;
    while (simPaused && !simAbortRequested) await sleep(100);
    scene.phase += 0.12 + i * 0.005;
    drawLivePitch(scene, minute, event);
    renderMiniLineups(match, minute);
    renderLiveStatBars(stats, match, minute);
    await sleep(wait);
  }
}


async function showGoalReplay(scorerName, assistName, minute, side = "home") {
  const overlay = document.getElementById("goal-replay-overlay");
  const canvas = document.getElementById("goal-replay-canvas");
  if (!overlay || !canvas) {
    await sleep(Math.min(simSpeed * 1.2, 700));
    return;
  }
  document.getElementById("goal-replay-title").textContent = "Broadcast Replay";
  document.getElementById("goal-replay-scorer").textContent = scorerName;
  document.getElementById("goal-replay-minute").textContent = `${minute}'`;
  document.getElementById("goal-replay-assist").textContent = assistName || "Unassisted";
  document.getElementById("goal-replay-badge").textContent = "Goal Check";
  overlay.classList.add("open");

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const attackColor = side === "home" ? "#59a8ff" : "#ff9d59";
  const defendColor = side === "home" ? "#ff9d59" : "#59a8ff";
  const keeperColor = "#f8fafc";

  const drawPlayer = (x, y, color, scale = 1, facing = 1, withBall = false) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -13, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-5, -6, 10, 20);
    ctx.strokeStyle = "rgba(10,14,28,.45)";
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.moveTo(-5, -2); ctx.lineTo(-10 * facing, 6);
    ctx.moveTo(5, -2); ctx.lineTo(10 * facing, 5);
    ctx.moveTo(-3, 14); ctx.lineTo(-6 * facing, 24);
    ctx.moveTo(3, 14); ctx.lineTo(7 * facing, 24);
    ctx.stroke();
    if (withBall) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(13 * facing, 16, 4.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawPitch = (camX = 0, camY = 0, zoom = 1) => {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2 + camX, -h / 2 + camY);

    const grass = ctx.createLinearGradient(0, 0, 0, h);
    grass.addColorStop(0, "#0a6b34");
    grass.addColorStop(1, "#064722");
    ctx.fillStyle = grass;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.04)";
      ctx.fillRect(24, 24 + ((h - 48) / 10) * i, w - 48, (h - 48) / 10);
    }

    ctx.strokeStyle = "rgba(255,255,255,.88)";
    ctx.lineWidth = 2.8;
    ctx.strokeRect(24, 24, w - 48, h - 48);
    ctx.beginPath(); ctx.moveTo(w / 2, 24); ctx.lineTo(w / 2, h - 24); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 56, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(w * 0.70, h * 0.17, w * 0.17, h * 0.40);
    ctx.strokeRect(w * 0.79, h * 0.30, w * 0.08, h * 0.14);
    ctx.beginPath(); ctx.arc(w * 0.76, h / 2, 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,.82)"; ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,.10)";
    ctx.fillRect(0, 0, w, 70);
    ctx.fillRect(0, h - 60, w, 60);
    ctx.restore();
  };

  const lowerThird = (phaseText) => {
    ctx.save();
    const boxY = h - 58;
    ctx.fillStyle = "rgba(10,14,24,.86)";
    ctx.fillRect(24, boxY, w * 0.54, 34);
    ctx.fillStyle = "#59a8ff";
    ctx.fillRect(24, boxY, 110, 34);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 12px sans-serif";
    ctx.fillText("MLS LIVE", 42, boxY + 21);
    ctx.font = "700 18px sans-serif";
    ctx.fillText(scorerName, 148, boxY + 22);
    ctx.font = "600 12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.fillText(assistName ? `Assist: ${assistName} · ${phaseText}` : phaseText, 148, boxY + 36);
    ctx.restore();
  };

  const drawNet = (ripple = 0) => {
    ctx.save();
    const gx = w * 0.87;
    const gy = h * 0.30;
    const gw = 52;
    const gh = 95;
    ctx.strokeStyle = "rgba(255,255,255,.86)";
    ctx.lineWidth = 2;
    ctx.strokeRect(gx, gy, gw, gh);
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    for (let i = 1; i < 6; i++) {
      const x = gx + (gw / 6) * i + Math.sin(ripple + i) * 1.6;
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh); ctx.stroke();
    }
    for (let i = 1; i < 5; i++) {
      const y = gy + (gh / 5) * i + Math.cos(ripple * 1.3 + i) * 1.2;
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
    }
    ctx.restore();
  };

  const frames = 96;
  for (let i = 0; i <= frames; i++) {
    if (simAbortRequested) break;
    const t = i / frames;
    const phase1 = Math.min(1, t / 0.38);
    const phase2 = t < 0.38 ? 0 : Math.min(1, (t - 0.38) / 0.34);
    const phase3 = t < 0.72 ? 0 : Math.min(1, (t - 0.72) / 0.28);

    ctx.clearRect(0, 0, w, h);
    const camX = Math.sin(t * Math.PI) * 16;
    const camY = Math.sin(t * Math.PI * 0.9) * -10;
    const zoom = 1 + Math.sin(Math.min(1, t) * Math.PI) * 0.07;
    drawPitch(camX, camY, zoom);

    const passerX = w * 0.18 + phase1 * 38;
    const passerY = h * 0.76 - phase1 * 12;
    const runnerX = w * 0.46 + phase1 * 60 + phase2 * 54;
    const runnerY = h * 0.58 - phase1 * 34 - phase2 * 56;
    const shooterX = w * 0.69 + phase2 * 18;
    const shooterY = h * 0.43 - phase2 * 10;
    const keeperX = w * 0.87 - phase3 * 20;
    const keeperY = h * 0.46 + Math.sin(phase3 * Math.PI) * 18;

    const defenders = [
      [w * 0.54 - phase2 * 20, h * 0.57 - phase2 * 8, 1, -1],
      [w * 0.62 - phase2 * 14, h * 0.46 + phase2 * 4, 0.96, -1],
      [w * 0.76 - phase2 * 6, h * 0.38 + phase2 * 3, 0.94, -1],
      [w * 0.81 - phase3 * 7, h * 0.50 + phase3 * 6, 0.98, -1],
    ];

    drawPlayer(passerX, passerY, attackColor, 1.03, 1, t < 0.18);
    drawPlayer(runnerX, runnerY, attackColor, 0.98, 1, t >= 0.18 && t < 0.62);
    drawPlayer(shooterX, shooterY, attackColor, 1.04, 1, t >= 0.62 && t < 0.76);
    defenders.forEach(d => drawPlayer(d[0], d[1], defendColor, d[2], d[3], false));
    drawPlayer(keeperX, keeperY, keeperColor, 1.08, -1, false);
    drawNet(phase3 * 14);

    let ballX = passerX + 12;
    let ballY = passerY + 16;
    if (t >= 0.18 && t < 0.62) {
      const pt = (t - 0.18) / 0.44;
      const cx = w * 0.36;
      const cy = h * 0.57;
      ballX = (1 - pt) * (1 - pt) * (passerX + 12) + 2 * (1 - pt) * pt * cx + pt * pt * (runnerX + 10);
      ballY = (1 - pt) * (1 - pt) * (passerY + 14) + 2 * (1 - pt) * pt * cy + pt * pt * (runnerY + 8);
    } else if (t >= 0.62) {
      const st = Math.min(1, (t - 0.62) / 0.38);
      const cx = w * 0.80;
      const cy = h * 0.18 + Math.sin(st * Math.PI) * -12;
      ballX = (1 - st) * (1 - st) * (shooterX + 12) + 2 * (1 - st) * st * cx + st * st * (w * 0.90);
      ballY = (1 - st) * (1 - st) * (shooterY + 6) + 2 * (1 - st) * st * cy + st * st * (h * 0.41);
      ctx.strokeStyle = "rgba(255,255,255,.18)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(shooterX + 10, shooterY + 4);
      ctx.quadraticCurveTo(cx, cy, ballX, ballY);
      ctx.stroke();
    }

    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(ballX, ballY, 6.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 1.2; ctx.stroke();

    ctx.save();
    ctx.fillStyle = "rgba(8,12,20,.60)";
    ctx.fillRect(24, 24, 250, 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 24px sans-serif";
    ctx.fillText("REPLAY", 38, 51);
    ctx.font = "600 13px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.fillText(`${minute}' · Final action`, 148, 51);
    ctx.restore();

    lowerThird(t < 0.62 ? "Build-up" : phase3 < 0.55 ? "Finish" : "Net cam");
    await sleep(Math.min(simSpeed * 0.38, 40));
  }

  await sleep(Math.min(simSpeed * 0.9, 420));
  overlay.classList.remove("open");
}


async function showVARReview(minute, scorerName = "") {
  const overlay = document.getElementById("var-overlay");
  const screen = document.getElementById("var-screen");
  const badge = document.getElementById("var-decision-badge");
  const desc = document.getElementById("var-desc");
  const scan = document.getElementById("var-scanning-text");
  const confirmed = Math.random() > 0.46;

  addSimEvent(minute, `📺 <b>VAR CHECK</b> — Reviewing the attacking phase.`, "color:var(--yellow);font-weight:700;");
  if (!overlay || !screen) {
    await sleep(900);
    addSimEvent(minute, confirmed ? "✅ Goal confirmed by VAR." : "❌ Goal disallowed after VAR review.", `color:${confirmed ? "var(--green)" : "var(--red)"};font-weight:700;`);
    return confirmed;
  }

  screen.innerHTML = `<canvas id="var-canvas" width="740" height="360"></canvas>`;
  const canvas = document.getElementById("var-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const drawScene = (progress, stage = 0) => {
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#0a1428");
    bg.addColorStop(1, "#162e4a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#0b6d35";
    ctx.fillRect(72, 40, w - 144, h - 80);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,.045)" : "rgba(0,0,0,.035)";
      ctx.fillRect(72, 40 + ((h - 80) / 8) * i, w - 144, (h - 80) / 8);
    }
    ctx.strokeStyle = "rgba(255,255,255,.82)";
    ctx.lineWidth = 2;
    ctx.strokeRect(72, 40, w - 144, h - 80);
    ctx.beginPath(); ctx.moveTo(w / 2, 40); ctx.lineTo(w / 2, h - 40); ctx.stroke();

    const defLineX = w * 0.58 + Math.sin(progress * Math.PI * 2) * 1.5;
    const attX = w * 0.60 + progress * 16;
    const attY = h * 0.48 - progress * 6;
    const defX = w * 0.54;
    const defY = h * 0.53;

    const drawPlayer = (x, y, color, active = false) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y - 10, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 7, y - 4, 14, 22);
      ctx.fillRect(x - 12, y + 18, 6, 16);
      ctx.fillRect(x + 6, y + 18, 6, 16);
      if (active) {
        ctx.strokeStyle = "rgba(255,255,255,.82)";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 14, y - 22, 28, 58);
      }
    };

    drawPlayer(attX, attY, "#59a8ff", true);
    drawPlayer(defX, defY, "#ff9d59", true);
    drawPlayer(w * 0.72 - progress * 10, h * 0.42 + progress * 3, "#ff9d59");

    ctx.strokeStyle = stage >= 1 ? "rgba(255,84,84,.96)" : "rgba(255,255,255,.22)";
    ctx.lineWidth = stage >= 1 ? 3.4 : 2;
    ctx.beginPath();
    ctx.moveTo(defLineX, 48);
    ctx.lineTo(defLineX, h - 48);
    ctx.stroke();

    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = stage >= 2 ? (confirmed ? "rgba(34,197,94,.95)" : "rgba(255,84,84,.95)") : "rgba(255,255,255,.86)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(attX, attY - 13);
    ctx.lineTo(defLineX, attY - 13);
    ctx.stroke();
    ctx.setLineDash([]);

    const scanY = 48 + ((h - 96) * progress);
    const grad2 = ctx.createLinearGradient(0, scanY - 24, 0, scanY + 24);
    grad2.addColorStop(0, "rgba(77,163,255,0)");
    grad2.addColorStop(0.5, "rgba(77,163,255,.34)");
    grad2.addColorStop(1, "rgba(77,163,255,0)");
    ctx.fillStyle = grad2;
    ctx.fillRect(76, scanY - 24, w - 152, 48);

    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.font = "800 20px sans-serif";
    ctx.fillText("MULTI-ANGLE REVIEW", 24, 31);
    ctx.font = "600 14px sans-serif";
    ctx.fillText(scorerName ? `${scorerName} phase under review` : "Checking attacking phase", 24, 55);

    if (stage >= 2) {
      ctx.fillStyle = confirmed ? "rgba(34,197,94,.18)" : "rgba(255,84,84,.18)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = confirmed ? "#7df0a5" : "#ff8f8f";
      ctx.font = "900 40px sans-serif";
      ctx.fillText(confirmed ? "ONSIDE" : "OFFSIDE", w - 214, 54);
    }
  };

  overlay.classList.add("open");
  badge.textContent = "Checking";
  desc.textContent = "Possible offside in the attacking phase";
  for (let i = 0; i <= 28; i++) {
    if (simAbortRequested) break;
    const stage = i < 10 ? 0 : i < 20 ? 1 : 2;
    drawScene(i / 28, stage);
    scan.textContent = ["Selecting angle", "Calibrating line", "Tracking attacker", "Checking APP", "Final decision incoming"][Math.min(4, Math.floor(i / 6))];
    await sleep(70);
  }
  badge.textContent = confirmed ? "Goal stands" : "No goal";
  desc.textContent = confirmed ? "The attacker is level with the last defender." : "The attacker is beyond the defensive line. Goal overturned.";
  scan.textContent = confirmed ? "Restart: kickoff" : "Restart: indirect free kick";
  await sleep(900);
  overlay.classList.remove("open");
  addSimEvent(minute, confirmed ? "✅ Goal confirmed by VAR." : "❌ Goal disallowed after VAR review.", `color:${confirmed ? "var(--green)" : "var(--red)"};font-weight:700;`);
  return confirmed;
}

// ── Main live match loop ─────────────────────────────────────────────────────

async function playLiveMatch(match) {
  bindOverlayButtons();

  const overlay = document.getElementById("match-sim-overlay");
  if (!overlay) { console.error("match-sim-overlay not found"); return; }
  overlay.classList.add("open");

  simInProgress = true;
  simPaused = false;
  simSkipped = false;
  simAbortRequested = false;
  setSimSpeed("normal");

  const ht = byTeamId(match.homeTeamId);
  const at = byTeamId(match.awayTeamId);

  const el = id => document.getElementById(id);

  if (el("sim-home-name")) el("sim-home-name").innerHTML = renderSimClubChip(ht, "home");
  if (el("sim-away-name")) el("sim-away-name").innerHTML = renderSimClubChip(at, "away");
  if (el("msim-comp-badge")) el("msim-comp-badge").textContent = `MLS ${state.season.year} Live`;
  if (el("sim-minute")) el("sim-minute").textContent = "Kickoff";
  if (el("sim-score")) el("sim-score").textContent = "0 – 0";
  if (el("sim-events")) el("sim-events").innerHTML = "";
  if (el("sim-progress-fill")) el("sim-progress-fill").style.width = "0%";
  if (el("sim-close-btn")) el("sim-close-btn").style.display = "";

  simView = "fitness";
  simLeftView = "home";
  simRightView = "away";
  document.querySelectorAll(".msim-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === simView));
  const sideTabs = document.querySelectorAll(".msim-side-tab");
  sideTabs.forEach(b => {
    const active = [simLeftView, simRightView].includes(b.dataset.sideView);
    b.classList.toggle("active", active);
  });
  livePitchScene = buildLivePitchScene(match);
  livePitchScene.lastMatch = match;
  if (el("sim-score-sub")) el("sim-score-sub").textContent = `${state.season.phase} · Tactical View`;
  renderMiniLineups(match, 1);
  drawLivePitch(livePitchScene, 1);

  const result = match.result || {
    homeGoals:0, awayGoals:0, homeXg:0, awayXg:0,
    homeShots:0, awayShots:0, homeSot:0, awaySot:0,
    homePoss:50, awayPoss:50,
    homeYellows:0, awayYellows:0, homeReds:0, awayReds:0,
    events:[],
  };

  livePitchScene.lastStats = result;
  livePitchScene.lastMinute = 1;
  renderLiveStatBars(result, match, 1);

  let hg = 0, ag = 0, ei = 0;
  const sortedEvents = [...(result.events || [])].sort((a, b) => a.minute - b.minute);

  addSimEvent(0, `<b>Kickoff!</b> ${escapeHtml(ht.name)} vs ${escapeHtml(at.name)}`);

  const commentary = [
    "Patient spell of possession in midfield.",
    "The tempo drops as both teams reset.",
    "Promising buildup down the flank.",
    "A dangerous ball flashes across the box.",
    "The crowd reacts to a half-chance.",
    "A tactical foul halts the counter-attack.",
    "Corner — cleared away at the near post.",
    "Yellow card shown for a late challenge.",
    "The keeper parries it wide for a corner.",
    "Offside flag cuts short the move.",
    "The referee has a word with the captain.",
    "Substitution warming up on the touchline.",
    "Long ball over the top — flagged offside.",
    "Brilliant last-ditch tackle in the box!",
  ];

  for (let minute = 1; minute <= 90; minute++) {
    if (simAbortRequested) break;
    while (simPaused && !simAbortRequested) await sleep(100);
    if (simSkipped || simAbortRequested) break;

    if (el("sim-minute")) el("sim-minute").textContent = `${minute}'`;
    if (el("sim-progress-fill")) el("sim-progress-fill").style.width = `${(minute/90)*100}%`;
    livePitchScene.lastMinute = minute;
    livePitchScene.lastStats = result;
    livePitchScene.lastMatch = match;
    Object.keys(livePitchScene.playerRatings || {}).forEach(pid => {
      livePitchScene.playerRatings[pid] = Math.max(5.3, Math.min(9.7, livePitchScene.playerRatings[pid] + (Math.random() * 0.02 - 0.008)));
    });

    if (Math.random() < 0.18) addSimEvent(minute, commentary[Math.floor(Math.random() * commentary.length)]);
    await animateLiveSegment(livePitchScene, minute, result, match, null);

    while (ei < sortedEvents.length && sortedEvents[ei].minute <= minute) {
      const ev = sortedEvents[ei];
      const scorer = ev.scorerId ? byPlayerId(ev.scorerId) : null;
      const assist = ev.assistId ? byPlayerId(ev.assistId) : null;
      const pName = scorer?.name || "Unknown";
      bumpLiveRating(scorer?.id, 0.95);
      bumpLiveRating(assist?.id, 0.35);
      const concededPack = ev.side === "home" ? livePitchScene?.awayPack : livePitchScene?.homePack;
      (concededPack?.xi || []).forEach(({ player }) => bumpLiveRating(player?.id, player?.position === 'GK' ? -0.22 : -0.08));

      if (ev.side === "home") hg++; else ag++;
      if (el("sim-score")) el("sim-score").textContent = `${hg} – ${ag}`;

      if (Math.random() < 0.10) {
        simPaused = true; await sleep(16);
        const confirmed = await showVARReview(minute, pName);
        simPaused = false;
        if (!confirmed) {
          if (ev.side === "home") hg--; else ag--;
          if (el("sim-score")) el("sim-score").textContent = `${hg} – ${ag}`;
          ei++; continue;
        }
      }

      livePitchScene.lastMinute = minute;
      await animateLiveSegment(livePitchScene, minute, result, match, { type: "goal", side: ev.side, scorer: pName });

      addSimEvent(minute,
        `⚽ <b>GOAL!</b> ${escapeHtml(pName)}${assist ? ` <span style="color:var(--muted)">(assist: ${escapeHtml(assist.name)})</span>` : ""}`,
        "background:rgba(34,197,94,0.08);border-left:3px solid var(--green);padding-left:6px;border-radius:3px;");

      const scoreEl = el("sim-score");
      if (scoreEl) {
        scoreEl.style.transition = "transform .22s,color .22s";
        scoreEl.style.color = "var(--green)";
        scoreEl.style.transform = "scale(1.08)";
        setTimeout(() => { if (scoreEl) { scoreEl.style.color = ""; scoreEl.style.transform = ""; } }, 420);
      }

      if (!simSkipped && !simAbortRequested) {
        simPaused = true; await sleep(16);
        await showGoalReplay(pName, assist?.name || null, minute, ev.side);
        simPaused = false;
      }
      ei++;
    }
    await sleep(simSpeedKey === "turbo" ? 10 : simSpeedKey === "fast" ? 14 : 18);
  }

  simInProgress = false;
  if (simAbortRequested) {
    overlay.classList.remove("open");
    document.getElementById("goal-replay-overlay")?.classList.remove("open");
    document.getElementById("var-overlay")?.classList.remove("open");
    livePitchScene = null;
    return;
  }

  if (el("sim-minute")) el("sim-minute").textContent = "Full Time";
  if (el("sim-progress-fill")) el("sim-progress-fill").style.width = "100%";
  addSimEvent(90,
    `<b>Full Time.</b> ${escapeHtml(ht.name)} ${result.homeGoals}–${result.awayGoals} ${escapeHtml(at.name)}`,
    "color:var(--accent);font-weight:700;");
  await sleep(400);
  livePitchScene = null;
}

// ── Sortable tables ──────────────────────────────────────────────────────────

function toggleSort(tbl, key) {
  const c = tableSortState[tbl];
  if (c.key === key) c.dir = c.dir === "asc" ? "desc" : "asc";
  else { c.key = key; c.dir = key === "name" || key === "position" ? "asc" : "desc"; }
  renderPage();
}
function sortArrow(tbl, key) {
  const c = tableSortState[tbl];
  return c.key !== key ? "" : c.dir === "asc" ? " ▲" : " ▼";
}
function makeSortableTh(label, tbl, key, cls="") {
  return `<th class="${cls}" data-sort-table="${tbl}" data-sort-key="${key}" style="cursor:pointer">${label}${sortArrow(tbl,key)}</th>`;
}
function bindSortableHeaders() {
  $$("[data-sort-table][data-sort-key]").forEach(el =>
    el.addEventListener("click", () => toggleSort(el.dataset.sortTable, el.dataset.sortKey)));
}

// ── Meta bar ─────────────────────────────────────────────────────────────────

function updateMeta() {
  if (!state) return;
  const t = getUserTeam(state);
  $("#metaClub").textContent   = t.name;
  $("#metaSeason").textContent = state.season.year;
  $("#metaPhase").textContent  = state.season.phase;
  $("#metaWeek").textContent   = state.calendar.week;
}

async function persist() {
  if (!state) return;
  await saveSlot(state.saveSlot, state);
}

function pageHead(title, sub) {
  return `<div class="page-head"><div><div class="page-title">${escapeHtml(title)}</div><div class="page-sub">${escapeHtml(sub)}</div></div></div>`;
}

// ── Player profile modal ─────────────────────────────────────────────────────


function openPlayerProfile(playerId) {
  const p = byPlayerId(playerId);
  if (!p) return;
  const team = p.clubId ? byTeamId(p.clubId) : null;
  const s = p.stats || {};
  const country = p.nationality || "Unknown";
  const profile = getPlayerStatProfile(p);
  const categoryOrder = [
    ["Physical", profile.stats.physical],
    ["Passing", profile.stats.passing],
    ["Shooting", profile.stats.shooting],
    ["Skill", profile.stats.skill],
    ["Mentality", profile.stats.mentality],
    ["Defense", profile.stats.defense],
    ["Goalkeeping", profile.stats.goalkeeping],
  ];
  const years = [];
  for (let y = Math.max(2023, (state.season.year || 2026) - 3); y <= (state.season.year || 2026); y++) years.push(y);
  const marketSeriesRaw = years.map((year, idx) => {
    const ageAdj = p.age <= 20 ? 1.05 : p.age <= 24 ? 1.12 : p.age <= 29 ? 1 : p.age <= 32 ? 0.92 : 0.82;
    return Math.max(350000, Math.round((p.contract?.salary || 100000) * (0.7 + idx * 0.12) * ageAdj * (0.84 + ((profile.positionRating || p.overall || 60) - 55) / 78)));
  });
  const marketSeries = marketSeriesRaw.map(v => roundMarketValue(v));
  const highest = Math.max(...marketSeries);
  const statTiles = p.position === "GK"
    ? [["Clean sheets", s.cleanSheets || 0], ["Goals against", s.ga || 0], ["Matches", s.gp || 0], ["Rating", getLivePlayerRating(p, 1).toFixed(2)], ["Minutes", formatNumber(s.min || 0)], ["Saves", s.saves || 0]]
    : [["Goals", s.goals || 0], ["Assists", s.assists || 0], ["Started", s.gs || 0], ["Matches", s.gp || 0], ["Minutes", formatNumber(s.min || 0)], ["Rating", getLivePlayerRating(p, 1).toFixed(2)], ["Yellow cards", s.yellows || 0], ["Red cards", s.reds || 0]];
  const traits = (p.traits || []).slice(0, 5);
  const traitHtml = traits.length ? traits.map(t => `<span class="trait-pill">${escapeHtml(t)}</span>`).join("") : `<span class="trait-pill">Balanced profile</span>`;
  const secondaryPosition = p.position === "LB" ? "LM"
    : p.position === "RB" ? "RM"
    : p.position === "CB" ? "CDM"
    : p.position === "ST" ? "CAM"
    : p.position === "CAM" ? "CM"
    : "Versatile";

  const html = `<div id="playerProfileOverlay" class="pp-overlay">
    <div class="pp-modal pp-player-shell player-profile-clean-shell">
      <button class="pp-close" id="ppClose">×</button>
      <div class="player-hero-card player-hero-card-clean">
        <div class="player-hero-top player-hero-top-clean">
          <div class="player-hero-id-block">
            <div class="player-avatar">${escapeHtml((p.name || "P").split(" ").map(x => x[0]).slice(0, 2).join(""))}</div>
            <div>
              <div class="player-hero-name">${escapeHtml(p.name)}</div>
              <div class="player-hero-sub">${team ? teamLink(team.id, team.name) : "Free Agent"} · ${escapeHtml(country)}</div>
            </div>
          </div>
          <div class="player-hero-metrics-clean">
            <div><span>Overall</span><strong>${p.overall}</strong></div>
            <div><span>Potential</span><strong>${p.potential}</strong></div>
            <div><span>${escapeHtml(p.position)} rating</span><strong>${profile.positionRating}</strong></div>
            <div><span>Market value</span><strong>${formatMarketValue(marketSeries[marketSeries.length - 1])}</strong></div>
          </div>
        </div>
      </div>

      <div class="player-profile-top-grid-clean">
        <section class="panel player-summary-panel-clean">
          <div class="panel-head"><h3>Overview</h3><span>${team ? teamLink(team.id, team.name) : "Free Agent"}</span></div>
          <div class="player-summary-grid-clean">
            <div class="pp-info-box"><span class="pp-info-lbl">Height</span><strong class="pp-info-val">${escapeHtml(p.height || `5'10"`)}</strong></div>
            <div class="pp-info-box"><span class="pp-info-lbl">Age</span><strong class="pp-info-val">${p.age}</strong></div>
            <div class="pp-info-box"><span class="pp-info-lbl">Preferred foot</span><strong class="pp-info-val">${escapeHtml(p.preferredFoot || "Right")}</strong></div>
            <div class="pp-info-box"><span class="pp-info-lbl">Country</span><strong class="pp-info-val">${escapeHtml(country)}</strong></div>
            <div class="pp-info-box"><span class="pp-info-lbl">Transfer value</span><strong class="pp-info-val">${formatMarketValue(marketSeries[marketSeries.length - 1])}</strong></div>
            <div class="pp-info-box"><span class="pp-info-lbl">Contract end</span><strong class="pp-info-val">${p.contract?.expiresYear || (state.season.year + (p.contract?.yearsLeft || 0))}</strong></div>
          </div>
          <div class="player-overview-split-clean">
            <div class="player-position-box-clean">
              <div class="pp-section-title">Position</div>
              <div class="position-primary">${escapeHtml(p.position)}</div>
              <div class="note">Primary</div>
              <div class="player-pos-chip">${escapeHtml(p.position)}</div>
              <div class="note" style="margin-top:10px;">${escapeHtml(secondaryPosition)}</div>
            </div>
            <div class="player-traits-card-clean">
              <div class="pp-section-title">Player traits</div>
              <div class="trait-radar-placeholder">${traitHtml}</div>
            </div>
          </div>
        </section>

        <section class="panel player-career-panel-clean">
          <div class="panel-head"><h3>Career</h3><span>${team ? "Senior career" : "Free agent"}</span></div>
          <div class="career-list">
            <div class="career-item"><strong>${team ? escapeHtml(team.name) : "Free Agent"}</strong><span>${Math.max(2023, state.season.year - (p.contract?.yearsLeft || 0) - 1)} — now</span><em>${formatNumber(s.gp || 0)} apps</em></div>
            ${p.homegrown ? `<div class="career-item"><strong>Youth career</strong><span>Academy pathway</span><em>Homegrown</em></div>` : ""}
          </div>
          <div class="subtle-divider"></div>
          <div class="player-mini-metrics player-mini-metrics-clean">
            <div><span>Salary</span><strong>${formatMoney(p.contract?.salary || 0)}</strong></div>
            <div><span>Country</span><strong>${escapeHtml(country)}</strong></div>
            <div><span>Position rating</span><strong>${profile.positionRating}</strong></div>
            <div><span>Potential</span><strong>${p.potential}</strong></div>
          </div>
        </section>
      </div>

      <div class="player-ratings-grid-clean">
        ${categoryOrder.map(([title, group]) => renderPlayerStatCard(title, profile.categoryRatings[title.toLowerCase()] || averageRatings(Object.values(group)), group)).join('')}
      </div>

      <div class="player-profile-bottom-grid-clean">
        <section class="panel">
          <div class="panel-head"><h3>Transfer value</h3><span>Highest: ${formatMarketValue(highest)}</span></div>
          <div class="market-graph market-graph-clean">${marketSeries.map(v => `<div class="market-bar"><i style="height:${Math.max(12, Math.round((v / highest) * 100))}%"></i></div>`).join("")}</div>
          <div class="market-years">${years.map(y => `<span>${y}</span>`).join("")}</div>
        </section>
        <section class="panel">
          <div class="panel-head"><h3>${state.season.year} / ${state.season.year + 1}</h3><span>${escapeHtml(team?.name || "Season stats")}</span></div>
          <div class="player-season-stat-strip player-season-stat-strip-clean">${statTiles.map(([k,v]) => `<div class="season-stat"><strong>${v}</strong><span>${escapeHtml(k)}</span></div>`).join("")}</div>
        </section>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Match stats</h3><span>Sim season log</span></div>
        <table class="tight-table player-match-table-clean"><thead><tr><th>Category</th><th class="num">Value</th><th>Category</th><th class="num">Value</th></tr></thead><tbody>
          <tr><td>Goals</td><td class="num">${s.goals || 0}</td><td>Assists</td><td class="num">${s.assists || 0}</td></tr>
          <tr><td>Shots</td><td class="num">${s.shots || 0}</td><td>On target</td><td class="num">${s.shotsOnTarget || 0}</td></tr>
          <tr><td>xG</td><td class="num">${(s.xg || 0).toFixed(1)}</td><td>Minutes</td><td class="num">${formatNumber(s.min || 0)}</td></tr>
          <tr><td>Yellow cards</td><td class="num">${s.yellows || 0}</td><td>Red cards</td><td class="num">${s.reds || 0}</td></tr>
        </tbody></table>
      </div>
    </div>
  </div>`;

  document.getElementById("playerProfileOverlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("ppClose")?.addEventListener("click", () => document.getElementById("playerProfileOverlay")?.remove());
  document.getElementById("playerProfileOverlay")?.addEventListener("click", e => { if (e.target.id === "playerProfileOverlay") document.getElementById("playerProfileOverlay")?.remove(); });
  document.querySelectorAll("#playerProfileOverlay .team-link").forEach(el => {
    el.oncontextmenu = e => { e.preventDefault(); armOpenInNewTab(el, "team", el.dataset.id); };
    el.onclick = async e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
        await persist();
        return;
      }
      e.preventDefault();
      document.getElementById("playerProfileOverlay")?.remove();
      if (shouldOpenInNewTab("team", el.dataset.id)) return openInNewTab("team", el.dataset.id);
      clearPendingNewTabTarget();
      setSelectedTeam(el.dataset.id);
    };
  });
}

// ── Page renderers ───────────────────────────────────────────────────────────

function renderDashboard() {
  const team = getUserTeam(state);
  const cap = getCapSummary(state, team.id);
  const confRows = state.standings[team.conference] || [];
  const rank = confRows.findIndex(r => r.teamId === team.id) + 1;
  const record = getTeamRecord(team.id) || { wins: 0, draws: 0, losses: 0, points: 0, gf: 0, ga: 0, gd: 0, played: 0 };
  const coach = getTeamCoach(team.id);
  const roster = getTeamPlayers(state, team.id);
  const goalLeader = [...roster].sort((a, b) => (b.stats.goals - a.stats.goals) || (b.overall - a.overall))[0];
  const assistLeader = [...roster].sort((a, b) => (b.stats.assists - a.stats.assists) || (b.overall - a.overall))[0];
  const ratingLeader = [...roster].sort((a, b) => b.overall - a.overall)[0];
  const headlines = (state.transactions || []).slice(0, 6).reverse();
  const schedule = state.schedule.filter(m => !m.played && (m.homeTeamId === team.id || m.awayTeamId === team.id)).slice(0, 5);
  const confTable = confRows.slice(0, 16).map((r, i) => `<tr class="${r.teamId === team.id ? 'highlight-row' : ''}"><td>${i + 1}</td><td>${teamLink(r.teamId, byTeamId(r.teamId)?.name || '—')}</td><td class="num">${r.points}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td></tr>`).join("");
  const nextGames = schedule.map(m => {
    const opp = byTeamId(m.homeTeamId === team.id ? m.awayTeamId : m.homeTeamId);
    const venue = m.homeTeamId === team.id ? 'Home' : 'Away';
    return `<tr><td class="num">${m.week}</td><td>${teamLink(opp.id, opp.name)}</td><td>${venue}</td></tr>`;
  }).join("") || `<tr><td colspan="3">No upcoming matches.</td></tr>`;
  const newsCards = headlines.map(tx => `<div class="news-card-fbgm"><div class="news-card-type">${escapeHtml(tx.type)}</div><div class="news-card-copy">${escapeHtml(tx.text)}</div></div>`).join("") || `<div class="note">No headlines yet.</div>`;
  return `${pageHead(`${team.name} Dashboard`, `${state.season.year} ${state.season.phase.toLowerCase()}`)}
  <div class="score-ticker">${state.schedule.filter(m => m.played).slice(-8).reverse().map(m => {
    const h = byTeamId(m.homeTeamId), a = byTeamId(m.awayTeamId);
    return `<div class="ticker-item">${teamLogoMark(h, 'mini-team-logo')}<span>${escapeHtml(h.shortName || h.name)}</span><strong>${m.result.homeGoals}</strong><span>${escapeHtml(a.shortName || a.name)}</span><strong>${m.result.awayGoals}</strong></div>`;
  }).join("") || `<div class="ticker-item"><span>No results yet</span></div>`}</div>
  <div class="dashboard-shell-v2">
    <section class="panel dashboard-standings-col">
      <div class="panel-head"><h3>${team.conference}</h3><span>GB</span></div>
      <table class="tight-table dashboard-standings-table"><tbody>${confTable}</tbody></table>
      <div class="panel-link-row"><button class="text-link nav-jump-btn" data-target-page="standings">» League Standings</button></div>
    </section>

    <section class="panel dashboard-main-v2">
      <div class="dashboard-main-top">
        <div class="dashboard-record-block">
          <div class="dashboard-record-big">${record.wins}-${record.draws}-${record.losses}</div>
          <div class="dashboard-record-sub">${ordinalSuffix(rank)} in conference</div>
        </div>
        <div class="dashboard-summary-grid">
          <div class="dashboard-summary-item"><span>Coach</span><strong>${coach ? coachLink(coach.id, coach.name) : '—'}</strong></div>
          <div class="dashboard-summary-item"><span>Budget room</span><strong>${formatMoney(cap.budgetRoom)}</strong></div>
          <div class="dashboard-summary-item"><span>Intl slots</span><strong>${cap.intlUsed}/${cap.intlTotal}</strong></div>
          <div class="dashboard-summary-item"><span>Upcoming</span><strong>${schedule.length} matches</strong></div>
        </div>
      </div>
      <div class="dashboard-mid-grid">
        <div>
          <h4>Team Leaders</h4>
          <div class="dash-list-row"><span>Goals</span><strong>${goalLeader ? playerLink(goalLeader.id, goalLeader.name) : '—'}</strong><span>${goalLeader?.stats.goals || 0}</span></div>
          <div class="dash-list-row"><span>Assists</span><strong>${assistLeader ? playerLink(assistLeader.id, assistLeader.name) : '—'}</strong><span>${assistLeader?.stats.assists || 0}</span></div>
          <div class="dash-list-row"><span>Best player</span><strong>${ratingLeader ? playerLink(ratingLeader.id, ratingLeader.name) : '—'}</strong><span>${ratingLeader?.overall || 0}</span></div>
          <div class="panel-link-row"><button class="text-link nav-jump-btn" data-target-page="roster">» Full Roster</button></div>
        </div>
        <div>
          <h4>Team Stats</h4>
          <div class="dash-list-row"><span>Points</span><strong>${record.points}</strong><span>${record.played} GP</span></div>
          <div class="dash-list-row"><span>Goals</span><strong>${record.gf}</strong><span>${record.ga} allowed</span></div>
          <div class="dash-list-row"><span>Payroll</span><strong>${formatMoney(cap.budgetUsed)}</strong><span>DP ${cap.dpCount} · U22 ${cap.u22Count}</span></div>
          <div class="panel-link-row"><button class="text-link nav-jump-btn" data-target-page="budget">» Team Finances</button></div>
        </div>
        <div>
          <h4>Finances</h4>
          <div class="dash-list-row"><span>Cash</span><strong>${formatMoney(team.finances.cash)}</strong><span>club balance</span></div>
          <div class="dash-list-row"><span>GAM</span><strong>${formatMoney(team.gam)}</strong><span>TAM ${formatMoney(team.tam)}</span></div>
          <div class="dash-list-row"><span>Inbox</span><strong>${state.pendingOffer ? '1 offer' : 'No messages'}</strong><span>${state.pendingOffer ? escapeHtml(state.pendingOffer.bidClub) : 'Clear'}</span></div>
        </div>
      </div>
      <div class="dashboard-bottom-grid">
        <div class="panel-lite">
          <div class="panel-head"><h3>Upcoming Games</h3><span>Next ${schedule.length}</span></div>
          <table class="tight-table"><thead><tr><th>Week</th><th>Opponent</th><th>Venue</th></tr></thead><tbody>${nextGames}</tbody></table>
        </div>
        <div class="panel-lite">
          <div class="panel-head"><h3>Front Office Notes</h3><span>Live</span></div>
          <div class="dash-list-row"><span>Next sim targets</span><strong>Match · Week · Draft · Free Agency</strong><span></span></div>
          <div class="dash-list-row"><span>Schedule</span><strong>34 regular season matches per club</strong><span></span></div>
          <div class="dash-list-row"><span>Incoming offer</span><strong>${state.pendingOffer ? 'Yes' : 'None'}</strong><span></span></div>
        </div>
      </div>
    </section>

    <section class="panel dashboard-news-col">
      <div class="panel-head"><h3>League Headlines</h3><span>News Feed</span></div>
      <div class="headline-grid news-grid-v2">${newsCards}</div>
    </section>
  </div>`;
}

function renderAcademy() {
  const team = getUserTeam(state);
  const prospects = getTeamAcademy(state, team.id);
  return `${pageHead("Youth Academy","Develop homegrowns and call them up")}
  <div class="panel">
    <div class="panel-head"><h3>Academy Prospects</h3><span>${prospects.length} players</span></div>
    <table><thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th><th>Notes</th><th></th></tr></thead><tbody>
      ${prospects.map(p => `<tr>
        <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.position)}</td>
        <td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td>
        <td>${escapeHtml(p.notes)}</td>
        <td class="num"><button class="small-btn academy-callup-btn" data-id="${p.id}">Call Up</button></td>
      </tr>`).join("")}
    </tbody></table>
  </div>`;
}

function renderStandings() {
  function renderConf(conf, tbl) {
    const mapped = state.standings[conf].map(r => ({ ...r, name: byTeamId(r.teamId).name }));
    const sorted = sortRows(mapped, tableSortState[tbl]);
    return `<div class="panel">
      <div class="panel-head"><h3>${conf} Conference</h3><span>${sorted.length} clubs</span></div>
      <table><thead><tr>
        <th>#</th>${makeSortableTh("Club",tbl,"name")}${makeSortableTh("GP",tbl,"played","num")}
        ${makeSortableTh("W",tbl,"wins","num")}${makeSortableTh("D",tbl,"draws","num")}
        ${makeSortableTh("L",tbl,"losses","num")}${makeSortableTh("GF",tbl,"gf","num")}
        ${makeSortableTh("GA",tbl,"ga","num")}${makeSortableTh("GD",tbl,"gd","num")}
        ${makeSortableTh("Pts",tbl,"points","num")}
      </tr></thead><tbody>
        ${sorted.map((r,i) => `<tr>
          <td>${i+1}</td><td>${teamLink(r.teamId, r.name)}</td><td class="num">${r.played}</td>
          <td class="num">${r.wins}</td><td class="num">${r.draws}</td><td class="num">${r.losses}</td>
          <td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${r.gd>0?"+":""}${r.gd}</td>
          <td class="num">${r.points}</td>
        </tr>`).join("")}
      </tbody></table>
    </div>`;
  }
  return `${pageHead("Standings","Every team plays 34 matches")}
  <div class="grid-2">${renderConf("East","standingsEast")}${renderConf("West","standingsWest")}</div>`;
}

function renderSchedule() {
  const team = getUserTeam(state);
  const rows = state.schedule.filter(m => m.homeTeamId===team.id || m.awayTeamId===team.id);
  return `${pageHead("Schedule","Team schedule view")}
  <div class="panel"><table>
    <thead><tr><th>Week</th><th>Home</th><th>Away</th><th>Status</th></tr></thead><tbody>
      ${rows.map(m => `<tr>
        <td>${m.week}</td>
        <td>${teamLink(m.homeTeamId, byTeamId(m.homeTeamId).name)}</td>
        <td>${teamLink(m.awayTeamId, byTeamId(m.awayTeamId).name)}</td>
        <td>${m.played ? `${m.result.homeGoals}-${m.result.awayGoals}` : "Upcoming"}</td>
      </tr>`).join("")}
    </tbody></table></div>`;
}

function renderWeeklySchedule() {
  const maxWeek = Math.max(...state.schedule.map(m => m.week));
  weeklyScheduleWeek = Math.max(1, Math.min(maxWeek, weeklyScheduleWeek || state.calendar.week || 1));
  const currentWeek = state.calendar.week || 1;
  const weekMatches = state.schedule.filter(m => m.week === weeklyScheduleWeek);
  const lockedFuture = weeklyScheduleWeek > currentWeek;
  return `${pageHead("Weekly Schedule","Current matchday lock — future weeks stay view-only until the current week is fully completed")}
  <div class="panel weekly-toolbar">
    <div class="weekly-nav">
      <button class="small-btn" id="weekPrevBtn">‹</button>
      <button class="small-btn" id="weekNextBtn">›</button>
      <select id="weekSelect">${Array.from({length:maxWeek}, (_,i) => `<option value="${i+1}" ${i+1===weeklyScheduleWeek ? 'selected' : ''}>Matchday ${i+1}</option>`).join('')}</select>
      ${lockedFuture ? `<span class="badge yellow">Future matchday locked</span>` : `<span class="badge green">Current playable week</span>`}
    </div>
    <div class="weekly-actions">
      <button class="ghost-btn" id="simWeekOnlyBtn" type="button" ${lockedFuture ? 'disabled' : ''}>Sim matchday</button>
      <button class="primary-btn" id="liveWatchWeekBtn" type="button" ${lockedFuture ? 'disabled' : ''}>Live watch all games</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Fixtures</h3><span>${lockedFuture ? 'Browse only' : 'Watch or sim'}</span></div>
    <div class="weekly-grid schedule-fixture-grid">${weekMatches.map(m => {
      const home = byTeamId(m.homeTeamId); const away = byTeamId(m.awayTeamId);
      const homePalette = teamColors(home.id); const awayPalette = teamColors(away.id);
      const homeRec = getTeamRecord(home.id) || { wins:0, draws:0, losses:0 };
      const awayRec = getTeamRecord(away.id) || { wins:0, draws:0, losses:0 };
      const playable = !lockedFuture;
      return `<div class="week-game-card schedule-card-clean">
        <div class="week-game-main week-game-main-clean">
          <div class="week-fixture-team home" style="--team-primary:${homePalette.primary};--team-secondary:${homePalette.secondary};--team-text:${homePalette.text};">
            <div class="week-team-crest">${teamLogoMark(home, 'mini-team-logo')}</div>
            <div class="week-team-copy">
              <div class="week-team-name-strong">${teamLink(home.id, home.name)}</div>
              <div class="week-team-sub">${homeRec.wins}-${homeRec.draws}-${homeRec.losses} · Home</div>
            </div>
          </div>
          <div class="week-versus week-versus-clean">${m.played ? `${m.result.homeGoals} - ${m.result.awayGoals}` : 'vs'}</div>
          <div class="week-fixture-team away" style="--team-primary:${awayPalette.primary};--team-secondary:${awayPalette.secondary};--team-text:${awayPalette.text};">
            <div class="week-team-copy align-right">
              <div class="week-team-name-strong">${teamLink(away.id, away.name)}</div>
              <div class="week-team-sub">${awayRec.wins}-${awayRec.draws}-${awayRec.losses} · Away</div>
            </div>
            <div class="week-team-crest">${teamLogoMark(away, 'mini-team-logo')}</div>
          </div>
        </div>
        <div class="week-game-actions week-game-actions-v2">
          <button class="small-btn watch-week-match-btn" data-id="${m.id}" ${!playable ? 'disabled' : ''}>Watch game</button>
          <button class="small-btn sim-week-match-btn" data-id="${m.id}" ${(!playable || m.played) ? 'disabled' : ''}>Sim game</button>
        </div>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function renderStats() {
  const rows = state.players.filter(p => p.clubId).map(p => ({
    id: p.id,
    name: p.name,
    clubId: p.clubId,
    club: byTeamId(p.clubId)?.name || "—",
    pos: p.position,
    gp: p.stats.gp,
    goals: p.stats.goals,
    assists: p.stats.assists,
    xg: p.stats.xg || 0,
    yellows: p.stats.yellows,
    reds: p.stats.reds,
    cleanSheets: p.stats.cleanSheets || 0,
    ga: p.stats.ga || 0,
  }));
  const sorted = sortRows(rows, tableSortState.stats);
  const categories = [
    ["Goals", "goals"], ["Assists", "assists"], ["xG", "xg"], ["Clean Sheets", "cleanSheets"], ["Yellow Cards", "yellows"], ["Red Cards", "reds"]
  ];
  return `${pageHead("Player Stats","League leaders and full leaderboard")}
  <div class="panel">
    <div class="panel-head"><h3>League Leaders</h3><span>Top 10 by category</span></div>
    <div class="leaders-grid">
      ${categories.map(([label,key]) => `<div class="leaders-card"><div class="leaders-card-title">${label}</div>${rows.slice().sort((a,b) => (b[key] || 0) - (a[key] || 0)).slice(0,10).map((p, idx) => `<div class="leaders-row"><span>${idx + 1}. ${playerLink(p.id, p.name)}</span><strong>${key === 'xg' ? (p[key] || 0).toFixed(1) : (p[key] || 0)}</strong></div>`).join('')}</div>`).join('')}
    </div>
  </div>
  <div class="panel stats-table-panel"><table class="tight-table stats-table-tight">
    <thead><tr>
      ${makeSortableTh("Name","stats","name")}
      <th>Club</th>
      ${makeSortableTh("Pos","stats","pos")}
      ${makeSortableTh("GP","stats","gp","num")}
      ${makeSortableTh("G","stats","goals","num")}
      ${makeSortableTh("A","stats","assists","num")}
      ${makeSortableTh("xG","stats","xg","num")}
      ${makeSortableTh("YC","stats","yellows","num")}
      ${makeSortableTh("RC","stats","reds","num")}
    </tr></thead><tbody>
      ${sorted.slice(0,220).map(p => `<tr>
        <td>${playerLink(p.id, p.name)}</td>
        <td>${teamLink(p.clubId, p.club)}</td><td>${escapeHtml(p.pos)}</td>
        <td class="num">${p.gp}</td><td class="num">${p.goals}</td><td class="num">${p.assists}</td>
        <td class="num">${(p.xg||0).toFixed(1)}</td><td class="num">${p.yellows}</td><td class="num">${p.reds}</td>
      </tr>`).join("")}
    </tbody></table></div>`;
}

function renderLeagueLeaders() {
  const rows = state.players.filter(p => p.clubId).map(p => ({
    id: p.id, name: p.name, clubId: p.clubId, club: byTeamId(p.clubId)?.name || "—", pos: p.position,
    goals: p.stats.goals || 0, assists: p.stats.assists || 0, xg: p.stats.xg || 0, cleanSheets: p.stats.cleanSheets || 0,
    yellows: p.stats.yellows || 0, reds: p.stats.reds || 0, appearances: p.stats.gp || 0,
  }));
  const cats = [["Goals","goals"],["Assists","assists"],["xG","xg"],["Appearances","appearances"],["Clean Sheets","cleanSheets"],["Yellow Cards","yellows"],["Red Cards","reds"]];
  return `${pageHead("League Leaders","Top 10 in every tracked stat, with quick access to the full leaderboard")}
  <div class="leaders-grid full-leaders-grid">${cats.map(([label,key]) => `<div class="panel leaders-full-card"><div class="panel-head"><h3>${label}</h3><button class="text-link nav-jump-btn" data-target-page="stats">Open full leaderboard</button></div>${rows.slice().sort((a,b) => (b[key] || 0) - (a[key] || 0)).slice(0,10).map((p, idx) => `<div class="leaders-row"><span>${idx + 1}. ${playerLink(p.id, p.name)} <small>${escapeHtml(p.pos)} · ${teamLink(p.clubId, p.club)}</small></span><strong>${key === 'xg' ? (p[key] || 0).toFixed(1) : formatNumber(p[key] || 0)}</strong></div>`).join('')}</div>`).join('')}</div>`;
}

function renderFreeAgents() {
  const team = getUserTeam(state);
  const cap = getCapSummary(state, team.id);
  const roster = getTeamPlayers(state, team.id);
  const openSpots = Math.max(0, 30 - roster.length);
  const composition = ["GK","LB","CB","RB","LM","RM","CDM","CM","CAM","LW","RW","ST"].map(pos => {
    const count = roster.filter(p => p.position === pos).length;
    return `<div>${pos}: <strong>${count}</strong></div>`;
  }).join('');
  const rows = state.freeAgents.slice().sort((a,b)=> (b.overall-a.overall) || (a.age-b.age));
  return `${pageHead("Free Agents","Available")}
  <div class="free-agency-shell">
    <div class="free-agency-top">
      <div class="free-agency-summary">
        <div class="note">More: Upcoming Free Agents</div>
        <p>You currently have <strong>${openSpots}</strong> open roster spots and <strong>${formatMoney(Math.max(0, cap.budgetRoom))}</strong> in cap space.</p>
        <div class="note">Min contract: ${formatMoney(500000)} · Max contract: ${formatMoney(30000000)}</div>
      </div>
      <div class="free-agency-composition panel-lite"><div class="panel-head"><h3>Roster Composition</h3><span>Current</span></div><div class="fa-comp-grid">${composition}</div></div>
    </div>
    <div class="panel">
      <div class="fa-toolbar"><div class="note">${rows.length} available players</div><div class="fa-search-row"><input id="freeAgentSearch" class="search-input" placeholder="Search" /><select id="freeAgentPageSize"><option>10</option><option selected>25</option><option>50</option></select></div></div>
      <table class="tight-table free-agent-table"><thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">Ovr</th><th class="num">Pot</th><th class="num">G</th><th class="num">Stats</th><th class="num">AV</th><th>Mood</th><th>Asking For</th><th>Exp</th><th>Negotiate</th></tr></thead><tbody>
        ${rows.slice(0,25).map(p => `<tr><td>${playerLink(p.id, p.name)}</td><td>${escapeHtml(p.position)}</td><td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td><td class="num">${p.stats?.gp || 0}</td><td class="num">${(p.stats?.goals || 0) + (p.stats?.assists || 0)}</td><td class="num">${(getLivePlayerRating(p,1) || 0).toFixed(1)}</td><td><span class="badge">${escapeHtml(p.morale || 'Ok')}</span></td><td>${formatMoney(p.contract.salary)}</td><td>${state.season.year + (p.contract.yearsLeft || 0)}</td><td><button class="small-btn sign-fa-btn" data-id="${p.id}">Sign</button></td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>`;
}

function renderLeagueFinances() {
  const teams = state.teams.slice().sort((a,b) => (b.finances.cash - a.finances.cash));
  return `${pageHead("League Finances","Club-wide payroll, cash and allocation money")}
  <div class="panel"><table class="tight-table"><thead><tr><th>Club</th><th class="num">Cash</th><th class="num">Budget</th><th class="num">GAM</th><th class="num">TAM</th><th class="num">Intl</th></tr></thead><tbody>
  ${teams.map(t => { const cap=getCapSummary(state,t.id); return `<tr><td>${teamLink(t.id,t.name)}</td><td class="num">${formatMoney(t.finances.cash)}</td><td class="num">${formatMoney(cap.budgetUsed)}</td><td class="num">${formatMoney(t.gam)}</td><td class="num">${formatMoney(t.tam)}</td><td class="num">${cap.intlUsed}/${cap.intlTotal}</td></tr>`; }).join('')}
  </tbody></table></div>`;
}

function renderLeagueHistory() {
  const rows = (state.awardsHistory || []).slice().reverse();
  return `${pageHead("League History","Season, champion, awards and cup results")}
  <div class="panel"><table class="tight-table"><thead><tr><th>Season</th><th>Champion</th><th>Runner-up</th><th>MVP</th><th>Golden Boot</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.season || '—'}</td><td>${escapeHtml(r.champion || '—')}</td><td>${escapeHtml(r.runnerUp || '—')}</td><td>${escapeHtml(r.mvp || '—')}</td><td>${escapeHtml(r.goldenBoot || '—')}</td></tr>`).join('') || `<tr><td colspan="5">No league history yet.</td></tr>`}
  </tbody></table></div>`;
}

function renderPowerRankings() {
  const rows = state.teams.map(t => {
    const rec = getTeamRecord(t.id) || { points:0, gd:0, played:0 };
    const score = (rec.points * 5) + (rec.gd * 2) + teamOverall(state, t.id);
    return { team:t, rec, score };
  }).sort((a,b)=> b.score-a.score).slice(0,30);
  return `${pageHead("Live Power Rankings","Form, standings and squad quality combined")}
  <div class="panel"><table class="tight-table"><thead><tr><th>#</th><th>Club</th><th class="num">Pts</th><th class="num">GD</th><th class="num">Overall</th></tr></thead><tbody>
    ${rows.map((r,i)=> `<tr><td>${i+1}</td><td>${teamLink(r.team.id,r.team.name)}</td><td class="num">${r.rec.points}</td><td class="num">${r.rec.gd>0?'+':''}${r.rec.gd}</td><td class="num">${teamOverall(state, r.team.id).toFixed(1)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderNewsFeed() {
  const items = (state.transactions || []).slice().reverse().slice(0,40);
  return `${pageHead("News Feed","Social-style league updates")}
  <div class="news-feed-list">${items.map((tx,i)=> `<div class="panel news-post"><div class="news-post-head"><strong>@mlsgmnews</strong><span>${tx.season || state.season.year}</span></div><div class="news-post-type">${escapeHtml(tx.type)}</div><div>${escapeHtml(tx.text)}</div></div>`).join('') || `<div class="panel note">No posts yet.</div>`}</div>`;
}

function renderPlayerRatings() {
  const rows = state.players.filter(p => p.clubId).slice().sort((a,b)=> (b.overall-a.overall) || (b.potential-a.potential));
  return `${pageHead("Player Ratings","Overall, potential and detailed attribute ratings")}
  <div class="panel"><table class="tight-table"><thead><tr><th>Name</th><th>Club</th><th>Pos</th><th class="num">Age</th><th class="num">Ovr</th><th class="num">Pot</th><th class="num">Pace</th><th class="num">Passing</th><th class="num">Defense</th><th class="num">Physical</th></tr></thead><tbody>
    ${rows.map(p => `<tr><td>${playerLink(p.id,p.name)}</td><td>${teamLink(p.clubId, byTeamId(p.clubId)?.name || '—')}</td><td>${escapeHtml(p.position)}</td><td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td><td class="num">${p.attributes?.pace || 0}</td><td class="num">${p.attributes?.passing || 0}</td><td class="num">${p.attributes?.defense || 0}</td><td class="num">${p.attributes?.physical || 0}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderInjuries() {
  const rows = state.players.filter(p => p.clubId && p.injuredUntil && p.injuredUntil >= state.calendar.absoluteDay).map(p => ({ p, days: (p.injuredUntil - state.calendar.absoluteDay) })).sort((a,b)=> b.days-a.days);
  return `${pageHead("Injuries","Current unavailable players across the league")}
  <div class="panel"><table class="tight-table"><thead><tr><th>Player</th><th>Club</th><th>Pos</th><th>Injury</th><th class="num">Days Left</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${playerLink(r.p.id,r.p.name)}</td><td>${teamLink(r.p.clubId, byTeamId(r.p.clubId)?.name || '—')}</td><td>${escapeHtml(r.p.position)}</td><td>${escapeHtml(r.p.injuryMeta?.type || 'Unavailable')}</td><td class="num">${r.days}</td></tr>`).join('') || `<tr><td colspan="5">No active injuries.</td></tr>`}
  </tbody></table></div>`;
}

function renderAwardRace() {
  const rows = state.players.filter(p => p.clubId).map(p => ({ p, score: ((p.stats.goals || 0) * 4) + ((p.stats.assists || 0) * 3) + ((getLivePlayerRating(p,1) || 6) * 5) + ((getTeamRecord(p.clubId)?.points || 0) * 0.25) })).sort((a,b)=> b.score-a.score).slice(0,20);
  return `${pageHead("Live Award Race","Rolling MVP race based on season form")}
  <div class="panel"><table class="tight-table"><thead><tr><th>#</th><th>Player</th><th>Club</th><th class="num">Goals</th><th class="num">Assists</th><th class="num">Rating</th><th class="num">Race Score</th></tr></thead><tbody>
    ${rows.map((r,i) => `<tr><td>${i+1}</td><td>${playerLink(r.p.id,r.p.name)}</td><td>${teamLink(r.p.clubId, byTeamId(r.p.clubId)?.name || '—')}</td><td class="num">${r.p.stats.goals || 0}</td><td class="num">${r.p.stats.assists || 0}</td><td class="num">${(getLivePlayerRating(r.p,1) || 0).toFixed(2)}</td><td class="num">${r.score.toFixed(1)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderTradeProposals() {
  return `${pageHead("Trade Proposals","Incoming and recent league offers")}
  <div class="panel">${state.pendingOffer ? `<div class="offer-box"><strong>${escapeHtml(state.pendingOffer.bidClub)}</strong> offered ${formatMoney(state.pendingOffer.amount)} for ${escapeHtml(byPlayerId(state.pendingOffer.playerId)?.name || 'your player')}.</div>` : `<div class="note">No active trade proposals right now.</div>`}</div>`;
}


function renderTransactions() {
  return `${pageHead("Transactions Log","Signings, trades, offers, injuries, academy, awards")}
  <div class="panel"><table>
    <thead><tr><th>Type</th><th>Season</th><th>Text</th></tr></thead><tbody>
      ${state.transactions.map(tx => `<tr><td><span class="badge">${escapeHtml(tx.type)}</span></td><td>${tx.season}</td><td>${escapeHtml(tx.text)}</td></tr>`).join("")}
    </tbody></table>
  </div>`;
}

function renderTrade() {
  const userTeam = getUserTeam(state);
  const partnerId = tradePartnerTeamId && tradePartnerTeamId !== userTeam.id
    ? tradePartnerTeamId
    : state.teams.find(t => t.id !== userTeam.id)?.id;
  tradePartnerTeamId = partnerId;
  const partner = byTeamId(partnerId);
  const myPlayers = getTeamPlayers(state, userTeam.id);
  const theirPlayers = partner ? getTeamPlayers(state, partner.id) : [];
  const years = [state.season.year + 1, state.season.year + 2];
  const myPicks = getUserDraftPicks(years);
  const theirPicks = (state.draft?.picks || [])
    .filter(p => partner && p.ownerTeamId === partner.id && years.includes(p.year))
    .sort((a, b) => a.year - b.year || a.round - b.round);

  const pickLabel = p => `${p.year} R${p.round} · ${escapeHtml(byTeamId(p.originalTeamId)?.shortName || byTeamId(p.originalTeamId)?.name || "Unknown")}`;
  const teamNeeds = roster => {
    const counts = pos => roster.filter(p => p.position === pos).length;
    const needs = [];
    if (counts("GK") < 2) needs.push("GK");
    if (counts("CB") < 3) needs.push("CB");
    if (counts("LB") < 2) needs.push("LB");
    if (counts("RB") < 2) needs.push("RB");
    if (counts("CDM") < 2) needs.push("CDM");
    if (counts("ST") < 2) needs.push("ST");
    return needs.length ? needs.join(", ") : "No urgent needs";
  };

  return `${pageHead("Trade Center","Realistic AI trade logic — harder to fleece clubs")}
  <div class="trade-header-simple">
    <div>
      <label for="tradePartnerSelect">Trade Partner</label>
      <select id="tradePartnerSelect">${state.teams.filter(t => t.id !== userTeam.id).map(t => `<option value="${t.id}" ${t.id===partnerId?"selected":""}>${escapeHtml(t.name)}</option>`).join("")}</select>
    </div>
    <div class="trade-meta-box">
      ${partner ? `${teamLogoMark(partner, "mini-team-logo")}<div><strong>${escapeHtml(partner.name)}</strong><div class="note">Needs: ${escapeHtml(teamNeeds(theirPlayers))}</div></div>` : ""}
    </div>
  </div>

  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>You Send</h3><span>${escapeHtml(userTeam.name)}</span></div>
      <div class="grid-3">
        <div><label>GAM</label><input id="tradeOutgoingGAM" type="number" min="0" value="0" /></div>
        <div><label>TAM</label><input id="tradeOutgoingTAM" type="number" min="0" value="0" /></div>
        <div><label>Intl Slots</label><input id="tradeOutgoingIntl" type="number" min="0" value="0" /></div>
      </div>
      <div class="trade-check-grid">${myPlayers.map(p => `<label class="trade-check"><input type="checkbox" data-trade-kind="out-player" value="${p.id}" /> <span>${escapeHtml(p.name)} <strong>${p.overall}</strong> · ${escapeHtml(p.position)} · ${formatMoney(p.contract.salary)}</span></label>`).join("")}</div>
      <div class="subtle-divider"></div>
      <div class="trade-check-grid">${myPicks.map(p => `<label class="trade-check"><input type="checkbox" data-trade-kind="out-pick" value="${p.id}" /> <span>${pickLabel(p)}</span></label>`).join("") || `<div class="note">No tradable picks in the next two drafts.</div>`}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>You Receive</h3><span>${escapeHtml(partner?.name || "Choose a club")}</span></div>
      <div class="grid-3">
        <div><label>GAM</label><input id="tradeIncomingGAM" type="number" min="0" value="0" /></div>
        <div><label>TAM</label><input id="tradeIncomingTAM" type="number" min="0" value="0" /></div>
        <div><label>Intl Slots</label><input id="tradeIncomingIntl" type="number" min="0" value="0" /></div>
      </div>
      <div class="trade-check-grid">${theirPlayers.map(p => `<label class="trade-check"><input type="checkbox" data-trade-kind="in-player" value="${p.id}" /> <span>${escapeHtml(p.name)} <strong>${p.overall}</strong> · ${escapeHtml(p.position)} · ${formatMoney(p.contract.salary)}</span></label>`).join("") || `<div class="note">No roster data.</div>`}</div>
      <div class="subtle-divider"></div>
      <div class="trade-check-grid">${theirPicks.map(p => `<label class="trade-check"><input type="checkbox" data-trade-kind="in-pick" value="${p.id}" /> <span>${pickLabel(p)}</span></label>`).join("") || `<div class="note">No tradable picks in the next two drafts.</div>`}</div>
    </div>
  </div>

  <div class="panel">
    <div class="trade-tips">
      <div>Contending teams protect win-now starters.</div>
      <div>Rebuilding teams value youth and upside more.</div>
      <div>Position shortages, salary load, and years left matter now.</div>
    </div>
    <div class="flex"><button id="proposeTradeBtn" class="primary-btn" type="button">Send Trade Proposal</button></div>
  </div>`;
}


function designationBudgetCharge(player) {
  if (!player) return 0;
  if (player.designation === "DP") return 803125;
  if (player.designation === "U22") return player.age <= 20 ? 150000 : 200000;
  if (player.designation === "TAM") return Math.min(player.contract?.salary || 0, 803125);
  return Math.min(player.contract?.salary || 0, 803125);
}

function projectedPlayoffSeeds() {
  const project = conf => (state.standings[conf] || [])
    .slice()
    .sort((a, b) => b.points - a.points || b.wins - a.wins || b.gd - a.gd || b.gf - a.gf)
    .map((row, idx) => ({ ...row, seed: idx + 1 }));
  return { East: project("East"), West: project("West") };
}

function renderBracketMatchup(teamA, teamB, meta = "") {
  const row = (team, fallbackLabel = "TBD") => {
    if (!team) return `<div class="bracket-team"><span>${fallbackLabel}</span><strong>—</strong></div>`;
    const teamId = team.teamId || team.id || "";
    const name = byTeamId(teamId)?.name || team.name || fallbackLabel;
    const seed = team.seed ? `#${team.seed}` : "";
    const label = `${seed} ${name}`.trim();
    return `<div class="bracket-team">${teamId ? teamLink(teamId, label) : `<span>${escapeHtml(label)}</span>`}<strong>${team.resultText || ""}</strong></div>`;
  };
  return `<div class="bracket-match">${row(teamA)}${row(teamB)}${meta ? `<div class="bracket-meta">${meta}</div>` : ""}</div>`;
}

function buildPlayoffGraphicData() {
  if (!state.playoffs) {
    const seeds = projectedPlayoffSeeds();
    const projected = conf => {
      const s = seeds[conf];
      return {
        wildCard: [{ a: s[7], b: s[8], meta: "Wild Card" }],
        roundOne: [
          { a: s[0], b: { name: "WC Winner" }, meta: "Round One" },
          { a: s[1], b: s[6], meta: "Round One" },
          { a: s[2], b: s[5], meta: "Round One" },
          { a: s[3], b: s[4], meta: "Round One" },
        ],
        semis: [{ a: { name: "R1 Winner" }, b: { name: "R1 Winner" }, meta: "Semifinal" }, { a: { name: "R1 Winner" }, b: { name: "R1 Winner" }, meta: "Semifinal" }],
        final: [{ a: { name: `${conf} SF Winner` }, b: { name: `${conf} SF Winner` }, meta: "Conference Final" }],
      };
    };
    return { locked: false, currentRound: "Projected Field", East: projected("East"), West: projected("West"), cup: [{ a: { name: "East Champion" }, b: { name: "West Champion" }, meta: "MLS Cup" }] };
  }

  const p = state.playoffs;
  const seedMap = conf => (p.conferenceSeeds[conf] || []).reduce((acc, row) => (acc[row.teamId] = row.seed, acc), {});
  const seeds = { East: seedMap("East"), West: seedMap("West") };
  const wcFor = conf => {
    const match = p.rounds.wildCard.find(m => m.homeConf === conf);
    if (!match) {
      const rows = p.conferenceSeeds[conf];
      return [{ a: { teamId: rows[7]?.teamId, seed: 8 }, b: { teamId: rows[8]?.teamId, seed: 9 }, meta: "Wild Card" }];
    }
    return [{
      a: { teamId: match.homeTeamId, seed: seeds[conf][match.homeTeamId], resultText: match.result ? String(match.result.homeGoals) : "" },
      b: { teamId: match.awayTeamId, seed: seeds[conf][match.awayTeamId], resultText: match.result ? String(match.result.awayGoals) : "" },
      meta: "Wild Card"
    }];
  };

  const buildConference = conf => {
    const confSeeds = p.conferenceSeeds[conf] || [];
    const sBySeed = n => confSeeds.find(x => x.seed === n);
    const summaries = p.rounds.roundOne.filter(x => x.seriesSummary && x.conference === conf);
    const sf = p.rounds.semifinals.filter(m => m.homeConf === conf).map(m => ({
      a: { teamId: m.homeTeamId, seed: seeds[conf][m.homeTeamId], resultText: m.result ? String(m.result.homeGoals) : "" },
      b: { teamId: m.awayTeamId, seed: seeds[conf][m.awayTeamId], resultText: m.result ? String(m.result.awayGoals) : "" },
      meta: "Semifinal",
    }));
    const cfm = p.rounds.conferenceFinals.find(m => m.homeConf === conf);
    return {
      wildCard: wcFor(conf),
      roundOne: summaries.length ? summaries.map(s => ({
        a: { teamId: s.higher, seed: seeds[conf][s.higher], resultText: s.wins?.[s.higher] ?? "" },
        b: { teamId: s.lower, seed: seeds[conf][s.lower], resultText: s.wins?.[s.lower] ?? "" },
        meta: "Best of 3",
      })) : [
        { a: { teamId: sBySeed(1)?.teamId, seed: 1 }, b: { name: "WC Winner" }, meta: "Round One" },
        { a: { teamId: sBySeed(2)?.teamId, seed: 2 }, b: { teamId: sBySeed(7)?.teamId, seed: 7 }, meta: "Round One" },
        { a: { teamId: sBySeed(3)?.teamId, seed: 3 }, b: { teamId: sBySeed(6)?.teamId, seed: 6 }, meta: "Round One" },
        { a: { teamId: sBySeed(4)?.teamId, seed: 4 }, b: { teamId: sBySeed(5)?.teamId, seed: 5 }, meta: "Round One" },
      ],
      semis: sf.length ? sf : [{ a: { name: "R1 Winner" }, b: { name: "R1 Winner" }, meta: "Semifinal" }, { a: { name: "R1 Winner" }, b: { name: "R1 Winner" }, meta: "Semifinal" }],
      final: cfm ? [{
        a: { teamId: cfm.homeTeamId, seed: seeds[conf][cfm.homeTeamId], resultText: cfm.result ? String(cfm.result.homeGoals) : "" },
        b: { teamId: cfm.awayTeamId, seed: seeds[conf][cfm.awayTeamId], resultText: cfm.result ? String(cfm.result.awayGoals) : "" },
        meta: "Conference Final",
      }] : [{ a: { name: `${conf} SF Winner` }, b: { name: `${conf} SF Winner` }, meta: "Conference Final" }],
    };
  };

  const cupMatch = p.rounds.cup[0];
  return {
    locked: true,
    currentRound: p.currentRound,
    East: buildConference("East"),
    West: buildConference("West"),
    cup: [cupMatch ? {
      a: { teamId: cupMatch.homeTeamId, seed: seeds[state.teams.find(t => t.id === cupMatch.homeTeamId)?.conference || "East"]?.[cupMatch.homeTeamId], resultText: cupMatch.result ? String(cupMatch.result.homeGoals) : "" },
      b: { teamId: cupMatch.awayTeamId, seed: seeds[state.teams.find(t => t.id === cupMatch.awayTeamId)?.conference || "West"]?.[cupMatch.awayTeamId], resultText: cupMatch.result ? String(cupMatch.result.awayGoals) : "" },
      meta: p.championTeamId ? `Champion: ${byTeamId(p.championTeamId)?.shortName || byTeamId(p.championTeamId)?.name}` : "MLS Cup",
    } : { a: { name: "East Champion" }, b: { name: "West Champion" }, meta: "MLS Cup" }],
  };
}


function renderBudget() {
  const team = getUserTeam(state);
  const cap = getCapSummary(state, team.id);
  const players = getTeamPlayers(state, team.id).sort((a,b) => (designationBudgetCharge(b) - designationBudgetCharge(a)) || (b.overall - a.overall));
  const senior = players.filter(p => p.rosterRole === "Senior");
  const intlPlayers = players.filter(p => takesIntlSlot(p));
  const dps = players.filter(p => p.designation === "DP");
  const tamPlayers = players.filter(p => p.designation === "TAM");
  const u22 = players.filter(p => p.designation === "U22");
  const expiring = getExpiringPlayers(state, team.id);
  return `${pageHead("Roster Construction", "Compact MLS budget board with auto-DP logic, intl slot balance, and fast designation control")}
  <div class="cards budget-cards-compact">
    <div class="card"><div class="card-label">Salary Budget</div><div class="card-value">${formatMoney(team.salaryBudget)}</div><div class="card-note">Budget used ${formatMoney(cap.budgetUsed)}</div></div>
    <div class="card"><div class="card-label">Budget Room</div><div class="card-value">${formatMoney(cap.budgetRoom)}</div><div class="card-note">Senior ${cap.seniorCount}/20</div></div>
    <div class="card"><div class="card-label">Allocation</div><div class="card-value">${formatMoney(team.gam)}</div><div class="card-note">TAM ${formatMoney(team.tam)}</div></div>
    <div class="card"><div class="card-label">Roster Slots</div><div class="card-value">${intlPlayers.length}/${team.internationalSlots}</div><div class="card-note">${dps.length} DP · ${u22.length} U22 · ${tamPlayers.length} TAM</div></div>
  </div>
  <div class="grid-2 compact-grid">
    <div class="panel">
      <div class="panel-head"><h3>Designation Board</h3><span>Higher-than-TAM salaries auto-DP on load</span></div>
      <table class="tight-table"><thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">Salary</th><th>Tag</th><th>Set</th></tr></thead><tbody>
        ${players.slice(0,22).map(p => `<tr>
          <td>${playerLink(p.id, p.name)}</td>
          <td>${escapeHtml(p.position)}</td>
          <td class="num">${p.age}</td>
          <td class="num">${formatMoney(p.contract.salary)}</td>
          <td><span class="badge ${p.designation === 'DP' ? 'blue' : p.designation === 'U22' ? 'green' : p.designation === 'TAM' ? 'yellow' : ''}">${escapeHtml(p.designation || 'Std')}</span></td>
          <td><select class="budget-designation-select" data-id="${p.id}">${[
            { value: "Auto", label: `Auto (${p.designation || "None"})` },
            { value: "None", label: "None" },
            { value: "DP", label: "DP" },
            { value: "U22", label: "U22" },
            { value: "TAM", label: "TAM" },
          ].map(opt => `<option value="${opt.value}" ${((p.designationMode || "auto") === "auto" ? "Auto" : (p.designation || "None"))===opt.value?"selected":""}>${opt.label}</option>`).join('')}</select></td>
        </tr>`).join('')}
      </tbody></table>
      <div class="flex" style="margin-top:10px;"><button id="saveBudgetBtn" class="primary-btn" type="button">Save Designations</button></div>
    </div>
    <div>
      <div class="panel">
        <div class="panel-head"><h3>Roster Sheet</h3><span>Simple overview</span></div>
        <table class="tight-table"><thead><tr><th>Bucket</th><th class="num">Used</th><th class="num">Max</th><th>Names</th></tr></thead><tbody>
          <tr><td>DP</td><td class="num">${dps.length}</td><td class="num">${cap.dpSlots}</td><td>${dps.map(p => playerLink(p.id, p.name)).join(', ') || 'None'}</td></tr>
          <tr><td>U22</td><td class="num">${u22.length}</td><td class="num">${cap.u22Slots}</td><td>${u22.map(p => playerLink(p.id, p.name)).join(', ') || 'None'}</td></tr>
          <tr><td>TAM</td><td class="num">${tamPlayers.length}</td><td class="num">—</td><td>${tamPlayers.map(p => playerLink(p.id, p.name)).join(', ') || 'None'}</td></tr>
          <tr><td>INTL</td><td class="num">${intlPlayers.length}</td><td class="num">${team.internationalSlots}</td><td>${intlPlayers.map(p => playerLink(p.id, p.name)).join(', ') || 'None'}</td></tr>
        </tbody></table>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Budget Charges</h3><span>Top hits</span></div>
        <table class="tight-table"><thead><tr><th>Name</th><th>Pos</th><th>Tag</th><th class="num">Charge</th></tr></thead><tbody>
          ${players.slice(0,12).map(p => `<tr><td>${playerLink(p.id, p.name)}</td><td>${escapeHtml(p.position)}</td><td>${escapeHtml(p.designation || 'Std')}</td><td class="num">${formatMoney(designationBudgetCharge(p))}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Contract Negotiations</h3><span>Expiring players</span></div>
        <table class="tight-table"><thead><tr><th>Name</th><th>Demand</th><th>Your Offer</th><th></th></tr></thead><tbody>
          ${expiring.map(p => { const demand = getContractDemand(state, p); return `<tr><td><span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span> <span class="badge">${escapeHtml(p.position)}</span></td><td>${formatMoney(demand.askSalary)} · ${demand.askYears}yr</td><td><div class="contract-offer-inline"><input type="number" class="contract-years-input" data-id="${p.id}" min="1" max="5" value="${demand.askYears}" /><input type="number" class="contract-salary-input" data-id="${p.id}" min="88025" step="25000" value="${demand.askSalary}" /></div></td><td class="num"><button class="small-btn renegotiate-btn" data-id="${p.id}">Offer</button></td></tr>`; }).join('') || `<tr><td colspan="4">No expiring players right now.</td></tr>`}
        </tbody></table>
      </div>
    </div>
  </div>`;
}

function renderDraft() {
  const phaseIsDraft = state.season.phase === "Draft";
  const draft = state.draft || {};
  const currentPick = phaseIsDraft && draft.order?.length ? getCurrentDraftPick(state) : null;
  const onClockTeam = currentPick ? byTeamId(currentPick.ownerTeamId) : null;
  const board = (draft.pool || []).slice().sort((a, b) => (b.potential + b.overall * 0.5) - (a.potential + a.overall * 0.5));
  const ownedPicks = getUserDraftPicks([state.season.year + 1, state.season.year + 2]);

  return `${pageHead("MLS SuperDraft", phaseIsDraft ? "Live draft room with AI picks and draft-day trades" : "Expanded draft board, larger player pool, and lower-ceiling MLS-ready prospects")}
  ${phaseIsDraft ? `<div class="cards">
    <div class="card"><div class="card-label">On The Clock</div><div class="card-value">${onClockTeam ? teamLink(onClockTeam.id, onClockTeam.shortName || onClockTeam.name) : "—"}</div><div class="card-note">${currentPick ? `Round ${currentPick.round}` : "Waiting"}</div></div>
    <div class="card"><div class="card-label">Pick #</div><div class="card-value">${(draft.currentPickIndex || 0) + 1}</div><div class="card-note">of ${draft.order?.length || 0}</div></div>
    <div class="card"><div class="card-label">Prospects Left</div><div class="card-value">${board.length}</div><div class="card-note">Board still available</div></div><div class="card"><div class="card-label">Pool Size</div><div class="card-value">${draft.pool?.length || 0}</div><div class="card-note">Larger SuperDraft class</div></div>
    <div class="card"><div class="card-label">Your Status</div><div class="card-value">${currentPick?.ownerTeamId === state.userTeamId ? "ON CLOCK" : "WAITING"}</div><div class="card-note">${escapeHtml(getUserTeam(state).shortName || getUserTeam(state).name)}</div></div>
  </div>` : ""}
  <div class="panel">
    <div class="flex">${phaseIsDraft ? `<button id="draftStartBtn" class="primary-btn" type="button">${draft.started ? "Advance To Next User Pick" : "Start Live Draft"}</button>` : `<div class="note">The live draft starts automatically after MLS Cup.</div>`}</div>
  </div>
  <div class="grid-2">
    <div class="panel">
      <div class="panel-head"><h3>Draft Board</h3><span>${board.length}</span></div>
      <table><thead><tr><th>Name</th><th>College</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th>${phaseIsDraft && currentPick?.ownerTeamId===state.userTeamId ? `<th></th>` : ``}</tr></thead><tbody>
        ${board.slice(0, 80).map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.college || "—")}</td><td>${escapeHtml(p.position)}</td><td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td>${phaseIsDraft && currentPick?.ownerTeamId===state.userTeamId ? `<td><button class="small-btn draft-pick-btn" data-id="${p.id}">Draft</button></td>` : ``}</tr>`).join("") || `<tr><td colspan="7">Board not available yet.</td></tr>`}
      </tbody></table>
    </div>
    <div>
      <div class="panel">
        <div class="panel-head"><h3>Your Draft Picks</h3><span>Next 2 drafts</span></div>
        <table><thead><tr><th>Year</th><th>Round</th><th>Original Club</th></tr></thead><tbody>
          ${ownedPicks.map(p => `<tr><td>${p.year}</td><td>${p.round}</td><td>${teamLink(p.originalTeamId, byTeamId(p.originalTeamId)?.name || "—")}</td></tr>`).join("") || `<tr><td colspan="3">No picks tracked yet.</td></tr>`}
        </tbody></table>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Recent Draft Activity</h3><span>Live log</span></div>
        <table><thead><tr><th>Type</th><th>Detail</th></tr></thead><tbody>
          ${(draft.history || []).slice(0, 18).map(item => `<tr><td><span class="badge ${item.kind==="trade"?"yellow":""}">${item.kind === "trade" ? "Trade" : "Pick"}</span></td><td>${escapeHtml(item.text)}</td></tr>`).join("") || `<tr><td colspan="2">No draft activity yet.</td></tr>`}
        </tbody></table>
      </div>
    </div>
  </div>`;
}


function renderRoster() {
  const team = getUserTeam(state);
  const rows = getTeamPlayers(state, team.id).map(p => ({
    ...p,
    positionOrder: positionSortValue(p.position),
    salary: p.contract?.salary || 0,
    expiry: p.contract?.expiresYear || (state.season.year + (p.contract?.yearsLeft || 0)),
    nationality: p.nationality || "Unknown",
  }));
  const sorted = sortRows(rows, tableSortState.roster);
  const rosterSize = rows.length;
  const intlUsed = rows.filter(p => takesIntlSlot(p)).length;
  return `${pageHead("Roster", `${escapeHtml(team.name)} · ${rosterSize} players · ${intlUsed}/${team.internationalSlots} international slots used`)}
  <div class="panel roster-panel-clean">
    <div class="panel-head"><h3>First Team Roster</h3><span>Sortable roster board</span></div>
    <div class="table-scroll"><table class="roster-clean-table"><thead><tr>
      ${makeSortableTh("Name","roster","name")}
      ${makeSortableTh("Pos","roster","position")}
      ${makeSortableTh("Age","roster","age","num")}
      ${makeSortableTh("OVR","roster","overall","num")}
      ${makeSortableTh("POT","roster","potential","num")}
      ${makeSortableTh("Status","roster","designation")}
      ${makeSortableTh("Country","roster","nationality")}
      ${makeSortableTh("Salary","roster","salary","num")}
      ${makeSortableTh("Exp","roster","expiry","num")}
    </tr></thead><tbody>
      ${sorted.map(p => `<tr>
        <td>${playerLink(p.id, p.name)}</td>
        <td><span class="roster-pos-pill">${escapeHtml(p.position)}</span></td>
        <td class="num">${p.age}</td>
        <td class="num">${p.overall}</td>
        <td class="num">${p.potential}</td>
        <td>${escapeHtml(p.designation || (takesIntlSlot(p) ? 'INTL' : 'Standard'))}</td>
        <td>${escapeHtml(p.nationality || 'Unknown')}</td>
        <td class="num">${formatMoney(p.salary)}</td>
        <td class="num">${p.expiry}</td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

function renderTeamPage() {
  const team = byTeamId(selectedTeamId || state.userTeamId) || getUserTeam(state);
  const players = getTeamPlayers(state, team.id).sort((a,b)=>b.overall-a.overall);
  const record = getTeamRecord(team.id);
  const upcoming = state.schedule.filter(m => !m.played && (m.homeTeamId===team.id || m.awayTeamId===team.id)).slice(0,5);
  const topPlayers = players.slice(0,8);
  const cap = getCapSummary(state, team.id);
  const coach = getTeamCoach(team.id);

  return `${pageHead(team.name, `${team.conference} Conference club page`)}
  <div class="club-hero-simple">
    <div class="club-hero-left">
      ${teamLogoMark(team, "club-hero-logo")}
      <div>
        <div class="club-hero-name">${escapeHtml(team.name)}</div>
        <div class="club-hero-sub">${record ? `${record.wins}-${record.draws}-${record.losses} · ${record.points} pts` : team.conference}${coach ? ` · Coach: ${coachLink(coach.id, coach.name)}` : ""}</div>
      </div>
    </div>
    <div class="club-hero-actions">
      ${team.id === state.userTeamId ? `<span class="badge blue">Your club</span>` : ""}
      <button type="button" class="ghost-btn" id="teamBackToDashboardBtn">Dashboard</button>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="card-label">Overall</div><div class="card-value">${teamOverall(state, team.id).toFixed(1)}</div><div class="card-note">First XI</div></div>
    <div class="card"><div class="card-label">Budget Room</div><div class="card-value">${formatMoney(cap.budgetRoom)}</div><div class="card-note">${formatMoney(team.gam)} GAM</div></div>
    <div class="card"><div class="card-label">Roster Size</div><div class="card-value">${players.length}</div><div class="card-note">${team.internationalSlots} intl slots</div></div>
    <div class="card"><div class="card-label">Top Player</div><div class="card-value">${players[0]?.overall || "—"}</div><div class="card-note">${escapeHtml(players[0]?.name || "No roster")}</div></div>
  </div>

  <div class="two-col">
    <div class="panel">
      <div class="panel-head"><h3>Top Players</h3><span>By overall</span></div>
      <table><thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th></tr></thead><tbody>
        ${topPlayers.map(p => `<tr><td>${playerLink(p.id, p.name)}</td><td>${escapeHtml(p.position)}</td><td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td></tr>`).join("")}
      </tbody></table>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Upcoming Matches</h3><span>Next 5</span></div>
      <table><thead><tr><th>Week</th><th>Opponent</th><th>Venue</th></tr></thead><tbody>
        ${upcoming.map(m => {
          const home = m.homeTeamId===team.id;
          const opp = byTeamId(home ? m.awayTeamId : m.homeTeamId);
          return `<tr><td>${m.week}</td><td>${teamLink(opp.id, opp.name)}</td><td>${home ? "Home" : "Away"}</td></tr>`;
        }).join("") || `<tr><td colspan="3">No remaining matches.</td></tr>`}
      </tbody></table>
    </div>
  </div>`;
}



function renderOpenCup() {
  ensureOpenCupState(state);
  const cup = state.openCup;
  const entryObj = ref => {
    const entry = openCupEntryByRef(ref);
    if (!entry) return null;
    if (String(ref).startsWith("mls:")) return { teamId: entry.id, name: entry.name };
    return { name: entry.name };
  };
  const round = (key, label) => `<div class="playoff-round-col"><div class="playoff-round-title">${label}</div>${(cup.rounds[key] || []).map(m => renderBracketMatchup(entryObj(m.homeRef), entryObj(m.awayRef), m.played ? `${m.result.homeGoals}-${m.result.awayGoals}` : `Week ${m.week}`)).join('') || `<div class="bracket-match"><div class="note">TBD</div></div>`}</div>`;
  const champion = cup.championRef ? openCupEntryByRef(cup.championRef)?.name : null;
  return `${pageHead("U.S. Open Cup", `2026-format single-elimination cup`)}
  <div class="panel"><div class="panel-head"><h3>Bracket</h3><span>${champion ? 'Champion crowned' : 'In progress'}</span></div>
    <div class="playoff-bracket-grid">${round('roundOf32','Round of 32')}${round('roundOf16','Round of 16')}${round('quarterfinals','Quarterfinals')}${round('semifinals','Semifinals')}${round('final','Final')}</div>
    ${champion ? `<div class="playoff-champion-banner">🏆 ${escapeHtml(champion)}</div>` : ''}
  </div>`;
}

function renderPlayoffs() {
  const graphic = buildPlayoffGraphicData();
  const projectionSeeds = projectedPlayoffSeeds();

  const seedTable = conf => {
    const rows = state.playoffs ? state.playoffs.conferenceSeeds[conf] : projectionSeeds[conf];
    return `<table><thead><tr><th>Seed</th><th>Club</th><th class="num">Pts</th></tr></thead><tbody>
      ${rows.slice(0, 9).map(r => `<tr><td>${r.seed}</td><td>${teamLink(r.teamId, byTeamId(r.teamId)?.name || "—")}</td><td class="num">${r.points}</td></tr>`).join("")}
    </tbody></table>`;
  };

  const confCol = (title, data) => `<div class="playoff-conference">
    <div class="panel-head"><h3>${title}</h3><span>${graphic.locked ? "Locked field" : "Projected field"}</span></div>
    <div class="playoff-bracket-grid">
      <div class="playoff-round-col"><div class="playoff-round-title">Wild Card</div>${data.wildCard.map(m => renderBracketMatchup(m.a, m.b, m.meta)).join("")}</div>
      <div class="playoff-round-col"><div class="playoff-round-title">Round One</div>${data.roundOne.map(m => renderBracketMatchup(m.a, m.b, m.meta)).join("")}</div>
      <div class="playoff-round-col"><div class="playoff-round-title">Semifinals</div>${data.semis.map(m => renderBracketMatchup(m.a, m.b, m.meta)).join("")}</div>
      <div class="playoff-round-col"><div class="playoff-round-title">Conference Final</div>${data.final.map(m => renderBracketMatchup(m.a, m.b, m.meta)).join("")}</div>
    </div>
  </div>`;

  return `${pageHead("MLS Cup Playoffs", graphic.locked ? `Locked bracket · ${escapeHtml(graphic.currentRound)}` : "Projected bracket updates with the standings every week")}
  <div class="grid-2">
    <div class="panel">${confCol("Eastern Conference", graphic.East)}</div>
    <div class="panel">${confCol("Western Conference", graphic.West)}</div>
  </div>
  <div class="panel" style="margin-top:16px;">
    <div class="panel-head"><h3>MLS Cup</h3><span>${graphic.locked && state.playoffs?.championTeamId ? "Champion crowned" : "Awaiting finalists"}</span></div>
    <div class="playoff-cup-center">${graphic.cup.map(m => renderBracketMatchup(m.a, m.b, m.meta)).join("")}</div>
    ${state.playoffs?.championTeamId ? `<div class="playoff-champion-banner">🏆 ${escapeHtml(byTeamId(state.playoffs.championTeamId)?.name || "Champion")}</div>` : ""}
  </div>
  <div class="grid-2" style="margin-top:16px;">
    <div class="panel"><div class="panel-head"><h3>East Seeds</h3><span>Top 9</span></div>${seedTable("East")}</div>
    <div class="panel"><div class="panel-head"><h3>West Seeds</h3><span>Top 9</span></div>${seedTable("West")}</div>
  </div>`;
}

async function renderSaves() {
  const slots = await listSlots();
  return `${pageHead("Save System","Local slots + JSON export/import")}
  <div class="panel">
    <div class="panel-head"><h3>Save Slots</h3><span>${slots.length}</span></div>
    ${slots.map(slot => `<div class="save-slot-card"><div><strong>${escapeHtml(slot.slot)}</strong></div><div class="note">${new Date(slot.updatedAt).toLocaleString()}</div><div class="save-slot-actions"><button class="small-btn load-slot-btn" data-slot="${slot.slot}">Load</button><button class="small-btn delete-slot-btn" data-slot="${slot.slot}">Delete</button></div></div>`).join("")||`<p class="note">No saves yet.</p>`}
  </div>`;
}

// ── Tactics page ─────────────────────────────────────────────────────────────

const FORMATIONS = {
  "4-3-3":   ["GK","LB","CB","CB","RB","CDM","CM","CM","LW","RW","ST"],
  "4-4-2":   ["GK","LB","CB","CB","RB","LM","CM","CM","RM","ST","ST"],
  "4-2-3-1": ["GK","LB","CB","CB","RB","CDM","CDM","LW","CAM","RW","ST"],
  "3-5-2":   ["GK","CB","CB","CB","LM","CDM","CM","CM","RM","ST","ST"],
  "5-3-2":   ["GK","LB","CB","CB","CB","RB","CDM","CM","CM","ST","ST"],
  "4-1-4-1": ["GK","LB","CB","CB","RB","CDM","LM","CM","CM","RM","ST"],
  "3-4-3":   ["GK","CB","CB","CB","LM","CM","CM","RM","LW","ST","RW"],
};

const ROLES = {
  GK:  ["Goalkeeper","Sweeper Keeper"],
  LB:  ["Attacking Fullback","Defensive Fullback","Wingback"],
  CB:  ["Ball-Playing CB","Stopper","Cover"],
  RB:  ["Attacking Fullback","Defensive Fullback","Wingback"],
  LM:  ["Wide Midfielder","Inside Midfielder","Crossing Outlet"],
  RM:  ["Wide Midfielder","Inside Midfielder","Crossing Outlet"],
  CDM: ["Holding Midfielder","Deep Playmaker","Destroyer"],
  CM:  ["Box-to-Box","Playmaker","Carrier","Defensive CM"],
  CAM: ["Advanced Playmaker","Shadow Striker","Enganche"],
  LW:  ["Inside Forward","Touchline Winger","Inverted Winger"],
  RW:  ["Inside Forward","Touchline Winger","Inverted Winger"],
  ST:  ["Pressing Forward","False 9","Target Man","Poacher"],
};

const MENTALITIES   = ["Attacking","Positive","Balanced","Cautious","Defensive"];
const PRESSING_OPTS = ["High","Medium","Low","Gegenpressing","Counter"];
const DEF_LINES     = ["High Line","Mid Block","Low Block","Offside Trap"];

const FORMATION_LAYOUT = {
  "4-3-3":   [{x:0.50,y:0.87},{x:0.18,y:0.70},{x:0.38,y:0.70},{x:0.62,y:0.70},{x:0.82,y:0.70},{x:0.25,y:0.50},{x:0.50,y:0.47},{x:0.75,y:0.50},{x:0.12,y:0.20},{x:0.88,y:0.20},{x:0.50,y:0.14}],
  "4-4-2":   [{x:0.50,y:0.87},{x:0.18,y:0.70},{x:0.38,y:0.70},{x:0.62,y:0.70},{x:0.82,y:0.70},{x:0.14,y:0.49},{x:0.38,y:0.49},{x:0.62,y:0.49},{x:0.86,y:0.49},{x:0.35,y:0.18},{x:0.65,y:0.18}],
  "4-2-3-1": [{x:0.50,y:0.87},{x:0.18,y:0.70},{x:0.38,y:0.70},{x:0.62,y:0.70},{x:0.82,y:0.70},{x:0.35,y:0.56},{x:0.65,y:0.56},{x:0.14,y:0.34},{x:0.50,y:0.31},{x:0.86,y:0.34},{x:0.50,y:0.13}],
  "3-5-2":   [{x:0.50,y:0.87},{x:0.25,y:0.70},{x:0.50,y:0.70},{x:0.75,y:0.70},{x:0.10,y:0.50},{x:0.30,y:0.50},{x:0.50,y:0.48},{x:0.70,y:0.50},{x:0.90,y:0.50},{x:0.35,y:0.18},{x:0.65,y:0.18}],
  "5-3-2":   [{x:0.50,y:0.87},{x:0.12,y:0.72},{x:0.30,y:0.70},{x:0.50,y:0.70},{x:0.70,y:0.70},{x:0.88,y:0.72},{x:0.25,y:0.47},{x:0.50,y:0.45},{x:0.75,y:0.47},{x:0.35,y:0.18},{x:0.65,y:0.18}],
  "4-1-4-1": [{x:0.50,y:0.87},{x:0.18,y:0.70},{x:0.38,y:0.70},{x:0.62,y:0.70},{x:0.82,y:0.70},{x:0.50,y:0.57},{x:0.14,y:0.40},{x:0.38,y:0.40},{x:0.62,y:0.40},{x:0.86,y:0.40},{x:0.50,y:0.14}],
  "3-4-3":   [{x:0.50,y:0.87},{x:0.25,y:0.70},{x:0.50,y:0.70},{x:0.75,y:0.70},{x:0.20,y:0.50},{x:0.80,y:0.50},{x:0.14,y:0.22},{x:0.86,y:0.22},{x:0.50,y:0.45},{x:0.35,y:0.18},{x:0.65,y:0.18}],
};

function renderTactics() {
  if (!tactics.formation) tactics.formation = "4-3-3";
  const team      = getUserTeam(state);
  const players   = getTeamPlayers(state, team.id);
  const positions = FORMATIONS[tactics.formation] || FORMATIONS["4-3-3"];
  const layout    = FORMATION_LAYOUT[tactics.formation] || FORMATION_LAYOUT["4-3-3"];
  const W = 480, H = 320;

  if (!tactics.lineup || tactics.lineup.length !== positions.length) {
    const used = new Set();
    tactics.lineup = positions.map(pos => {
      const best = players.find(p => p.position === pos && !used.has(p.id))
                || players.find(p => !used.has(p.id));
      if (best) used.add(best.id);
      return { playerId: best?.id||null, role: ROLES[pos]?.[0]||pos, position: pos };
    });
  }

  const dots = positions.map((pos, i) => {
    const slot   = tactics.lineup[i] || {};
    const player = slot.playerId ? players.find(p=>p.id===slot.playerId) : null;
    const lx = (layout[i]?.x||0.5)*W;
    const ly = (layout[i]?.y||0.5)*H;
    const nameShort = player ? (player.name.split(" ").pop().slice(0,10)) : "—";
    return `<g>
      <circle cx="${lx}" cy="${ly}" r="20" fill="rgba(77,163,255,0.20)" stroke="var(--accent)" stroke-width="1.5"/>
      <text x="${lx}" y="${ly-5}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="8.5" font-weight="700" font-family="var(--mono)">${pos}</text>
      <text x="${lx}" y="${ly+7}" text-anchor="middle" dominant-baseline="middle" fill="var(--accent)" font-size="7.5" font-family="var(--sans)">${escapeHtml(nameShort)}</text>
    </g>`;
  }).join("");

  const lineupRows = positions.map((pos, i) => {
    const slot     = tactics.lineup[i] || {};
    const player   = slot.playerId ? players.find(p=>p.id===slot.playerId) : null;
    const roleOpts = (ROLES[pos]||[pos]).map(r => `<option value="${r}" ${slot.role===r?"selected":""}>${r}</option>`).join("");
    const playerOpts = `<option value="">— Select —</option>` +
      players.map(p => `<option value="${p.id}" ${slot.playerId===p.id?"selected":""}>${escapeHtml(p.name)} (${p.position} · ${p.overall})</option>`).join("");
    return `<tr>
      <td><span class="badge">${pos}</span></td>
      <td><select class="tactics-player-select" data-slot="${i}" style="margin:0;padding:5px 8px;font-size:12px;width:100%;">${playerOpts}</select></td>
      <td><select class="tactics-role-select" data-slot="${i}" style="margin:0;padding:5px 8px;font-size:12px;width:100%;">${roleOpts}</select></td>
      <td class="num">${player?player.overall:"—"}</td>
      <td class="num">${player?formatMoney(player.contract.salary):"—"}</td>
    </tr>`;
  }).join("");

  return `${pageHead("Tactics","Formation, lineup & roles · saved per session")}
  <div class="two-col" style="gap:18px;">
    <div>
      <div class="panel">
        <div class="panel-head"><h3>Setup</h3><span>Shape & style</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
          <div><label>Formation</label><select id="tactics-formation" style="margin:0;">${Object.keys(FORMATIONS).map(f=>`<option value="${f}" ${tactics.formation===f?"selected":""}>${f}</option>`).join("")}</select></div>
          <div><label>Mentality</label><select id="tactics-mentality" style="margin:0;">${MENTALITIES.map(m=>`<option value="${m}" ${tactics.mentality===m?"selected":""}>${m}</option>`).join("")}</select></div>
          <div><label>Pressing</label><select id="tactics-pressing" style="margin:0;">${PRESSING_OPTS.map(p=>`<option value="${p}" ${tactics.pressingIntensity===p?"selected":""}>${p}</option>`).join("")}</select></div>
          <div><label>Def. Line</label><select id="tactics-defline" style="margin:0;">${DEF_LINES.map(d=>`<option value="${d}" ${tactics.defensiveLine===d?"selected":""}>${d}</option>`).join("")}</select></div>
        </div>

        <div class="panel-head"><h3>Pitch View</h3><span>${tactics.formation}</span></div>
        <div style="display:flex;justify-content:center;">
          <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:480px;border-radius:10px;">
            <defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1a4a2a"/><stop offset="100%" stop-color="#163d22"/></linearGradient></defs>
            <rect width="${W}" height="${H}" fill="url(#gp)" rx="8"/>
            ${Array.from({length:7},(_,i)=>`<rect x="8" y="${8+i*((H-16)/7)}" width="${W-16}" height="${(H-16)/7}" fill="${i%2===0?"rgba(255,255,255,0.018)":"transparent"}"/>`).join("")}
            <rect x="8" y="8" width="${W-16}" height="${H-16}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.2" rx="4"/>
            <line x1="8" y1="${H/2}" x2="${W-8}" y2="${H/2}" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
            <circle cx="${W/2}" cy="${H/2}" r="38" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>
            <rect x="${W*0.3}" y="8" width="${W*0.4}" height="44" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>
            <rect x="${W*0.3}" y="${H-52}" width="${W*0.4}" height="44" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>
            ${dots}
          </svg>
        </div>
      </div>
    </div>

    <div>
      <div class="panel">
        <div class="panel-head"><h3>Starting XI</h3><span>Players & roles</span></div>
        <table style="table-layout:fixed;width:100%;">
          <thead><tr><th style="width:48px">Pos</th><th>Player</th><th>Role</th><th class="num" style="width:40px">OVR</th><th class="num" style="width:72px">Salary</th></tr></thead>
          <tbody id="tactics-lineup-body">${lineupRows}</tbody>
        </table>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
          <button id="tactics-save-btn" class="primary-btn">💾 Save Lineup</button>
          <button id="tactics-auto-btn" class="ghost-btn">⚡ Auto Best XI</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Match Notes</h3><span>Optional instructions</span></div>
        <textarea id="tactics-notes" placeholder="Set pieces, pressing triggers, individual instructions..." style="width:100%;min-height:90px;background:var(--bg3);border:1px solid var(--line);border-radius:10px;padding:10px;color:var(--text);font-size:13px;resize:vertical;">${escapeHtml(tactics.notes||"")}</textarea>
      </div>
    </div>
  </div>`;
}

// ── Main render ──────────────────────────────────────────────────────────────

async function renderPage() {
  if (!state) return;
  updateMeta();
  let html = "";
  if      (currentPage==="dashboard")      html = renderDashboard();
  else if (currentPage==="roster")         html = renderRoster();
  else if (currentPage==="academy")        html = renderAcademy();
  else if (currentPage==="standings")      html = renderStandings();
  else if (currentPage==="schedule" || currentPage==="teamSchedule") html = renderSchedule();
  else if (currentPage==="weekly")         html = renderWeeklySchedule();
  else if (currentPage==="leaders")        html = renderLeagueLeaders();
  else if (currentPage==="stats")          html = renderStats();
  else if (currentPage==="transactions")   html = renderTransactions();
  else if (currentPage==="trade")          html = renderTrade();
  else if (currentPage==="budget")         html = renderBudget();
  else if (currentPage==="draft")          html = renderDraft();
  else if (currentPage==="team")           html = renderTeamPage();
  else if (currentPage==="playoffs")       html = renderPlayoffs();
  else if (currentPage==="openCup")        html = renderOpenCup();
  else if (currentPage==="tactics")        html = renderTactics();
  else if (currentPage==="leagueFinances") html = renderLeagueFinances();
  else if (currentPage==="leagueHistory")  html = renderLeagueHistory();
  else if (currentPage==="power")          html = renderPowerRankings();
  else if (currentPage==="news")           html = renderNewsFeed();
  else if (currentPage==="freeAgents")     html = renderFreeAgents();
  else if (currentPage==="proposals")      html = renderTradeProposals();
  else if (currentPage==="ratings")        html = renderPlayerRatings();
  else if (currentPage==="injuries")       html = renderInjuries();
  else if (currentPage==="awards")         html = renderAwardRace();
  else if (currentPage==="saves")          html = await renderSaves();
  $("#pageRoot").innerHTML = html;
  bindPageEvents();
  bindSortableHeaders();
}

// ── Page event binding ───────────────────────────────────────────────────────

function bindPageEvents() {
  $$(".sign-fa-btn").forEach(btn => btn.addEventListener("click", async () => {
    const r = signFreeAgent(state, btn.dataset.id, state.userTeamId);
    if (!r.ok) return toast(r.reason,"warn");
    await persist(); toast("Signed.","success"); renderPage();
  }));

  $$(".academy-callup-btn").forEach(btn => btn.addEventListener("click", async () => {
    const r = callUpAcademyPlayer(state, btn.dataset.id, state.userTeamId);
    if (!r.ok) return toast(r.reason,"warn");
    await persist(); toast("Called up.","success"); renderPage();
  }));

  $("#playMyMatchBtn")?.addEventListener("click", async () => {
    const uid = state.userTeamId;
    const next = state.schedule.find(m => !m.played && (m.homeTeamId===uid||m.awayTeamId===uid));
    if (!next) return toast("No match ready.","warn");
    if (next.week !== state.calendar.week) return toast("Finish the current matchday and advance the week before opening a future fixture.","warn");
    if (!next.result) simulateMatch(state, next);
    await playLiveMatch(next);
    await persist(); await renderPage();
  });

  $("#weekPrevBtn")?.addEventListener("click", async () => { weeklyScheduleWeek = Math.max(1, weeklyScheduleWeek - 1); await renderPage(); });
  $("#weekNextBtn")?.addEventListener("click", async () => { weeklyScheduleWeek = Math.min(Math.max(...state.schedule.map(m => m.week)), weeklyScheduleWeek + 1); await renderPage(); });
  $("#weekSelect")?.addEventListener("change", async e => { weeklyScheduleWeek = Number(e.target.value) || 1; await renderPage(); });
  $("#simWeekOnlyBtn")?.addEventListener("click", async () => {
    if (weeklyScheduleWeek !== state.calendar.week) return toast("You cannot simulate a future matchday before the current week is complete.", "warn");
    state.schedule.filter(m => m.week === weeklyScheduleWeek && !m.played).forEach(m => simulateMatch(state, m));
    if (state.calendar.week === weeklyScheduleWeek) { state.calendar.week += 1; state.calendar.absoluteDay += 7; }
    await persist(); await renderPage(); toast(`Matchday ${weeklyScheduleWeek} simulated.`, "success");
  });
  $("#liveWatchWeekBtn")?.addEventListener("click", async () => {
    if (weeklyScheduleWeek !== state.calendar.week) return toast("Future matchdays stay locked until you finish the current week.", "warn");
    const games = state.schedule.filter(m => m.week === weeklyScheduleWeek);
    for (const match of games) {
      if (!match.played) simulateMatch(state, match);
      await playLiveMatch(match);
      if (simAbortRequested) break;
    }
    if (!simAbortRequested && state.calendar.week === weeklyScheduleWeek) { state.calendar.week += 1; state.calendar.absoluteDay += 7; }
    await persist(); await renderPage();
  });
  $$(".watch-week-match-btn").forEach(btn => btn.addEventListener("click", async () => {
    const match = state.schedule.find(m => m.id === btn.dataset.id);
    if (!match) return;
    if (!match.played && match.week !== state.calendar.week) return toast("That matchday has not opened yet.", "warn");
    if (!match.played) simulateMatch(state, match);
    await playLiveMatch(match);
    await persist(); await renderPage();
  }));
  $$(".sim-week-match-btn").forEach(btn => btn.addEventListener("click", async () => {
    const match = state.schedule.find(m => m.id === btn.dataset.id);
    if (!match || match.played) return;
    if (match.week !== state.calendar.week) return toast("Finish the current matchday before simming into the future.", "warn");
    simulateMatch(state, match);
    await persist(); await renderPage();
  }));
  $$(".nav-jump-btn").forEach(btn => btn.addEventListener("click", async () => {
    currentPage = btn.dataset.targetPage || "dashboard";
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === currentPage));
    await renderPage();
  }));


  $("#tradePartnerSelect")?.addEventListener("change", async e => {
    tradePartnerTeamId = e.target.value;
    await renderPage();
  });

  $("#proposeTradeBtn")?.addEventListener("click", async () => {
    const proposal = {
      partnerTeamId: document.getElementById("tradePartnerSelect")?.value,
      outgoingPlayerIds: $$('[data-trade-kind="out-player"]:checked').map(el => el.value),
      incomingPlayerIds: $$('[data-trade-kind="in-player"]:checked').map(el => el.value),
      outgoingPickIds: $$('[data-trade-kind="out-pick"]:checked').map(el => el.value),
      incomingPickIds: $$('[data-trade-kind="in-pick"]:checked').map(el => el.value),
      outgoingGAM: Number(document.getElementById("tradeOutgoingGAM")?.value || 0),
      incomingGAM: Number(document.getElementById("tradeIncomingGAM")?.value || 0),
      outgoingTAM: Number(document.getElementById("tradeOutgoingTAM")?.value || 0),
      incomingTAM: Number(document.getElementById("tradeIncomingTAM")?.value || 0),
      outgoingIntlSlots: Number(document.getElementById("tradeOutgoingIntl")?.value || 0),
      incomingIntlSlots: Number(document.getElementById("tradeIncomingIntl")?.value || 0),
    };
    const result = proposeTrade(state, proposal);
    if (!result.ok) {
      const extra = result.evaluation ? ` Asked: ${formatMoney(result.evaluation.demandedReturn || 0)} / Offered: ${formatMoney(result.evaluation.offeredReturn || 0)}` : "";
      return toast((result.reason || "Trade rejected.") + extra, "warn");
    }
    await persist();
    toast("Trade accepted.", "success");
    await renderPage();
  });

  $("#saveBudgetBtn")?.addEventListener("click", async () => {
    let error = "";
    $$(".budget-designation-select").forEach(sel => {
      const result = setPlayerDesignation(state, sel.dataset.id, sel.value);
      if (!result.ok && !error) error = result.reason || "Could not update designation.";
    });
    if (error) return toast(error, "warn");

    await persist();
    toast("Designations saved.", "success");
    await renderPage();
  });

  $$(".renegotiate-btn").forEach(btn => btn.addEventListener("click", async () => {
    const years = document.querySelector(`.contract-years-input[data-id="${btn.dataset.id}"]`)?.value;
    const salary = document.querySelector(`.contract-salary-input[data-id="${btn.dataset.id}"]`)?.value;
    const result = renegotiateContract(state, btn.dataset.id, years, salary);
    if (!result.ok) return toast(result.reason || "Extension rejected.", "warn");
    await persist();
    toast("Extension agreed.", "success");
    await renderPage();
  }));

  $$(".contract-row-btn").forEach(btn => btn.addEventListener("click", async () => {
    currentPage = "budget";
    await renderPage();
  }));

  $$(".team-link[data-id]").forEach(el => {
    el.oncontextmenu = e => { e.preventDefault(); armOpenInNewTab(el, "team", el.dataset.id); };
    el.onclick = async e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
        await persist();
        clearPendingNewTabTarget();
        return;
      }
      e.preventDefault();
      if (shouldOpenInNewTab("team", el.dataset.id)) return openInNewTab("team", el.dataset.id);
      clearPendingNewTabTarget();
      setSelectedTeam(el.dataset.id);
    };
  });

  $("#teamBackToDashboardBtn")?.addEventListener("click", async () => {
    currentPage = "dashboard";
    await renderPage();
  });

  $("#draftStartBtn")?.addEventListener("click", async () => {
    startDraft(state);
    const result = advanceDraftUntilUserOrEnd(state, false);
    await persist();
    toast(result.waitingOnUser ? "You are on the clock." : "Draft advanced.", result.waitingOnUser ? "warn" : "success");
    await renderPage();
  });

  $$(".draft-pick-btn").forEach(btn => btn.addEventListener("click", async () => {
    const result = makeUserDraftPick(state, btn.dataset.id);
    if (!result.ok) return toast(result.reason || "Could not make pick.", "warn");
    advanceDraftUntilUserOrEnd(state, false);
    await persist();
    toast("Pick submitted.", "success");
    await renderPage();
  }));

  $("#acceptOfferBtn")?.addEventListener("click", async () => {
    acceptPendingOffer(state); await persist(); toast("Accepted.","success"); renderPage();
  });
  $("#rejectOfferBtn")?.addEventListener("click", async () => {
    rejectPendingOffer(state); await persist(); toast("Rejected.","warn"); renderPage();
  });

  $$(".load-slot-btn").forEach(btn => btn.addEventListener("click", async () => {
    const loaded = await loadSlot(btn.dataset.slot);
    if (!loaded) return;
    state = normalizeState(loaded); initGreenCards(state);
    setAppVisible(true); closeOverlay($("#loadOverlay"));
    await renderPage(); toast(`Loaded ${btn.dataset.slot}.`,"success");
  }));

  $$(".delete-slot-btn").forEach(btn => btn.addEventListener("click", async () => {
    await deleteSlot(btn.dataset.slot); toast(`Deleted ${btn.dataset.slot}.`,"warn"); renderPage();
  }));

  $$(".coach-link[data-id]").forEach(el => {
    el.oncontextmenu = e => { e.preventDefault(); armOpenInNewTab(el, "coach", el.dataset.id); };
    el.onclick = async e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
        await persist();
        clearPendingNewTabTarget();
        return;
      }
      e.preventDefault();
      if (shouldOpenInNewTab("coach", el.dataset.id)) return openInNewTab("coach", el.dataset.id);
      clearPendingNewTabTarget();
      renderCoachProfile(el.dataset.id);
    };
  });

  $$(".player-link[data-id]").forEach(el => {
    el.oncontextmenu = e => { e.preventDefault(); armOpenInNewTab(el, "player", el.dataset.id); };
    el.onclick = async e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
        await persist();
        clearPendingNewTabTarget();
        return;
      }
      e.preventDefault();
      if (shouldOpenInNewTab("player", el.dataset.id)) return openInNewTab("player", el.dataset.id);
      clearPendingNewTabTarget();
      openPlayerProfile(el.dataset.id);
    };
  });

  // Tactics
  const tfm = document.getElementById("tactics-formation");
  if (tfm) {
    tfm.addEventListener("change", () => { tactics.formation = tfm.value; tactics.lineup=[]; renderPage(); });
    document.getElementById("tactics-mentality")?.addEventListener("change", e => tactics.mentality = e.target.value);
    document.getElementById("tactics-pressing")?.addEventListener("change",  e => tactics.pressingIntensity = e.target.value);
    document.getElementById("tactics-defline")?.addEventListener("change",   e => tactics.defensiveLine = e.target.value);

    $$(".tactics-player-select").forEach(sel => sel.addEventListener("change", () => {
      tactics.lineup[+sel.dataset.slot].playerId = sel.value||null;
      renderPage();
    }));
    $$(".tactics-role-select").forEach(sel => sel.addEventListener("change", () => {
      tactics.lineup[+sel.dataset.slot].role = sel.value;
    }));

    document.getElementById("tactics-save-btn")?.addEventListener("click", async () => {
      tactics.notes = document.getElementById("tactics-notes")?.value||"";
      await persist(); toast("Lineup saved.","success");
    });
    document.getElementById("tactics-auto-btn")?.addEventListener("click", () => {
      const team = getUserTeam(state);
      const plrs = getTeamPlayers(state, team.id);
      const poss = FORMATIONS[tactics.formation]||FORMATIONS["4-3-3"];
      const used = new Set();
      tactics.lineup = poss.map(pos => {
        const best = plrs.find(p=>p.position===pos&&!used.has(p.id)) || plrs.find(p=>!used.has(p.id));
        if (best) used.add(best.id);
        return { playerId: best?.id||null, role: ROLES[pos]?.[0]||pos, position: pos };
      });
      renderPage(); toast("Auto-selected best XI.","success");
    });
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────

function bindNav() {
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", async () => {
    currentPage = btn.dataset.page;
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b===btn));
    await renderPage();
  }));
}

// ── League creation ──────────────────────────────────────────────────────────

async function createLeagueFromForm() {
  const opts = {
    saveSlot:       $("#saveSlotInput").value.trim()||"slot1",
    userTeamName:   $("#userTeamSelect").value,
    leagueMode:     $("#leagueModeSelect")?.value || "generated",
    salaryBudget:   Number($("#salaryCapInput").value)||6425000,
    gamAnnual:      Number($("#gamInput").value)||3280000,
    tamAnnual:      Number($("#tamInput").value)||2125000,
    academyPerTeam: Number($("#academyInput").value)||8,
  };
  state = normalizeState(createNewState(opts));
  initGreenCards(state);
  await persist();
  closeOverlay($("#setupOverlay"));
  setAppVisible(true);
  currentPage = "dashboard";
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page==="dashboard"));
  await renderPage();
  toast(`League created — ${opts.saveSlot} (${opts.leagueMode === "real" ? "Real MLS Players" : "Auto-generated"}).`,"success");
}

async function openLoadModal() {
  const slots = await listSlots();
  $("#saveSlotsList").innerHTML = slots.length
    ? slots.map(s => `<div class="save-slot-card"><div><strong>${escapeHtml(s.slot)}</strong></div><div class="note">${new Date(s.updatedAt).toLocaleString()}</div><div class="save-slot-actions"><button class="small-btn quick-load-btn" data-slot="${s.slot}">Load</button></div></div>`).join("")
    : `<p class="note">No saves found.</p>`;
  openOverlay($("#loadOverlay"));
  $$(".quick-load-btn").forEach(btn => btn.addEventListener("click", async () => {
    const loaded = await loadSlot(btn.dataset.slot);
    if (!loaded) return toast("Not found.","error");
    state = normalizeState(loaded); initGreenCards(state);
    closeOverlay($("#loadOverlay")); setAppVisible(true);
    await renderPage(); toast(`Loaded ${btn.dataset.slot}.`,"success");
  }));
}

function populateTeamSelect() {
  const all = [...CONFERENCES.East, ...CONFERENCES.West];
  $("#userTeamSelect").innerHTML = all.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
}


async function advanceUntil(predicate, maxSteps = 500) {
  let steps = 0;
  while (!predicate() && steps < maxSteps) {
    advanceOneWeek(state);
    if (state.season.phase === "Offseason") runGreenCardOffseason(state);
    steps += 1;
  }
}
// ── Top-level bindings ───────────────────────────────────────────────────────

function bindTopLevel() {
  $("#showCreateLeagueBtn").addEventListener("click", () => openOverlay($("#setupOverlay")));
  $("#closeSetupBtn").addEventListener("click", () => closeOverlay($("#setupOverlay")));
  $("#showLoadLeagueBtn").addEventListener("click", openLoadModal);
  $("#closeLoadBtn").addEventListener("click", () => closeOverlay($("#loadOverlay")));
  $("#createLeagueBtn").addEventListener("click", createLeagueFromForm);

  $("#saveBtn").addEventListener("click", async () => { await persist(); toast(`Saved to ${state.saveSlot}.`,"success"); });
  $("#exportBtn").addEventListener("click", () => { if (state) downloadJSON(`mls-gm-${state.saveSlot}.json`, state); });
  $("#importInput").addEventListener("change", async e => {
    const f = e.target.files?.[0]; if (!f) return;
    state = normalizeState(await readJSONFile(f)); initGreenCards(state);
    await persist(); setAppVisible(true); await renderPage(); toast("Imported.","success");
  });
  $("#backHomeBtn").addEventListener("click", () => setAppVisible(false));
  $("#themeToggleBtn")?.addEventListener("click", async () => {
    const next = currentTheme() === "light" ? "dark" : "light";
    applyTheme(next);
    if (state) {
      state.settings.theme = next;
      await persist();
    }
  });

  const playBtn = $("#playMenuBtn");
  const playDrop = $("#playMenuDropdown");
  playBtn?.addEventListener("click", e => { e.stopPropagation(); playDrop?.classList.toggle("hidden"); });
  document.addEventListener("click", () => playDrop?.classList.add("hidden"));
  $$(".play-menu-item").forEach(btn => btn.addEventListener("click", async e => {
    e.stopPropagation();
    playDrop?.classList.add("hidden");
    const action = btn.dataset.simAction;
    if (!state) return;
    if (action === "week") return $("#simWeekBtn")?.click();
    if (action === "weeklive") { currentPage = "weekly"; weeklyScheduleWeek = state.calendar.week; await renderPage(); return; }
    if (action === "month") return $("#simMonthBtn")?.click();
    if (action === "tradeDeadline") return $("#simToDraftBtn")?.click();
    if (action === "playoffs") { await advanceUntil(() => state.season.phase === "Playoffs"); await persist(); await renderPage(); return; }
    if (action === "extensions") return $("#simToExtensionsBtn")?.click();
    if (action === "freeAgency") return $("#simToFABtn")?.click();
    if (action === "nextSeason") return $("#simYearBtn")?.click();
  }));

  $("#simOneBtn")?.addEventListener("click", async () => {
    if (!state) return;
    if (state.season.phase !== "Regular Season") {
      advanceOneWeek(state);
      if (state.season.phase==="Offseason") runGreenCardOffseason(state);
      await persist(); await renderPage(); return;
    }
    const uid = state.userTeamId;
    const next = state.schedule.find(m => !m.played && (m.homeTeamId===uid||m.awayTeamId===uid));
    if (!next) { toast("No match found.","warn"); return; }
    if (next.week !== state.calendar.week) { toast("Your next fixture is in a future matchday. Finish the current week first.","warn"); return; }
    simulateMatch(state, next);
    await playLiveMatch(next);
    if (!simAbortRequested) {
      state.schedule.filter(m => m.week===next.week && !m.played).forEach(m => simulateMatch(state,m));
    }
    await persist(); await renderPage();
  });

  $("#simWeekBtn")?.addEventListener("click", async () => {
    if (!state) return;
    advanceOneWeek(state);
    if (state.season.phase==="Offseason") runGreenCardOffseason(state);
    await persist(); await renderPage();
  });

  $("#simMonthBtn")?.addEventListener("click", async () => {
    if (!state) return;
    for (let i = 0; i < 4; i++) {
      advanceOneWeek(state);
      if (state.season.phase==="Offseason") runGreenCardOffseason(state);
      if (state.season.phase !== "Regular Season") break;
    }
    await persist(); await renderPage();
  });

  $("#simSeasonBtn").addEventListener("click", async () => {
    if (!state) return;
    await advanceUntil(() => !["Regular Season","Playoffs"].includes(state.season.phase));
    await persist(); await renderPage();
  });

  $("#simToDraftBtn")?.addEventListener("click", async () => {
    if (!state) return;
    await advanceUntil(() => state.season.phase === "Draft");
    await persist(); await renderPage();
  });

  $("#simToExtensionsBtn")?.addEventListener("click", async () => {
    if (!state) return;
    await advanceUntil(() => state.season.phase === "Contract Extensions");
    await persist(); await renderPage();
  });

  $("#simToFABtn")?.addEventListener("click", async () => {
    if (!state) return;
    await advanceUntil(() => state.season.phase === "Free Agency");
    await persist(); await renderPage();
  });

  $("#simYearBtn").addEventListener("click", async () => {
    if (!state) return;
    const startYear = state.season.year;
    await advanceUntil(() => state.season.phase === "Regular Season" && state.calendar.week === 1 && state.season.year > startYear, 800);
    await persist(); await renderPage();
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  applyTheme(currentTheme());
  populateTeamSelect();
  try { await loadExternalData(); } catch(e) { console.error("External data:", e); }
  bindTopLevel();
  bindNav();
  setAppVisible(false);
  const launched = await applyHashLaunch();
  if (!launched) setAppVisible(false);
}

boot();
