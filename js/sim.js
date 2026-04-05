import {
  MLS_RULES,
  CONFERENCES,
  RIVALRIES,
  FORMATIONS,
  POSITIONS,
  NATIONS,
  FIRST_NAMES,
  LAST_NAMES,
  COLLEGES,
  DISCIPLINE_POINTS,
} from "./data.js";
import {
  clamp,
  randInt,
  randFloat,
  pick,
  uuid,
  deepClone,
  weightedRandom,
  sortStandingsRows,
} from "./utils.js";

function posBucket(pos) {
  if (pos === "GK") return "GK";
  if (pos === "CB" || pos === "FB") return "DEF";
  if (pos === "CDM" || pos === "CM" || pos === "CAM") return "MID";
  return "ATT";
}

function domesticForTeam(playerNation, clubCountry) {
  if (clubCountry === "Canada") {
    return playerNation === "Canada" || playerNation === "USA";
  }
  return playerNation === "USA";
}

function randomName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function computeOverall(attrs, pos) {
  const base = (
    attrs.pace +
    attrs.shooting +
    attrs.passing +
    attrs.dribbling +
    attrs.defense +
    attrs.physical
  ) / 6;

  const bonuses = {
    GK: (attrs.defense * 0.35 + attrs.passing * 0.15 + attrs.physical * 0.20),
    CB: (attrs.defense * 0.35 + attrs.physical * 0.2),
    FB: (attrs.defense * 0.2 + attrs.pace * 0.2 + attrs.passing * 0.1),
    CDM: (attrs.defense * 0.25 + attrs.passing * 0.15 + attrs.physical * 0.1),
    CM: (attrs.passing * 0.25 + attrs.dribbling * 0.1),
    CAM: (attrs.passing * 0.25 + attrs.shooting * 0.15 + attrs.dribbling * 0.15),
    Winger: (attrs.pace * 0.2 + attrs.dribbling * 0.2 + attrs.shooting * 0.1),
    ST: (attrs.shooting * 0.3 + attrs.physical * 0.15 + attrs.pace * 0.1),
  }[pos] || 0;

  return Math.round(clamp(base * 0.65 + bonuses * 0.35, 40, 92));
}

function makeAttributes(pos, quality = 60, age = 25) {
  const spread = randInt(-7, 7);
  const ageCurve = age < 22 ? 2 : age <= 29 ? 4 : -Math.floor((age - 29) * 1.1);
  const base = quality + spread + ageCurve;

  const map = {
    GK:      [48, 32, 58, 36, 73, 64],
    CB:      [59, 35, 58, 50, 74, 74],
    FB:      [74, 42, 62, 60, 68, 66],
    CDM:     [58, 45, 69, 58, 74, 72],
    CM:      [62, 51, 74, 67, 62, 67],
    CAM:     [67, 70, 78, 78, 44, 58],
    Winger:  [80, 71, 68, 79, 40, 58],
    ST:      [73, 79, 58, 68, 35, 73],
  }[pos];

  const [pace, shooting, passing, dribbling, defense, physical] = map.map(v =>
    clamp(Math.round(v + (base - 60) * 0.65 + randInt(-8, 8)), 30, 95)
  );

  return { pace, shooting, passing, dribbling, defense, physical };
}

function generatePlayer(club, idx, forcedPos = null) {
  const positionWeights = [
    { value: "GK", weight: 2 },
    { value: "CB", weight: 4 },
    { value: "FB", weight: 4 },
    { value: "CDM", weight: 2 },
    { value: "CM", weight: 5 },
    { value: "CAM", weight: 2 },
    { value: "Winger", weight: 4 },
    { value: "ST", weight: 3 },
  ];

  const position = forcedPos || weightedRandom(positionWeights);
  const age = randInt(17, 34);

  const nationPool = club.country === "Canada"
    ? ["Canada", "USA", ...NATIONS]
    : ["USA", ...NATIONS];

  const nationality = pick(nationPool);
  const domestic = domesticForTeam(nationality, club.country);
  const preferredFoot = Math.random() < 0.76 ? "Right" : "Left";

  let qualityBase = club.marketRating + randInt(-10, 10);
  if (idx < 3) qualityBase += 10;
  if (idx > 20) qualityBase -= 6;

  const homegrown = age <= 22 && Math.random() < 0.22;
  const attrs = makeAttributes(position, clamp(qualityBase, 48, 84), age);
  const overall = computeOverall(attrs, position);
  const potential = clamp(overall + randInt(-3, 14) + (age <= 22 ? 8 : 0), overall, 93);

  const salaryBase = Math.max(
    age <= 21 ? MLS_RULES.reserveMin : MLS_RULES.seniorMin,
    Math.round(overall * overall * 90 + randInt(-50000, 100000))
  );

  let designation = null;
  if (idx === 0 && overall >= 76 && Math.random() < 0.65) designation = "DP";
  else if (age <= 22 && overall >= 64 && Math.random() < 0.24) designation = "U22";
  else if (salaryBase > MLS_RULES.maxBudgetCharge && Math.random() < 0.42) designation = "TAM";

  const salary = designation === "DP"
    ? Math.max(salaryBase, randInt(1_400_000, 6_200_000))
    : designation === "TAM"
      ? clamp(Math.max(salaryBase, randInt(850_000, 1_750_000)), 820000, MLS_RULES.tamUpperSalary)
      : salaryBase;

  const rosterRole =
    idx < 18 ? "Senior" :
    idx < 24 ? "Supplemental" :
    "Reserve";

  return {
    id: uuid("p"),
    name: randomName(),
    age,
    nationality,
    domestic,
    preferredFoot,
    clubId: club.id,
    position,
    rosterRole,
    designation,
    homegrown,
    intlSlotExempt: false,
    contract: {
      yearsLeft: randInt(1, 5),
      salary,
      status: "Active",
    },
    morale: clamp(65 + randInt(-12, 12), 20, 100),
    injuryProne: Math.random() < 0.08,
    injuredUntil: null,
    attributes: attrs,
    overall,
    potential,
    budgetChargeApplied: 0,
    allocation: { gam: 0, tam: 0 },
    stats: {
      gp: 0, gs: 0, min: 0,
      goals: 0, assists: 0,
      shots: 0, shotsOnTarget: 0, xg: 0,
      yellows: 0, reds: 0,
      cleanSheets: 0, ga: 0,
      motm: 0,
    },
  };
}

