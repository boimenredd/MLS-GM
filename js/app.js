import { CONFERENCES, FORMATIONS } from "./data.js";
import {
  $, $$, formatMoney, downloadJSON, readJSONFile, toast,
} from "./utils.js";
import { saveSlot, loadSlot, listSlots, deleteSlot } from "./db.js";
import {
  createNewState,
  getUserTeam,
  getTeamPlayers,
  getCapSummary,
  advanceOneWeek,
  simulateToSeasonEnd,
  signFreeAgent,
  acceptPendingOffer,
  rejectPendingOffer,
} from "./sim.js";

let state = null;
let currentPage = "dashboard";

function currentTeam() {
  return getUserTeam(state);
}

function byIdTeam(id) {
  return state.teams.find(t => t.id === id);
}

function byIdPlayer(id) {
  return state.players.find(p => p.id === id);
}

function updateTopBar() {
  const team = currentTeam();
  $("#clubName").textContent = team?.name || "—";
  $("#seasonLabel").textContent = state?.season?.year || "—";
  $("#phaseLabel").textContent = state?.season?.phase || "—";
  $("#weekLabel").textContent = state?.calendar?.week || "—";
}

function switchPage(page) {
  currentPage = page;
  $$(".page").forEach(p => p.classList.remove("active"));
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $(`#page-${page}`).classList.add("active");
  render();
}

