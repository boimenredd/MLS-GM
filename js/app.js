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
  standings,
  signFreeAgent,
  callUpAcademyPlayer,
  acceptPendingOffer,
  rejectPendingOffer,
  advanceOneWeek,
  simulateToSeasonEnd,
} from "./sim.js";
import { CONFERENCES } from "./data.js";

let state = null;
let currentPage = "dashboard";

const SIM_SPEEDS = {
  slow: 1200,
  normal: 600,
  fast: 220,
  turbo: 80,
};

let simSpeedKey = "normal";
let simSpeed = SIM_SPEEDS.normal;
let simPaused = false;
let simSkipped = false;
let simInProgress = false;
let liveSimMatch = null;
let liveSimResolve = null;

const tableSortState = {
  roster: { key: "positionOrder", dir: "asc" },
  standingsEast: { key: "points", dir: "desc" },
  standingsWest: { key: "points", dir: "desc" },
  stats: { key: "goals", dir: "desc" },
};

function byTeamId(id) {
  return state.teams.find(t => t.id === id);
}

function byPlayerId(id) {
  return state.players.find(p => p.id === id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setAppVisible(inSim) {
  $("#homeScreen").classList.toggle("hidden", inSim);
  $("#appShell").classList.toggle("hidden", !inSim);
}

function openOverlay(el) {
  el.classList.add("open");
}

function closeOverlay(el) {
  el.classList.remove("open");
}

function populateTeamSelect() {
  const allTeams = [...CONFERENCES.East, ...CONFERENCES.West];
  $("#userTeamSelect").innerHTML = allTeams
    .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
}

function getPositionOrder(pos) {
  const order = {
    GK: 1,
    CB: 2,
    FB: 3,
    CDM: 4,
    CM: 5,
    CAM: 6,
    Winger: 7,
    ST: 8,
  };
  return order[pos] || 99;
}

function sortRows(rows, sortConfig) {
  const { key, dir } = sortConfig;
  const mult = dir === "asc" ? 1 : -1;

  return rows.slice().sort((a, b) => {
    const av = a[key];
    const bv = b[key];

    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * mult;
    }

    return String(av).localeCompare(String(bv)) * mult;
  });
}

function ensureLiveSimOverlay() {
  if (document.getElementById("match-sim-overlay")) return;

  const div = document.createElement("div");
  div.id = "match-sim-overlay";
  div.innerHTML = `
    <div id="match-sim-box" class="panel" style="max-width:1100px;width:min(1100px,96vw);margin:30px auto;">
      <div class="panel-head">
        <h3 id="msim-title">Live Match</h3>
        <span id="msim-weather">Live Sim</span>
      </div>

      <div style="text-align:center;margin-bottom:12px;">
        <div id="sim-minute" class="page-sub">Kickoff</div>
        <div id="sim-score" style="font-size:42px;font-weight:900;">0 – 0</div>
      </div>

      <div style="display:grid;grid-template-columns:220px 1fr 220px;gap:14px;">
        <div>
          <div class="panel-head"><h3>Live Stats</h3><span>Updating</span></div>
          <div id="msim-live-stats"></div>
          <div class="panel-head" style="margin-top:12px;"><h3>Live Ratings</h3><span>Top XI</span></div>
          <div id="msim-live-ratings"></div>
        </div>

        <div>
          <div class="panel-head"><h3>Commentary</h3><span>Minute by minute</span></div>
          <div id="sim-events" style="max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--bg3);"></div>
        </div>

        <div>
          <div class="panel-head"><h3 id="msim-home-lineup-title">HOME XI</h3><span>Lineup</span></div>
          <div id="msim-home-lineup" style="margin-bottom:12px;"></div>
          <div class="panel-head"><h3 id="msim-away-lineup-title">AWAY XI</h3><span>Lineup</span></div>
          <div id="msim-away-lineup"></div>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:14px;">
        <button class="small-btn sim-speed-opt active" data-speed="slow" type="button">🐢 Slow</button>
        <button class="small-btn sim-speed-opt" data-speed="normal" type="button">▶ Normal</button>
        <button class="small-btn sim-speed-opt" data-speed="fast" type="button">⚡ Fast</button>
        <button class="small-btn sim-speed-opt" data-speed="turbo" type="button">🚀 Turbo</button>
        <button id="sim-pause-btn" class="small-btn" type="button">⏸ Pause</button>
        <button id="sim-skip-btn" class="small-btn" type="button">⏭ Skip</button>
        <button id="sim-close-btn" class="small-btn" type="button">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(div);

  div.querySelectorAll(".sim-speed-opt").forEach(btn => {
    btn.addEventListener("click", () => setSimSpeed(btn.dataset.speed));
  });

  document.getElementById("sim-pause-btn").addEventListener("click", toggleSimPause);
  document.getElementById("sim-skip-btn").addEventListener("click", () => {
    simSkipped = true;
    simPaused = false;
  });
  document.getElementById("sim-close-btn").addEventListener("click", () => {
    if (!simInProgress) {
      div.classList.remove("open");
    }
  });
}

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
  const homeTeam = byTeamId(match.homeTeamId);
  const awayTeam = byTeamId(match.awayTeamId);

  const homeXI = getTeamPlayers(state, homeTeam.id).slice(0, 11);
  const awayXI = getTeamPlayers(state, awayTeam.id).slice(0, 11);

  document.getElementById("msim-home-lineup-title").textContent = `${homeTeam.shortName || homeTeam.name} XI`;
  document.getElementById("msim-away-lineup-title").textContent = `${awayTeam.shortName || awayTeam.name} XI`;

  document.getElementById("msim-home-lineup").innerHTML = homeXI.map(p => `
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);font-size:11px;">
      <span>${escapeHtml(p.name)}</span><span>${p.overall}</span>
    </div>
  `).join("");

  document.getElementById("msim-away-lineup").innerHTML = awayXI.map(p => `
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);font-size:11px;">
      <span>${escapeHtml(p.name)}</span><span>${p.overall}</span>
    </div>
  `).join("");
}

function renderLiveStatBars(stats) {
  const rows = [
    ["Possession", `${stats.homePoss}%`, `${stats.awayPoss}%`],
    ["Shots", stats.homeShots, stats.awayShots],
    ["On Target", stats.homeSot, stats.awaySot],
    ["xG", stats.homeXg.toFixed(2), stats.awayXg.toFixed(2)],
    ["Yellows", stats.homeYellows, stats.awayYellows],
    ["Reds", stats.homeReds, stats.awayReds],
  ];

  document.getElementById("msim-live-stats").innerHTML = rows.map(([label, left, right]) => `
    <div style="display:grid;grid-template-columns:42px 1fr 42px;gap:8px;align-items:center;margin-bottom:8px;font-size:11px;">
      <span style="text-align:center;">${left}</span>
      <div>
        <div style="text-align:center;font-size:10px;color:var(--muted);margin-bottom:2px;">${label}</div>
        <div style="height:6px;background:var(--bg3);border-radius:6px;overflow:hidden;display:flex;">
          <div style="width:50%;background:var(--accent);"></div>
          <div style="width:50%;background:#f97316;"></div>
        </div>
      </div>
      <span style="text-align:center;">${right}</span>
    </div>
  `).join("");
}

function renderLiveRatingsPanel(match) {
  const homeXI = getTeamPlayers(state, match.homeTeamId).slice(0, 6);
  const awayXI = getTeamPlayers(state, match.awayTeamId).slice(0, 6);

  const merged = [...homeXI.map(p => ({ ...p, side: "H" })), ...awayXI.map(p => ({ ...p, side: "A" }))]
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 8);

  document.getElementById("msim-live-ratings").innerHTML = merged.map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--line);font-size:11px;">
      <span>${p.side} · ${escapeHtml(p.name)}</span>
      <span style="font-family:var(--mono);font-weight:700;">${(6 + (p.overall - 60) / 10).toFixed(1)}</span>
    </div>
  `).join("");
}