function getClubCountry(name) {
  return ["Toronto FC", "CF Montréal", "Vancouver Whitecaps FC"].includes(name) ? "Canada" : "USA";
}

function getShortName(name) {
  return name
    .replace("Football Club", "FC")
    .replace("CITY", "CITY")
    .replace("Sounders FC", "Sounders")
    .replace("Whitecaps FC", "Whitecaps")
    .replace("United FC", "United")
    .replace("Revolution", "Revs");
}

function initStandingsRow(teamId) {
  return {
    teamId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    awayGf: 0,
    awayGa: 0,
    awayGd: 0,
    homeGf: 0,
    homeGa: 0,
    homeGd: 0,
    disciplinePoints: 0,
    points: 0,
    randomTiebreak: Math.random(),
  };
}

export function getBudgetCharge(player) {
  const salary = player.contract.salary;
  const role = player.rosterRole;
  if (role !== "Senior") return 0;
  if (player.homegrown && role !== "Senior") return 0;

  let charge = Math.min(salary, MLS_RULES.maxBudgetCharge);

  if (player.designation === "DP") {
    if (player.age <= 20) charge = MLS_RULES.youngDpBudgetU20;
    else if (player.age <= 23) charge = MLS_RULES.youngDpBudgetU23;
    else charge = MLS_RULES.maxBudgetCharge;
  } else if (player.designation === "U22") {
    charge = player.age <= 20 ? MLS_RULES.youngDpBudgetU20 : MLS_RULES.youngDpBudgetU23;
  } else if (player.designation === "TAM") {
    charge = clamp(salary - Math.min(player.allocation.tam, salary), 150000, MLS_RULES.maxBudgetCharge);
  } else {
    charge = clamp(salary - Math.min(player.allocation.gam, salary * 0.5), MLS_RULES.reserveMin, MLS_RULES.maxBudgetCharge);
  }

  if (player.designation === "DP") {
    charge = Math.max(150000, charge - player.allocation.gam);
  }

  return Math.round(charge);
}

function teamStrength(state, teamId, useLineup = true) {
  const team = state.teams.find(t => t.id === teamId);
  const squad = state.players.filter(p => p.clubId === teamId && (!p.injuredUntil || p.injuredUntil < state.calendar.absoluteDay));
  const lineupIds = team.lineup?.playerIds || [];
  let chosen = useLineup ? squad.filter(p => lineupIds.includes(p.id)) : [];
  if (chosen.length < 11) {
    const fallback = [...squad].sort((a,b) => b.overall - a.overall);
    chosen = fallback.slice(0, 11);
  }

  const total = chosen.reduce((sum, p) => sum + p.overall, 0) / Math.max(chosen.length, 1);
  const moraleAdj = chosen.reduce((sum, p) => sum + (p.morale - 60) * 0.03, 0) / Math.max(chosen.length, 1);
  return total + moraleAdj;
}

function getRivalBoost(homeName, awayName) {
  const found = RIVALRIES.some(([a, b]) =>
    (a === homeName && b === awayName) || (a === awayName && b === homeName)
  );
  return found ? 0.08 : 0;
}

function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function minuteSet(goals) {
  const minutes = [];
  for (let i = 0; i < goals; i++) minutes.push(randInt(3, 90));
  return minutes.sort((a, b) => a - b);
}

function chooseScorer(players, sidePos = "ATT") {
  const weights = players.map(p => {
    const bucket = posBucket(p.position);
    let weight = 1;
    if (sidePos === "ATT") {
      if (bucket === "ATT") weight = 5;
      else if (bucket === "MID") weight = 3;
      else if (bucket === "DEF") weight = 1.1;
      else weight = 0.3;
    }
    weight *= Math.max(0.5, p.overall / 70);
    return { value: p, weight };
  });
  return weightedRandom(weights);
}

function recordDiscipline(row, yellows, reds) {
  row.disciplinePoints += yellows * DISCIPLINE_POINTS.yellow + reds * DISCIPLINE_POINTS.straightRed;
}

function addTransaction(state, type, text) {
  state.transactions.unshift({
    id: uuid("tx"),
    season: state.season.year,
    day: state.calendar.absoluteDay,
    type,
    text,
  });
  if (state.transactions.length > 400) state.transactions.pop();
}

function applyResultToStandings(state, match) {
  const homeRow = state.standings[match.homeConf].find(r => r.teamId === match.homeTeamId);
  const awayRow = state.standings[match.awayConf].find(r => r.teamId === match.awayTeamId);
  const { homeGoals, awayGoals, homeYellows, awayYellows, homeReds, awayReds } = match.result;

  for (const row of [homeRow, awayRow]) row.played += 1;
  homeRow.gf += homeGoals; homeRow.ga += awayGoals; homeRow.gd = homeRow.gf - homeRow.ga;
  awayRow.gf += awayGoals; awayRow.ga += homeGoals; awayRow.gd = awayRow.gf - awayRow.ga;

  homeRow.homeGf += homeGoals; homeRow.homeGa += awayGoals; homeRow.homeGd = homeRow.homeGf - homeRow.homeGa;
  awayRow.awayGf += awayGoals; awayRow.awayGa += homeGoals; awayRow.awayGd = awayRow.awayGf - awayRow.awayGa;

  recordDiscipline(homeRow, homeYellows, homeReds);
  recordDiscipline(awayRow, awayYellows, awayReds);

  if (homeGoals > awayGoals) {
    homeRow.wins++; homeRow.points += 3; awayRow.losses++;
  } else if (awayGoals > homeGoals) {
    awayRow.wins++; awayRow.points += 3; homeRow.losses++;
  } else {
    homeRow.draws++; awayRow.draws++;
    homeRow.points++; awayRow.points++;
  }

  state.standings[match.homeConf].sort(sortStandingsRows);
  state.standings[match.awayConf].sort(sortStandingsRows);
}

