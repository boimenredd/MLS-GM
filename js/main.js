import { createLeague } from './data.js';
import {
  generateSchedule,
  simulateMatch,
  weeklyMaintenance,
  startPlayoffs,
  simPlayoffRound,
} from './engine.js';
import {
  saveLeague,
  loadLeague,
  exportLeague,
  importLeague,
} from './storage.js';
import { renderTabs, renderPage } from './ui.js';

let state = createLeague();
generateSchedule(state);

let activeTab = 'Dashboard';

const content = document.getElementById('content');
const tabs = document.getElementById('tabs');
const teamSelect = document.getElementById('userTeamSelect');
const slotSelect = document.getElementById('saveSlotSelect');
const statusEl = document.getElementById('simStatus');

function status(txt) {
  statusEl.textContent = txt;
}

function populateTeamSelect() {
  teamSelect.innerHTML = state.teams
    .map(
      (t, i) => `
        <option value="${i}" ${i === state.meta.userTeamId ? 'selected' : ''}>
          ${t.name}
        </option>
      `
    )
    .join('');
}

function refresh() {
  populateTeamSelect();

  renderTabs(tabs, activeTab, (tab) => {
    activeTab = tab;
    refresh();
  });

  content.innerHTML = renderPage(state, activeTab);
}

function bindTopControls() {
  document.getElementById('newLeagueBtn').addEventListener('click', () => {
    state = createLeague();
    generateSchedule(state);
    activeTab = 'Dashboard';
    refresh();
    status('Created new league.');
  });

  document.getElementById('saveBtn').addEventListener('click', async () => {
    await saveLeague(slotSelect.value, state);
    status(`Saved to ${slotSelect.value}`);
  });

  document.getElementById('loadBtn').addEventListener('click', async () => {
    const loaded = await loadLeague(slotSelect.value);
    if (loaded) {
      state = loaded;
      refresh();
      status(`Loaded ${slotSelect.value}`);
    } else {
      status('No save found in that slot.');
    }
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    exportLeague(state);
    status('Exported save file.');
  });

  document.getElementById('importInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state = await importLeague(file);
    refresh();
    status('Imported save file.');
  });

  document.getElementById('simGameBtn').addEventListener('click', () => {
    simGames(1);
  });

  document.getElementById('simWeekBtn').addEventListener('click', () => {
    simCurrentWeek();
  });

  document.getElementById('simSeasonBtn').addEventListener('click', () => {
    simToSeasonEnd();
  });

  document.getElementById('simFiveSeasonsBtn').addEventListener('click', () => {
    simMultiSeason(5);
  });

  teamSelect.addEventListener('change', () => {
    state.meta.userTeamId = Number(teamSelect.value);
    refresh();
  });
}

function simGames(count) {
  if (state.meta.phase === 'playoffs') {
    for (let i = 0; i < count; i++) {
      simPlayoffRound(state);
    }
    refresh();
    return;
  }

  let played = 0;

  while (played < count && state.meta.gameIndex < state.schedule.length) {
    const g = state.schedule[state.meta.gameIndex];

    if (!g.played) {
      const res = simulateMatch(state, g, false);
      Object.assign(g, res, { played: true });
      played += 1;
    }

    state.meta.gameIndex += 1;
  }

  weeklyMaintenance(state);

  if (state.meta.gameIndex >= state.schedule.length) {
    startPlayoffs(state);
    status('Regular season complete. Playoffs started.');
  }

  refresh();
}

function simCurrentWeek() {
  if (state.meta.phase === 'playoffs') {
    simGames(1);
    return;
  }

  const currentWeek = state.meta.week;
  const games = state.schedule.filter(
    (g, i) => i >= state.meta.gameIndex && g.week === currentWeek && !g.played
  );

  for (const g of games) {
    const res = simulateMatch(state, g, false);
    Object.assign(g, res, { played: true });
    state.meta.gameIndex += 1;
  }

  state.meta.week += 1;
  weeklyMaintenance(state);

  if (state.meta.gameIndex >= state.schedule.length) {
    startPlayoffs(state);
    status('Regular season complete. Playoffs started.');
  }

  refresh();
}

function simToSeasonEnd() {
  if (state.meta.phase === 'playoffs') {
    while (state.meta.phase === 'playoffs') {
      simPlayoffRound(state);
    }
    refresh();
    return;
  }

  while (state.meta.phase === 'regular') {
    simCurrentWeek();
    if (state.meta.week > 60) break;
  }

  while (state.meta.phase === 'playoffs') {
    simPlayoffRound(state);
  }

  refresh();
}

function simMultiSeason(years) {
  for (let i = 0; i < years; i++) {
    simToSeasonEnd();
  }
  status(`Simulated ${years} seasons.`);
}

bindTopControls();
refresh();