async function showGoalReplay(scorerName, assistName, minute) {
  addSimEvent(
    minute,
    `🎥 <b>Replay:</b> ${escapeHtml(scorerName)}${assistName ? ` <span style="color:var(--muted)">(assist: ${escapeHtml(assistName)})</span>` : ""}`,
    "color:var(--green);font-weight:600;"
  );
  await sleep(Math.min(simSpeed * 1.4, 900));
}

async function showVARReview(minute) {
  addSimEvent(minute, `📺 <b>VAR CHECK</b> — Reviewing the incident.`, "color:var(--yellow);font-weight:700;");
  await sleep(900);

  const confirmed = Math.random() > 0.45;
  addSimEvent(
    minute,
    confirmed ? "✅ Goal confirmed by VAR." : "❌ Goal disallowed after VAR review.",
    `color:${confirmed ? "var(--green)" : "var(--red)"};font-weight:700;`
  );

  return confirmed;
}

async function playLiveMatch(match) {
  ensureLiveSimOverlay();

  const overlay = document.getElementById("match-sim-overlay");
  overlay.classList.add("open");

  simInProgress = true;
  simPaused = false;
  simSkipped = false;
  setSimSpeed("normal");

  const homeTeam = byTeamId(match.homeTeamId);
  const awayTeam = byTeamId(match.awayTeamId);

  document.getElementById("msim-title").textContent = `${homeTeam.name} vs ${awayTeam.name}`;
  document.getElementById("sim-minute").textContent = "Kickoff";
  document.getElementById("sim-score").textContent = "0 – 0";
  document.getElementById("sim-events").innerHTML = "";

  renderMiniLineups(match);

  const result = match.result || {
    homeGoals: 0,
    awayGoals: 0,
    homeXg: 0,
    awayXg: 0,
    homeShots: 0,
    awayShots: 0,
    homeSot: 0,
    awaySot: 0,
    homePoss: 50,
    awayPoss: 50,
    homeYellows: 0,
    awayYellows: 0,
    homeReds: 0,
    awayReds: 0,
    events: [],
  };

  renderLiveStatBars(result);
  renderLiveRatingsPanel(match);

  let hg = 0;
  let ag = 0;
  let ei = 0;
  const sortedEvents = [...(result.events || [])].sort((a, b) => a.minute - b.minute);

  addSimEvent(0, `<b>Kickoff!</b> ${escapeHtml(homeTeam.name)} vs ${escapeHtml(awayTeam.name)}`);

  for (let minute = 1; minute <= 90; minute++) {
    while (simPaused) {
      await sleep(100);
    }

    if (simSkipped) break;

    document.getElementById("sim-minute").textContent = `${minute}'`;

    if (Math.random() < 0.18) {
      const commentaryPool = [
        "Patient spell of possession in midfield.",
        "The tempo drops as both teams reset.",
        "Promising buildup down the flank.",
        "A dangerous ball flashes across the box.",
        "The crowd reacts to a half-chance.",
      ];
      addSimEvent(minute, commentaryPool[Math.floor(Math.random() * commentaryPool.length)]);
    }

    while (ei < sortedEvents.length && sortedEvents[ei].minute <= minute) {
      const ev = sortedEvents[ei];
      const scorer = ev.scorerId ? byPlayerId(ev.scorerId) : null;
      const assist = ev.assistId ? byPlayerId(ev.assistId) : null;
      const pName = scorer?.name || "Unknown";

      if (ev.side === "home") hg++;
      else ag++;

      document.getElementById("sim-score").textContent = `${hg} – ${ag}`;

      const maybeVAR = Math.random() < 0.10;
      if (maybeVAR) {
        simPaused = true;
        await sleep(0);
        await sleep(16);
        const confirmed = await showVARReview(minute);
        simPaused = false;

        if (!confirmed) {
          if (ev.side === "home") hg--;
          else ag--;
          document.getElementById("sim-score").textContent = `${hg} – ${ag}`;
          ei++;
          continue;
        }
      }

      addSimEvent(
        minute,
        `⚽ <b>GOAL!</b> ${escapeHtml(pName)}${assist ? ` <span style="color:var(--muted)">(assist: ${escapeHtml(assist.name)})</span>` : ""}`,
        "background:rgba(34,197,94,0.08);border-left:3px solid var(--green);padding-left:6px;border-radius:3px;"
      );

      document.getElementById("sim-score").style.animation = "goalPulse .5s ease";
      setTimeout(() => {
        const el = document.getElementById("sim-score");
        if (el) el.style.animation = "";
      }, 500);

      if (!simSkipped) {
        simPaused = true;
        await sleep(0);
        await sleep(0);
        await showGoalReplay(pName, assist?.name || null, minute);
        simPaused = false;
      }

      ei++;
    }

    renderLiveRatingsPanel(match);
    await sleep(simSpeed);
  }

  document.getElementById("sim-minute").textContent = "Full Time";
  addSimEvent(90, `<b>Full Time.</b> ${escapeHtml(homeTeam.name)} ${hg}–${ag} ${escapeHtml(awayTeam.name)}`, "color:var(--accent);font-weight:700;");

  simInProgress = false;
  await sleep(400);
}