function givePlayerMatchStats(state, teamId, resultSide, teamGoals, oppGoals, xg, shots, sot, yellows, reds) {
  const available = state.players
    .filter(p => p.clubId === teamId && (!p.injuredUntil || p.injuredUntil < state.calendar.absoluteDay))
    .sort((a, b) => b.overall - a.overall);

  const starters = available.slice(0, 11);
  starters.forEach((p) => {
    p.stats.gp += 1;
    p.stats.gs += 1;
    p.stats.min += 90;
    p.morale = clamp(p.morale + (resultSide === "win" ? 2 : resultSide === "loss" ? -2 : 0), 10, 100);
  });

  const gk = starters.find(p => p.position === "GK");
  if (gk) {
    gk.stats.ga += oppGoals;
    if (oppGoals === 0) gk.stats.cleanSheets += 1;
  }

  const scorers = [];
  const assisterPool = starters.filter(p => p.position !== "GK");
  for (let i = 0; i < teamGoals; i++) {
    const scorer = chooseScorer(starters);
    scorer.stats.goals += 1;
    scorer.stats.shots += randInt(1, 3);
    scorer.stats.shotsOnTarget += 1;
    scorer.stats.xg += xg / Math.max(1, teamGoals);
    scorers.push(scorer.id);

    const assistRoll = Math.random();
    if (assistRoll < 0.72) {
      const candidates = assisterPool.filter(p => p.id !== scorer.id);
      if (candidates.length) {
        const assister = chooseScorer(candidates, "ATT");
        assister.stats.assists += 1;
      }
    }
  }

  if (scorers.length) {
    const motmId = scorers[randInt(0, scorers.length - 1)];
    const motm = state.players.find(p => p.id === motmId);
    if (motm) motm.stats.motm += 1;
  }

  for (let i = 0; i < yellows; i++) {
    const p = pick(starters);
    p.stats.yellows += 1;
  }
  for (let i = 0; i < reds; i++) {
    const p = pick(starters.filter(x => x.position !== "GK"));
    if (p) p.stats.reds += 1;
  }
}

export function simulateMatch(state, match, opts = {}) {
  const homeTeam = state.teams.find(t => t.id === match.homeTeamId);
  const awayTeam = state.teams.find(t => t.id === match.awayTeamId);

  const homePower = teamStrength(state, homeTeam.id);
  const awayPower = teamStrength(state, awayTeam.id);
  const homeAdv = 0.28;
  const rivalry = getRivalBoost(homeTeam.name, awayTeam.name);

  const baseHome = 1.20 + (homePower - awayPower) * 0.018 + homeAdv + rivalry * 0.5;
  const baseAway = 1.02 + (awayPower - homePower) * 0.016 + rivalry * 0.25;

  let homeXg = clamp(baseHome + randFloat(-0.18, 0.35), 0.2, 3.8);
  let awayXg = clamp(baseAway + randFloat(-0.18, 0.30), 0.1, 3.4);

  let homeGoals = poisson(homeXg);
  let awayGoals = poisson(awayXg);

  const penaltyOnly = opts.penaltyOnDraw && homeGoals === awayGoals;
  let extraTime = false;
  let penalties = null;

  if (opts.singleElimination && homeGoals === awayGoals) {
    extraTime = true;
    homeXg += randFloat(0.10, 0.35);
    awayXg += randFloat(0.08, 0.28);
    homeGoals += poisson(homeXg * 0.16);
    awayGoals += poisson(awayXg * 0.16);
    if (homeGoals === awayGoals) {
      penalties = {
        home: randInt(3, 6),
        away: randInt(3, 6),
      };
      while (penalties.home === penalties.away) {
        penalties.home = randInt(3, 7);
        penalties.away = randInt(3, 7);
      }
    }
  } else if (penaltyOnly) {
    penalties = {
      home: randInt(2, 6),
      away: randInt(2, 6),
    };
    while (penalties.home === penalties.away) {
      penalties.home = randInt(2, 7);
      penalties.away = randInt(2, 7);
    }
  }

  const homeShots = Math.max(homeGoals + randInt(6, 13), Math.round(homeXg * 6.8));
  const awayShots = Math.max(awayGoals + randInt(5, 12), Math.round(awayXg * 6.7));
  const homeSot = clamp(homeGoals + randInt(1, 5), homeGoals, homeShots);
  const awaySot = clamp(awayGoals + randInt(1, 5), awayGoals, awayShots);
  const totalPoss = 100;
  const homePoss = clamp(Math.round(50 + (homePower - awayPower) * 0.42 + randInt(-6, 6)), 35, 65);
  const awayPoss = totalPoss - homePoss;

  const homeYellows = randInt(0, 4);
  const awayYellows = randInt(0, 4);
  const homeReds = Math.random() < 0.05 ? 1 : 0;
  const awayReds = Math.random() < 0.05 ? 1 : 0;

  const homePlayers = state.players.filter(p => p.clubId === homeTeam.id).sort((a,b)=>b.overall-a.overall).slice(0, 11);
  const awayPlayers = state.players.filter(p => p.clubId === awayTeam.id).sort((a,b)=>b.overall-a.overall).slice(0, 11);

  const events = [];
  minuteSet(homeGoals).forEach(min => {
    const scorer = chooseScorer(homePlayers);
    const assist = Math.random() < 0.72 ? chooseScorer(homePlayers.filter(p => p.id !== scorer.id), "ATT") : null;
    events.push({ minute: min, side: "home", type: "goal", scorerId: scorer.id, assistId: assist?.id || null });
  });
  minuteSet(awayGoals).forEach(min => {
    const scorer = chooseScorer(awayPlayers);
    const assist = Math.random() < 0.72 ? chooseScorer(awayPlayers.filter(p => p.id !== scorer.id), "ATT") : null;
    events.push({ minute: min, side: "away", type: "goal", scorerId: scorer.id, assistId: assist?.id || null });
  });
  events.sort((a, b) => a.minute - b.minute);

  const resultSideHome =
    penalties
      ? penalties.home > penalties.away ? "win" : "loss"
      : homeGoals > awayGoals ? "win" : homeGoals < awayGoals ? "loss" : "draw";

  const resultSideAway =
    penalties
      ? penalties.away > penalties.home ? "win" : "loss"
      : awayGoals > homeGoals ? "win" : awayGoals < homeGoals ? "loss" : "draw";

  givePlayerMatchStats(state, homeTeam.id, resultSideHome, homeGoals, awayGoals, homeXg, homeShots, homeSot, homeYellows, homeReds);
  givePlayerMatchStats(state, awayTeam.id, resultSideAway, awayGoals, homeGoals, awayXg, awayShots, awaySot, awayYellows, awayReds);

  match.played = true;
  match.result = {
    homeGoals,
    awayGoals,
    homeXg: Number(homeXg.toFixed(2)),
    awayXg: Number(awayXg.toFixed(2)),
    homeShots,
    awayShots,
    homeSot,
    awaySot,
    homePoss,
    awayPoss,
    homeYellows,
    awayYellows,
    homeReds,
    awayReds,
    events,
    penalties,
    extraTime,
  };

  if (match.type === "Regular Season") {
    applyResultToStandings(state, match);
  }

  return match.result;
}

