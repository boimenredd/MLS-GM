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
} from "./sim.js";
import { CONFERENCES } from "./data.js";

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
  return { GK:1, CB:2, FB:3, CDM:4, CM:5, CAM:6, Winger:7, ST:8 }[pos] || 99;
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
    cb.textContent = "✕ Close";
    cb.addEventListener("click", () => {
      if (!simInProgress) overlay.classList.remove("open");
    });
    const box = document.getElementById("match-sim-box") || overlay;
    box.style.position = "relative";
    box.appendChild(cb);
  }
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

async function showGoalReplay(scorerName, assistName, minute) {
  addSimEvent(minute,
    `🎥 <b>Replay:</b> ${escapeHtml(scorerName)}${assistName ? ` <span style="color:var(--muted)">(assist: ${escapeHtml(assistName)})</span>` : ""}`,
    "color:var(--green);font-weight:600;");
  await sleep(Math.min(simSpeed * 1.4, 900));
}

async function showVARReview(minute) {
  addSimEvent(minute, `📺 <b>VAR CHECK</b> — Reviewing the incident.`, "color:var(--yellow);font-weight:700;");
  await sleep(900);
  const confirmed = Math.random() > 0.45;
  addSimEvent(minute,
    confirmed ? "✅ Goal confirmed by VAR." : "❌ Goal disallowed after VAR review.",
    `color:${confirmed ? "var(--green)" : "var(--red)"};font-weight:700;`);
  return confirmed;
}

// ── Main live match loop ─────────────────────────────────────────────────────

