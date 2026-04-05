import { $, $$, formatMoney, downloadJSON, readJSONFile, toast } from "./utils.js";
import { saveSlot, loadSlot, listSlots, deleteSlot } from "./db.js";
import { loadExternalData, externalDataStatus } from "./assets.js";
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

function renderDashboard() {
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
  const cap = getCapSummary(state, team.id);

  return `
    ${pageHead("Roster Management", "MLS senior / supplemental / reserve structure")}
    <div class="cards">
      <div class="card"><div class="card-label">Senior</div><div class="card-value">${cap.seniorCount}</div><div class="card-note">Max 20</div></div>
      <div class="card"><div class="card-label">Supplemental</div><div class="card-value">${cap.supplementalCount}</div><div class="card-note">Cap exempt</div></div>
      <div class="card"><div class="card-label">Reserve</div><div class="card-value">${cap.reserveCount}</div><div class="card-note">Developmental</div></div>
      <div class="card"><div class="card-label">Salary Budget</div><div class="card-value">${formatMoney(cap.budgetUsed)}</div><div class="card-note">${cap.budgetRoom >= 0 ? "Room" : "Over"} ${formatMoney(Math.abs(cap.budgetRoom))}</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Squad</h3><span>${players.length} players</span></div>
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
              <td>${escapeHtml(p.name)}${p.injuredUntil ? ` <span class="badge red">Inj</span>` : ""}</td>
              <td>${escapeHtml(p.position)}</td>
              <td class="num">${p.age}</td>
              <td class="num">${p.overall}</td>
              <td class="num">${p.potential}</td>
              <td>${escapeHtml(p.rosterRole)}</td>
              <td>${
                p.designation
                  ? `<span class="badge blue">${escapeHtml(p.designation)}</span>`
                  : p.homegrown
                    ? `<span class="badge green">HG</span>`
                    : p.domestic
                      ? "Domestic"
                      : `<span class="badge yellow">INTL</span>`
              }</td>
              <td class="num">${formatMoney(p.contract.salary)}</td>
              <td class="num">${formatMoney(p.rosterRole === "Senior" ? Math.min(p.contract.salary, 803125) : 0)}</td>
              <td class="num">${p.morale}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Free Agency</h3><span>Out-of-contract pool</span></div>
      <table>
        <thead><tr><th>Name</th><th>Pos</th><th class="num">Age</th><th class="num">OVR</th><th class="num">Salary</th><th>Nation</th><th></th></tr></thead>
        <tbody>
          ${state.freeAgents.slice(0, 24).map(p => `
            <tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.position)}</td>
              <td class="num">${p.age}</td>
              <td class="num">${p.overall}</td>
              <td class="num">${formatMoney(p.contract.salary)}</td>
              <td>${escapeHtml(p.nationality)}</td>
              <td class="num"><button class="small-btn sign-fa-btn" data-id="${p.id}">Sign</button></td>
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
  const renderTable = (conf) => `
    <div class="panel">
      <div class="panel-head"><h3>${escapeHtml(conf)} Conference</h3><span>Top 9 qualify</span></div>
      <table>
        <thead>
          <tr><th>#</th><th>Club</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GF</th><th class="num">GA</th><th class="num">GD</th><th class="num">Pts</th></tr>
        </thead>
        <tbody>
          ${state.standings[conf].map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(byTeamId(r.teamId).name)}${r.teamId === state.userTeamId ? " <strong>(You)</strong>" : ""}</td>
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

  return `${pageHead("Standings", "MLS tiebreaker ordering applied")}${renderTable("East")}${renderTable("West")}`;
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

  $("#simOneBtn").addEventListener("click", async () => {
    if (!state) return;
    advanceOneWeek(state);
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

function boot() {
  populateTeamSelect();
  bindTopLevel();
  bindNav();
  setAppVisible(false);
}

boot();