function createLineup(team) {
  const formation = "4-3-3";
  return { formation, playerIds: [] };
}

function createConferenceSchedule(teamIds) {
  const matches = [];
  const n = teamIds.length;

  for (let i = 0; i < n; i++) {
    for (let delta = 1; delta <= 6; delta++) {
      const j = (i + delta) % n;
      if (i < j || (i + delta) >= n) {
        matches.push([teamIds[i], teamIds[j], true]);
        matches.push([teamIds[j], teamIds[i], true]);
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 7) % n;
    if (i < j || i === 8 || i === 9 || i === 10 || i === 11 || i === 12 || i === 13 || i === 14) {
      const home = i % 2 === 0 ? teamIds[i] : teamIds[j];
      const away = i % 2 === 0 ? teamIds[j] : teamIds[i];
      if (!matches.some(m => m[0] === home && m[1] === away) && !matches.some(m => m[0] === away && m[1] === home && !m[2])) {
        matches.push([home, away, false]);
      }
    }
  }

  return matches;
}

function createInterconferenceSchedule(eastIds, westIds) {
  const matches = [];
  for (let i = 0; i < eastIds.length; i++) {
    for (let delta = 0; delta < 8; delta++) {
      const westIndex = (i + delta) % westIds.length;
      const home = delta % 2 === 0 ? eastIds[i] : westIds[westIndex];
      const away = delta % 2 === 0 ? westIds[westIndex] : eastIds[i];
      matches.push([home, away]);
    }
  }
  return matches;
}

function distributeAcrossWeeks(matchObjects) {
  const weeks = Array.from({ length: 34 }, () => []);
  for (const match of matchObjects) {
    let tries = 0;
    while (tries < 200) {
      const week = randInt(1, 34);
      const conflict = weeks[week - 1].some(m =>
        m.homeTeamId === match.homeTeamId || m.awayTeamId === match.homeTeamId ||
        m.homeTeamId === match.awayTeamId || m.awayTeamId === match.awayTeamId
      );
      if (!conflict) {
        match.week = week;
        weeks[week - 1].push(match);
        break;
      }
      tries++;
    }
  }
  return weeks.flat().sort((a, b) => a.week - b.week);
}

function buildSchedule(state) {
  const eastTeams = state.teams.filter(t => t.conference === "East");
  const westTeams = state.teams.filter(t => t.conference === "West");

  const conferenceMatches = [
    ...createConferenceSchedule(eastTeams.map(t => t.id)),
    ...createConferenceSchedule(westTeams.map(t => t.id)),
  ].map(([homeTeamId, awayTeamId]) => {
    const homeTeam = state.teams.find(t => t.id === homeTeamId);
    const awayTeam = state.teams.find(t => t.id === awayTeamId);
    return {
      id: uuid("m"),
      type: "Regular Season",
      week: null,
      played: false,
      homeTeamId,
      awayTeamId,
      homeConf: homeTeam.conference,
      awayConf: awayTeam.conference,
      result: null,
    };
  });

  const interMatches = createInterconferenceSchedule(
    eastTeams.map(t => t.id),
    westTeams.map(t => t.id)
  ).map(([homeTeamId, awayTeamId]) => {
    const homeTeam = state.teams.find(t => t.id === homeTeamId);
    const awayTeam = state.teams.find(t => t.id === awayTeamId);
    return {
      id: uuid("m"),
      type: "Regular Season",
      week: null,
      played: false,
      homeTeamId,
      awayTeamId,
      homeConf: homeTeam.conference,
      awayConf: awayTeam.conference,
      result: null,
    };
  });

  state.schedule = distributeAcrossWeeks([...conferenceMatches, ...interMatches]);
}

function buildDraftPicks(teams) {
  const picks = {};
  for (const team of teams) {
    picks[team.id] = [];
    for (let year = 2027; year <= 2029; year++) {
      for (let round = 1; round <= 3; round++) {
        picks[team.id].push({ id: uuid("pick"), year, round, ownerTeamId: team.id, originalTeamId: team.id });
      }
    }
  }
  return picks;
}

export function createNewState(userTeamName) {
  const teams = [];
  let ordinal = 0;

  for (const [conference, names] of Object.entries(CONFERENCES)) {
    for (const name of names) {
      teams.push({
        id: uuid("t"),
        ordinal: ordinal++,
        name,
        shortName: getShortName(name),
        conference,
        country: getClubCountry(name),
        marketRating: randInt(58, 77),
        gam: MLS_RULES.gamAnnual + randInt(-450000, 3200000),
        tam: MLS_RULES.tamAnnual,
        salaryBudget: MLS_RULES.salaryBudget,
        internationalSlots: MLS_RULES.internationalSlotsDefault,
        lineup: createLineup(name),
        finances: {
          cash: randInt(5_000_000, 26_000_000),
          ticketBase: randInt(17000, 42000),
          sponsor: randInt(9_000_000, 25_000_000),
        },
      });
    }
  }

  const players = [];
  for (const team of teams) {
    const rolePlan = [
      "GK","GK","CB","CB","CB","FB","FB","FB","CDM","CM","CM","CAM",
      "Winger","Winger","ST","ST","CM","CB","FB","GK","Winger","ST","CDM","CM","CB","FB"
    ];
    rolePlan.forEach((pos, idx) => players.push(generatePlayer(team, idx, pos)));
  }

  for (const team of teams) {
    const squad = players.filter(p => p.clubId === team.id).sort((a,b) => b.overall - a.overall);
    team.lineup.playerIds = squad.slice(0, 11).map(p => p.id);
  }

  const state = {
    version: 1,
    rules: deepClone(MLS_RULES),
    season: { year: 2026, phase: "Regular Season" },
    calendar: { week: 1, absoluteDay: 0 },
    teams,
    players,
    standings: {
      East: teams.filter(t => t.conference === "East").map(t => initStandingsRow(t.id)),
      West: teams.filter(t => t.conference === "West").map(t => initStandingsRow(t.id)),
    },
    schedule: [],
    playoffs: null,
    draft: {
      pool: [],
      active: false,
      completedForYear: false,
      picksByTeam: buildDraftPicks(teams),
    },
    freeAgents: [],
    transactions: [],
    awardsHistory: [],
    userTeamId: teams.find(t => t.name === userTeamName)?.id || teams[0].id,
    saveSlot: "default",
  };

  players.forEach(p => { p.budgetChargeApplied = getBudgetCharge(p); });
  buildSchedule(state);
  state.standings.East.sort(sortStandingsRows);
  state.standings.West.sort(sortStandingsRows);
  seedInitialFreeAgents(state);
  addTransaction(state, "League", `League initialized for ${state.season.year}.`);
  return state;
}

function seedInitialFreeAgents(state) {
  const freeAgents = [];
  for (let i = 0; i < 110; i++) {
    const fakeClub = { id: null, marketRating: randInt(52, 73), country: "USA" };
    const p = generatePlayer(fakeClub, i, pick(POSITIONS));
    p.clubId = null;
    p.contract.status = "Free Agent";
    p.contract.salary = clamp(Math.round(p.contract.salary * randFloat(0.6, 1.15)), MLS_RULES.reserveMin, 1_200_000);
    p.budgetChargeApplied = getBudgetCharge({ ...p, rosterRole: "Senior" });
    freeAgents.push(p);
  }
  state.freeAgents = freeAgents;
}

export function getUserTeam(state) {
  return state.teams.find(t => t.id === state.userTeamId);
}

export function getTeamPlayers(state, teamId) {
  return state.players.filter(p => p.clubId === teamId).sort((a, b) => b.overall - a.overall);
}

export function getCapSummary(state, teamId) {
  const players = getTeamPlayers(state, teamId);
  const senior = players.filter(p => p.rosterRole === "Senior");
  const supplemental = players.filter(p => p.rosterRole === "Supplemental");
  const reserve = players.filter(p => p.rosterRole === "Reserve");

  const budgetUsed = senior.reduce((sum, p) => sum + getBudgetCharge(p), 0);
  const intUsed = players.filter(p => !p.domestic && !p.intlSlotExempt).length;
  const dpCount = players.filter(p => p.designation === "DP").length;

  return {
    seniorCount: senior.length,
    supplementalCount: supplemental.length,
    reserveCount: reserve.length,
    budgetUsed,
    budgetRoom: MLS_RULES.salaryBudget - budgetUsed,
    gam: state.teams.find(t => t.id === teamId).gam,
    tam: state.teams.find(t => t.id === teamId).tam,
    intlUsed: intUsed,
    intlTotal: state.teams.find(t => t.id === teamId).internationalSlots,
    dpCount,
  };
}

function maybeInjurePlayers(state) {
  const activePlayers = state.players.filter(p => p.clubId && (!p.injuredUntil || p.injuredUntil < state.calendar.absoluteDay));
  for (const player of activePlayers) {
    const risk = player.injuryProne ? 0.018 : 0.008;
    if (Math.random() < risk) {
      const duration = weightedRandom([
        { value: randInt(7, 18), weight: 70 },
        { value: randInt(21, 56), weight: 24 },
        { value: randInt(90, 240), weight: 6 },
      ]);
      player.injuredUntil = state.calendar.absoluteDay + duration;
      addTransaction(state, "Injury", `${player.name} suffered an injury (${duration} days).`);
    }
  }
}

function processIncomingExternalOffers(state) {
  const userTeam = getUserTeam(state);
  const userPlayers = getTeamPlayers(state, userTeam.id).filter(p => p.age >= 20);
  if (!userPlayers.length) return;
  if (Math.random() > 0.16) return;

  const target = pick(userPlayers.slice(0, 12));
  const offer = Math.round(target.contract.salary * randFloat(1.3, 3.2) + target.overall * 55000);
  state.pendingOffer = {
    id: uuid("offer"),
    playerId: target.id,
    bidClub: pick(state.teams.filter(t => t.id !== userTeam.id)).name,
    amount: offer,
  };
  addTransaction(state, "Offer", `${state.pendingOffer.bidClub} offered ${offer.toLocaleString()} for ${target.name}.`);
}

export function acceptPendingOffer(state) {
  if (!state.pendingOffer) return;
  const offer = state.pendingOffer;
  const player = state.players.find(p => p.id === offer.playerId);
  if (!player) return;

  const userTeam = getUserTeam(state);
  player.clubId = null;
  player.contract.status = "Free Agent";
  player.contract.yearsLeft = randInt(2, 4);
  state.freeAgents.push(player);
  userTeam.finances.cash += offer.amount;
  userTeam.gam += Math.min(400000, Math.round(offer.amount * 0.06));
  addTransaction(state, "Sale", `${player.name} departed after ${offer.bidClub} paid ${offer.amount.toLocaleString()}.`);
  state.pendingOffer = null;
}

export function rejectPendingOffer(state) {
  if (!state.pendingOffer) return;
  addTransaction(state, "Offer", `Rejected offer from ${state.pendingOffer.bidClub}.`);
  state.pendingOffer = null;
}

export function advanceOneWeek(state) {
  if (state.season.phase === "Regular Season") {
    const matches = state.schedule.filter(m => m.week === state.calendar.week && !m.played);
    for (const match of matches) simulateMatch(state, match);

    maybeInjurePlayers(state);
    processIncomingExternalOffers(state);

    state.calendar.week += 1;
    state.calendar.absoluteDay += 7;

    if (state.calendar.week > 34) {
      state.season.phase = "Playoffs";
      state.playoffs = buildPlayoffs(state);
      addTransaction(state, "Playoffs", `MLS Cup Playoffs field set for ${state.season.year}.`);
    }
  } else if (state.season.phase === "Playoffs") {
    advancePlayoffs(state);
  } else if (state.season.phase === "Offseason") {
    runOffseason(state);
  }
}

export function simulateToSeasonEnd(state) {
  while (state.season.phase === "Regular Season" || state.season.phase === "Playoffs") {
    advanceOneWeek(state);
  }
}

function getSeededConferenceRows(state, conference) {
  return [...state.standings[conference]].sort(sortStandingsRows).map((row, idx) => ({ ...row, seed: idx + 1 }));
}

function buildPlayoffs(state) {
  const east = getSeededConferenceRows(state, "East");
  const west = getSeededConferenceRows(state, "West");

  return {
    conferenceSeeds: { East: east, West: west },
    currentRound: "Wild Card",
    rounds: {
      wildCard: [],
      roundOne: [],
      semifinals: [],
      conferenceFinals: [],
      cup: [],
    },
    championTeamId: null,
  };
}

function buildSeriesGame(homeTeamId, awayTeamId, roundName, conf = null) {
  return {
    id: uuid("pm"),
    type: roundName,
    week: null,
    played: false,
    homeTeamId,
    awayTeamId,
    homeConf: conf || state.teams?.find?.(t => t.id === homeTeamId)?.conference || "East",
    awayConf: conf || state.teams?.find?.(t => t.id === awayTeamId)?.conference || "East",
    result: null,
  };
}

function seriesWinner(match) {
  if (!match.result) return null;
  if (match.result.penalties) return match.result.penalties.home > match.result.penalties.away ? match.homeTeamId : match.awayTeamId;
  return match.result.homeGoals > match.result.awayGoals ? match.homeTeamId : match.awayTeamId;
}

function createRoundOneSeries(state, conference, seeds) {
  const wildCardWinner = seeds.find(s => s.seed === 8)._wildCardWinner;
  return [
    { higher: seeds.find(s => s.seed === 1).teamId, lower: wildCardWinner, conference, wins: {} },
    { higher: seeds.find(s => s.seed === 2).teamId, lower: seeds.find(s => s.seed === 7).teamId, conference, wins: {} },
    { higher: seeds.find(s => s.seed === 3).teamId, lower: seeds.find(s => s.seed === 6).teamId, conference, wins: {} },
    { higher: seeds.find(s => s.seed === 4).teamId, lower: seeds.find(s => s.seed === 5).teamId, conference, wins: {} },
  ];
}

export function advancePlayoffs(state) {
  const p = state.playoffs;
  const eastSeeds = p.conferenceSeeds.East;
  const westSeeds = p.conferenceSeeds.West;

  if (p.currentRound === "Wild Card") {
    for (const conf of ["East", "West"]) {
      const seeds = conf === "East" ? eastSeeds : westSeeds;
      const seed8 = seeds.find(s => s.seed === 8);
      const seed9 = seeds.find(s => s.seed === 9);
      const match = {
        id: uuid("wc"),
        type: "Wild Card",
        played: false,
        homeTeamId: seed8.teamId,
        awayTeamId: seed9.teamId,
        homeConf: conf,
        awayConf: conf,
        result: null,
      };
      simulateMatch(state, match, { penaltyOnDraw: true });
      const winner = seriesWinner(match);
      seed8._wildCardWinner = winner;
      p.rounds.wildCard.push(match);
    }
    p.currentRound = "Round One";
    return;
  }

  if (p.currentRound === "Round One") {
    const seriesList = [
      ...createRoundOneSeries(state, "East", eastSeeds),
      ...createRoundOneSeries(state, "West", westSeeds),
    ];

    for (const series of seriesList) {
      const wins = { [series.higher]: 0, [series.lower]: 0 };
      const games = [
        [series.higher, series.lower],
        [series.lower, series.higher],
        [series.higher, series.lower],
      ];

      for (const [home, away] of games) {
        if (wins[series.higher] === 2 || wins[series.lower] === 2) break;
        const match = {
          id: uuid("r1"),
          type: "Round One",
          played: false,
          homeTeamId: home,
          awayTeamId: away,
          homeConf: series.conference,
          awayConf: series.conference,
          result: null,
        };
        simulateMatch(state, match, { penaltyOnDraw: true });
        const winner = seriesWinner(match);
        wins[winner] += 1;
        p.rounds.roundOne.push(match);
      }

      series.winner = wins[series.higher] === 2 ? series.higher : series.lower;
      series.seedHigher = [...eastSeeds, ...westSeeds].find(s => s.teamId === series.higher)?.seed || 99;
      series.seedLower = [...eastSeeds, ...westSeeds].find(s => s.teamId === series.lower)?.seed || 99;
      series.seedWinner = series.winner === series.higher ? series.seedHigher : series.seedLower;
      p.rounds.roundOne.push({ seriesSummary: true, ...series, wins });
    }
    p.currentRound = "Semifinals";
    return;
  }

  if (p.currentRound === "Semifinals") {
    const eastWinners = p.rounds.roundOne.filter(x => x.seriesSummary && x.conference === "East");
    const westWinners = p.rounds.roundOne.filter(x => x.seriesSummary && x.conference === "West");
    const pairs = [
      [eastWinners[0].winner, eastWinners[3].winner, "East"],
      [eastWinners[2].winner, eastWinners[1].winner, "East"],
      [westWinners[0].winner, westWinners[3].winner, "West"],
      [westWinners[2].winner, westWinners[1].winner, "West"],
    ];

    for (const [a, b, conf] of pairs) {
      const seedA = p.conferenceSeeds[conf].find(s => s.teamId === a).seed;
      const seedB = p.conferenceSeeds[conf].find(s => s.teamId === b).seed;
      const home = seedA < seedB ? a : b;
      const away = home === a ? b : a;
      const match = {
        id: uuid("sf"),
        type: "Conference Semifinal",
        played: false,
        homeTeamId: home,
        awayTeamId: away,
        homeConf: conf,
        awayConf: conf,
        result: null,
      };
      simulateMatch(state, match, { singleElimination: true });
      p.rounds.semifinals.push(match);
    }
    p.currentRound = "Conference Finals";
    return;
  }

  if (p.currentRound === "Conference Finals") {
    for (const conf of ["East", "West"]) {
      const winners = p.rounds.semifinals
        .filter(m => m.homeConf === conf)
        .map(m => seriesWinner(m));

      const rows = p.conferenceSeeds[conf];
      winners.sort((a, b) => rows.find(r => r.teamId === a).seed - rows.find(r => r.teamId === b).seed);
      const home = winners[0];
      const away = winners[1];
      const match = {
        id: uuid("cf"),
        type: "Conference Final",
        played: false,
        homeTeamId: home,
        awayTeamId: away,
        homeConf: conf,
        awayConf: conf,
        result: null,
      };
      simulateMatch(state, match, { singleElimination: true });
      p.rounds.conferenceFinals.push(match);
    }
    p.currentRound = "MLS Cup";
    return;
  }

  if (p.currentRound === "MLS Cup") {
    const eastWinner = seriesWinner(p.rounds.conferenceFinals.find(m => m.homeConf === "East"));
    const westWinner = seriesWinner(p.rounds.conferenceFinals.find(m => m.homeConf === "West"));
    const eastSeed = p.conferenceSeeds.East.find(r => r.teamId === eastWinner).seed;
    const westSeed = p.conferenceSeeds.West.find(r => r.teamId === westWinner).seed;
    const home = eastSeed < westSeed ? eastWinner : westWinner;
    const away = home === eastWinner ? westWinner : eastWinner;
    const cup = {
      id: uuid("cup"),
      type: "MLS Cup",
      played: false,
      homeTeamId: home,
      awayTeamId: away,
      homeConf: state.teams.find(t => t.id === home).conference,
      awayConf: state.teams.find(t => t.id === away).conference,
      result: null,
    };
    simulateMatch(state, cup, { singleElimination: true });
    p.rounds.cup.push(cup);
    p.championTeamId = seriesWinner(cup);

    awardSeason(state);
    state.season.phase = "Offseason";
    addTransaction(state, "Champion", `${state.teams.find(t => t.id === p.championTeamId).name} won MLS Cup ${state.season.year}.`);
  }
}

function awardSeason(state) {
  const active = state.players.filter(p => p.clubId);
  const mvp = [...active].sort((a, b) =>
    (b.stats.goals + b.stats.assists * 0.8 + b.stats.motm * 2 + b.overall * 0.1) -
    (a.stats.goals + a.stats.assists * 0.8 + a.stats.motm * 2 + a.overall * 0.1)
  )[0];
  const goldenBoot = [...active].sort((a, b) => b.stats.goals - a.stats.goals)[0];
  const gk = [...active].filter(p => p.position === "GK")
    .sort((a, b) => (b.stats.cleanSheets * 3 - b.stats.ga * 0.12) - (a.stats.cleanSheets * 3 - a.stats.ga * 0.12))[0];

  state.awardsHistory.push({
    year: state.season.year,
    mvp: mvp?.name || "—",
    goldenBoot: goldenBoot?.name || "—",
    goalkeeper: gk?.name || "—",
  });
}

function ageAndDevelop(state) {
  for (const p of state.players) {
    p.age += 1;
    const peak = p.age >= 26 && p.age <= 29;
    const delta =
      p.age <= 21 ? randInt(1, 5) :
      p.age <= 25 ? randInt(0, 3) :
      peak ? randInt(-1, 2) :
      randInt(-4, 1);

    const boost = p.homegrown ? 1 : 0;
    const target = clamp(p.overall + delta + boost, 44, p.potential);
    const diff = target - p.overall;

    for (const key of Object.keys(p.attributes)) {
      p.attributes[key] = clamp(p.attributes[key] + Math.sign(diff) * randInt(0, Math.abs(diff) + 1), 25, 98);
    }
    p.overall = computeOverall(p.attributes, p.position);
    p.morale = clamp(p.morale + randInt(-8, 8), 10, 100);
    if (p.contract.yearsLeft > 0) p.contract.yearsLeft -= 1;
    p.stats = {
      gp: 0, gs: 0, min: 0,
      goals: 0, assists: 0,
      shots: 0, shotsOnTarget: 0, xg: 0,
      yellows: 0, reds: 0,
      cleanSheets: 0, ga: 0,
      motm: 0,
    };
    p.injuredUntil = null;
  }
}

function moveExpiredToFreeAgency(state) {
  for (const p of state.players) {
    if (p.clubId && p.contract.yearsLeft <= 0) {
      addTransaction(state, "Free Agency", `${p.name} became a free agent.`);
      p.clubId = null;
      p.contract.status = "Free Agent";
      p.contract.yearsLeft = randInt(1, 3);
      state.freeAgents.push(p);
    }
  }
}

function draftOrder(state) {
  const allRows = [
    ...state.standings.East.map(r => ({ ...r, conf: "East" })),
    ...state.standings.West.map(r => ({ ...r, conf: "West" })),
  ].sort((a, b) => {
    const pa = a.points, pb = b.points;
    if (pa !== pb) return pa - pb;
    if (a.wins !== b.wins) return a.wins - b.wins;
    if (a.gd !== b.gd) return a.gd - b.gd;
    return a.gf - b.gf;
  });

  return allRows.map(r => r.teamId);
}

function generateDraftPool(state) {
  const pool = [];
  for (let i = 0; i < 120; i++) {
    const fakeClub = { id: null, marketRating: randInt(51, 73), country: "USA" };
    const pos = pick(POSITIONS);
    const p = generatePlayer(fakeClub, i, pos);
    p.age = randInt(18, 22);
    p.name = randomName();
    p.college = pick(COLLEGES);
    p.homegrown = false;
    p.clubId = null;
    p.contract.status = "Draft Eligible";
    p.potential = clamp(p.overall + randInt(4, 16), p.overall, 92);
    pool.push(p);
  }
  state.draft.pool = pool.sort((a, b) => (b.potential + b.overall * 0.5) - (a.potential + a.overall * 0.5));
  state.draft.active = true;
  state.draft.completedForYear = false;
}

function runDraft(state) {
  generateDraftPool(state);
  const order = draftOrder(state);

  for (let round = 1; round <= 3; round++) {
    for (const teamId of order) {
      const choiceIndex = Math.min(randInt(0, 4), state.draft.pool.length - 1);
      const player = state.draft.pool.splice(choiceIndex, 1)[0];
      if (!player) continue;

      player.clubId = teamId;
      player.contract.status = "Active";
      player.contract.yearsLeft = randInt(2, 4);
      player.contract.salary = round === 1 ? MLS_RULES.seniorMin : MLS_RULES.reserveMin;
      player.rosterRole = round === 1 ? "Supplemental" : "Reserve";
      player.designation = round === 1 && Math.random() < 0.35 ? "U22" : null;
      player.domestic = true;
      state.players.push(player);

      const team = state.teams.find(t => t.id === teamId);
      addTransaction(state, "Draft", `${team.name} selected ${player.name} in Round ${round}.`);
    }
  }

  state.draft.active = false;
  state.draft.completedForYear = true;
}

function aiFillRostersFromFreeAgency(state) {
  for (const team of state.teams) {
    const squad = getTeamPlayers(state, team.id);
    let needs = 26 - squad.length;
    while (needs > 0 && state.freeAgents.length) {
      const best = state.freeAgents
        .filter(p => (p.domestic || getCapSummary(state, team.id).intlUsed < team.internationalSlots))
        .sort((a, b) => b.overall - a.overall)[0];
      if (!best) break;
      best.clubId = team.id;
      best.contract.status = "Active";
      best.contract.yearsLeft = randInt(1, 3);
      best.rosterRole = squad.length < 20 ? "Senior" : squad.length < 24 ? "Supplemental" : "Reserve";
      state.freeAgents = state.freeAgents.filter(p => p.id !== best.id);
      needs--;
    }
  }
}

function rebalanceLineups(state) {
  for (const team of state.teams) {
    team.lineup.playerIds = getTeamPlayers(state, team.id).slice(0, 11).map(p => p.id);
  }
}

function resetStandingsAndSchedule(state) {
  state.standings = {
    East: state.teams.filter(t => t.conference === "East").map(t => initStandingsRow(t.id)),
    West: state.teams.filter(t => t.conference === "West").map(t => initStandingsRow(t.id)),
  };
  buildSchedule(state);
  state.playoffs = null;
  state.pendingOffer = null;
}

export function runOffseason(state) {
  moveExpiredToFreeAgency(state);
  ageAndDevelop(state);
  runDraft(state);
  aiFillRostersFromFreeAgency(state);
  rebalanceLineups(state);
  resetStandingsAndSchedule(state);

  state.season.year += 1;
  state.season.phase = "Regular Season";
  state.calendar.week = 1;
  state.calendar.absoluteDay += 28;

  for (const team of state.teams) {
    team.gam = MLS_RULES.gamAnnual + randInt(-350000, 2600000);
    team.tam = MLS_RULES.tamAnnual;
    team.finances.cash += randInt(-2_000_000, 8_000_000);
  }

  addTransaction(state, "Season", `Opened ${state.season.year} season.`);
}

export function signFreeAgent(state, playerId, teamId) {
  const player = state.freeAgents.find(p => p.id === playerId);
  const team = state.teams.find(t => t.id === teamId);
  if (!player || !team) return { ok: false, reason: "Not found" };

  const cap = getCapSummary(state, teamId);
  const projectedCharge = getBudgetCharge({ ...player, rosterRole: cap.seniorCount < 20 ? "Senior" : "Supplemental" });

  if (!player.domestic && cap.intlUsed >= team.internationalSlots) {
    return { ok: false, reason: "No international slots available" };
  }

  if (cap.seniorCount < 20 && cap.budgetRoom < projectedCharge && player.overall > 61) {
    return { ok: false, reason: "Insufficient budget room" };
  }

  player.clubId = teamId;
  player.contract.status = "Active";
  player.contract.yearsLeft = randInt(1, 3);
  player.rosterRole = cap.seniorCount < 20 ? "Senior" : cap.supplementalCount < 4 ? "Supplemental" : "Reserve";

  state.freeAgents = state.freeAgents.filter(p => p.id !== playerId);
  addTransaction(state, "Signing", `${team.name} signed free agent ${player.name}.`);
  return { ok: true };
}
