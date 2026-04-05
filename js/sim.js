import {
  MLS_RULES,
  CONFERENCES,
  RIVALRIES,
  POSITIONS,
  NATIONS,
  FIRST_NAMES,
  LAST_NAMES,
  COLLEGES,
} from "./data.js";

import {
  clamp,
  randInt,
  randFloat,
  pick,
  uuid,
  weightedRandom,
} from "./utils.js";

function clubCountry(name) {
  return ["Toronto FC", "CF Montréal", "Vancouver Whitecaps FC"].includes(name) ? "Canada" : "USA";
}

function shortName(name) {
  return name
    .replace("Football Club", "FC")
    .replace("Sounders FC", "Sounders")
    .replace("Whitecaps FC", "Whitecaps");
}

function posBucket(pos) {
  if (pos === "GK") return "GK";
  if (pos === "CB" || pos === "FB") return "DEF";
  if (pos === "CDM" || pos === "CM" || pos === "CAM") return "MID";
  return "ATT";
}

function domesticForTeam(playerNation, country) {
  if (country === "Canada") return playerNation === "Canada" || playerNation === "USA";
  return playerNation === "USA";
}

function randomName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

export function overall(player) {
  const a = player.attributes;
  return Math.round((a.pace + a.shooting + a.passing + a.dribbling + a.defense + a.physical) / 6);
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

function makePlayer(club, idx, forcedPos = null) {
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
  const nationality = pick(club.country === "Canada" ? ["Canada", "USA", ...NATIONS] : ["USA", ...NATIONS]);
  const domestic = domesticForTeam(nationality, club.country);
  const preferredFoot = Math.random() < 0.76 ? "Right" : "Left";

  let qualityBase = club.marketRating + randInt(-10, 10);
  if (idx < 3) qualityBase += 10;
  if (idx > 20) qualityBase -= 6;

  const homegrown = age <= 22 && Math.random() < 0.22;
  const attributes = makeAttributes(position, clamp(qualityBase, 48, 84), age);
  const ovr = overall({ attributes });
  const potential = clamp(ovr + randInt(-3, 14) + (age <= 22 ? 8 : 0), ovr, 93);

  const salaryBase = Math.max(
    age <= 21 ? 88025 : 113400,
    Math.round(ovr * ovr * 90 + randInt(-50000, 100000))
  );

  let designation = null;
  if (idx === 0 && ovr >= 76 && Math.random() < 0.65) designation = "DP";
  else if (age <= 22 && ovr >= 64 && Math.random() < 0.24) designation = "U22";
  else if (salaryBase > MLS_RULES.maxBudgetCharge && Math.random() < 0.42) designation = "TAM";

  const salary = designation === "DP"
    ? Math.max(salaryBase, randInt(1400000, 6200000))
    : designation === "TAM"
      ? clamp(Math.max(salaryBase, randInt(850000, 1750000)), 820000, 1803125)
      : salaryBase;

  const rosterRole = idx < 18 ? "Senior" : idx < 24 ? "Supplemental" : "Reserve";

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
    contract: {
      yearsLeft: randInt(1, 5),
      salary,
      status: "Active",
    },
    morale: clamp(65 + randInt(-12, 12), 20, 100),
    injuryProne: Math.random() < 0.08,
    injuredUntil: null,
    attributes,
    overall: ovr,
    potential,
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

function makeAcademyPlayer(team) {
  const age = randInt(15, 18);
  const position = pick(POSITIONS);
  const quality = randInt(50, 68);
  const attributes = makeAttributes(position, quality, age);
  const ovr = overall({ attributes });
  const potential = clamp(ovr + randInt(10, 24), ovr + 6, 94);

  return {
    id: uuid("a"),
    name: randomName(),
    age,
    nationality: team.country === "Canada" ? pick(["Canada", "USA"]) : "USA",
    domestic: true,
    preferredFoot: Math.random() < 0.75 ? "Right" : "Left",
    position,
    status: "Academy",
    homegrownEligible: true,
    morale: clamp(68 + randInt(-8, 8), 35, 100),
    attributes,
    overall: ovr,
    potential,
    notes: `${pick(COLLEGES)} local product`,
  };
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
  if (player.rosterRole !== "Senior") return 0;
  const salary = player.contract.salary;

  if (player.designation === "DP") {
    if (player.age <= 20) return MLS_RULES.youngDpBudgetU20;
    if (player.age <= 23) return MLS_RULES.youngDpBudgetU23;
    return MLS_RULES.maxBudgetCharge;
  }

  if (player.designation === "U22") {
    return player.age <= 20 ? MLS_RULES.youngDpBudgetU20 : MLS_RULES.youngDpBudgetU23;
  }

  return Math.min(salary, MLS_RULES.maxBudgetCharge);
}

export function teamOverall(state, teamId) {
  const roster = state.players
    .filter(p => p.clubId === teamId && (!p.injuredUntil || p.injuredUntil < state.calendar.absoluteDay))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 11);

  if (!roster.length) return 50;
  const avg = roster.reduce((sum, p) => sum + p.overall + (p.morale - 60) * 0.03, 0) / roster.length;
  return avg;
}

export function getUserTeam(state) {
  return state.teams.find(t => t.id === state.userTeamId);
}

export function getTeamPlayers(state, teamId) {
  return state.players.filter(p => p.clubId === teamId).sort((a, b) => b.overall - a.overall);
}

export function getTeamAcademy(state, teamId) {
  return state.academies[teamId] || [];
}

export function getCapSummary(state, teamId) {
  const players = getTeamPlayers(state, teamId);
  const senior = players.filter(p => p.rosterRole === "Senior");
  const supplemental = players.filter(p => p.rosterRole === "Supplemental");
  const reserve = players.filter(p => p.rosterRole === "Reserve");

  const budgetUsed = senior.reduce((sum, p) => sum + getBudgetCharge(p), 0);
  const intlUsed = players.filter(p => !p.domestic).length;
  const team = state.teams.find(t => t.id === teamId);

  return {
    seniorCount: senior.length,
    supplementalCount: supplemental.length,
    reserveCount: reserve.length,
    budgetUsed,
    budgetRoom: team.salaryBudget - budgetUsed,
    intlUsed,
    intlTotal: team.internationalSlots,
    dpCount: players.filter(p => p.designation === "DP").length,
  };
}

export function sortStandingsRows(a, b) {
  const diffs = [
    b.points - a.points,
    b.wins - a.wins,
    b.gd - a.gd,
    b.gf - a.gf,
    a.disciplinePoints - b.disciplinePoints,
    b.awayGd - a.awayGd,
    b.awayGf - a.awayGf,
    b.homeGd - a.homeGd,
    b.homeGf - a.homeGf,
    a.randomTiebreak - b.randomTiebreak,
  ];
  return diffs.find(v => v !== 0) || 0;
}

export function standings(state, conference = null) {
  if (!conference) {
    return [...state.teams].sort((a, b) => {
      const ra = [...state.standings.East, ...state.standings.West].find(r => r.teamId === a.id);
      const rb = [...state.standings.East, ...state.standings.West].find(r => r.teamId === b.id);
      return sortStandingsRows(ra, rb);
    });
  }

  return state.standings[conference]
    .slice()
    .sort(sortStandingsRows)
    .map(row => ({ ...state.teams.find(t => t.id === row.teamId), row }));
}

function seedFreeAgents(state) {
  const freeAgents = [];
  for (let i = 0; i < 110; i++) {
    const fakeClub = { id: null, marketRating: randInt(52, 73), country: "USA" };
    const p = makePlayer(fakeClub, i, pick(POSITIONS));
    p.clubId = null;
    p.contract.status = "Free Agent";
    p.contract.salary = clamp(Math.round(p.contract.salary * randFloat(0.6, 1.15)), 88025, 1200000);
    freeAgents.push(p);
  }
  state.freeAgents = freeAgents;
}

function makeSchedule(state) {
  const eastIds = state.teams.filter(t => t.conference === "East").map(t => t.id);
  const westIds = state.teams.filter(t => t.conference === "West").map(t => t.id);
  const matches = [];

  function addConferenceGames(ids) {
    const n = ids.length;
    for (let i = 0; i < n; i++) {
      for (let delta = 1; delta <= 6; delta++) {
        const j = (i + delta) % n;
        if (i < j || (i + delta) >= n) {
          matches.push([ids[i], ids[j]]);
          matches.push([ids[j], ids[i]]);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 7) % n;
      const home = i % 2 === 0 ? ids[i] : ids[j];
      const away = i % 2 === 0 ? ids[j] : ids[i];
      if (!matches.some(m => m[0] === home && m[1] === away)) matches.push([home, away]);
    }
  }

  addConferenceGames(eastIds);
  addConferenceGames(westIds);

  for (let i = 0; i < eastIds.length; i++) {
    for (let delta = 0; delta < 8; delta++) {
      const w = westIds[(i + delta) % westIds.length];
      const home = delta % 2 === 0 ? eastIds[i] : w;
      const away = delta % 2 === 0 ? w : eastIds[i];
      matches.push([home, away]);
    }
  }

  const schedule = matches.map(([homeTeamId, awayTeamId]) => {
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

  const weeks = Array.from({ length: 34 }, () => []);
  for (const match of schedule) {
    let placed = false;
    for (let tries = 0; tries < 200 && !placed; tries++) {
      const week = randInt(1, 34);
      const conflict = weeks[week - 1].some(m =>
        m.homeTeamId === match.homeTeamId || m.awayTeamId === match.homeTeamId ||
        m.homeTeamId === match.awayTeamId || m.awayTeamId === match.awayTeamId
      );
      if (!conflict) {
        match.week = week;
        weeks[week - 1].push(match);
        placed = true;
      }
    }
  }

  state.schedule = weeks.flat().sort((a, b) => a.week - b.week);
}

function chooseScorer(players) {
  const weights = players.map(p => {
    const bucket = posBucket(p.position);
    let weight = 1;
    if (bucket === "ATT") weight = 5;
    else if (bucket === "MID") weight = 3;
    else if (bucket === "DEF") weight = 1.2;
    else weight = 0.25;
    weight *= Math.max(0.5, p.overall / 70);
    return { value: p, weight };
  });
  return weightedRandom(weights);
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

function rivalryBoost(homeName, awayName) {
  return RIVALRIES.some(([a, b]) => (a === homeName && b === awayName) || (a === awayName && b === homeName)) ? 0.08 : 0;
}

function addTransaction(state, type, text) {
  state.transactions.unshift({
    id: uuid("tx"),
    season: state.season.year,
    day: state.calendar.absoluteDay,
    type,
    text,
  });
  if (state.transactions.length > 500) state.transactions.pop();
}

function applyStandings(state, match) {
  const homeRow = state.standings[match.homeConf].find(r => r.teamId === match.homeTeamId);
  const awayRow = state.standings[match.awayConf].find(r => r.teamId === match.awayTeamId);
  const { homeGoals, awayGoals, homeYellows, awayYellows, homeReds, awayReds } = match.result;

  homeRow.played += 1;
  awayRow.played += 1;

  homeRow.gf += homeGoals; homeRow.ga += awayGoals; homeRow.gd = homeRow.gf - homeRow.ga;
  awayRow.gf += awayGoals; awayRow.ga += homeGoals; awayRow.gd = awayRow.gf - awayRow.ga;

  homeRow.homeGf += homeGoals; homeRow.homeGa += awayGoals; homeRow.homeGd = homeRow.homeGf - homeRow.homeGa;
  awayRow.awayGf += awayGoals; awayRow.awayGa += homeGoals; awayRow.awayGd = awayRow.awayGf - awayRow.awayGa;

  homeRow.disciplinePoints += homeYellows * 3 + homeReds * 7;
  awayRow.disciplinePoints += awayYellows * 3 + awayReds * 7;

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

function giveStats(state, teamId, teamGoals, oppGoals, xg, shots, sot, yellows, reds, resultType) {
  const starters = state.players
    .filter(p => p.clubId === teamId && (!p.injuredUntil || p.injuredUntil < state.calendar.absoluteDay))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 11);

  starters.forEach(p => {
    p.stats.gp += 1;
    p.stats.gs += 1;
    p.stats.min += 90;
    p.morale = clamp(p.morale + (resultType === "win" ? 2 : resultType === "loss" ? -2 : 0), 10, 100);
  });

  const gk = starters.find(p => p.position === "GK");
  if (gk) {
    gk.stats.ga += oppGoals;
    if (oppGoals === 0) gk.stats.cleanSheets += 1;
  }

  for (let i = 0; i < teamGoals; i++) {
    const scorer = chooseScorer(starters);
    scorer.stats.goals += 1;
    scorer.stats.shots += randInt(1, 3);
    scorer.stats.shotsOnTarget += 1;
    scorer.stats.xg += xg / Math.max(1, teamGoals);

    if (Math.random() < 0.72) {
      const assistPool = starters.filter(p => p.id !== scorer.id);
      if (assistPool.length) chooseScorer(assistPool).stats.assists += 1;
    }
  }

  for (let i = 0; i < yellows; i++) pick(starters).stats.yellows += 1;
  for (let i = 0; i < reds; i++) {
    const outfield = starters.filter(p => p.position !== "GK");
    if (outfield.length) pick(outfield).stats.reds += 1;
  }
}

export function simulateMatch(state, match, opts = {}) {
  const homeTeam = state.teams.find(t => t.id === match.homeTeamId);
  const awayTeam = state.teams.find(t => t.id === match.awayTeamId);

  const homePower = teamOverall(state, homeTeam.id);
  const awayPower = teamOverall(state, awayTeam.id);
  const rivalry = rivalryBoost(homeTeam.name, awayTeam.name);

  let homeXg = clamp(1.2 + (homePower - awayPower) * 0.018 + 0.28 + rivalry * 0.5 + randFloat(-0.18, 0.35), 0.2, 3.8);
  let awayXg = clamp(1.02 + (awayPower - homePower) * 0.016 + rivalry * 0.25 + randFloat(-0.18, 0.30), 0.1, 3.4);

  let homeGoals = poisson(homeXg);
  let awayGoals = poisson(awayXg);

  let penalties = null;
  let extraTime = false;

  if (opts.singleElimination && homeGoals === awayGoals) {
    extraTime = true;
    homeGoals += poisson(homeXg * 0.16);
    awayGoals += poisson(awayXg * 0.16);
    if (homeGoals === awayGoals) {
      penalties = { home: randInt(3, 6), away: randInt(3, 6) };
      while (penalties.home === penalties.away) {
        penalties.home = randInt(3, 7);
        penalties.away = randInt(3, 7);
      }
    }
  } else if (opts.penaltyOnDraw && homeGoals === awayGoals) {
    penalties = { home: randInt(2, 6), away: randInt(2, 6) };
    while (penalties.home === penalties.away) {
      penalties.home = randInt(2, 7);
      penalties.away = randInt(2, 7);
    }
  }

  const homeShots = Math.max(homeGoals + randInt(6, 13), Math.round(homeXg * 6.8));
  const awayShots = Math.max(awayGoals + randInt(5, 12), Math.round(awayXg * 6.7));
  const homeSot = clamp(homeGoals + randInt(1, 5), homeGoals, homeShots);
  const awaySot = clamp(awayGoals + randInt(1, 5), awayGoals, awayShots);
  const homePoss = clamp(Math.round(50 + (homePower - awayPower) * 0.42 + randInt(-6, 6)), 35, 65);
  const awayPoss = 100 - homePoss;
  const homeYellows = randInt(0, 4);
  const awayYellows = randInt(0, 4);
  const homeReds = Math.random() < 0.05 ? 1 : 0;
  const awayReds = Math.random() < 0.05 ? 1 : 0;

  const homePlayers = state.players.filter(p => p.clubId === homeTeam.id).sort((a,b)=>b.overall-a.overall).slice(0, 11);
  const awayPlayers = state.players.filter(p => p.clubId === awayTeam.id).sort((a,b)=>b.overall-a.overall).slice(0, 11);

  const events = [];
  for (let i = 0; i < homeGoals; i++) {
    const scorer = chooseScorer(homePlayers);
    const assistPool = homePlayers.filter(p => p.id !== scorer.id);
    const assist = Math.random() < 0.72 && assistPool.length ? chooseScorer(assistPool) : null;
    events.push({ minute: randInt(3, 90), side: "home", scorerId: scorer.id, assistId: assist?.id || null });
  }
  for (let i = 0; i < awayGoals; i++) {
    const scorer = chooseScorer(awayPlayers);
    const assistPool = awayPlayers.filter(p => p.id !== scorer.id);
    const assist = Math.random() < 0.72 && assistPool.length ? chooseScorer(assistPool) : null;
    events.push({ minute: randInt(3, 90), side: "away", scorerId: scorer.id, assistId: assist?.id || null });
  }
  events.sort((a, b) => a.minute - b.minute);

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

  const homeResult = penalties ? (penalties.home > penalties.away ? "win" : "loss") : homeGoals > awayGoals ? "win" : homeGoals < awayGoals ? "loss" : "draw";
  const awayResult = penalties ? (penalties.away > penalties.home ? "win" : "loss") : awayGoals > homeGoals ? "win" : awayGoals < homeGoals ? "loss" : "draw";

  giveStats(state, homeTeam.id, homeGoals, awayGoals, homeXg, homeShots, homeSot, homeYellows, homeReds, homeResult);
  giveStats(state, awayTeam.id, awayGoals, homeGoals, awayXg, awayShots, awaySot, awayYellows, awayReds, awayResult);

  if (match.type === "Regular Season") applyStandings(state, match);

  return match.result;
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

function maybeExternalOffer(state) {
  const userTeam = getUserTeam(state);
  const players = getTeamPlayers(state, userTeam.id).filter(p => p.age >= 20);
  if (!players.length) return;
  if (Math.random() > 0.16) return;

  const target = pick(players.slice(0, 12));
  const offer = Math.round(target.contract.salary * randFloat(1.3, 3.2) + target.overall * 55000);
  state.pendingOffer = {
    id: uuid("offer"),
    playerId: target.id,
    bidClub: pick(state.teams.filter(t => t.id !== userTeam.id)).name,
    amount: offer,
  };
  addTransaction(state, "Offer", `${state.pendingOffer.bidClub} offered ${offer.toLocaleString()} for ${target.name}.`);
}

function buildPlayoffs(state) {
  const east = state.standings.East.slice().sort(sortStandingsRows).map((row, idx) => ({ ...row, seed: idx + 1 }));
  const west = state.standings.West.slice().sort(sortStandingsRows).map((row, idx) => ({ ...row, seed: idx + 1 }));

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

function winnerOf(match) {
  if (!match.result) return null;
  if (match.result.penalties) return match.result.penalties.home > match.result.penalties.away ? match.homeTeamId : match.awayTeamId;
  return match.result.homeGoals > match.result.awayGoals ? match.homeTeamId : match.awayTeamId;
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

function generateDraftPool(state) {
  const pool = [];
  for (let i = 0; i < 120; i++) {
    const fakeClub = { id: null, marketRating: randInt(51, 73), country: "USA" };
    const pos = pick(POSITIONS);
    const p = makePlayer(fakeClub, i, pos);
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
}

function draftOrder(state) {
  const rows = [...state.standings.East, ...state.standings.West].sort((a, b) => {
    if (a.points !== b.points) return a.points - b.points;
    if (a.wins !== b.wins) return a.wins - b.wins;
    if (a.gd !== b.gd) return a.gd - b.gd;
    return a.gf - b.gf;
  });
  return rows.map(r => r.teamId);
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
      player.contract.salary = round === 1 ? 113400 : 88025;
      player.rosterRole = round === 1 ? "Supplemental" : "Reserve";
      player.designation = round === 1 && Math.random() < 0.35 ? "U22" : null;
      player.domestic = true;
      state.players.push(player);
      addTransaction(state, "Draft", `${state.teams.find(t => t.id === teamId).name} selected ${player.name} in Round ${round}.`);
    }
  }
}

function ageAndDevelop(state) {
  for (const p of state.players) {
    p.age += 1;
    const delta =
      p.age <= 21 ? randInt(1, 5) :
      p.age <= 25 ? randInt(0, 3) :
      p.age <= 29 ? randInt(-1, 2) :
      randInt(-4, 1);

    for (const key of Object.keys(p.attributes)) {
      p.attributes[key] = clamp(p.attributes[key] + Math.sign(delta) * randInt(0, Math.abs(delta) + 1), 25, 98);
    }
    p.overall = overall(p);
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

  for (const team of state.teams) {
    const academy = state.academies[team.id] || [];
    academy.forEach(a => {
      a.age += 1;
      for (const key of Object.keys(a.attributes)) {
        a.attributes[key] = clamp(a.attributes[key] + randInt(0, 2), 25, 98);
      }
      a.overall = overall(a);
      a.potential = clamp(a.potential + randInt(-1, 2), a.overall, 95);
      a.morale = clamp(a.morale + randInt(-4, 6), 20, 100);
    });

    while ((state.academies[team.id] || []).length < state.settings.academyPerTeam) {
      state.academies[team.id].push(makeAcademyPlayer(team));
    }
  }
}

function expireContracts(state) {
  const expired = [];
  for (const p of state.players) {
    if (p.clubId && p.contract.yearsLeft <= 0) {
      expired.push(p);
    }
  }
  for (const p of expired) {
    p.clubId = null;
    p.contract.status = "Free Agent";
    p.contract.yearsLeft = randInt(1, 3);
    state.freeAgents.push(p);
    addTransaction(state, "Free Agency", `${p.name} became a free agent.`);
  }
}

function aiFillRosters(state) {
  for (const team of state.teams) {
    const squad = getTeamPlayers(state, team.id);
    let needs = 26 - squad.length;
    while (needs > 0 && state.freeAgents.length) {
      const player = state.freeAgents.sort((a, b) => b.overall - a.overall)[0];
      if (!player) break;
      player.clubId = team.id;
      player.contract.status = "Active";
      player.contract.yearsLeft = randInt(1, 3);
      player.rosterRole = squad.length < 20 ? "Senior" : squad.length < 24 ? "Supplemental" : "Reserve";
      state.freeAgents = state.freeAgents.filter(p => p.id !== player.id);
      needs--;
    }
  }
}

function resetStandingsAndSchedule(state) {
  state.standings = {
    East: state.teams.filter(t => t.conference === "East").map(t => initStandingsRow(t.id)),
    West: state.teams.filter(t => t.conference === "West").map(t => initStandingsRow(t.id)),
  };
  makeSchedule(state);
  state.playoffs = null;
  state.pendingOffer = null;
}

export function createNewState(options) {
  const teams = [];
  let ordinal = 0;

  for (const [conference, names] of Object.entries(CONFERENCES)) {
    for (const name of names) {
      teams.push({
        id: uuid("t"),
        ordinal: ordinal++,
        name,
        shortName: shortName(name),
        conference,
        country: clubCountry(name),
        marketRating: randInt(58, 77),
        gam: Number(options.gamAnnual),
        tam: Number(options.tamAnnual),
        salaryBudget: Number(options.salaryBudget),
        internationalSlots: MLS_RULES.intlSlotsDefault,
        finances: {
          cash: randInt(5000000, 26000000),
          ticketBase: randInt(17000, 42000),
          sponsor: randInt(9000000, 25000000),
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
    rolePlan.forEach((pos, idx) => players.push(makePlayer(team, idx, pos)));
  }

  const academies = {};
  for (const team of teams) {
    academies[team.id] = Array.from({ length: Number(options.academyPerTeam) }, () => makeAcademyPlayer(team));
  }

  const state = {
    version: 2,
    season: { year: 2026, phase: "Regular Season" },
    calendar: { week: 1, absoluteDay: 0 },
    teams,
    players,
    academies,
    standings: {
      East: teams.filter(t => t.conference === "East").map(t => initStandingsRow(t.id)),
      West: teams.filter(t => t.conference === "West").map(t => initStandingsRow(t.id)),
    },
    schedule: [],
    playoffs: null,
    draft: { pool: [] },
    freeAgents: [],
    transactions: [],
    awardsHistory: [],
    pendingOffer: null,
    userTeamId: teams.find(t => t.name === options.userTeamName)?.id || teams[0].id,
    saveSlot: options.saveSlot || "slot1",
    settings: {
      academyPerTeam: Number(options.academyPerTeam),
      salaryBudget: Number(options.salaryBudget),
      gamAnnual: Number(options.gamAnnual),
      tamAnnual: Number(options.tamAnnual),
    },
  };

  makeSchedule(state);
  seedFreeAgents(state);
  addTransaction(state, "League", `League initialized for ${state.season.year}.`);
  return state;
}

export function signFreeAgent(state, playerId, teamId) {
  const player = state.freeAgents.find(p => p.id === playerId);
  if (!player) return { ok: false, reason: "Player not found" };

  const cap = getCapSummary(state, teamId);
  const team = state.teams.find(t => t.id === teamId);

  if (!player.domestic && cap.intlUsed >= team.internationalSlots) {
    return { ok: false, reason: "No international slot available" };
  }

  const projectedCharge = getBudgetCharge({ ...player, rosterRole: cap.seniorCount < 20 ? "Senior" : "Supplemental" });
  if (cap.seniorCount < 20 && cap.budgetRoom < projectedCharge) {
    return { ok: false, reason: "Not enough cap room" };
  }

  player.clubId = teamId;
  player.contract.status = "Active";
  player.contract.yearsLeft = randInt(1, 3);
  player.rosterRole = cap.seniorCount < 20 ? "Senior" : cap.supplementalCount < 4 ? "Supplemental" : "Reserve";
  state.freeAgents = state.freeAgents.filter(p => p.id !== playerId);
  addTransaction(state, "Signing", `${team.name} signed free agent ${player.name}.`);
  return { ok: true };
}

export function callUpAcademyPlayer(state, academyPlayerId, teamId) {
  const academy = state.academies[teamId] || [];
  const prospect = academy.find(p => p.id === academyPlayerId);
  if (!prospect) return { ok: false, reason: "Prospect not found" };

  const teamPlayers = getTeamPlayers(state, teamId);
  if (teamPlayers.length >= 30) return { ok: false, reason: "Roster full" };

  const signed = {
    id: uuid("p"),
    name: prospect.name,
    age: prospect.age,
    nationality: prospect.nationality,
    domestic: true,
    preferredFoot: prospect.preferredFoot,
    clubId: teamId,
    position: prospect.position,
    rosterRole: teamPlayers.length < 20 ? "Supplemental" : "Reserve",
    designation: null,
    homegrown: true,
    contract: {
      yearsLeft: 3,
      salary: 88025,
      status: "Active",
    },
    morale: prospect.morale,
    injuryProne: false,
    injuredUntil: null,
    attributes: prospect.attributes,
    overall: prospect.overall,
    potential: prospect.potential,
    stats: {
      gp: 0, gs: 0, min: 0,
      goals: 0, assists: 0,
      shots: 0, shotsOnTarget: 0, xg: 0,
      yellows: 0, reds: 0,
      cleanSheets: 0, ga: 0,
      motm: 0,
    },
  };

  state.players.push(signed);
  state.academies[teamId] = academy.filter(p => p.id !== academyPlayerId);
  state.academies[teamId].push(makeAcademyPlayer(state.teams.find(t => t.id === teamId)));
  addTransaction(state, "Academy", `${signed.name} was called up from the academy by ${state.teams.find(t => t.id === teamId).name}.`);
  return { ok: true };
}

export function acceptPendingOffer(state) {
  if (!state.pendingOffer) return;
  const offer = state.pendingOffer;
  const player = state.players.find(p => p.id === offer.playerId);
  const team = getUserTeam(state);
  if (!player || !team) return;

  player.clubId = null;
  player.contract.status = "Free Agent";
  player.contract.yearsLeft = randInt(1, 3);
  state.freeAgents.push(player);
  team.finances.cash += offer.amount;
  team.gam += Math.min(400000, Math.round(offer.amount * 0.06));
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
    maybeExternalOffer(state);

    state.calendar.week += 1;
    state.calendar.absoluteDay += 7;

    if (state.calendar.week > 34) {
      state.season.phase = "Playoffs";
      state.playoffs = buildPlayoffs(state);
      addTransaction(state, "Playoffs", `MLS Cup Playoffs field set for ${state.season.year}.`);
    }
    return;
  }

  if (state.season.phase === "Playoffs") {
    advancePlayoffs(state);
    return;
  }

  if (state.season.phase === "Offseason") {
    runOffseason(state);
  }
}

export function simulateToSeasonEnd(state) {
  while (state.season.phase === "Regular Season" || state.season.phase === "Playoffs") {
    advanceOneWeek(state);
  }
}

function createRoundOneSeries(playoffs, conf) {
  const seeds = playoffs.conferenceSeeds[conf];
  const wild = seeds.find(s => s.seed === 8)._wildCardWinner;
  return [
    { higher: seeds.find(s => s.seed === 1).teamId, lower: wild, conference: conf },
    { higher: seeds.find(s => s.seed === 2).teamId, lower: seeds.find(s => s.seed === 7).teamId, conference: conf },
    { higher: seeds.find(s => s.seed === 3).teamId, lower: seeds.find(s => s.seed === 6).teamId, conference: conf },
    { higher: seeds.find(s => s.seed === 4).teamId, lower: seeds.find(s => s.seed === 5).teamId, conference: conf },
  ];
}

export function advancePlayoffs(state) {
  const p = state.playoffs;
  if (!p) return;

  if (p.currentRound === "Wild Card") {
    for (const conf of ["East", "West"]) {
      const seeds = p.conferenceSeeds[conf];
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
      seed8._wildCardWinner = winnerOf(match);
      p.rounds.wildCard.push(match);
    }
    p.currentRound = "Round One";
    return;
  }

  if (p.currentRound === "Round One") {
    const seriesList = [
      ...createRoundOneSeries(p, "East"),
      ...createRoundOneSeries(p, "West"),
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
        wins[winnerOf(match)] += 1;
        p.rounds.roundOne.push(match);
      }

      p.rounds.roundOne.push({
        seriesSummary: true,
        conference: series.conference,
        higher: series.higher,
        lower: series.lower,
        winner: wins[series.higher] === 2 ? series.higher : series.lower,
        wins,
      });
    }

    p.currentRound = "Semifinals";
    return;
  }

  if (p.currentRound === "Semifinals") {
    for (const conf of ["East", "West"]) {
      const winners = p.rounds.roundOne
        .filter(x => x.seriesSummary && x.conference === conf)
        .map(x => x.winner);

      const seeds = p.conferenceSeeds[conf];
      winners.sort((a, b) => seeds.find(s => s.teamId === a).seed - seeds.find(s => s.teamId === b).seed);

      const pairs = [
        [winners[0], winners[3]],
        [winners[1], winners[2]],
      ];

      for (const [a, b] of pairs) {
        const seedA = seeds.find(s => s.teamId === a).seed;
        const seedB = seeds.find(s => s.teamId === b).seed;
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
    }
    p.currentRound = "Conference Finals";
    return;
  }

  if (p.currentRound === "Conference Finals") {
    for (const conf of ["East", "West"]) {
      const winners = p.rounds.semifinals.filter(m => m.homeConf === conf).map(m => winnerOf(m));
      const seeds = p.conferenceSeeds[conf];
      winners.sort((a, b) => seeds.find(s => s.teamId === a).seed - seeds.find(s => s.teamId === b).seed);
      const match = {
        id: uuid("cf"),
        type: "Conference Final",
        played: false,
        homeTeamId: winners[0],
        awayTeamId: winners[1],
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
    const eastWinner = winnerOf(p.rounds.conferenceFinals.find(m => m.homeConf === "East"));
    const westWinner = winnerOf(p.rounds.conferenceFinals.find(m => m.homeConf === "West"));
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
    p.championTeamId = winnerOf(cup);
    awardSeason(state);
    state.season.phase = "Offseason";
    addTransaction(state, "Champion", `${state.teams.find(t => t.id === p.championTeamId).name} won MLS Cup ${state.season.year}.`);
  }
}

export function runOffseason(state) {
  expireContracts(state);
  ageAndDevelop(state);
  runDraft(state);
  aiFillRosters(state);
  resetStandingsAndSchedule(state);

  state.season.year += 1;
  state.season.phase = "Regular Season";
  state.calendar.week = 1;
  state.calendar.absoluteDay += 28;

  for (const team of state.teams) {
    team.gam = state.settings.gamAnnual + randInt(-350000, 2600000);
    team.tam = state.settings.tamAnnual;
    team.finances.cash += randInt(-2000000, 8000000);
  }

  addTransaction(state, "Season", `Opened ${state.season.year} season.`);
}