function toggleSort(tableName, key) {
  const current = tableSortState[tableName];
  if (current.key === key) {
    current.dir = current.dir === "asc" ? "desc" : "asc";
  } else {
    current.key = key;
    current.dir = key === "name" || key === "position" ? "asc" : "desc";
  }
  renderPage();
}

function sortArrow(tableName, key) {
  const current = tableSortState[tableName];
  if (current.key !== key) return "";
  return current.dir === "asc" ? " ▲" : " ▼";
}

function makeSortableTh(label, tableName, key, extraClass = "") {
  return `<th class="${extraClass}" data-sort-table="${tableName}" data-sort-key="${key}" style="cursor:pointer">${label}${sortArrow(tableName, key)}</th>`;
}

function updateMeta() {
  if (!state) return;
  const team = getUserTeam(state);
  $("#metaClub").textContent = team.name;
  $("#metaSeason").textContent = state.season.year;
  $("#metaPhase").textContent = state.season.phase;
  $("#metaWeek").textContent = state.calendar.week;
}

async function persist() {
  if (!state) return;
  await saveSlot(state.saveSlot, state);
}

function pageHead(title, sub) {
  return `
    <div class="page-head">
      <div>
        <div class="page-title">${escapeHtml(title)}</div>
        <div class="page-sub">${escapeHtml(sub)}</div>
      </div>
    </div>
  `;
}

