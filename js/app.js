import { $, $$, formatMoney, downloadJSON, readJSONFile, toast } from "./utils.js";
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
} from "./sim.js";
import { CONFERENCES, TEAM_LOGOS } from "./data.js";

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

const tableSortState = {
  roster:        { key: "positionOrder", dir: "asc" },
  standingsEast: { key: "points",        dir: "desc" },
  standingsWest: { key: "points",        dir: "desc" },
  stats:         { key: "goals",         dir: "desc" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function byTeamId(id)   { return state.teams.find(t => t.id === id); }
function byPlayerId(id) {
  return state.players.find(p => p.id === id)
      || state.freeAgents?.find(p => p.id === id);
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
  return `<button type="button" class="text-link team-link" data-id="${teamId}">${escapeHtml(text)}</button>`;
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
  const params = new URLSearchParams();
  params.set("slot", state.saveSlot);
  params.set("route", type);
  params.set("id", id);
  const targetUrl = `${location.pathname}${location.search}#${params.toString()}`;
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
  return true;
}


function getTeamRecord(teamId) {
  const team = byTeamId(teamId);
  const rows = state?.standings?.[team?.conference] || [];
  return rows.find(r => r.teamId === teamId) || null;
}

function normalizeState(st) {
  if (!st) return st;
  st.version = Math.max(st.version || 0, 5);
  st.season ||= { year: 2026, phase: "Regular Season" };
  st.calendar ||= { week: 1, absoluteDay: 0 };
  st.settings ||= {};
  st.settings.salaryBudget ||= 6425000;
  st.settings.gamAnnual ||= 3280000;
  st.settings.tamAnnual ||= 2125000;
  st.settings.academyPerTeam ||= 8;
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

function renderMiniLineups(match) {
  const ht = byTeamId(match.homeTeamId);
  const at = byTeamId(match.awayTeamId);
  const hxi = getTeamPlayers(state, ht.id).slice(0, 11);
  const axi = getTeamPlayers(state, at.id).slice(0, 11);
  const hTitle = document.getElementById("msim-home-lineup-title");
  const aTitle = document.getElementById("msim-away-lineup-title");
  const hList  = document.getElementById("msim-home-lineup");
  const aList  = document.getElementById("msim-away-lineup");
  if (hTitle) hTitle.textContent = `${ht.shortName || ht.name} XI`;
  if (aTitle) aTitle.textContent = `${at.shortName || at.name} XI`;
  const row = p => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line);font-size:11px;"><span>${escapeHtml(p.name)}</span><span>${p.overall}</span></div>`;
  if (hList) hList.innerHTML = hxi.map(row).join("");
  if (aList) aList.innerHTML = axi.map(row).join("");
}

function renderLiveStatBars(stats) {
  const el = document.getElementById("msim-live-stats");
  if (!el) return;
  const rows = [
    ["Possession", `${stats.homePoss||50}%`, `${stats.awayPoss||50}%`],
    ["Shots",      stats.homeShots||0,        stats.awayShots||0],
    ["On Target",  stats.homeSot||0,          stats.awaySot||0],
    ["xG",         (stats.homeXg||0).toFixed(2), (stats.awayXg||0).toFixed(2)],
    ["Yellows",    stats.homeYellows||0,       stats.awayYellows||0],
    ["Reds",       stats.homeReds||0,          stats.awayReds||0],
  ];
  el.innerHTML = rows.map(([label, l, r]) => `
    <div style="display:grid;grid-template-columns:42px 1fr 42px;gap:6px;align-items:center;margin-bottom:7px;font-size:11px;">
      <span style="text-align:center;">${l}</span>
      <div>
        <div style="text-align:center;font-size:9px;color:var(--muted);margin-bottom:2px;">${label}</div>
        <div style="height:5px;background:var(--bg3);border-radius:6px;overflow:hidden;display:flex;">
          <div style="width:50%;background:var(--accent);"></div>
          <div style="width:50%;background:#f97316;"></div>
        </div>
      </div>
      <span style="text-align:center;">${r}</span>
    </div>`).join("");
}


async function showGoalReplay(scorerName, assistName, minute, side = "home") {
  const overlay = document.getElementById("goal-replay-overlay");
  const canvas = document.getElementById("goal-replay-canvas");
  if (!overlay || !canvas) {
    await sleep(Math.min(simSpeed * 1.2, 700));
    return;
  }
  document.getElementById("goal-replay-title").textContent = "Goal Sequence";
  document.getElementById("goal-replay-scorer").textContent = scorerName;
  document.getElementById("goal-replay-minute").textContent = `${minute}'`;
  document.getElementById("goal-replay-assist").textContent = assistName || "Unassisted";
  overlay.classList.add("open");

  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const attackColor = side === "home" ? "#59a8ff" : "#ff9d59";
  const defendColor = side === "home" ? "#ff9d59" : "#59a8ff";

  const playerDot = (x, y, color, scale = 1, dir = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, -8, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-4, -3, 8, 15);
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(dir * 6, 8);
    ctx.moveTo(0, 2);
    ctx.lineTo(-dir * 5, 9);
    ctx.moveTo(-1, 12);
    ctx.lineTo(-4, 20);
    ctx.moveTo(1, 12);
    ctx.lineTo(4, 20);
    ctx.stroke();
    ctx.restore();
  };

  const drawPitch = () => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0b7a39");
    grad.addColorStop(1, "#065229");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.78)";
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, w - 48, h - 48);
    ctx.beginPath(); ctx.moveTo(w / 2, 24); ctx.lineTo(w / 2, h - 24); ctx.stroke();
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 58, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(w * 0.69, h * 0.18, w * 0.18, h * 0.38);
    ctx.strokeRect(w * 0.78, h * 0.29, w * 0.09, h * 0.16);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    for (let i = 0; i < 8; i++) ctx.fillRect(24, 24 + ((h - 48) / 8) * i, w - 48, ((h - 48) / 16));
  };

  const frames = 64;
  for (let i = 0; i <= frames; i++) {
    if (simAbortRequested) break;
    const t = i / frames;
    ctx.clearRect(0, 0, w, h);
    drawPitch();

    const cam = 1 + Math.sin(t * Math.PI) * 0.045;
    ctx.save();
    ctx.translate(w * (1 - cam) / 2, h * (1 - cam) / 2);
    ctx.scale(cam, cam);

    const sx = w * 0.18, sy = h * 0.72;
    const mx = w * 0.52, my = h * 0.44;
    const ex = w * 0.82, ey = h * 0.37;
    const bx = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * mx + t * t * ex;
    const by = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * my + t * t * ey;

    const attackers = [
      [sx - 8, sy + 10, 1.02, 1],
      [w * 0.32 + t * 26, h * 0.60 - t * 14, 0.98, 1],
      [w * 0.44 + t * 24, h * 0.49 - t * 10, 0.96, 1],
      [w * 0.60 + t * 10, h * 0.42 - t * 8, 0.98, 1],
    ];
    const defenders = [
      [w * 0.54 - t * 14, h * 0.52, 0.98, -1],
      [w * 0.64 - t * 22, h * 0.46 + t * 7, 1.0, -1],
      [w * 0.71 - t * 16, h * 0.37 + t * 5, 0.96, -1],
    ];

    attackers.forEach(args => playerDot(args[0], args[1], attackColor, args[2], args[3]));
    defenders.forEach(args => playerDot(args[0], args[1], defendColor, args[2], args[3]));
    playerDot(w * 0.85 - t * 14, h * 0.37 + Math.sin(t * Math.PI) * 18, "#e5e7eb", 1.08, -1);

    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx, my, bx, by);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(bx, by, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();

    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText("GOAL", 30, 42);
    ctx.font = "600 16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.fillText(`${scorerName}${assistName ? ` · Assist ${assistName}` : ""}`, 30, 68);
    await sleep(Math.min(simSpeed * 0.42, 50));
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
  const confirmed = Math.random() > 0.5;

  addSimEvent(minute, `📺 <b>VAR CHECK</b> — Reviewing the incident.`, "color:var(--yellow);font-weight:700;");
  if (!overlay || !screen) {
    await sleep(900);
    addSimEvent(minute, confirmed ? "✅ Goal confirmed by VAR." : "❌ Goal disallowed after VAR review.", `color:${confirmed ? "var(--green)" : "var(--red)"};font-weight:700;`);
    return confirmed;
  }

  screen.innerHTML = `<canvas id="var-canvas" width="740" height="360"></canvas>`;
  const canvas = document.getElementById("var-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;

  const drawFrame = progress => {
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#0a1224");
    bg.addColorStop(1, "#17314e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#0b6a34";
    ctx.fillRect(70, 40, w - 140, h - 80);
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(70, 40, w - 140, h - 80);
    ctx.beginPath();
    ctx.moveTo(w / 2, 40);
    ctx.lineTo(w / 2, h - 40);
    ctx.stroke();

    const defLineX = w * 0.58 + Math.sin(progress * Math.PI * 2) * 2;
    ctx.strokeStyle = "rgba(255,80,80,.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(defLineX, 48);
    ctx.lineTo(defLineX, h - 48);
    ctx.stroke();

    const attX = w * 0.60 + progress * 18;
    const attY = h * 0.48 - progress * 4;
    const defX = w * 0.54;
    const defY = h * 0.52;
    const drawPlayer = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y - 10, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 7, y - 4, 14, 22);
      ctx.fillRect(x - 11, y + 18, 6, 16);
      ctx.fillRect(x + 5, y + 18, 6, 16);
    };
    drawPlayer(attX, attY, "#59a8ff");
    drawPlayer(defX, defY, "#ff9d59");
    drawPlayer(w * 0.72 - progress * 10, h * 0.42 + progress * 3, "#ff9d59");

    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(attX, attY - 12);
    ctx.lineTo(defLineX, attY - 12);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255,255,255,.86)";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText("VAR", 24, 32);
    ctx.font = "600 14px sans-serif";
    ctx.fillText(scorerName ? `${scorerName} under review` : "Checking attacking phase", 24, 56);

    const scanY = 48 + ((h - 96) * progress);
    const grad2 = ctx.createLinearGradient(0, scanY - 18, 0, scanY + 18);
    grad2.addColorStop(0, "rgba(77,163,255,0)");
    grad2.addColorStop(0.5, "rgba(77,163,255,.30)");
    grad2.addColorStop(1, "rgba(77,163,255,0)");
    ctx.fillStyle = grad2;
    ctx.fillRect(74, scanY - 18, w - 148, 36);
  };

  overlay.classList.add("open");
  badge.textContent = "Checking";
  desc.textContent = "Possible offside / foul in the attacking phase";
  for (let i = 0; i <= 22; i++) {
    if (simAbortRequested) break;
    const progress = i / 22;
    drawFrame(progress);
    scan.textContent = ["Selecting angle", "Drawing defensive line", "Tracking attacker", "Reviewing APP"][i % 4];
    await sleep(85);
  }
  badge.textContent = confirmed ? "Goal stands" : "No goal";
  desc.textContent = confirmed ? "After review, the attacking player is onside." : "The attacker is beyond the last defender. Goal overturned.";
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

  if (el("sim-home-name")) el("sim-home-name").textContent = ht.shortName || ht.name;
  if (el("sim-away-name")) el("sim-away-name").textContent = at.shortName || at.name;
  if (el("sim-minute")) el("sim-minute").textContent = "Kickoff";
  if (el("sim-score")) el("sim-score").textContent = "0 – 0";
  if (el("sim-events")) el("sim-events").innerHTML = "";
  if (el("sim-progress-fill")) el("sim-progress-fill").style.width = "0%";
  if (el("sim-close-btn")) el("sim-close-btn").style.display = "";

  renderMiniLineups(match);

  const result = match.result || {
    homeGoals:0, awayGoals:0, homeXg:0, awayXg:0,
    homeShots:0, awayShots:0, homeSot:0, awaySot:0,
    homePoss:50, awayPoss:50,
    homeYellows:0, awayYellows:0, homeReds:0, awayReds:0,
    events:[],
  };

  renderLiveStatBars(result);

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

    if (Math.random() < 0.18) addSimEvent(minute, commentary[Math.floor(Math.random() * commentary.length)]);

    while (ei < sortedEvents.length && sortedEvents[ei].minute <= minute) {
      const ev = sortedEvents[ei];
      const scorer = ev.scorerId ? byPlayerId(ev.scorerId) : null;
      const assist = ev.assistId ? byPlayerId(ev.assistId) : null;
      const pName = scorer?.name || "Unknown";

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
    await sleep(simSpeed);
  }

  simInProgress = false;
  if (simAbortRequested) {
    overlay.classList.remove("open");
    document.getElementById("goal-replay-overlay")?.classList.remove("open");
    document.getElementById("var-overlay")?.classList.remove("open");
    return;
  }

  if (el("sim-minute")) el("sim-minute").textContent = "Full Time";
  if (el("sim-progress-fill")) el("sim-progress-fill").style.width = "100%";
  addSimEvent(90,
    `<b>Full Time.</b> ${escapeHtml(ht.name)} ${result.homeGoals}–${result.awayGoals} ${escapeHtml(at.name)}`,
    "color:var(--accent);font-weight:700;");
  await sleep(400);
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
  const a = p.attributes;
  const d = p.detailed || {};
  const s = p.stats;
  const tag = getPlayerTag(p);
  const intlBadge = isUSOrCanadian(p)
    ? `<span class="badge green">Domestic</span>`
    : p.hasGreenCard ? `<span class="badge green">Green Card</span>` : `<span class="badge yellow">INTL Slot</span>`;

  const columns = [
    ["Physical", d.physical || {}],
    [p.position === "GK" ? "Goalkeeping" : "Technical", p.position === "GK" ? (d.goalkeeping || {}) : (d.technical || {})],
    [p.position === "GK" ? "Distribution" : "Defending", p.position === "GK" ? { kicking: d.goalkeeping?.kicking, command: d.goalkeeping?.command, vision: d.technical?.vision, shortPassing: d.technical?.shortPassing } : (d.defending || {})],
  ];

  const seasonStats = p.position === "GK"
    ? [["GP", s.gp], ["GS", s.gs], ["Min", s.min], ["CS", s.cleanSheets], ["GA", s.ga]]
    : [["GP", s.gp], ["GS", s.gs], ["Min", s.min], ["G", s.goals], ["A", s.assists], ["xG", (s.xg || 0).toFixed(1)], ["YC", s.yellows], ["RC", s.reds]];

  const demand = p.clubId === state.userTeamId ? getContractDemand(state, p) : null;

  const html = `<div id="playerProfileOverlay" class="pp-overlay">
    <div class="pp-modal pp-modal-wide">
      <button class="pp-close" id="ppClose">×</button>
      <div class="pp-simple-head">
        <div class="pp-simple-left">
          <div class="pp-logo-slot">${team ? teamLogoMark(team, "profile-team-logo") : ""}</div>
          <div>
            <div class="pp-player-name">${escapeHtml(p.name)}</div>
            <div class="pp-club-name">${team ? teamLink(team.id, team.name) : "Free Agent"} · ${escapeHtml(p.position)}</div>
            <div class="pp-badges">
              <span class="badge blue">${escapeHtml(tag)}</span>
              ${intlBadge}
              ${p.homegrown ? `<span class="badge green">Homegrown</span>` : ""}
              ${(p.traits || []).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join("")}
            </div>
          </div>
        </div>
        <div class="pp-simple-right">
          <div class="rating-chip"><span>Overall</span><strong>${p.overall}</strong></div>
          <div class="rating-chip"><span>Potential</span><strong>${p.potential}</strong></div>
          <div class="rating-chip"><span>Age</span><strong>${p.age}</strong></div>
        </div>
      </div>

      <div class="pp-grid-3">
        ${columns.map(([title, obj]) => `<div class="pp-rating-col">
          <div class="pp-section-title">${escapeHtml(title)}</div>
          ${Object.entries(obj).map(([k,v]) => `<div class="pp-rating-row"><span>${escapeHtml(k.replace(/([A-Z])/g, " $1").replace(/^./, m => m.toUpperCase()))}</span><strong>${v ?? "—"}</strong></div>`).join("")}
        </div>`).join("")}
      </div>

      <div class="pp-info-grid" style="margin-top:14px;">
        <div class="pp-info-box"><div class="pp-info-lbl">Salary</div><div class="pp-info-val">${formatMoney(p.contract.salary)}</div></div>
        <div class="pp-info-box"><div class="pp-info-lbl">Years Left</div><div class="pp-info-val">${p.contract.yearsLeft}</div></div>
        <div class="pp-info-box"><div class="pp-info-lbl">Contract Thru</div><div class="pp-info-val">${p.contract.expiresYear || (state.season.year + p.contract.yearsLeft)}</div></div>
        <div class="pp-info-box"><div class="pp-info-lbl">Foot</div><div class="pp-info-val">${escapeHtml(p.preferredFoot || "Right")}</div></div>
        <div class="pp-info-box"><div class="pp-info-lbl">Morale</div><div class="pp-info-val">${p.morale || "—"}</div></div>
        <div class="pp-info-box"><div class="pp-info-lbl">Role</div><div class="pp-info-val">${escapeHtml(p.rosterRole || "—")}</div></div>
      </div>

      <div class="panel" style="margin-top:14px;">
        <div class="panel-head"><h3>Season Stats</h3><span>${escapeHtml(state.season.phase)}</span></div>
        <div class="pp-stats-row">
          ${seasonStats.map(([lbl,val]) => `<div class="pp-stat-box"><div class="pp-stat-val">${val}</div><div class="pp-stat-lbl">${lbl}</div></div>`).join("")}
        </div>
      </div>

      ${demand ? `<div class="panel" style="margin-top:14px;">
        <div class="panel-head"><h3>Contract Outlook</h3><span>User club only</span></div>
        <div class="info-stack">
          <div class="info-row"><span>Expected salary</span><strong>${formatMoney(demand.askSalary)}</strong></div>
          <div class="info-row"><span>Expected length</span><strong>${demand.askYears} years</strong></div>
          <div class="info-row"><span>Status</span><strong>${p.contract.yearsLeft <= 1 ? "Extension priority" : "Under control"}</strong></div>
        </div>
      </div>` : ""}
    </div>
  </div>`;

  document.getElementById("playerProfileOverlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("ppClose").addEventListener("click", () => document.getElementById("playerProfileOverlay")?.remove());
  document.getElementById("playerProfileOverlay").addEventListener("click", e => {
    if (e.target.id === "playerProfileOverlay") document.getElementById("playerProfileOverlay")?.remove();
  });
  document.querySelectorAll("#playerProfileOverlay .team-link").forEach(el => {
    el.oncontextmenu = e => {
      e.preventDefault();
      armOpenInNewTab(el, "team", el.dataset.id);
    };
    el.onclick = async e => {
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
  const confRows = state.standings[team.conference];
  const rank = confRows.findIndex(r => r.teamId === team.id) + 1;
  const upcoming = state.schedule
    .filter(m => !m.played && (m.homeTeamId===team.id || m.awayTeamId===team.id))
    .slice(0,5);
  const awards = state.awardsHistory[state.awardsHistory.length-1];
  const teamPlayers = getTeamPlayers(state, team.id);
  const intlUsed = teamPlayers.filter(p => takesIntlSlot(p)).length;
  const record = getTeamRecord(team.id);

  return `${pageHead("Dashboard", `${team.conference} Conference · simplified club overview`)}
  <div class="club-hero-simple">
    <div class="club-hero-left">
      ${teamLogoMark(team, "club-hero-logo")}
      <div>
        <div class="club-hero-name">${escapeHtml(team.name)}</div>
        <div class="club-hero-sub">${record ? `${record.wins}-${record.draws}-${record.losses} · ${rank}${rank===1?"st":rank===2?"nd":rank===3?"rd":"th"} in ${team.conference}` : team.conference}</div>
      </div>
    </div>
    <div class="club-hero-actions">
      <button id="playMyMatchBtn" class="primary-btn" type="button">Play Next Match</button>
      <button class="ghost-btn team-link" type="button" data-id="${team.id}">Club Page</button>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="card-label">Team Overall</div><div class="card-value">${teamOverall(state, team.id).toFixed(1)}</div><div class="card-note">First XI</div></div>
    <div class="card"><div class="card-label">Budget Room</div><div class="card-value">${formatMoney(cap.budgetRoom)}</div><div class="card-note">${formatMoney(cap.budgetUsed)} used</div></div>
    <div class="card"><div class="card-label">Intl Slots</div><div class="card-value">${intlUsed}/${cap.intlTotal}</div><div class="card-note">${cap.dpCount} DP · ${cap.u22Count} U22</div></div>
    <div class="card"><div class="card-label">Current Phase</div><div class="card-value">${escapeHtml(state.season.phase)}</div><div class="card-note">Week ${state.calendar.week}</div></div>
  </div>

  <div class="two-col">
    <div>
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

      <div class="panel">
        <div class="panel-head"><h3>Recent Transactions</h3><span>Latest</span></div>
        <table><thead><tr><th>Type</th><th>Detail</th></tr></thead><tbody>
          ${state.transactions.slice(0,10).map(tx => `<tr><td><span class="badge">${escapeHtml(tx.type)}</span></td><td>${escapeHtml(tx.text)}</td></tr>`).join("")}
        </tbody></table>
      </div>
    </div>

    <div>
      <div class="panel">
        <div class="panel-head"><h3>${escapeHtml(team.conference)} Table</h3><span>Playoff line</span></div>
        <table><thead><tr><th>#</th><th>Club</th><th class="num">GP</th><th class="num">Pts</th><th class="num">GD</th></tr></thead><tbody>
          ${confRows.slice(0,10).map((r,i) => `<tr>
            <td>${i+1}</td>
            <td>${teamLink(r.teamId, byTeamId(r.teamId).name)}${r.teamId===team.id ? ` <span class="badge blue">You</span>` : ""}</td>
            <td class="num">${r.played}</td>
            <td class="num">${r.points}</td>
            <td class="num">${r.gd>0?"+":""}${r.gd}</td>
          </tr>`).join("")}
        </tbody></table>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Front Office Notes</h3><span>League windows</span></div>
        <div class="info-stack">
          <div class="info-row"><span>Next sim targets</span><strong>Match · Week · Month · Draft · Extensions · Free Agency</strong></div>
          <div class="info-row"><span>Schedule</span><strong>34 regular season matches per club</strong></div>
          <div class="info-row"><span>Latest awards</span><strong>${escapeHtml(awards ? `${awards.year} MVP: ${awards.mvp}` : "No awards yet")}</strong></div>
          ${state.pendingOffer ? `<div class="info-row"><span>Incoming offer</span><strong>${escapeHtml(byPlayerId(state.pendingOffer.playerId)?.name||"Unknown")} · ${formatMoney(state.pendingOffer.amount)}</strong></div>` : `<div class="info-row"><span>Incoming offer</span><strong>None</strong></div>`}
        </div>
        ${state.pendingOffer ? `<div class="flex" style="margin-top:12px;"><button id="acceptOfferBtn" class="primary-btn">Accept</button><button id="rejectOfferBtn" class="ghost-btn">Reject</button></div>` : ``}
      </div>
    </div>
  </div>`;
}

function renderRoster() {
  const team = getUserTeam(state);
  const players = getTeamPlayers(state, team.id);
  const cap = getCapSummary(state, team.id);
  const intlUsed = players.filter(p => takesIntlSlot(p)).length;
  const expiring = getExpiringPlayers(state, team.id);

  const rows = players.map(p => ({
    id: p.id, name: p.name, position: p.position,
    positionOrder: getPositionOrder(p.position),
    age: p.age, overall: p.overall, potential: p.potential,
    salary: p.contract.salary, yearsLeft: p.contract.yearsLeft,
    morale: p.morale, role: p.rosterRole,
    tag: getPlayerTag(p), intl: takesIntlSlot(p),
    injury: p.injuryMeta?.type || (p.injuredUntil ? "Inj" : ""),
    traits: (p.traits || []).join(", "),
  }));

  const sorted = sortRows(rows, tableSortState.roster);
  const groups = [
    ["Goalkeepers", sorted.filter(p => p.position==="GK")],
    ["Back Line", sorted.filter(p => ["LB","CB","RB"].includes(p.position))],
    ["Wide Midfield", sorted.filter(p => ["LM","RM"].includes(p.position))],
    ["Central Midfield", sorted.filter(p => ["CDM","CM","CAM"].includes(p.position))],
    ["Attackers", sorted.filter(p => ["LW","RW","ST"].includes(p.position))],
  ];

  const grp = (label, group) => !group.length ? "" : `<tr><td colspan="12" class="roster-group-row">${label}</td></tr>
    ${group.map(p => `<tr>
      <td><strong class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</strong>${p.injury?` <span class="badge red">${escapeHtml(p.injury)}</span>`:""}</td>
      <td><span class="badge">${escapeHtml(p.position)}</span></td>
      <td class="num">${p.age}</td>
      <td class="num">${p.overall}</td>
      <td class="num">${p.potential}</td>
      <td class="num">${formatMoney(p.salary)}</td>
      <td class="num">${p.yearsLeft}yr</td>
      <td>${escapeHtml(p.role)}</td>
      <td>${escapeHtml((p.traits || "").slice(0, 26) || "—")}</td>
      <td><span class="badge ${p.tag==="DP"?"blue":p.tag==="HG"||p.tag==="DOM"||p.tag==="GC"?"green":p.tag==="INTL"?"yellow":""}">${escapeHtml(p.tag)}</span></td>
      <td class="num">${p.intl?"<span class='badge yellow'>INTL</span>":"<span class='badge green'>✓</span>"}</td>
      <td class="num">${p.yearsLeft <= 1 ? `<button class="small-btn contract-row-btn" data-id="${p.id}">Extend</button>` : ""}</td>
    </tr>`).join("")}`;

  return `${pageHead("Roster", "Specific positions, simpler tables, click player names for full profile")}
  <div class="cards">
    <div class="card"><div class="card-label">Senior</div><div class="card-value">${cap.seniorCount}</div><div class="card-note">Max 20</div></div>
    <div class="card"><div class="card-label">Supplemental</div><div class="card-value">${cap.supplementalCount}</div><div class="card-note">Cap exempt</div></div>
    <div class="card"><div class="card-label">Reserve</div><div class="card-value">${cap.reserveCount}</div><div class="card-note">Depth</div></div>
    <div class="card"><div class="card-label">Expiring</div><div class="card-value">${expiring.length}</div><div class="card-note">${intlUsed}/${cap.intlTotal} intl slots used</div></div>
  </div>

  <div class="panel">
    <div class="panel-head"><h3>Squad List</h3><span>${players.length} players</span></div>
    <table><thead><tr>
      ${makeSortableTh("Name","roster","name")}
      ${makeSortableTh("Pos","roster","positionOrder")}
      ${makeSortableTh("Age","roster","age","num")}
      ${makeSortableTh("OVR","roster","overall","num")}
      ${makeSortableTh("POT","roster","potential","num")}
      ${makeSortableTh("Salary","roster","salary","num")}
      ${makeSortableTh("Contract","roster","yearsLeft","num")}
      ${makeSortableTh("Role","roster","role")}
      <th>Traits</th>
      ${makeSortableTh("Tag","roster","tag")}
      <th class="num">Intl</th>
      <th class="num"></th>
    </tr></thead><tbody>
      ${groups.map(([label, group]) => grp(label, group)).join("")}
    </tbody></table>
  </div>

  <div class="two-col">
    <div class="panel">
      <div class="panel-head"><h3>Free Agency</h3><span>Best available</span></div>
      <table><thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">Salary</th><th></th></tr></thead><tbody>
        ${state.freeAgents.slice().sort((a,b)=>b.overall-a.overall).slice(0,24).map(p => `<tr>
          <td><span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span></td>
          <td>${escapeHtml(p.position)}</td>
          <td class="num">${p.age}</td>
          <td class="num">${p.overall}</td>
          <td class="num">${formatMoney(p.contract.salary)}</td>
          <td class="num"><button class="small-btn sign-fa-btn" data-id="${p.id}">Sign</button></td>
        </tr>`).join("")}
      </tbody></table>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Contract Watch</h3><span>One year or less</span></div>
      <table><thead><tr><th>Name</th><th>Pos</th><th class="num">OVR</th><th>Demand</th><th></th></tr></thead><tbody>
        ${expiring.map(p => {
          const demand = getContractDemand(state, p);
          return `<tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.position)}</td>
            <td class="num">${p.overall}</td>
            <td>${formatMoney(demand.askSalary)} · ${demand.askYears}yr</td>
            <td class="num"><button class="small-btn contract-row-btn" data-id="${p.id}">Negotiate</button></td>
          </tr>`;
        }).join("") || `<tr><td colspan="5">No urgent renewals.</td></tr>`}
      </tbody></table>
    </div>
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
  return `${pageHead("Schedule","34-match regular season")}
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
  }));
  const sorted = sortRows(rows, tableSortState.stats);
  return `${pageHead("Player Stats","League leaders")}
  <div class="panel"><table>
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
      ${sorted.slice(0,160).map(p => `<tr>
        <td><span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span></td>
        <td>${teamLink(p.clubId, p.club)}</td><td>${escapeHtml(p.pos)}</td>
        <td class="num">${p.gp}</td><td class="num">${p.goals}</td><td class="num">${p.assists}</td>
        <td class="num">${(p.xg||0).toFixed(1)}</td><td class="num">${p.yellows}</td><td class="num">${p.reds}</td>
      </tr>`).join("")}
    </tbody></table></div>`;
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
  const players = getTeamPlayers(state, team.id);
  const senior = players.filter(p => p.rosterRole === "Senior");
  const supplemental = players.filter(p => p.rosterRole === "Supplemental");
  const reserve = players.filter(p => p.rosterRole === "Reserve");
  const intlPlayers = players.filter(p => takesIntlSlot(p));
  const dps = players.filter(p => p.designation === "DP");
  const tamPlayers = players.filter(p => p.designation === "TAM");
  const u22 = players.filter(p => p.designation === "U22");
  const expiring = getExpiringPlayers(state, team.id);

  const rosterRow = (p, className = "") => `<tr class="${className}">
    <td><span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span></td>
    <td>${escapeHtml(p.designation || (p.homegrown ? "HG" : ""))}</td>
    <td>${p.injuredUntil ? escapeHtml(p.injuryMeta?.type || "Unavailable") : ""}</td>
    <td class="num">${p.contract.expiresYear || (state.season.year + (p.contract.yearsLeft || 0))}</td>
    <td class="num">${Math.max(0, p.contract.yearsLeft || 0)}</td>
  </tr>`;

  const distributionRow = (label, used, max, note) => `<tr><td>${label}</td><td class="num">${used}</td><td class="num">${max}</td><td>${note}</td></tr>`;
  const chargeRows = players
    .slice()
    .sort((a, b) => designationBudgetCharge(b) - designationBudgetCharge(a))
    .slice(0, 10)
    .map(p => `<tr><td><span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span></td><td>${escapeHtml(p.position)}</td><td>${escapeHtml(p.designation || "Std")}</td><td class="num">${formatMoney(designationBudgetCharge(p))}</td></tr>`)
    .join("");

  return `${pageHead("Roster Construction", "Simplified roster sheet with slot usage, allocation distribution, and negotiations")}
  <div class="roster-sheet">
    <div class="roster-sheet-brand">
      ${teamLogoMark(team, "roster-sheet-logo")}
      <div class="roster-sheet-club">${escapeHtml(team.name)}</div>
      <div class="roster-sheet-league">MLS roster construction model</div>
      <div class="roster-sheet-summary">
        <div><span>Salary Budget</span><strong>${formatMoney(team.salaryBudget)}</strong></div>
        <div><span>Budget Used</span><strong>${formatMoney(cap.budgetUsed)}</strong></div>
        <div><span>Budget Room</span><strong>${formatMoney(cap.budgetRoom)}</strong></div>
        <div><span>Senior Spots</span><strong>${cap.seniorCount}/20</strong></div>
      </div>
    </div>

    <div class="roster-sheet-main">
      <div class="panel tight-panel">
        <div class="sheet-section-title">Senior Roster</div>
        <table class="sheet-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th class="num">Contract Thru</th><th class="num">Years Left</th></tr></thead><tbody>
          ${senior.map(p => rosterRow(p, p.designation==="DP" ? "sheet-dp" : p.designation==="U22" ? "sheet-u22" : p.designation==="TAM" ? "sheet-tam" : "")).join("")}
        </tbody></table>

        <div class="sheet-section-title" style="margin-top:14px;">Supplemental Roster</div>
        <table class="sheet-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th class="num">Contract Thru</th><th class="num">Years Left</th></tr></thead><tbody>
          ${supplemental.map(p => rosterRow(p)).join("") || `<tr><td colspan="5">No players.</td></tr>`}
        </tbody></table>

        <div class="sheet-section-title" style="margin-top:14px;">Reserve / Off-Roster</div>
        <table class="sheet-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th class="num">Contract Thru</th><th class="num">Years Left</th></tr></thead><tbody>
          ${reserve.map(p => rosterRow(p)).join("") || `<tr><td colspan="5">No players.</td></tr>`}
        </tbody></table>
      </div>

      <div class="sheet-side">
        <div class="panel tight-panel">
          <div class="sheet-section-title">Slot Distribution</div>
          <table class="sheet-mini-table"><thead><tr><th>Type</th><th class="num">Used</th><th class="num">Max</th><th>Notes</th></tr></thead><tbody>
            ${distributionRow("Intl", intlPlayers.length, team.internationalSlots, `${Math.max(0, team.internationalSlots - intlPlayers.length)} open`)}
            ${distributionRow("DP", dps.length, cap.dpSlots, `${Math.max(0, cap.dpSlots - dps.length)} open`)}
            ${distributionRow("U22", u22.length, cap.u22Slots, `${Math.max(0, cap.u22Slots - u22.length)} open`)}
            ${distributionRow("TAM", tamPlayers.length, "—", "Budget relief")}
          </tbody></table>
        </div>

        <div class="panel tight-panel">
          <div class="sheet-section-title">${state.season.year} Allocation Money</div>
          <div class="sheet-summary-card">
            <div><span>GAM Available</span><strong>${formatMoney(team.gam)}</strong></div>
            <div><span>TAM Available</span><strong>${formatMoney(team.tam)}</strong></div>
            <div><span>Intl Slots</span><strong>${intlPlayers.length}/${team.internationalSlots}</strong></div>
            <div><span>DP / U22</span><strong>${dps.length}/${cap.dpSlots} · ${u22.length}/${cap.u22Slots}</strong></div>
          </div>
        </div>

        <div class="panel tight-panel">
          <div class="sheet-section-title">Designation Lists</div>
          <table class="sheet-mini-table"><thead><tr><th>Bucket</th><th>Names</th></tr></thead><tbody>
            <tr><td>DP</td><td>${dps.map(p => `<span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span>`).join(", ") || "None"}</td></tr>
            <tr><td>U22</td><td>${u22.map(p => `<span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span>`).join(", ") || "None"}</td></tr>
            <tr><td>TAM</td><td>${tamPlayers.map(p => `<span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span>`).join(", ") || "None"}</td></tr>
            <tr><td>INTL</td><td>${intlPlayers.map(p => `<span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span>`).join(", ") || "None"}</td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  </div>

  <div class="two-col" style="margin-top:16px;">
    <div class="panel">
      <div class="panel-head"><h3>Budget Charge Board</h3><span>Top roster charges</span></div>
      <table><thead><tr><th>Name</th><th>Pos</th><th>Tag</th><th class="num">Budget Charge</th></tr></thead><tbody>
        ${chargeRows || `<tr><td colspan="4">No players.</td></tr>`}
      </tbody></table>
      <div class="subtle-divider"></div>
      <div class="panel-head"><h3>Designation Manager</h3><span>Roster labels only</span></div>
      <table><thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th>Designation</th></tr></thead><tbody>
        ${players.map(p => `<tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.position)}</td>
          <td class="num">${p.age}</td>
          <td class="num">${p.overall}</td>
          <td>
            <select class="budget-designation-select" data-id="${p.id}">
              ${["None","DP","U22","TAM"].map(opt => `<option value="${opt}" ${(p.designation || "None")===opt?"selected":""}>${opt}</option>`).join("")}
            </select>
          </td>
        </tr>`).join("")}
      </tbody></table>
      <div class="flex" style="margin-top:12px;"><button id="saveBudgetBtn" class="primary-btn" type="button">Save Designations</button></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Contract Negotiations</h3><span>Only expiring players</span></div>
      <table><thead><tr><th>Name</th><th>Demand</th><th>Your Offer</th><th></th></tr></thead><tbody>
        ${expiring.map(p => {
          const demand = getContractDemand(state, p);
          return `<tr>
            <td>${escapeHtml(p.name)} <span class="badge">${escapeHtml(p.position)}</span></td>
            <td>${formatMoney(demand.askSalary)} · ${demand.askYears}yr</td>
            <td>
              <div class="contract-offer-inline">
                <input type="number" class="contract-years-input" data-id="${p.id}" min="1" max="5" value="${demand.askYears}" />
                <input type="number" class="contract-salary-input" data-id="${p.id}" min="88025" step="25000" value="${demand.askSalary}" />
              </div>
            </td>
            <td class="num"><button class="small-btn renegotiate-btn" data-id="${p.id}">Offer</button></td>
          </tr>`;
        }).join("") || `<tr><td colspan="4">No expiring players right now.</td></tr>`}
      </tbody></table>
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


function renderTeamPage() {
  const team = byTeamId(selectedTeamId || state.userTeamId) || getUserTeam(state);
  const players = getTeamPlayers(state, team.id).sort((a,b)=>b.overall-a.overall);
  const record = getTeamRecord(team.id);
  const upcoming = state.schedule.filter(m => !m.played && (m.homeTeamId===team.id || m.awayTeamId===team.id)).slice(0,5);
  const topPlayers = players.slice(0,8);
  const cap = getCapSummary(state, team.id);

  return `${pageHead(team.name, `${team.conference} Conference club page`)}
  <div class="club-hero-simple">
    <div class="club-hero-left">
      ${teamLogoMark(team, "club-hero-logo")}
      <div>
        <div class="club-hero-name">${escapeHtml(team.name)}</div>
        <div class="club-hero-sub">${record ? `${record.wins}-${record.draws}-${record.losses} · ${record.points} pts` : team.conference}</div>
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
        ${topPlayers.map(p => `<tr><td><span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span></td><td>${escapeHtml(p.position)}</td><td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td></tr>`).join("")}
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
  if      (currentPage==="dashboard")    html = renderDashboard();
  else if (currentPage==="roster")       html = renderRoster();
  else if (currentPage==="academy")      html = renderAcademy();
  else if (currentPage==="standings")    html = renderStandings();
  else if (currentPage==="schedule")     html = renderSchedule();
  else if (currentPage==="stats")        html = renderStats();
  else if (currentPage==="transactions") html = renderTransactions();
  else if (currentPage==="trade")        html = renderTrade();
  else if (currentPage==="budget")       html = renderBudget();
  else if (currentPage==="draft")        html = renderDraft();
  else if (currentPage==="team")         html = renderTeamPage();
  else if (currentPage==="playoffs")     html = renderPlayoffs();
  else if (currentPage==="tactics")      html = renderTactics();
  else if (currentPage==="saves")        html = await renderSaves();
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
    if (!next.result) simulateMatch(state, next);
    await playLiveMatch(next);
    await persist(); await renderPage();
  });


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
    el.oncontextmenu = e => {
      e.preventDefault();
      armOpenInNewTab(el, "team", el.dataset.id);
    };
    el.onclick = async e => {
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

  $$(".player-link[data-id]").forEach(el => {
    el.oncontextmenu = e => {
      e.preventDefault();
      armOpenInNewTab(el, "player", el.dataset.id);
    };
    el.onclick = async e => {
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
  toast(`League created — ${opts.saveSlot}.`,"success");
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