async function playLiveMatch(match) {
  bindOverlayButtons();

  const overlay = document.getElementById("match-sim-overlay");
  if (!overlay) { console.error("match-sim-overlay not found"); return; }
  overlay.classList.add("open");

  simInProgress = true; simPaused = false; simSkipped = false;
  setSimSpeed("normal");

  const ht = byTeamId(match.homeTeamId);
  const at = byTeamId(match.awayTeamId);

  const el = id => document.getElementById(id);

  if (el("sim-home-name")) el("sim-home-name").textContent = ht.shortName || ht.name;
  if (el("sim-away-name")) el("sim-away-name").textContent = at.shortName || at.name;
  if (el("sim-minute"))    el("sim-minute").textContent = "Kickoff";
  if (el("sim-score"))     el("sim-score").textContent  = "0 \u2013 0";
  if (el("sim-events"))    el("sim-events").innerHTML   = "";
  if (el("sim-progress-fill")) el("sim-progress-fill").style.width = "0%";
  if (el("sim-close-btn")) el("sim-close-btn").style.display = "none";

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
    "Corner! — cleared away at the near post.",
    "Yellow card shown for a late challenge.",
    "The keeper parries it wide for a corner.",
    "Offside flag cuts short the celebration.",
    "The referee has a word with the captain.",
    "Substitution warming up on the touchline.",
    "Long ball over the top — flagged offside.",
    "Brilliant last-ditch tackle in the box!",
  ];

  for (let minute = 1; minute <= 90; minute++) {
    while (simPaused) await sleep(100);
    if (simSkipped) break;

    if (el("sim-minute")) el("sim-minute").textContent = `${minute}''`;
    if (el("sim-progress-fill")) el("sim-progress-fill").style.width = `${(minute/90)*100}%`;

    if (Math.random() < 0.18)
      addSimEvent(minute, commentary[Math.floor(Math.random() * commentary.length)]);

    while (ei < sortedEvents.length && sortedEvents[ei].minute <= minute) {
      const ev     = sortedEvents[ei];
      const scorer = ev.scorerId ? byPlayerId(ev.scorerId) : null;
      const assist = ev.assistId ? byPlayerId(ev.assistId) : null;
      const pName  = scorer?.name || "Unknown";

      if (ev.side === "home") hg++; else ag++;
      if (el("sim-score")) el("sim-score").textContent = `${hg} \u2013 ${ag}`;

      if (Math.random() < 0.10) {
        simPaused = true; await sleep(16);
        const confirmed = await showVARReview(minute);
        simPaused = false;
        if (!confirmed) {
          if (ev.side === "home") hg--; else ag--;
          if (el("sim-score")) el("sim-score").textContent = `${hg} \u2013 ${ag}`;
          ei++; continue;
        }
      }

      addSimEvent(minute,
        `⚽ <b>GOAL!</b> ${escapeHtml(pName)}${assist ? ` <span style="color:var(--muted)">(assist: ${escapeHtml(assist.name)})</span>` : ""}`,
        "background:rgba(34,197,94,0.08);border-left:3px solid var(--green);padding-left:6px;border-radius:3px;");

      const scoreEl = el("sim-score");
      if (scoreEl) {
        scoreEl.style.transition = "color .2s";
        scoreEl.style.color = "var(--green)";
        setTimeout(() => { if (scoreEl) scoreEl.style.color = ""; }, 500);
      }

      if (!simSkipped) {
        simPaused = true; await sleep(16);
        await showGoalReplay(pName, assist?.name || null, minute);
        simPaused = false;
      }
      ei++;
    }
    await sleep(simSpeed);
  }

  if (el("sim-minute")) el("sim-minute").textContent = "Full Time";
  if (el("sim-progress-fill")) el("sim-progress-fill").style.width = "100%";
  addSimEvent(90,
    `<b>Full Time.</b> ${escapeHtml(ht.name)} ${result.homeGoals}\u2013${result.awayGoals} ${escapeHtml(at.name)}`,
    "color:var(--accent);font-weight:700;");

  simInProgress = false;
  if (el("sim-close-btn")) el("sim-close-btn").style.display = "";
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
  const a    = p.attributes;
  const s    = p.stats;
  const tag  = getPlayerTag(p);

  const attrs = [
    { label:"PAC", value: a.pace },
    { label:"SHO", value: a.shooting },
    { label:"PAS", value: a.passing },
    { label:"DRI", value: a.dribbling },
    { label:"DEF", value: a.defense },
    { label:"PHY", value: a.physical },
  ];

  const cx=130, cy=110, r=85;
  const pts = attrs.map((attr, i) => {
    const ang = (Math.PI*2*i/6) - Math.PI/2;
    const v = attr.value/100;
    return `${cx + r*v*Math.cos(ang)},${cy + r*v*Math.sin(ang)}`;
  }).join(" ");
  const gridPts = (f) => attrs.map((_, i) => {
    const ang = (Math.PI*2*i/6) - Math.PI/2;
    return `${cx + r*f*Math.cos(ang)},${cy + r*f*Math.sin(ang)}`;
  }).join(" ");

  const spokes = attrs.map((_, i) => {
    const ang = (Math.PI*2*i/6) - Math.PI/2;
    return `<line x1="${cx}" y1="${cy}" x2="${cx+r*Math.cos(ang)}" y2="${cy+r*Math.sin(ang)}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
  }).join("");

  const labelEls = attrs.map((attr, i) => {
    const ang = (Math.PI*2*i/6) - Math.PI/2;
    const lx = cx + (r+20)*Math.cos(ang);
    const ly = cy + (r+20)*Math.sin(ang);
    return `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="var(--muted)" font-size="11" font-family="var(--mono)">${attr.label}</text>`;
  }).join("");

  const radarSVG = `<svg viewBox="0 0 260 220" xmlns="http://www.w3.org/2000/svg" style="width:220px;height:190px;">
    ${[0.25,0.5,0.75,1].map(f => `<polygon points="${gridPts(f)}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`).join("")}
    ${spokes}
    <polygon points="${pts}" fill="rgba(77,163,255,0.22)" stroke="var(--accent)" stroke-width="2"/>
    ${labelEls}
  </svg>`;

  const intlBadge = isUSOrCanadian(p)
    ? `<span class="badge green">Domestic</span>`
    : p.hasGreenCard ? `<span class="badge green">Green Card</span>` : `<span class="badge yellow">INTL Slot</span>`;

  const statItems = p.position === "GK"
    ? [["GP",s.gp],["Min",s.min],["CS",s.cleanSheets],["GA",s.ga]]
    : [["GP",s.gp],["G",s.goals],["A",s.assists],["xG",s.xg?.toFixed?.(1)||0],["YC",s.yellows],["RC",s.reds]];

  const marketVal = formatMoney(Math.round(p.overall * p.overall * 3200 + (p.potential - p.overall) * 85000));

  const traitData = [
    ["Shot Attempts",    Math.min(100,Math.round(a.shooting*0.88))],
    ["Chances Created",  Math.min(100,Math.round(a.passing*0.92))],
    ["Aerial Duels Won", Math.min(100,Math.round(a.physical*0.90))],
    ["Defensive Contrib",Math.min(100,Math.round(a.defense*0.95))],
    ["Goals",            Math.min(100,Math.round((s.goals||0)*3.5))],
    ["Touches",          Math.min(100,Math.round(a.dribbling*0.85))],
  ];

  const html = `<div id="playerProfileOverlay" class="pp-overlay">
    <div class="pp-modal">
      <button class="pp-close" id="ppClose">×</button>

      <div class="pp-hero">
        <div class="pp-avatar-block">
          <div class="pp-pos-badge">${escapeHtml(p.position)}</div>
          <div class="pp-flag">${escapeHtml(p.nationality)}</div>
        </div>
        <div class="pp-hero-info">
          <div class="pp-player-name">${escapeHtml(p.name)}</div>
          <div class="pp-club-name">${escapeHtml(team?.name || "Free Agent")}${p.rosterRole && team ? ` · ${p.rosterRole}` : ""}</div>
          <div class="pp-badges">
            <span class="badge blue">${escapeHtml(p.position)}</span>
            ${intlBadge}
            ${p.designation ? `<span class="badge blue">${escapeHtml(p.designation)}</span>` : ""}
            ${p.homegrown ? `<span class="badge green">Homegrown</span>` : ""}
            ${p.injuryMeta ? `<span class="badge red">${escapeHtml(p.injuryMeta.type)}</span>` : ""}
          </div>
        </div>
        <div class="pp-ovr-block">
          <div class="pp-ovr-num">${p.overall}</div>
          <div class="pp-ovr-label">OVR</div>
          <div class="pp-pot-num">${p.potential} POT</div>
        </div>
      </div>

      <div class="pp-body">
        <div class="pp-col-left">
          <div class="pp-section-title">Attributes</div>
          <div style="display:flex;justify-content:center;margin-bottom:10px;">${radarSVG}</div>
          <div class="pp-attr-list">
            ${attrs.map(at => `
              <div class="pp-attr-row">
                <span class="pp-attr-label">${at.label}</span>
                <div class="pp-attr-bar-bg"><div class="pp-attr-bar" style="width:${at.value}%;background:${at.value>=80?"var(--green)":at.value>=65?"var(--accent)":"var(--yellow)"};"></div></div>
                <span class="pp-attr-val">${at.value}</span>
              </div>`).join("")}
          </div>
        </div>

        <div class="pp-col-right">
          <div class="pp-info-grid">
            <div class="pp-info-box"><div class="pp-info-lbl">Age</div><div class="pp-info-val">${p.age}</div></div>
            <div class="pp-info-box"><div class="pp-info-lbl">Foot</div><div class="pp-info-val">${p.preferredFoot||"Right"}</div></div>
            <div class="pp-info-box"><div class="pp-info-lbl">Salary</div><div class="pp-info-val">${formatMoney(p.contract.salary)}</div></div>
            <div class="pp-info-box"><div class="pp-info-lbl">Contract</div><div class="pp-info-val">${p.contract.yearsLeft}yr</div></div>
            <div class="pp-info-box"><div class="pp-info-lbl">Morale</div><div class="pp-info-val">${p.morale||"—"}</div></div>
            <div class="pp-info-box"><div class="pp-info-lbl">Value</div><div class="pp-info-val" style="color:var(--green);">${marketVal}</div></div>
          </div>

          <div class="pp-section-title" style="margin-top:14px;">Season Stats</div>
          <div class="pp-stats-row">
            ${statItems.map(([lbl,val]) => `<div class="pp-stat-box"><div class="pp-stat-val">${val}</div><div class="pp-stat-lbl">${lbl}</div></div>`).join("")}
          </div>

          <div class="pp-section-title" style="margin-top:14px;">Player Traits</div>
          <div class="pp-traits">
            ${traitData.map(([lbl,pct]) => `
              <div class="pp-trait-row">
                <span class="pp-trait-lbl">${lbl}</span>
                <div class="pp-trait-bar-bg"><div class="pp-trait-bar" style="width:${pct}%"></div></div>
                <span class="pp-trait-pct">${pct}%</span>
              </div>`).join("")}
          </div>
        </div>
      </div>
    </div>
  </div>`;

  document.getElementById("playerProfileOverlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", html);
  document.getElementById("ppClose").addEventListener("click", () => document.getElementById("playerProfileOverlay")?.remove());
  document.getElementById("playerProfileOverlay").addEventListener("click", e => {
    if (e.target.id === "playerProfileOverlay") document.getElementById("playerProfileOverlay")?.remove();
  });
}

// ── Page renderers ───────────────────────────────────────────────────────────

function renderDashboard() {
  const team     = getUserTeam(state);
  const cap      = getCapSummary(state, team.id);
  const confRows = state.standings[team.conference];
  const rank     = confRows.findIndex(r => r.teamId === team.id) + 1;
  const upcoming = state.schedule
    .filter(m => !m.played && (m.homeTeamId===team.id || m.awayTeamId===team.id))
    .slice(0,5);
  const awards = state.awardsHistory[state.awardsHistory.length-1];
  const teamPlayers = getTeamPlayers(state, team.id);
  const intlUsed = teamPlayers.filter(p => takesIntlSlot(p)).length;

  return `${pageHead("Dashboard", `${team.conference} Conference · Front office overview`)}
  <div class="flex" style="margin-bottom:12px;">
    <button id="playMyMatchBtn" class="primary-btn" type="button">▶ Play My Match</button>
  </div>
  <div class="cards">
    <div class="card"><div class="card-label">Conference Place</div><div class="card-value">${rank}</div><div class="card-note">${escapeHtml(team.conference)}</div></div>
    <div class="card"><div class="card-label">Team Overall</div><div class="card-value">${teamOverall(state, team.id).toFixed(1)}</div><div class="card-note">${escapeHtml(team.name)}</div></div>
    <div class="card"><div class="card-label">Budget Used</div><div class="card-value">${formatMoney(cap.budgetUsed)}</div><div class="card-note">${formatMoney(cap.budgetRoom)} room</div></div>
    <div class="card"><div class="card-label">Intl Slots</div><div class="card-value">${intlUsed}/${cap.intlTotal}</div><div class="card-note">${cap.dpCount} DPs</div></div>
  </div>
  <div class="two-col">
    <div>
      <div class="panel">
        <div class="panel-head"><h3>Upcoming Matches</h3><span>Next 5</span></div>
        <table><thead><tr><th>Week</th><th>Opponent</th><th>Venue</th></tr></thead><tbody>
          ${upcoming.map(m => {
            const home = m.homeTeamId===team.id;
            const opp = byTeamId(home ? m.awayTeamId : m.homeTeamId);
            return `<tr><td>${m.week}</td><td>${escapeHtml(opp.name)}</td><td>${home?"Home":"Away"}</td></tr>`;
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
        <div class="panel-head"><h3>Standings Snapshot</h3><span>${escapeHtml(team.conference)}</span></div>
        <table><thead><tr><th>#</th><th>Club</th><th class="num">Pts</th><th class="num">W</th><th class="num">GD</th></tr></thead><tbody>
          ${confRows.slice(0,9).map((r,i) => `<tr><td>${i+1}</td><td>${escapeHtml(byTeamId(r.teamId).name)}${r.teamId===team.id?" <strong>(You)</strong>":""}</td><td class="num">${r.points}</td><td class="num">${r.wins}</td><td class="num">${r.gd>0?"+":""}${r.gd}</td></tr>`).join("")}
        </tbody></table>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Incoming Offer</h3><span>External bid</span></div>
        ${state.pendingOffer
          ? `<p><strong>${escapeHtml(state.pendingOffer.bidClub)}</strong> wants <strong>${escapeHtml(byPlayerId(state.pendingOffer.playerId)?.name||"Unknown")}</strong>.</p>
             <p>Offer: <strong>${formatMoney(state.pendingOffer.amount)}</strong></p>
             <div class="flex"><button id="acceptOfferBtn" class="primary-btn">Accept</button><button id="rejectOfferBtn" class="ghost-btn">Reject</button></div>`
          : `<p class="note">No active offers.</p>`}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Latest Awards</h3><span>${awards?awards.year:"—"}</span></div>
        ${awards
          ? `<table><tbody><tr><td>MVP</td><td>${escapeHtml(awards.mvp)}</td></tr><tr><td>Golden Boot</td><td>${escapeHtml(awards.goldenBoot)}</td></tr><tr><td>GK of the Year</td><td>${escapeHtml(awards.goalkeeper)}</td></tr></tbody></table>`
          : `<p class="note">Awards appear after first season.</p>`}
      </div>
    </div>
  </div>`;
}

function renderRoster() {
  const team    = getUserTeam(state);
  const players = getTeamPlayers(state, team.id);
  const cap     = getCapSummary(state, team.id);
  const intlUsed = players.filter(p => takesIntlSlot(p)).length;

  const rows = players.map(p => ({
    id: p.id, name: p.name, position: p.position,
    positionOrder: getPositionOrder(p.position),
    age: p.age, overall: p.overall, potential: p.potential,
    salary: p.contract.salary, yearsLeft: p.contract.yearsLeft,
    morale: p.morale, role: p.rosterRole,
    tag: getPlayerTag(p),
    intl: takesIntlSlot(p),
    injury: p.injuryMeta?.type || (p.injuredUntil ? "Inj" : ""),
  }));

  const sorted = sortRows(rows, tableSortState.roster);
  const GKs  = sorted.filter(p => p.position==="GK");
  const DEFs = sorted.filter(p => p.position==="CB"||p.position==="FB");
  const MIDs = sorted.filter(p => ["CDM","CM","CAM"].includes(p.position));
  const ATTs = sorted.filter(p => p.position==="Winger"||p.position==="ST");

  function grp(label, group) {
    if (!group.length) return "";
    return `<tr><td colspan="11" style="background:var(--bg3);color:var(--muted);font-size:10px;font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;padding:6px 8px;">${label}</td></tr>
    ${group.map(p => `<tr>
      <td><strong class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</strong>${p.injury?` <span class="badge red">${escapeHtml(p.injury)}</span>`:""}</td>
      <td><span class="badge">${escapeHtml(p.position)}</span></td>
      <td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td>
      <td class="num">${formatMoney(p.salary)}</td><td class="num">${p.yearsLeft}yr</td><td class="num">${p.morale}</td>
      <td>${escapeHtml(p.role)}</td>
      <td><span class="badge ${p.tag==="DP"?"blue":p.tag==="HG"||p.tag==="DOM"||p.tag==="GC"?"green":p.tag==="INTL"?"yellow":""}">${escapeHtml(p.tag)}</span></td>
      <td class="num">${p.intl?"<span class='badge yellow'>INTL</span>":"<span class='badge green'>✓</span>"}</td>
    </tr>`).join("")}`;
  }

  return `${pageHead("Roster","Sortable · click name for player profile")}
  <div class="cards">
    <div class="card"><div class="card-label">Senior</div><div class="card-value">${cap.seniorCount}</div><div class="card-note">Max 20</div></div>
    <div class="card"><div class="card-label">Supplemental</div><div class="card-value">${cap.supplementalCount}</div><div class="card-note">Cap exempt</div></div>
    <div class="card"><div class="card-label">Reserve</div><div class="card-value">${cap.reserveCount}</div><div class="card-note">Developmental</div></div>
    <div class="card"><div class="card-label">Intl Slots</div><div class="card-value">${intlUsed}/${cap.intlTotal}</div><div class="card-note">GC = domestic</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Squad</h3><span>${players.length} players</span></div>
    <table><thead><tr>
      ${makeSortableTh("Name","roster","name")}
      ${makeSortableTh("Pos","roster","positionOrder")}
      ${makeSortableTh("Age","roster","age","num")}
      ${makeSortableTh("OVR","roster","overall","num")}
      ${makeSortableTh("POT","roster","potential","num")}
      ${makeSortableTh("Salary","roster","salary","num")}
      ${makeSortableTh("Ctract","roster","yearsLeft","num")}
      ${makeSortableTh("Morale","roster","morale","num")}
      ${makeSortableTh("Role","roster","role")}
      ${makeSortableTh("Tag","roster","tag")}
      <th class="num">Intl</th>
    </tr></thead><tbody>
      ${grp("Goalkeepers",GKs)}${grp("Defenders",DEFs)}${grp("Midfielders",MIDs)}${grp("Attackers",ATTs)}
    </tbody></table>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Free Agency</h3><span>Out-of-contract pool</span></div>
    <table><thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">Salary</th><th>Nation</th><th>Intl</th><th></th></tr></thead><tbody>
      ${state.freeAgents.slice(0,24).map(p => `<tr>
        <td><span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span></td>
        <td>${escapeHtml(p.position)}</td><td class="num">${p.age}</td><td class="num">${p.overall}</td>
        <td class="num">${formatMoney(p.contract.salary)}</td><td>${escapeHtml(p.nationality)}</td>
        <td class="num">${takesIntlSlot(p)?"<span class='badge yellow'>INTL</span>":"<span class='badge green'>DOM</span>"}</td>
        <td class="num"><button class="small-btn sign-fa-btn" data-id="${p.id}">Sign</button></td>
      </tr>`).join("")}
    </tbody></table>
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
      <div class="panel-head"><h3>${escapeHtml(conf)} Conference</h3><span>Top 9 qualify</span></div>
      <table><thead><tr><th>#</th>
        ${makeSortableTh("Club",tbl,"name")}
        ${makeSortableTh("P",tbl,"played","num")}${makeSortableTh("W",tbl,"wins","num")}
        ${makeSortableTh("D",tbl,"draws","num")}${makeSortableTh("L",tbl,"losses","num")}
        ${makeSortableTh("GF",tbl,"gf","num")}${makeSortableTh("GA",tbl,"ga","num")}
        ${makeSortableTh("GD",tbl,"gd","num")}${makeSortableTh("Pts",tbl,"points","num")}
      </tr></thead><tbody>
        ${sorted.map((r,i) => `<tr>
          <td>${i+1}</td>
          <td>${escapeHtml(r.name)}${r.teamId===state.userTeamId?" <strong>(You)</strong>":""}</td>
          <td class="num">${r.played}</td><td class="num">${r.wins}</td><td class="num">${r.draws}</td>
          <td class="num">${r.losses}</td><td class="num">${r.gf}</td><td class="num">${r.ga}</td>
          <td class="num">${r.gd>0?"+":""}${r.gd}</td><td class="num"><strong>${r.points}</strong></td>
        </tr>`).join("")}
      </tbody></table>
    </div>`;
  }
  return `${pageHead("Standings","Sortable conference tables · MLS tiebreaker")}${renderConf("East","standingsEast")}${renderConf("West","standingsWest")}`;
}

function renderSchedule() {
  const team = getUserTeam(state);
  const games = state.schedule.filter(m => m.homeTeamId===team.id||m.awayTeamId===team.id);
  return `${pageHead("Schedule",`${games.length} matches this season`)}
  <div class="panel"><table>
    <thead><tr><th>Week</th><th>Opponent</th><th>Venue</th><th>Score</th><th>xG</th></tr></thead><tbody>
      ${games.map(m => {
        const home = m.homeTeamId===team.id;
        const opp  = byTeamId(home ? m.awayTeamId : m.homeTeamId);
        const score = !m.played ? "—" : `${m.result.homeGoals}-${m.result.awayGoals}${m.result.penalties?` (pens ${m.result.penalties.home}-${m.result.penalties.away})`:""}`;
        const xg = !m.played ? "—" : `${m.result.homeXg} / ${m.result.awayXg}`;
        return `<tr><td>${m.week}</td><td>${escapeHtml(opp.name)}</td><td>${home?"Home":"Away"}</td><td>${score}</td><td>${xg}</td></tr>`;
      }).join("")}
    </tbody></table>
  </div>`;
}

function renderStats() {
  const active = state.players.filter(p => p.clubId);
  const rows = active.map(p => ({
    id: p.id, name: p.name,
    club: byTeamId(p.clubId)?.shortName || "—",
    pos: p.position, gp: p.stats.gp,
    goals: p.stats.goals, assists: p.stats.assists,
    xg: p.stats.xg, yellows: p.stats.yellows, reds: p.stats.reds,
  }));
  const sorted = sortRows(rows, tableSortState.stats);
  return `${pageHead("Player Stats","Season totals · click name for profile")}
  <div class="panel"><table>
    <thead><tr>
      ${makeSortableTh("Name","stats","name")}${makeSortableTh("Club","stats","club")}
      ${makeSortableTh("Pos","stats","pos")}${makeSortableTh("GP","stats","gp","num")}
      ${makeSortableTh("G","stats","goals","num")}${makeSortableTh("A","stats","assists","num")}
      ${makeSortableTh("xG","stats","xg","num")}${makeSortableTh("YC","stats","yellows","num")}
      ${makeSortableTh("RC","stats","reds","num")}
    </tr></thead><tbody>
      ${sorted.slice(0,160).map(p => `<tr>
        <td><span class="player-link" data-id="${p.id}">${escapeHtml(p.name)}</span></td>
        <td>${escapeHtml(p.club)}</td><td>${escapeHtml(p.pos)}</td>
        <td class="num">${p.gp}</td><td class="num">${p.goals}</td><td class="num">${p.assists}</td>
        <td class="num">${(p.xg||0).toFixed(1)}</td><td class="num">${p.yellows}</td><td class="num">${p.reds}</td>
      </tr>`).join("")}
    </tbody></table>
  </div>`;
}

function renderTransactions() {
  return `${pageHead("Transactions Log","Signings, offers, injuries, academy, awards")}
  <div class="panel"><table>
    <thead><tr><th>Type</th><th>Season</th><th>Text</th></tr></thead><tbody>
      ${state.transactions.map(tx => `<tr><td><span class="badge">${escapeHtml(tx.type)}</span></td><td>${tx.season}</td><td>${escapeHtml(tx.text)}</td></tr>`).join("")}
    </tbody></table>
  </div>`;
}

function renderDraft() {
  const rows = state.draft.pool || [];
  return `${pageHead("MLS SuperDraft","Pool appears in the offseason")}
  <div class="panel">
    <div class="panel-head"><h3>Draft Pool</h3><span>${rows.length}</span></div>
    <table><thead><tr><th>Name</th><th>College</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th></tr></thead><tbody>
      ${rows.slice(0,40).map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.college||"—")}</td><td>${escapeHtml(p.position)}</td><td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td></tr>`).join("") || `<tr><td colspan="6">Draft pool generates in offseason.</td></tr>`}
    </tbody></table>
  </div>`;
}

function renderPlayoffs() {
  if (!state.playoffs) return `${pageHead("Playoffs","Bracket appears after week 34")}<div class="panel"><p class="note">Regular season still in progress.</p></div>`;
  const nameOf = id => byTeamId(id)?.name || "—";
  const rm = m => {
    if (m.seriesSummary) return `<div class="card"><div class="card-label">${escapeHtml(m.conference)} Round One</div><div class="card-note">${escapeHtml(nameOf(m.higher))} vs ${escapeHtml(nameOf(m.lower))} · Winner: <strong>${escapeHtml(nameOf(m.winner))}</strong></div></div>`;
    return `<div class="card"><div class="card-label">${escapeHtml(m.type)}</div><div class="card-note"><strong>${escapeHtml(nameOf(m.homeTeamId))}</strong> ${m.result.homeGoals}-${m.result.awayGoals} <strong>${escapeHtml(nameOf(m.awayTeamId))}</strong>${m.result.penalties?` (pens ${m.result.penalties.home}-${m.result.penalties.away})`:""}</div></div>`;
  };
  return `${pageHead("MLS Cup Playoffs",`Round: ${escapeHtml(state.playoffs.currentRound)}`)}
  <div class="grid-2">
    <div class="panel"><div class="panel-head"><h3>Wild Card</h3><span>8 vs 9</span></div>${state.playoffs.rounds.wildCard.map(rm).join("")||`<p class="note">Not yet.</p>`}</div>
    <div class="panel"><div class="panel-head"><h3>Round One</h3><span>Best of 3</span></div>${state.playoffs.rounds.roundOne.map(rm).join("")||`<p class="note">Not yet.</p>`}</div>
    <div class="panel"><div class="panel-head"><h3>Conference Semis</h3><span>Single elim</span></div>${state.playoffs.rounds.semifinals.map(rm).join("")||`<p class="note">Not yet.</p>`}</div>
    <div class="panel"><div class="panel-head"><h3>Finals / MLS Cup</h3><span>Single elim</span></div>${[...state.playoffs.rounds.conferenceFinals,...state.playoffs.rounds.cup].map(rm).join("")||`<p class="note">Not yet.</p>`}${state.playoffs.championTeamId?`<p style="margin-top:10px;"><strong>🏆 Champion: ${escapeHtml(nameOf(state.playoffs.championTeamId))}</strong></p>`:""}</div>
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
  "4-3-3":   ["GK","CB","CB","FB","FB","CM","CM","CDM","Winger","Winger","ST"],
  "4-4-2":   ["GK","CB","CB","FB","FB","CM","CM","Winger","Winger","ST","ST"],
  "4-2-3-1": ["GK","CB","CB","FB","FB","CDM","CDM","CAM","Winger","Winger","ST"],
  "3-5-2":   ["GK","CB","CB","CB","CDM","CM","CM","Winger","Winger","ST","ST"],
  "5-3-2":   ["GK","CB","CB","CB","FB","FB","CM","CM","CDM","ST","ST"],
  "4-1-4-1": ["GK","CB","CB","FB","FB","CDM","CM","CM","CAM","Winger","ST"],
  "3-4-3":   ["GK","CB","CB","CB","CM","CM","Winger","Winger","CAM","ST","ST"],
};

const ROLES = {
  GK:     ["Goalkeeper","Sweeper Keeper"],
  CB:     ["Ball-Playing CB","Stopper","Cover"],
  FB:     ["Attacking FB","Defensive FB","Wing Back"],
  CDM:    ["Holding DM","Deep Playmaker","Box-to-Box"],
  CM:     ["Box-to-Box","Playmaker","Carrier","Defensive CM"],
  CAM:    ["Advanced Playmaker","Shadow Striker","Enganche"],
  Winger: ["Inside Forward","Wide Midfielder","Inverted Winger"],
  ST:     ["Pressing Forward","False 9","Target Man","Poacher"],
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
  else if (currentPage==="draft")        html = renderDraft();
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

  $("#acceptOfferBtn")?.addEventListener("click", async () => {
    acceptPendingOffer(state); await persist(); toast("Accepted.","success"); renderPage();
  });
  $("#rejectOfferBtn")?.addEventListener("click", async () => {
    rejectPendingOffer(state); await persist(); toast("Rejected.","warn"); renderPage();
  });

  $$(".load-slot-btn").forEach(btn => btn.addEventListener("click", async () => {
    const loaded = await loadSlot(btn.dataset.slot);
    if (!loaded) return;
    state = loaded; initGreenCards(state);
    setAppVisible(true); closeOverlay($("#loadOverlay"));
    await renderPage(); toast(`Loaded ${btn.dataset.slot}.`,"success");
  }));

  $$(".delete-slot-btn").forEach(btn => btn.addEventListener("click", async () => {
    await deleteSlot(btn.dataset.slot); toast(`Deleted ${btn.dataset.slot}.`,"warn"); renderPage();
  }));

  $$(".player-link[data-id]").forEach(el =>
    el.addEventListener("click", () => openPlayerProfile(el.dataset.id)));

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
  state = createNewState(opts);
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
    state = loaded; initGreenCards(state);
    closeOverlay($("#loadOverlay")); setAppVisible(true);
    await renderPage(); toast(`Loaded ${btn.dataset.slot}.`,"success");
  }));
}

function populateTeamSelect() {
  const all = [...CONFERENCES.East, ...CONFERENCES.West];
  $("#userTeamSelect").innerHTML = all.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
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
    state = await readJSONFile(f); initGreenCards(state);
    await persist(); setAppVisible(true); await renderPage(); toast("Imported.","success");
  });
  $("#backHomeBtn").addEventListener("click", () => setAppVisible(false));

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
    state.schedule.filter(m => m.week===next.week && !m.played).forEach(m => simulateMatch(state,m));
    await persist(); await renderPage();
  });

  $("#simWeekBtn").addEventListener("click", async () => {
    if (!state) return;
    advanceOneWeek(state);
    if (state.season.phase==="Offseason") runGreenCardOffseason(state);
    await persist(); await renderPage();
  });

  $("#simSeasonBtn").addEventListener("click", async () => {
    if (!state) return;
    simulateToSeasonEnd(state); await persist(); await renderPage();
  });

  $("#simYearBtn").addEventListener("click", async () => {
    if (!state) return;
    while (state.season.phase !== "Offseason") advanceOneWeek(state);
    advanceOneWeek(state); runGreenCardOffseason(state);
    await persist(); await renderPage();
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  populateTeamSelect();
  try { await loadExternalData(); } catch(e) { console.error("External data:", e); }
  bindTopLevel();
  bindNav();
  setAppVisible(false);
}

boot();
