import { standings, teamOverall } from './sim.js';

export const TABS = [
  'Dashboard',
  'Roster',
  'Standings',
  'Schedule'
];

export function renderTabs(el, active, onClick) {
  el.innerHTML = TABS.map(tab => `
    <button class="tab ${tab === active ? 'active' : ''}" data-tab="${tab}">
      ${tab}
    </button>
  `).join('');

  el.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => onClick(btn.dataset.tab);
  });
}

export function renderPage(state, tab) {
  switch (tab) {
    case 'Dashboard': return dashboard(state);
    case 'Roster': return roster(state);
    case 'Standings': return standingsView(state);
    case 'Schedule': return schedule(state);
    default: return `<div>Unknown tab</div>`;
  }
}

function dashboard(state) {
  const team = state.teams[state.meta.userTeamId];

  return `
    <h2>${team.name}</h2>
    <p>Record: ${team.wins}-${team.draws}-${team.losses}</p>
    <p>Points: ${team.points}</p>
    <p>OVR: ${teamOverall(team).toFixed(1)}</p>
  `;
}

function roster(state) {
  const team = state.teams[state.meta.userTeamId];

  return `
    <h2>Roster</h2>
    <table>
      <tr>
        <th>Name</th>
        <th>Pos</th>
        <th>Age</th>
      </tr>
      ${team.players.map(p => `
        <tr>
          <td>${p.name}</td>
          <td>${p.position}</td>
          <td>${p.age}</td>
        </tr>
      `).join('')}
    </table>
  `;
}

function standingsView(state) {
  const rows = standings(state).map((t, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${t.name}</td>
      <td>${t.points}</td>
    </tr>
  `).join('');

  return `
    <h2>Standings</h2>
    <table>
      <tr>
        <th>#</th>
        <th>Team</th>
        <th>Pts</th>
      </tr>
      ${rows}
    </table>
  `;
}

function schedule(state) {
  return `
    <h2>Schedule</h2>
    <p>${state.schedule.length} games generated</p>
  `;
}