function bindSortableHeaders() {
  $$("[data-sort-table][data-sort-key]").forEach(el => {
    el.addEventListener("click", () => {
      toggleSort(el.dataset.sortTable, el.dataset.sortKey);
    });
  });
}

function renderDashboard() {
  <div class="flex" style="margin-bottom:12px;">
  <button id="playMyMatchBtn" class="primary-btn" type="button">▶ Play My Match</button>
  </div>
  const team = getUserTeam(state);
  const cap = getCapSummary(state, team.id);
  const confRows = state.standings[team.conference];
  const rank = confRows.findIndex(r => r.teamId === team.id) + 1;
  const upcoming = state.schedule
    .filter(m => !m.played && (m.homeTeamId === team.id || m.awayTeamId === team.id))
    .slice(0, 5);

  const awards = state.awardsHistory[state.awardsHistory.length - 1];

  return `
    ${pageHead("Dashboard", `${team.conference} Conference · Front office overview`)}

    <div class="cards">
      <div class="card">
        <div class="card-label">Conference Place</div>
        <div class="card-value">${rank}</div>
        <div class="card-note">${escapeHtml(team.conference)}</div>
      </div>
      <div class="card">
        <div class="card-label">Team Overall</div>
        <div class="card-value">${teamOverall(state, team.id).toFixed(1)}</div>
        <div class="card-note">${escapeHtml(team.name)}</div>
      </div>
      <div class="card">
        <div class="card-label">Budget Used</div>
        <div class="card-value">${formatMoney(cap.budgetUsed)}</div>
        <div class="card-note">${formatMoney(cap.budgetRoom)} room</div>
      </div>
      <div class="card">
        <div class="card-label">International Slots</div>
        <div class="card-value">${cap.intlUsed}/${cap.intlTotal}</div>
        <div class="card-note">${cap.dpCount} DPs</div>
      </div>
    </div>

    <div class="two-col">
      <div>
        <div class="panel">
          <div class="panel-head"><h3>Upcoming Matches</h3><span>Next 5</span></div>
          <table>
            <thead><tr><th>Week</th><th>Opponent</th><th>Venue</th></tr></thead>
            <tbody>
              ${upcoming.map(m => {
                const home = m.homeTeamId === team.id;
                const opp = byTeamId(home ? m.awayTeamId : m.homeTeamId);
                return `<tr><td>${m.week}</td><td>${escapeHtml(opp.name)}</td><td>${home ? "Home" : "Away"}</td></tr>`;
              }).join("") || `<tr><td colspan="3">No remaining matches.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Recent Transactions</h3><span>Latest</span></div>
          <table>
            <thead><tr><th>Type</th><th>Detail</th></tr></thead>
            <tbody>
              ${state.transactions.slice(0, 10).map(tx => `
                <tr>
                  <td><span class="badge">${escapeHtml(tx.type)}</span></td>
                  <td>${escapeHtml(tx.text)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="panel">
          <div class="panel-head"><h3>Standings Snapshot</h3><span>${escapeHtml(team.conference)}</span></div>
          <table>
            <thead><tr><th>#</th><th>Club</th><th class="num">Pts</th><th class="num">W</th><th class="num">GD</th></tr></thead>
            <tbody>
              ${confRows.slice(0, 9).map((r, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(byTeamId(r.teamId).name)}${r.teamId === team.id ? " <strong>(You)</strong>" : ""}</td>
                  <td class="num">${r.points}</td>
                  <td class="num">${r.wins}</td>
                  <td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Incoming Offer</h3><span>External bid</span></div>
          ${
            state.pendingOffer
              ? `
                <p><strong>${escapeHtml(state.pendingOffer.bidClub)}</strong> wants <strong>${escapeHtml(byPlayerId(state.pendingOffer.playerId)?.name || "Unknown")}</strong>.</p>
                <p>Offer value: <strong>${formatMoney(state.pendingOffer.amount)}</strong></p>
                <div class="flex">
                  <button id="acceptOfferBtn" class="primary-btn">Accept</button>
                  <button id="rejectOfferBtn" class="ghost-btn">Reject</button>
                </div>
              `
              : `<p class="note">No active incoming external offers.</p>`
          }
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Latest Awards</h3><span>${awards ? awards.year : "—"}</span></div>
          ${
            awards
              ? `
                <table>
                  <tbody>
                    <tr><td>MVP</td><td>${escapeHtml(awards.mvp)}</td></tr>
                    <tr><td>Golden Boot</td><td>${escapeHtml(awards.goldenBoot)}</td></tr>
                    <tr><td>Goalkeeper of the Year</td><td>${escapeHtml(awards.goalkeeper)}</td></tr>
                  </tbody>
                </table>
              `
              : `<p class="note">Awards will appear after the first completed season.</p>`
          }
        </div>
      </div>
    </div>
  `;
}

function renderRoster() {
  const team = getUserTeam(state);
  const players = getTeamPlayers(state, team.id);

  const rows = players.map(p => ({
    id: p.id,
    name: p.name,
    position: p.position,
    positionOrder: getPositionOrder(p.position),
    age: p.age,
    overall: p.overall,
    potential: p.potential,
    contract: `${formatMoney(p.contract.salary)} thru ${state.season.year + p.contract.yearsLeft}`,
    yearsLeft: p.contract.yearsLeft,
    morale: p.morale,
    role: p.rosterRole,
    tag: p.designation || (p.homegrown ? "HG" : p.domestic ? "DOM" : "INTL"),
    acquired: p.homegrown ? "Academy" : "Squad",
  }));

  const sorted = sortRows(rows, tableSortState.roster);

  return `
    ${pageHead("Roster", "Sortable squad table with separated positions")}
    <div class="panel">
      <div class="panel-head"><h3>First Team Squad</h3><span>${players.length} players</span></div>
      <table class="roster-table">
        <thead>
          <tr>
            ${makeSortableTh("Name", "roster", "name")}
            ${makeSortableTh("Pos", "roster", "position")}
            ${makeSortableTh("Age", "roster", "age", "num")}
            ${makeSortableTh("Ovr", "roster", "overall", "num")}
            ${makeSortableTh("Pot", "roster", "potential", "num")}
            ${makeSortableTh("Contract", "roster", "contract")}
            ${makeSortableTh("YWT", "roster", "yearsLeft", "num")}
            ${makeSortableTh("Mood", "roster", "morale", "num")}
            ${makeSortableTh("Role", "roster", "role")}
            ${makeSortableTh("Acquired", "roster", "acquired")}
          </tr>
        </thead>
        <tbody>
          ${sorted.map(p => `
            <tr>
              <td><strong>${escapeHtml(p.name)}</strong></td>
              <td><span class="pos-badge pos-${p.position}">${escapeHtml(p.position)}</span></td>
              <td class="num">${p.age}</td>
              <td class="num">${p.overall}</td>
              <td class="num">${p.potential}</td>
              <td>${escapeHtml(p.contract)}</td>
              <td class="num">${p.yearsLeft}</td>
              <td class="num">${p.morale}</td>
              <td>${escapeHtml(p.role)} <span class="badge">${escapeHtml(p.tag)}</span></td>
              <td>${escapeHtml(p.acquired)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAcademy() {
  const team = getUserTeam(state);
  const prospects = getTeamAcademy(state, team.id);

  return `
    ${pageHead("Youth Academy", "Develop homegrowns and call them up to the senior setup")}
    <div class="panel">
      <div class="panel-head"><h3>Academy Prospects</h3><span>${prospects.length} players</span></div>
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th><th>Notes</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${prospects.map(p => `
            <tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.position)}</td>
              <td class="num">${p.age}</td>
              <td class="num">${p.overall}</td>
              <td class="num">${p.potential}</td>
              <td>${escapeHtml(p.notes)}</td>
              <td class="num"><button class="small-btn academy-callup-btn" data-id="${p.id}">Call Up</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderStandings() {
  const renderTable = (conf, tableName) => {
    const mapped = state.standings[conf].map(r => ({
      ...r,
      name: byTeamId(r.teamId).name,
    }));

    const sorted = sortRows(mapped, tableSortState[tableName]);

    return `
      <div class="panel">
        <div class="panel-head"><h3>${escapeHtml(conf)} Conference</h3><span>Top 9 qualify</span></div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              ${makeSortableTh("Club", tableName, "name")}
              ${makeSortableTh("P", tableName, "played", "num")}
              ${makeSortableTh("W", tableName, "wins", "num")}
              ${makeSortableTh("D", tableName, "draws", "num")}
              ${makeSortableTh("L", tableName, "losses", "num")}
              ${makeSortableTh("GF", tableName, "gf", "num")}
              ${makeSortableTh("GA", tableName, "ga", "num")}
              ${makeSortableTh("GD", tableName, "gd", "num")}
              ${makeSortableTh("Pts", tableName, "points", "num")}
            </tr>
          </thead>
          <tbody>
            ${sorted.map((r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(r.name)}${r.teamId === state.userTeamId ? " <strong>(You)</strong>" : ""}</td>
                <td class="num">${r.played}</td>
                <td class="num">${r.wins}</td>
                <td class="num">${r.draws}</td>
                <td class="num">${r.losses}</td>
                <td class="num">${r.gf}</td>
                <td class="num">${r.ga}</td>
                <td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td>
                <td class="num"><strong>${r.points}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  return `
    ${pageHead("Standings", "Sortable conference tables")}
    ${renderTable("East", "standingsEast")}
    ${renderTable("West", "standingsWest")}
  `;
}

function renderSchedule() {
  const team = getUserTeam(state);
  const games = state.schedule.filter(m => m.homeTeamId === team.id || m.awayTeamId === team.id);

  return `
    ${pageHead("Schedule", "34-match regular season")}
    <div class="panel">
      <table>
        <thead><tr><th>Week</th><th>Opponent</th><th>Venue</th><th>Score</th><th>xG</th></tr></thead>
        <tbody>
          ${games.map(m => {
            const home = m.homeTeamId === team.id;
            const opp = byTeamId(home ? m.awayTeamId : m.homeTeamId);
            const score = !m.played ? "—" : `${m.result.homeGoals}-${m.result.awayGoals}${m.result.penalties ? ` (pens ${m.result.penalties.home}-${m.result.penalties.away})` : ""}`;
            const xg = !m.played ? "—" : `${m.result.homeXg} / ${m.result.awayXg}`;
            return `<tr><td>${m.week}</td><td>${escapeHtml(opp.name)}</td><td>${home ? "Home" : "Away"}</td><td>${score}</td><td>${xg}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderStats() {
  const active = state.players.filter(p => p.clubId);
  return `
    ${pageHead("Player Stats", "Season totals")}
    <div class="panel">
      <table>
        <thead><tr><th>Name</th><th>Club</th><th>Pos</th><th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">xG</th><th class="num">YC</th><th class="num">RC</th></tr></thead>
        <tbody>
          ${active.sort((a,b) => (b.stats.goals + b.stats.assists) - (a.stats.goals + a.stats.assists)).slice(0, 160).map(p => `
            <tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(byTeamId(p.clubId).shortName)}</td>
              <td>${escapeHtml(p.position)}</td>
              <td class="num">${p.stats.gp}</td>
              <td class="num">${p.stats.goals}</td>
              <td class="num">${p.stats.assists}</td>
              <td class="num">${p.stats.xg.toFixed(1)}</td>
              <td class="num">${p.stats.yellows}</td>
              <td class="num">${p.stats.reds}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTransactions() {
  return `
    ${pageHead("Transactions Log", "Signings, offers, injuries, academy, awards")}
    <div class="panel">
      <table>
        <thead><tr><th>Type</th><th>Season</th><th>Text</th></tr></thead>
        <tbody>
          ${state.transactions.map(tx => `
            <tr>
              <td><span class="badge">${escapeHtml(tx.type)}</span></td>
              <td>${tx.season}</td>
              <td>${escapeHtml(tx.text)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDraft() {
  const rows = state.draft.pool || [];
  return `
    ${pageHead("MLS SuperDraft", "Pool appears in the offseason")}
    <div class="panel">
      <div class="panel-head"><h3>Draft Pool</h3><span>${rows.length}</span></div>
      <table>
        <thead><tr><th>Name</th><th>College</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th></tr></thead>
        <tbody>
          ${rows.slice(0, 40).map(p => `
            <tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.college || "—")}</td>
              <td>${escapeHtml(p.position)}</td>
              <td class="num">${p.age}</td>
              <td class="num">${p.overall}</td>
              <td class="num">${p.potential}</td>
            </tr>
          `).join("") || `<tr><td colspan="6">Draft pool generates in offseason.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderPlayoffs() {
  if (!state.playoffs) {
    return `${pageHead("Playoffs", "Bracket appears after week 34")}<div class="panel"><p class="note">Regular season is still in progress.</p></div>`;
  }

  const nameOf = (id) => byTeamId(id)?.name || "—";

  const renderMatch = (m) => {
    if (m.seriesSummary) {
      return `
        <div class="card">
          <div class="card-label">${escapeHtml(m.conference)} Round One Series</div>
          <div class="card-note">${escapeHtml(nameOf(m.higher))} vs ${escapeHtml(nameOf(m.lower))} · Winner: <strong>${escapeHtml(nameOf(m.winner))}</strong></div>
        </div>
      `;
    }
    return `
      <div class="card">
        <div class="card-label">${escapeHtml(m.type)}</div>
        <div class="card-note"><strong>${escapeHtml(nameOf(m.homeTeamId))}</strong> ${m.result.homeGoals}-${m.result.awayGoals} <strong>${escapeHtml(nameOf(m.awayTeamId))}</strong>${m.result.penalties ? ` (pens ${m.result.penalties.home}-${m.result.penalties.away})` : ""}</div>
      </div>
    `;
  };

  return `
    ${pageHead("MLS Cup Playoffs", `Current round: ${escapeHtml(state.playoffs.currentRound)}`)}
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Wild Card</h3><span>8 vs 9</span></div>${state.playoffs.rounds.wildCard.map(renderMatch).join("") || `<p class="note">Not played yet.</p>`}</div>
      <div class="panel"><div class="panel-head"><h3>Round One</h3><span>Best of 3</span></div>${state.playoffs.rounds.roundOne.map(renderMatch).join("") || `<p class="note">Not played yet.</p>`}</div>
      <div class="panel"><div class="panel-head"><h3>Conference Semis</h3><span>Single elimination</span></div>${state.playoffs.rounds.semifinals.map(renderMatch).join("") || `<p class="note">Not played yet.</p>`}</div>
      <div class="panel"><div class="panel-head"><h3>Conference Finals / MLS Cup</h3><span>Single elimination</span></div>${[...state.playoffs.rounds.conferenceFinals, ...state.playoffs.rounds.cup].map(renderMatch).join("") || `<p class="note">Not played yet.</p>`}${state.playoffs.championTeamId ? `<p><strong>Champion:</strong> ${escapeHtml(nameOf(state.playoffs.championTeamId))}</p>` : ""}</div>
    </div>
  `;
}

async function renderSaves() {
  const slots = await listSlots();
  return `
    ${pageHead("Save System", "IndexedDB slots + JSON export/import")}
    <div class="panel">
      <div class="panel-head"><h3>Local Save Slots</h3><span>${slots.length}</span></div>
      ${slots.map(slot => `
        <div class="save-slot-card">
          <div><strong>${escapeHtml(slot.slot)}</strong></div>
          <div class="note">${new Date(slot.updatedAt).toLocaleString()}</div>
          <div class="save-slot-actions">
            <button class="small-btn load-slot-btn" data-slot="${slot.slot}">Load</button>
            <button class="small-btn delete-slot-btn" data-slot="${slot.slot}">Delete</button>
          </div>
        </div>
      `).join("") || `<p class="note">No saves yet.</p>`}
    </div>
  `;
}

async function renderPage() {
  if (!state) return;
  updateMeta();

  let html = "";
  if (currentPage === "dashboard") html = renderDashboard();
  else if (currentPage === "roster") html = renderRoster();
  else if (currentPage === "academy") html = renderAcademy();
  else if (currentPage === "standings") html = renderStandings();
  else if (currentPage === "schedule") html = renderSchedule();
  else if (currentPage === "stats") html = renderStats();
  else if (currentPage === "transactions") html = renderTransactions();
  else if (currentPage === "draft") html = renderDraft();
  else if (currentPage === "playoffs") html = renderPlayoffs();
  else if (currentPage === "saves") html = await renderSaves();

  $("#pageRoot").innerHTML = html;
  bindPageEvents();
  bindSortableHeaders();
}

function bindPageEvents() {
  $(".sign-fa-btn")?.addEventListener?.("click", () => {});
  $$(".sign-fa-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const result = signFreeAgent(state, btn.dataset.id, state.userTeamId);
      if (!result.ok) return toast(result.reason, "warn");
      await persist();
      toast("Free agent signed.", "success");
      renderPage();
    });
  });

  $$(".academy-callup-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const result = callUpAcademyPlayer(state, btn.dataset.id, state.userTeamId);
      if (!result.ok) return toast(result.reason, "warn");
      await persist();
      toast("Academy player called up.", "success");
      renderPage();
    });
  });

  $("#playMyMatchBtn")?.addEventListener("click", async () => {
  const userTeamId = state.userTeamId;
  const nextMatch = state.schedule.find(
    m => !m.played && (m.homeTeamId === userTeamId || m.awayTeamId === userTeamId)
  );

  if (!nextMatch) {
    toast("No match ready.", "warn");
    return;
  }

  if (!nextMatch.result) {
    const { simulateMatch } = await import("./sim.js");
    simulateMatch(state, nextMatch);
  }

    await playLiveMatch(nextMatch);
    await persist();
    await renderPage();
  });

  $("#acceptOfferBtn")?.addEventListener("click", async () => {
    acceptPendingOffer(state);
    await persist();
    toast("Offer accepted.", "success");
    renderPage();
  });

  $("#rejectOfferBtn")?.addEventListener("click", async () => {
    rejectPendingOffer(state);
    await persist();
    toast("Offer rejected.", "warn");
    renderPage();
  });

  $$(".load-slot-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const loaded = await loadSlot(btn.dataset.slot);
      if (!loaded) return;
      state = loaded;
      setAppVisible(true);
      closeOverlay($("#loadOverlay"));
      await renderPage();
      toast(`Loaded ${btn.dataset.slot}.`, "success");
    });
  });

  $$(".delete-slot-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteSlot(btn.dataset.slot);
      toast(`Deleted ${btn.dataset.slot}.`, "warn");
      renderPage();
    });
  });
}

function bindNav() {
  $$(".nav-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      currentPage = btn.dataset.page;
      $$(".nav-btn").forEach(b => b.classList.toggle("active", b === btn));
      await renderPage();
    });
  });
}

async function createLeagueFromForm() {
  const options = {
    saveSlot: $("#saveSlotInput").value.trim() || "slot1",
    userTeamName: $("#userTeamSelect").value,
    salaryBudget: Number($("#salaryCapInput").value) || 6425000,
    gamAnnual: Number($("#gamInput").value) || 3280000,
    tamAnnual: Number($("#tamInput").value) || 2125000,
    academyPerTeam: Number($("#academyInput").value) || 8,
  };

  state = createNewState(options);
  await persist();
  closeOverlay($("#setupOverlay"));
  setAppVisible(true);
  currentPage = "dashboard";
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === "dashboard"));
  await renderPage();
  toast(`League created in ${options.saveSlot}.`, "success");
}

async function openLoadModal() {
  const slots = await listSlots();
  $("#saveSlotsList").innerHTML = slots.length
    ? slots.map(slot => `
        <div class="save-slot-card">
          <div><strong>${escapeHtml(slot.slot)}</strong></div>
          <div class="note">${new Date(slot.updatedAt).toLocaleString()}</div>
          <div class="save-slot-actions">
            <button class="small-btn quick-load-btn" data-slot="${slot.slot}">Load</button>
          </div>
        </div>
      `).join("")
    : `<p class="note">No saves found.</p>`;

  openOverlay($("#loadOverlay"));

  $$(".quick-load-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const loaded = await loadSlot(btn.dataset.slot);
      if (!loaded) return toast("Save not found.", "error");
      state = loaded;
      closeOverlay($("#loadOverlay"));
      setAppVisible(true);
      await renderPage();
      toast(`Loaded ${btn.dataset.slot}.`, "success");
    });
  });
}

function setSimSpeed(key) {
  if (!SIM_SPEEDS[key]) return;
  simSpeedKey = key;
  simSpeed = SIM_SPEEDS[key];

  document.querySelectorAll(".sim-speed-opt").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.speed === key);
  });
}

function toggleSimPause() {
  simPaused = !simPaused;
  const btn = document.getElementById("sim-pause-btn");
  if (btn) {
    btn.textContent = simPaused ? "▶ Resume" : "⏸ Pause";
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bindTopLevel() {
  $("#showCreateLeagueBtn").addEventListener("click", () => openOverlay($("#setupOverlay")));
  $("#closeSetupBtn").addEventListener("click", () => closeOverlay($("#setupOverlay")));
  $("#showLoadLeagueBtn").addEventListener("click", openLoadModal);
  $("#closeLoadBtn").addEventListener("click", () => closeOverlay($("#loadOverlay")));
  $("#createLeagueBtn").addEventListener("click", createLeagueFromForm);

  $("#saveBtn").addEventListener("click", async () => {
    await persist();
    toast(`Saved to ${state.saveSlot}.`, "success");
  });

  $("#exportBtn").addEventListener("click", () => {
    if (!state) return;
    downloadJSON(`mls-gm-${state.saveSlot}.json`, state);
  });

  $("#importInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state = await readJSONFile(file);
    await persist();
    setAppVisible(true);
    await renderPage();
    toast("Imported save.", "success");
  });

  $("#backHomeBtn").addEventListener("click", () => {
    setAppVisible(false);
  });

  $("#simOneBtn")?.addEventListener("click", async () => {
  if (!state) return;

  if (state.season.phase !== "Regular Season") {
    advanceOneWeek(state);
    await persist();
    await renderPage();
    return;
  }

  const userTeamId = state.userTeamId;
  const nextMatch = state.schedule.find(
    m =>
      !m.played &&
      (m.homeTeamId === userTeamId || m.awayTeamId === userTeamId)
  );

  if (!nextMatch) {
    toast("No upcoming match found.", "warn");
    return;
  }

  if (!nextMatch.result) {
    const { simulateMatch } = await import("./sim.js");
    simulateMatch(state, nextMatch);
  }

  await playLiveMatch(nextMatch);
  await persist();
  await renderPage();
});

  $("#simWeekBtn").addEventListener("click", async () => {
    if (!state) return;
    advanceOneWeek(state);
    await persist();
    await renderPage();
  });

  $("#simSeasonBtn").addEventListener("click", async () => {
    if (!state) return;
    simulateToSeasonEnd(state);
    await persist();
    await renderPage();
  });

  $("#simYearBtn").addEventListener("click", async () => {
    if (!state) return;
    while (state.season.phase !== "Offseason") advanceOneWeek(state);
    advanceOneWeek(state);
    await persist();
    await renderPage();
  });
}

async function boot() {
  populateTeamSelect();

  try {
    await loadExternalData();
  } catch (err) {
    console.error("External data failed to load:", err);
  }

  bindTopLevel();
  bindNav();
  setAppVisible(false);
}

boot();