function pageHead(title, sub = "") {
  return `
    <div class="page-head">
      <div>
        <div class="page-title">${title}</div>
        <div class="page-sub">${sub}</div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const team = currentTeam();
  const cap = getCapSummary(state, team.id);
  const confRows = state.standings[team.conference];
  const rank = confRows.findIndex(r => r.teamId === team.id) + 1;
  const nextMatches = state.schedule.filter(m => !m.played && (m.homeTeamId === team.id || m.awayTeamId === team.id)).slice(0, 5);
  const pendingOffer = state.pendingOffer;

  const awards = state.awardsHistory[state.awardsHistory.length - 1];

  $("#page-dashboard").innerHTML = `
    ${pageHead("Dashboard", `${team.conference} Conference · Front office overview`)}

    <div class="cards">
      <div class="card"><div class="card-label">Conference Place</div><div class="card-value">${rank}</div><div class="card-note">${team.conference}</div></div>
      <div class="card"><div class="card-label">Budget Used</div><div class="card-value">${formatMoney(cap.budgetUsed)}</div><div class="card-note">${formatMoney(cap.budgetRoom)} room</div></div>
      <div class="card"><div class="card-label">GAM / TAM</div><div class="card-value">${formatMoney(team.gam)}</div><div class="card-note">TAM ${formatMoney(team.tam)}</div></div>
      <div class="card"><div class="card-label">International Slots</div><div class="card-value">${cap.intlUsed}/${cap.intlTotal}</div><div class="card-note">${cap.dpCount} DPs</div></div>
    </div>

    <div class="two-col">
      <div>
        <div class="panel">
          <div class="panel-title"><h3>Upcoming Matches</h3><span>Next 5</span></div>
          <table>
            <thead><tr><th>Week</th><th>Opponent</th><th>Venue</th></tr></thead>
            <tbody>
              ${nextMatches.map(m => {
                const home = m.homeTeamId === team.id;
                const opp = byIdTeam(home ? m.awayTeamId : m.homeTeamId);
                return `<tr><td>${m.week}</td><td>${opp.name}</td><td>${home ? "Home" : "Away"}</td></tr>`;
              }).join("") || `<tr><td colspan="3">No remaining matches.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <div class="panel-title"><h3>Recent Transactions</h3><span>Latest</span></div>
          <table>
            <thead><tr><th>Type</th><th>Detail</th></tr></thead>
            <tbody>
              ${state.transactions.slice(0, 10).map(tx => `<tr><td><span class="badge">${tx.type}</span></td><td>${tx.text}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="panel">
          <div class="panel-title"><h3>Standings Snapshot</h3><span>${team.conference}</span></div>
          <table>
            <thead><tr><th>#</th><th>Club</th><th class="num">Pts</th><th class="num">W</th><th class="num">GD</th></tr></thead>
            <tbody>
              ${confRows.slice(0, 9).map((r, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${byIdTeam(r.teamId).name}${r.teamId === team.id ? " <strong>(You)</strong>" : ""}</td>
                  <td class="num">${r.points}</td>
                  <td class="num">${r.wins}</td>
                  <td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <div class="panel-title"><h3>Incoming Offer</h3><span>External bid</span></div>
          ${pendingOffer ? `
            <p><strong>${pendingOffer.bidClub}</strong> wants <strong>${byIdPlayer(pendingOffer.playerId).name}</strong>.</p>
            <p>Offer value: <strong>${formatMoney(pendingOffer.amount)}</strong></p>
            <div class="flex">
              <button id="acceptOfferBtn" class="primary-btn">Accept</button>
              <button id="rejectOfferBtn" class="ghost-btn">Reject</button>
            </div>
          ` : `<p class="text-muted">No active incoming external offers.</p>`}
        </div>

        ${awards ? `
          <div class="panel">
            <div class="panel-title"><h3>Last Season Awards</h3><span>${awards.year}</span></div>
            <table>
              <tbody>
                <tr><td>MVP</td><td>${awards.mvp}</td></tr>
                <tr><td>Golden Boot</td><td>${awards.goldenBoot}</td></tr>
                <tr><td>Goalkeeper of the Year</td><td>${awards.goalkeeper}</td></tr>
              </tbody>
            </table>
          </div>
        ` : ""}
      </div>
    </div>
  `;

  $("#acceptOfferBtn")?.addEventListener("click", async () => {
    acceptPendingOffer(state);
    await persist();
    render();
  });
  $("#rejectOfferBtn")?.addEventListener("click", async () => {
    rejectPendingOffer(state);
    await persist();
    render();
  });
}

function renderRoster() {
  const team = currentTeam();
  const players = getTeamPlayers(state, team.id);
  const cap = getCapSummary(state, team.id);

  $("#page-roster").innerHTML = `
    ${pageHead("Roster Management", "Senior / supplemental / reserve with MLS budget charges")}
    <div class="cards">
      <div class="card"><div class="card-label">Senior</div><div class="card-value">${cap.seniorCount}</div><div class="card-note">Max 20</div></div>
      <div class="card"><div class="card-label">Supplemental</div><div class="card-value">${cap.supplementalCount}</div><div class="card-note">Cap exempt</div></div>
      <div class="card"><div class="card-label">Reserve</div><div class="card-value">${cap.reserveCount}</div><div class="card-note">Developmental</div></div>
      <div class="card"><div class="card-label">Salary Budget</div><div class="card-value">${formatMoney(cap.budgetUsed)}</div><div class="card-note">${cap.budgetRoom >= 0 ? "Room" : "Over"} ${formatMoney(Math.abs(cap.budgetRoom))}</div></div>
    </div>

    <div class="panel">
      <div class="panel-title"><h3>Squad</h3><span>${players.length} players</span></div>
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th>
            <th>Role</th><th>Tag</th><th class="num">Salary</th><th class="num">Budget Charge</th><th class="num">Morale</th>
          </tr>
        </thead>
        <tbody>
          ${players.map(p => `
            <tr>
              <td>${p.name}${p.injuredUntil ? ` <span class="badge red">Inj</span>` : ""}</td>
              <td>${p.position}</td>
              <td class="num">${p.age}</td>
              <td class="num">${p.overall}</td>
              <td class="num">${p.potential}</td>
              <td>${p.rosterRole}</td>
              <td>${p.designation ? `<span class="badge blue">${p.designation}</span>` : p.homegrown ? `<span class="badge green">HG</span>` : p.domestic ? "Domestic" : `<span class="badge purple">INTL</span>`}</td>
              <td class="num">${formatMoney(p.contract.salary)}</td>
              <td class="num">${formatMoney(p.budgetChargeApplied || 0)}</td>
              <td class="num">${p.morale}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div class="panel">
      <div class="panel-title"><h3>Free Agency</h3><span>Only internal pool + out-of-contract players</span></div>
      <table>
        <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">Salary</th><th>Nation</th><th></th></tr></thead>
        <tbody>
          ${state.freeAgents.slice(0, 24).map(p => `
            <tr>
              <td>${p.name}</td>
              <td>${p.position}</td>
              <td class="num">${p.age}</td>
              <td class="num">${p.overall}</td>
              <td class="num">${formatMoney(p.contract.salary)}</td>
              <td>${p.nationality}</td>
              <td class="num"><button class="small-btn sign-fa-btn" data-id="${p.id}">Sign</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  $$(".sign-fa-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const result = signFreeAgent(state, btn.dataset.id, team.id);
      if (!result.ok) {
        toast(result.reason, "warn");
        return;
      }
      toast("Player signed.", "success");
      await persist();
      render();
    });
  });
}

function renderLineup() {
  const team = currentTeam();
  const players = getTeamPlayers(state, team.id);
  const formation = team.lineup.formation || "4-3-3";
  const shape = FORMATIONS[formation];
  const selected = team.lineup.playerIds.map(id => byIdPlayer(id)).filter(Boolean);

  const rows = [
    [shape[0]],
    shape.slice(1, 5),
    shape.slice(5, 8),
    shape.slice(8, 10),
    shape.slice(10),
  ];

  const byRole = [...selected];
  const takeForRole = (role) => {
    const exact = byRole.find(p => p.position === role || (role === "LB" || role === "RB" ? p.position === "FB" : false));
    if (exact) {
      byRole.splice(byRole.indexOf(exact), 1);
      return exact;
    }
    return byRole.shift() || null;
  };

  $("#page-lineup").innerHTML = `
    ${pageHead("Lineup Builder", "Click auto-select to refresh best XI")}
    <div class="panel">
      <div class="flex">
        <div style="min-width:220px">
          <label for="formationSelect">Formation</label>
          <select id="formationSelect">
            ${Object.keys(FORMATIONS).map(f => `<option value="${f}" ${f === formation ? "selected" : ""}>${f}</option>`).join("")}
          </select>
        </div>
        <button id="autoLineupBtn" class="primary-btn" style="width:auto">Auto Best XI</button>
      </div>
    </div>

    <div class="formation">
      ${rows.map(row => `
        <div class="form-row">
          ${row.map(role => {
            const p = takeForRole(role);
            return `
              <div class="slot">
                <div class="dot">${role}</div>
                <strong>${p ? p.name : "—"}</strong>
                <small>${p ? `${p.position} · ${p.overall}` : ""}</small>
              </div>
            `;
          }).join("")}
        </div>
      `).join("")}
    </div>

    <div class="panel">
      <div class="panel-title"><h3>Best XI Candidates</h3><span>Top squad players</span></div>
      <table>
        <thead><tr><th>Name</th><th>Pos</th><th class="num">OVR</th><th class="num">Morale</th></tr></thead>
        <tbody>
          ${players.slice(0, 20).map(p => `<tr><td>${p.name}</td><td>${p.position}</td><td class="num">${p.overall}</td><td class="num">${p.morale}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  $("#formationSelect").addEventListener("change", async (e) => {
    team.lineup.formation = e.target.value;
    await persist();
    render();
  });

  $("#autoLineupBtn").addEventListener("click", async () => {
    team.lineup.playerIds = players.slice(0, 11).map(p => p.id);
    await persist();
    render();
  });
}

function renderStandings() {
  const tableFor = (conf) => `
    <div class="panel">
      <div class="panel-title"><h3>${conf} Conference</h3><span>Top 9 qualify</span></div>
      <table>
        <thead>
          <tr><th>#</th><th>Club</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GF</th><th class="num">GA</th><th class="num">GD</th><th class="num">Pts</th></tr>
        </thead>
        <tbody>
          ${state.standings[conf].map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${byIdTeam(r.teamId).name}${r.teamId === state.userTeamId ? " <strong>(You)</strong>" : ""}</td>
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

  $("#page-standings").innerHTML = `
    ${pageHead("Standings", "Official MLS-style conference table ordering")}
    ${tableFor("East")}
    ${tableFor("West")}
  `;
}

function renderSchedule() {
  const team = currentTeam();
  const games = state.schedule.filter(m => m.homeTeamId === team.id || m.awayTeamId === team.id);

  $("#page-schedule").innerHTML = `
    ${pageHead("Schedule", "34-match regular season")}
    <div class="panel">
      <table>
        <thead><tr><th>Week</th><th>Opponent</th><th>Venue</th><th>Score</th><th>xG</th></tr></thead>
        <tbody>
          ${games.map(m => {
            const home = m.homeTeamId === team.id;
            const opp = byIdTeam(home ? m.awayTeamId : m.homeTeamId);
            const score = !m.played ? "—" : `${m.result.homeGoals}-${m.result.awayGoals}${m.result.penalties ? ` (pens ${m.result.penalties.home}-${m.result.penalties.away})` : ""}`;
            const xg = !m.played ? "—" : `${m.result.homeXg} / ${m.result.awayXg}`;
            return `<tr><td>${m.week}</td><td>${opp.name}</td><td>${home ? "Home" : "Away"}</td><td>${score}</td><td>${xg}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderStats() {
  const active = state.players.filter(p => p.clubId);
  $("#page-stats").innerHTML = `
    ${pageHead("Player Stats", "Season totals")}
    <div class="panel">
      <table>
        <thead><tr><th>Name</th><th>Club</th><th>Pos</th><th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">xG</th><th class="num">YC</th><th class="num">RC</th></tr></thead>
        <tbody>
          ${active.sort((a,b) => (b.stats.goals + b.stats.assists) - (a.stats.goals + a.stats.assists)).slice(0, 150).map(p => `
            <tr>
              <td>${p.name}</td>
              <td>${byIdTeam(p.clubId).shortName}</td>
              <td>${p.position}</td>
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

function renderLeaders() {
  const active = state.players.filter(p => p.clubId);
  const goals = [...active].sort((a,b) => b.stats.goals - a.stats.goals).slice(0, 10);
  const assists = [...active].sort((a,b) => b.stats.assists - a.stats.assists).slice(0, 10);
  const gk = [...active].filter(p => p.position === "GK").sort((a,b) => b.stats.cleanSheets - a.stats.cleanSheets).slice(0, 10);

  const table = (title, rows, valueKey) => `
    <div class="panel">
      <div class="panel-title"><h3>${title}</h3><span>Top 10</span></div>
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Club</th><th class="num">${valueKey}</th></tr></thead>
        <tbody>${rows.map((p, i) => `<tr><td>${i + 1}</td><td>${p.name}</td><td>${byIdTeam(p.clubId).shortName}</td><td class="num">${title === "Goalkeeper of the Year Race" ? p.stats.cleanSheets : title === "Golden Boot Race" ? p.stats.goals : p.stats.assists}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;

  $("#page-leaders").innerHTML = `
    ${pageHead("League Leaders", "Awards races and stat leaders")}
    <div class="grid-3">
      ${table("Golden Boot Race", goals, "Goals")}
      ${table("Assist Leaders", assists, "Assists")}
      ${table("Goalkeeper of the Year Race", gk, "CS")}
    </div>
  `;
}

function renderTransactions() {
  $("#page-transactions").innerHTML = `
    ${pageHead("Transactions Log", "Signings, injuries, draft, offers, awards")}
    <div class="panel">
      <table>
        <thead><tr><th>Type</th><th>Season</th><th>Text</th></tr></thead>
        <tbody>
          ${state.transactions.map(tx => `<tr><td><span class="badge">${tx.type}</span></td><td>${tx.season}</td><td>${tx.text}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDraft() {
  const orderEastWest = [
    ...state.standings.East.map(r => byIdTeam(r.teamId).name),
    ...state.standings.West.map(r => byIdTeam(r.teamId).name),
  ];

  $("#page-draft").innerHTML = `
    ${pageHead("MLS SuperDraft", state.draft.completedForYear ? "Draft completed this offseason" : "Draft is held in the offseason")}
    <div class="panel">
      <div class="panel-title"><h3>Preview</h3><span>Worst teams pick earlier</span></div>
      <table>
        <thead><tr><th>Projected Order Snapshot</th></tr></thead>
        <tbody>${orderEastWest.slice(-10).map(name => `<tr><td>${name}</td></tr>`).join("")}</tbody>
      </table>
    </div>

    <div class="panel">
      <div class="panel-title"><h3>Recent Draft Class</h3><span>Latest available pool view</span></div>
      <table>
        <thead><tr><th>Name</th><th>College</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">POT</th></tr></thead>
        <tbody>
          ${state.draft.pool.slice(0, 25).map(p => `<tr><td>${p.name}</td><td>${p.college || "—"}</td><td>${p.position}</td><td class="num">${p.age}</td><td class="num">${p.overall}</td><td class="num">${p.potential}</td></tr>`).join("") || `<tr><td colspan="6">Pool is generated during the offseason draft phase.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function renderPlayoffs() {
  const p = state.playoffs;
  if (!p) {
    $("#page-playoffs").innerHTML = `${pageHead("Playoffs", "Bracket appears after week 34")}<div class="panel"><p class="text-muted">Regular season is still in progress.</p></div>`;
    return;
  }

  const teamName = (id) => byIdTeam(id)?.name || "—";
  const fmt = (m) => {
    if (m.seriesSummary) {
      return `<div class="card"><div class="card-label">${m.conference} Round One Series</div><div class="card-note">${teamName(m.higher)} vs ${teamName(m.lower)} · Winner: <strong>${teamName(m.winner)}</strong></div></div>`;
    }
    if (!m.result) return `<div class="card"><div class="card-note">${teamName(m.homeTeamId)} vs ${teamName(m.awayTeamId)}</div></div>`;
    return `<div class="card"><div class="card-label">${m.type}</div><div class="card-note"><strong>${teamName(m.homeTeamId)}</strong> ${m.result.homeGoals}-${m.result.awayGoals} <strong>${teamName(m.awayTeamId)}</strong>${m.result.penalties ? ` (pens ${m.result.penalties.home}-${m.result.penalties.away})` : ""}</div></div>`;
  };

  $("#page-playoffs").innerHTML = `
    ${pageHead("MLS Cup Playoffs", `Current round: ${p.currentRound}`)}
    <div class="grid-4">
      <div><h3>Wild Card</h3>${p.rounds.wildCard.map(fmt).join("") || `<div class="panel"><p>Not played yet.</p></div>`}</div>
      <div><h3>Round One</h3>${p.rounds.roundOne.map(fmt).join("") || `<div class="panel"><p>Not played yet.</p></div>`}</div>
      <div><h3>Semis / Finals</h3>${[...p.rounds.semifinals, ...p.rounds.conferenceFinals].map(fmt).join("") || `<div class="panel"><p>Not played yet.</p></div>`}</div>
      <div><h3>MLS Cup</h3>${p.rounds.cup.map(fmt).join("") || `<div class="panel"><p>Not played yet.</p></div>`}${p.championTeamId ? `<div class="panel"><h3>Champion</h3><p><strong>${teamName(p.championTeamId)}</strong></p></div>` : ""}</div>
    </div>
  `;
}

async function renderSaves() {
  const slots = await listSlots();
  $("#page-saves").innerHTML = `
    ${pageHead("Save System", "IndexedDB slots + export/import")}
    <div class="grid-2">
      <div class="panel">
        <div class="panel-title"><h3>Local Save Slots</h3><span>${slots.length}</span></div>
        <table>
          <thead><tr><th>Slot</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            ${slots.map(s => `
              <tr>
                <td>${s.slot}</td>
                <td>${new Date(s.updatedAt).toLocaleString()}</td>
                <td class="num">
                  <button class="small-btn load-slot-btn" data-slot="${s.slot}">Load</button>
                  <button class="danger-btn delete-slot-btn" data-slot="${s.slot}">Delete</button>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="3">No save slots yet.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <div class="panel-title"><h3>Import / Export</h3><span>JSON</span></div>
        <div class="flex">
          <button id="exportBtn" class="primary-btn" style="width:auto">Export Save</button>
          <input id="importInput" type="file" accept="application/json" />
        </div>
      </div>
    </div>
  `;

  $$(".load-slot-btn").forEach(btn => btn.addEventListener("click", async () => {
    const loaded = await loadSlot(btn.dataset.slot);
    if (!loaded) return;
    state = loaded;
    state.saveSlot = btn.dataset.slot;
    updateTopBar();
    render();
    toast(`Loaded slot "${btn.dataset.slot}".`, "success");
  }));

  $$(".delete-slot-btn").forEach(btn => btn.addEventListener("click", async () => {
    await deleteSlot(btn.dataset.slot);
    toast(`Deleted slot "${btn.dataset.slot}".`, "warn");
    renderSaves();
  }));

  $("#exportBtn").addEventListener("click", () => {
    downloadJSON(`mls-save-${state.saveSlot || "default"}.json`, state);
  });

  $("#importInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await readJSONFile(file);
    state = data;
    await persist();
    updateTopBar();
    render();
    toast("Imported save.", "success");
  });
}

function render() {
  if (!state) return;
  updateTopBar();
  renderDashboard();
  renderRoster();
  renderLineup();
  renderStandings();
  renderSchedule();
  renderStats();
  renderLeaders();
  renderTransactions();
  renderDraft();
  renderPlayoffs();
  renderSaves();
}

async function persist() {
  if (!state) return;
  await saveSlot(state.saveSlot || "default", state);
}

function populateBootTeams() {
  const select = $("#userTeamSelect");
  const teams = [...CONFERENCES.East, ...CONFERENCES.West];
  select.innerHTML = teams.map(name => `<option value="${name}">${name}</option>`).join("");
}

function attachGlobalEvents() {
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchPage(btn.dataset.page)));

  $("#themeBtn").addEventListener("click", () => {
    document.body.classList.toggle("light");
  });

  $("#saveBtn").addEventListener("click", async () => {
    await persist();
    toast(`Saved to slot "${state.saveSlot}".`, "success");
  });

  $("#simOneBtn").addEventListener("click", async () => {
    advanceOneWeek(state);
    await persist();
    render();
  });

  $("#simWeekBtn").addEventListener("click", async () => {
    advanceOneWeek(state);
    await persist();
    render();
  });

  $("#simSeasonBtn").addEventListener("click", async () => {
    simulateToSeasonEnd(state);
    await persist();
    render();
  });

  $("#simYearBtn").addEventListener("click", async () => {
    while (state.season.phase !== "Offseason") advanceOneWeek(state);
    advanceOneWeek(state);
    await persist();
    render();
  });

  $("#newLeagueBtn").addEventListener("click", async () => {
    const teamName = $("#userTeamSelect").value;
    const slot = $("#saveSlotInput").value.trim() || "default";
    state = createNewState(teamName);
    state.saveSlot = slot;
    await persist();
    $("#bootOverlay").classList.remove("open");
    updateTopBar();
    render();
    toast(`Created new league in slot "${slot}".`, "success");
  });

  $("#loadLeagueBtn").addEventListener("click", async () => {
    const slot = $("#saveSlotInput").value.trim() || "default";
    const loaded = await loadSlot(slot);
    if (!loaded) {
      toast(`No save found in slot "${slot}".`, "warn");
      return;
    }
    state = loaded;
    state.saveSlot = slot;
    $("#bootOverlay").classList.remove("open");
    updateTopBar();
    render();
    toast(`Loaded slot "${slot}".`, "success");
  });

  $("#closeMatchBtn").addEventListener("click", () => {
    $("#matchOverlay").classList.remove("open");
  });
}

import { renderTabs, renderPage } from './ui.js';

populateBootTeams();
attachGlobalEvents();
