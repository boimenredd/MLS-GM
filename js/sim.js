import {
  MLS_RULES,
  CONFERENCES,
  RIVALRIES,
  POSITIONS,
  NATIONS,
  COLLEGES,
  US_OPEN_CUP_MLS_2026,
  US_OPEN_CUP_OPEN_FIELD_2026,
} from "./data.js";

import {
  clamp,
  randInt,
  randFloat,
  pick,
  uuid,
  weightedRandom,
} from "./utils.js";

import {
  generateNameForCountry,
  rollInjury,
} from "./assets.js";

// ─── Internal helpers ────────────────────────────────────────────────────────

function clubCountry(name) {
  return ["Toronto FC", "CF Montréal", "Vancouver Whitecaps FC"].includes(name)
    ? "Canada"
    : "USA";
}

function shortName(name) {
  return name
    .replace("Football Club", "FC")
    .replace("Sounders FC", "Sounders")
    .replace("Whitecaps FC", "Whitecaps");
}

function estimateSalaryByProfile(position, ovr, age, rosterRole) {
  const youthDiscount = age <= 20 ? 0.74 : age <= 23 ? 0.9 : age >= 32 ? 0.86 : 1;
  const roleMult = rosterRole === "Senior" ? 1 : rosterRole === "Supplemental" ? 0.72 : 0.52;
  let base;
  if (ovr >= 79) base = randInt(3200000, 9200000);
  else if (ovr >= 76) base = randInt(2000000, 5200000);
  else if (ovr >= 73) base = randInt(1200000, 2800000);
  else if (ovr >= 70) base = randInt(600000, 1500000);
  else if (ovr >= 67) base = randInt(250000, 700000);
  else if (ovr >= 63) base = randInt(140000, 350000);
  else if (ovr >= 58) base = randInt(95000, 190000);
  else base = randInt(88025, 140000);
  if (position === "GK" && ovr >= 70) base = Math.round(base * 0.88);
  return Math.max(88025, Math.round(base * youthDiscount * roleMult));
}

function openCupRef(type, id) {
  return `${type}:${id}`;
}

function parseOpenCupRef(ref) {
  const [type, ...rest] = String(ref || '').split(':');
  return { type, id: rest.join(':') };
}

function resolveOpenCupEntry(state, ref) {
  const { type, id } = parseOpenCupRef(ref);
  if (type === 'mls') {
    const team = state.teams.find(t => t.id === id);
    return team ? { kind: 'mls', id: team.id, name: team.name, shortName: team.shortName, strength: teamOverall(state, team.id), conference: team.conference } : null;
  }
  const guest = state.openCup?.guestTeams?.find(t => t.id === id);
  return guest ? { kind: 'guest', id: guest.id, name: guest.name, shortName: guest.shortName || guest.name, strength: guest.strength || 58 } : null;
}

function simulateOpenCupMatch(state, match) {
  const home = resolveOpenCupEntry(state, match.homeRef);
  const away = resolveOpenCupEntry(state, match.awayRef);
  if (!home || !away) return null;
  const homePower = home.strength + randFloat(-2.5, 2.5);
  const awayPower = away.strength + randFloat(-2.5, 2.5);
  const baseXg = 1.18;
  let homeXg = clamp(baseXg + (homePower - awayPower) * 0.045 + 0.18, 0.35, 3.2);
  let awayXg = clamp(baseXg + (awayPower - homePower) * 0.045, 0.3, 3.0);
  let homeGoals = poisson(homeXg);
  let awayGoals = poisson(awayXg);
  if (homeGoals === awayGoals) {
    homeGoals += poisson(homeXg * 0.18);
    awayGoals += poisson(awayXg * 0.18);
    if (homeGoals === awayGoals) {
      homeGoals += randInt(0, 1);
      awayGoals += homeGoals === awayGoals ? 1 : 0;
    }
  }
  match.played = true;
  match.result = {
    homeGoals, awayGoals,
    homeName: home.name, awayName: away.name,
    homeXg: Number(homeXg.toFixed(2)), awayXg: Number(awayXg.toFixed(2)),
  };
  match.winnerRef = homeGoals > awayGoals ? match.homeRef : match.awayRef;
  return match.result;
}

function advanceOpenCupWeek(state, week) {
  ensureOpenCupState(state);
  const oc = state.openCup;
  if (!oc || oc.year !== state.season.year || oc.championRef) return;
  const roundOrder = ['roundOf32','roundOf16','quarterfinals','semifinals','final'];
  for (const round of roundOrder) {
    const matches = oc.rounds?.[round] || [];
    const due = matches.filter(m => m.week === week && !m.played);
    if (!due.length) continue;
    due.forEach(m => simulateOpenCupMatch(state, m));
    if (matches.every(m => m.played)) {
      const winners = matches.map(m => m.winnerRef).filter(Boolean);
      if (round === 'final') {
        oc.championRef = winners[0] || null;
        oc.currentRound = 'Complete';
        if (oc.championRef) addTransaction(state, 'U.S. Open Cup', `${resolveOpenCupEntry(state, oc.championRef)?.name || 'Unknown'} won the U.S. Open Cup.`);
      } else {
        const nextMap = { roundOf32: ['roundOf16', 9], roundOf16: ['quarterfinals', 12], quarterfinals: ['semifinals', 24], semifinals: ['final', 31] };
        const [nextRound, nextWeek] = nextMap[round];
        if (!oc.rounds[nextRound]?.length) {
          oc.rounds[nextRound] = [];
          for (let i = 0; i < winners.length; i += 2) {
            const a = winners[i];
            const b = winners[i + 1];
            if (!a || !b) continue;
            oc.rounds[nextRound].push({ id: uuid('ocm'), round: nextRound, week: nextWeek, played: false, homeRef: Math.random() < 0.5 ? a : b, awayRef: Math.random() < 0.5 ? b : a });
          }
          oc.currentRound = nextRound;
        }
      }
    }
    break;
  }
}

export function ensureOpenCupState(state) {
  if (state.openCup && state.openCup.year === state.season.year) return state.openCup;
  const mlsTeams = state.teams.filter(t => US_OPEN_CUP_MLS_2026.includes(t.name));
  const guestTeams = US_OPEN_CUP_OPEN_FIELD_2026.map(name => ({ id: uuid('ocg'), name, shortName: name.replace(/ SC$| FC$/,'').slice(0, 18), strength: randInt(51, 66) }));
  const shuffledGuests = [...guestTeams].sort(() => Math.random() - 0.5);
  const shuffledMls = [...mlsTeams].sort(() => Math.random() - 0.5);
  const roundOf32 = shuffledMls.map((team, idx) => ({
    id: uuid('ocm'),
    round: 'roundOf32',
    week: 6,
    played: false,
    homeRef: Math.random() < 0.5 ? openCupRef('mls', team.id) : openCupRef('guest', shuffledGuests[idx].id),
    awayRef: Math.random() < 0.5 ? openCupRef('guest', shuffledGuests[idx].id) : openCupRef('mls', team.id),
  }));
  state.openCup = {
    year: state.season.year,
    guestTeams,
    rounds: { roundOf32, roundOf16: [], quarterfinals: [], semifinals: [], final: [] },
    currentRound: 'roundOf32',
    championRef: null,
  };
  return state.openCup;
}

function posBucket(pos) {
  if (pos === "GK") return "GK";
  if (["LB", "CB", "RB"].includes(pos)) return "DEF";
  if (["LM", "RM", "CDM", "CM", "CAM"].includes(pos)) return "MID";
  return "ATT";
}

function domesticForTeam(playerNation, country) {
  if (country === "Canada") return playerNation === "Canada" || playerNation === "USA";
  return playerNation === "USA";
}

function sideForWidePosition(pos, preferredFoot = "Right") {
  if (pos === "LB" || pos === "LM" || pos === "LW") return "Left";
  if (pos === "RB" || pos === "RM" || pos === "RW") return "Right";
  if (pos === "CB") return Math.random() < 0.5 ? "Left" : "Right";
  return preferredFoot;
}

function normalizeGeneratedPosition(pos, preferredFoot = "Right") {
  if (pos === "FB") return preferredFoot === "Left" ? "LB" : "RB";
  if (pos === "Winger") return preferredFoot === "Left" ? "LW" : "RW";
  return pos;
}

function makeDetailedRatings(position, a) {
  const sideBias = (position === "LB" || position === "LM" || position === "LW") ? 2 : (position === "RB" || position === "RM" || position === "RW" ? -2 : 0);
  return {
    physical: {
      acceleration: clamp(Math.round(a.pace + randInt(-6, 6)), 25, 98),
      sprintSpeed: clamp(Math.round(a.pace + randInt(-5, 5)), 25, 98),
      agility: clamp(Math.round((a.pace + a.dribbling) / 2 + randInt(-7, 7)), 25, 98),
      stamina: clamp(Math.round((a.physical + a.pace) / 2 + randInt(-8, 8)), 25, 98),
      strength: clamp(Math.round(a.physical + randInt(-8, 8)), 25, 98),
      jumping: clamp(Math.round((a.physical + a.defense) / 2 + randInt(-7, 7)), 25, 98),
    },
    technical: {
      finishing: clamp(Math.round((a.shooting * 1.08) + randInt(-7, 7)), 20, 98),
      longShots: clamp(Math.round((a.shooting * 0.94) + randInt(-7, 7)), 20, 98),
      crossing: clamp(Math.round((a.passing + a.dribbling) / 2 + (["LB","RB","LM","RM","LW","RW"].includes(position) ? 6 : -2) + sideBias + randInt(-7, 7)), 20, 98),
      shortPassing: clamp(Math.round(a.passing + randInt(-6, 6)), 20, 98),
      vision: clamp(Math.round((a.passing + a.dribbling) / 2 + (position === "CAM" ? 8 : 0) + randInt(-7, 7)), 20, 98),
      dribbling: clamp(Math.round(a.dribbling + randInt(-6, 6)), 20, 98),
      firstTouch: clamp(Math.round((a.dribbling + a.passing) / 2 + randInt(-6, 6)), 20, 98),
      setPieces: clamp(Math.round((a.passing + a.shooting) / 2 + randInt(-10, 8)), 20, 98),
    },
    defending: {
      marking: clamp(Math.round(a.defense + (["CB","LB","RB","CDM"].includes(position) ? 5 : -8) + randInt(-7, 7)), 20, 98),
      tackling: clamp(Math.round(a.defense + (["CB","LB","RB","CDM"].includes(position) ? 6 : -10) + randInt(-7, 7)), 20, 98),
      interceptions: clamp(Math.round(a.defense + (["CDM","CM","CAM"].includes(position) ? 2 : 0) + randInt(-7, 7)), 20, 98),
      heading: clamp(Math.round((a.defense + a.physical) / 2 + (position === "ST" ? 4 : 0) + randInt(-8, 8)), 20, 98),
      positioning: clamp(Math.round((a.defense + a.passing) / 2 + randInt(-8, 8)), 20, 98),
    },
    goalkeeping: {
      handling: clamp(Math.round((position === "GK" ? a.defense + 10 : 8) + randInt(-8, 8)), 1, 98),
      reflexes: clamp(Math.round((position === "GK" ? a.defense + 12 : 8) + randInt(-8, 8)), 1, 98),
      oneOnOnes: clamp(Math.round((position === "GK" ? a.defense + 8 : 6) + randInt(-8, 8)), 1, 98),
      kicking: clamp(Math.round((position === "GK" ? a.passing : 8) + randInt(-8, 8)), 1, 98),
      command: clamp(Math.round((position === "GK" ? a.physical + 6 : 6) + randInt(-8, 8)), 1, 98),
    },
  };
}

function deriveTraits(player) {
  const a = player.attributes;
  const t = [];
  if (player.position === "GK") {
    if (a.defense >= 76) t.push("Shot Stopper");
    if (a.passing >= 67) t.push("Sweeper Keeper");
    if (a.physical >= 72) t.push("Claims Crosses");
  } else {
    if (a.pace >= 77) t.push("Quick Burst");
    if (a.shooting >= 76) t.push(player.position === "ST" ? "Poacher" : "Goal Threat");
    if (a.passing >= 75) t.push(player.position === "CAM" ? "Playmaker" : "Progressive Passer");
    if (a.dribbling >= 76) t.push("Press Resistant");
    if (a.defense >= 75) t.push(["CB","LB","RB","CDM"].includes(player.position) ? "Ball Winner" : "Two-Way Workrate");
    if (a.physical >= 78) t.push(player.position === "ST" ? "Target Forward" : "Strong Dueler");
    if (["LB","RB","LM","RM","LW","RW"].includes(player.position) && a.passing >= 70) t.push("Delivery");
  }
  if (player.homegrown) t.push("Homegrown Upside");
  if (player.designation === "DP") t.push("Star Player");
  return [...new Set(t)].slice(0, 4);
}

export function hydratePlayer(player, seasonYear = 2026) {
  if (!player || !player.attributes) return player;
  if (player.position === "FB" || player.position === "Winger") {
    player.position = normalizeGeneratedPosition(player.position, player.preferredFoot || "Right");
  }
  player.side ||= sideForWidePosition(player.position, player.preferredFoot || "Right");
  player.detailed ||= makeDetailedRatings(player.position, player.attributes);
  player.traits ||= deriveTraits(player);
  player.contract ||= { yearsLeft: 1, salary: 113400, status: "Active" };
  player.contract.expiresYear ??= seasonYear + Math.max(0, Number(player.contract.yearsLeft || 0));
  return player;
}

function ensureDesignationMeta(player) {
  if (!player) return;
  if (!player.designationMode) player.designationMode = player.designation ? "manual" : "auto";
}

function dpFitScore(player) {
  const salary = Number(player.contract?.salary || 0);
  const primeBoost = player.age >= 21 && player.age <= 29 ? 18 : player.age <= 20 ? 10 : Math.max(-10, 8 - (player.age - 29) * 2);
  const roleBoost = ["ST", "CAM", "LW", "RW"].includes(player.position) ? 12 : ["CM", "CDM"].includes(player.position) ? 6 : 0;
  return (player.overall * 5.8) + (player.potential * 1.9) + (salary / 65000) + primeBoost + roleBoost;
}

function u22FitScore(player) {
  const salary = Number(player.contract?.salary || 0);
  const ageBoost = Math.max(0, 24 - player.age) * 12;
  const upsideBoost = Math.max(0, player.potential - player.overall) * 3.4;
  const homegrownBoost = player.homegrown ? 12 : 0;
  return (player.overall * 4.2) + (player.potential * 3.7) + ageBoost + upsideBoost + homegrownBoost - (salary / 90000);
}

function tamFitScore(player) {
  const salary = Number(player.contract?.salary || 0);
  const rosterBoost = player.rosterRole === "Senior" ? 18 : 0;
  return (player.overall * 4.8) + (player.potential * 1.2) + (salary / 50000) + rosterBoost;
}

export function autoAssignTeamDesignations(state, teamId) {
  const team = state.teams.find(t => t.id === teamId);
  if (!team) return { ok: false, reason: "Team not found." };
  const teamPlayers = getTeamPlayers(state, teamId);
  teamPlayers.forEach(ensureDesignationMeta);

  // Clean illegal manual U22 tags after aging.
  for (const p of teamPlayers) {
    if (p.designationMode === "manual" && p.designation === "U22" && p.age > 23) {
      p.designationMode = "auto";
      p.designation = null;
    }
  }

  for (const p of teamPlayers) {
    if (p.designationMode !== "manual") p.designation = null;
  }

  const manualDp = teamPlayers.filter(p => p.designationMode === "manual" && p.designation === "DP").length;
  const manualU22 = teamPlayers.filter(p => p.designationMode === "manual" && p.designation === "U22").length;
  const openDp = Math.max(0, (team.dpSlots ?? 3) - manualDp);
  const openU22 = Math.max(0, (team.u22Slots ?? 3) - manualU22);

  const seniorAuto = teamPlayers.filter(p => p.rosterRole === "Senior" && p.designationMode !== "manual");

  const u22Candidates = seniorAuto
    .filter(p => p.age <= 23)
    .sort((a, b) => u22FitScore(b) - u22FitScore(a));
  for (const player of u22Candidates.slice(0, openU22)) {
    player.designation = "U22";
  }

  const dpCandidates = seniorAuto
    .filter(p => !p.designation)
    .sort((a, b) => dpFitScore(b) - dpFitScore(a));
  let dpAssigned = 0;
  for (const player of dpCandidates) {
    if (dpAssigned >= openDp) break;
    const salary = Number(player.contract?.salary || 0);
    if (salary >= MLS_RULES.maxBudgetCharge * 1.1 || player.overall >= 73 || (player.potential >= 77 && salary >= 600000)) {
      player.designation = "DP";
      dpAssigned += 1;
    }
  }

  const tamCandidates = seniorAuto
    .filter(p => !p.designation)
    .sort((a, b) => tamFitScore(b) - tamFitScore(a));
  for (const player of tamCandidates) {
    const salary = Number(player.contract?.salary || 0);
    if (salary > MLS_RULES.maxBudgetCharge || (salary >= 650000 && player.overall >= 66) || (player.overall >= 71 && player.potential >= 74)) {
      player.designation = "TAM";
    }
  }

  return { ok: true };
}

export function autoAssignAllDesignations(state) {
  for (const team of state.teams || []) autoAssignTeamDesignations(state, team.id);
  return state;
}

// ─── Player stats/ratings ────────────────────────────────────────────────────

export function overall(player) {
  const a = player.attributes;
  return Math.round(
    (a.pace + a.shooting + a.passing + a.dribbling + a.defense + a.physical) / 6
  );
}

function makeAttributes(pos, quality = 60, age = 25) {
  const spread = randInt(-7, 7);
  const ageCurve =
    age < 22 ? 1 : age <= 28 ? 4 : -Math.floor((age - 28) * 1.15);
  const base = quality + spread + ageCurve;

  const map = {
    GK: [46, 24, 61, 32, 77, 69],
    LB: [77, 43, 67, 68, 73, 67],
    CB: [58, 34, 58, 49, 79, 77],
    RB: [77, 43, 67, 68, 73, 67],
    LM: [76, 57, 72, 73, 49, 63],
    RM: [76, 57, 72, 73, 49, 63],
    CDM:[59, 43, 71, 58, 78, 74],
    CM: [63, 51, 76, 67, 64, 69],
    CAM:[67, 70, 80, 79, 43, 58],
    LW: [81, 69, 68, 81, 38, 56],
    RW: [81, 69, 68, 81, 38, 56],
    ST: [72, 79, 56, 66, 31, 75],
  }[pos] || [62, 52, 67, 63, 58, 64];

  const [pace, shooting, passing, dribbling, defense, physical] = map.map(v =>
    clamp(Math.round(v + (base - 60) * 0.62 + randInt(-8, 8)), 24, 94)
  );

  return { pace, shooting, passing, dribbling, defense, physical };
}

// ─── Player / academy generation ─────────────────────────────────────────────

function makePlayer(club, idx, forcedPos = null) {
  const positionWeights = [
    { value: "GK",  weight: 2 },
    { value: "LB",  weight: 2 },
    { value: "CB",  weight: 5 },
    { value: "RB",  weight: 2 },
    { value: "LM",  weight: 1 },
    { value: "RM",  weight: 1 },
    { value: "CDM", weight: 2 },
    { value: "CM",  weight: 4 },
    { value: "CAM", weight: 2 },
    { value: "LW",  weight: 2 },
    { value: "RW",  weight: 2 },
    { value: "ST",  weight: 3 },
  ];

  const rawPosition = forcedPos || weightedRandom(positionWeights);
  const age        = randInt(17, 34);
  const nationality = pick(
    club.country === "Canada"
      ? ["Canada", "USA", ...NATIONS]
      : ["USA", ...NATIONS]
  );
  const domestic      = domesticForTeam(nationality, club.country);
  const preferredFoot = Math.random() < 0.76 ? "Right" : "Left";
  const position = normalizeGeneratedPosition(rawPosition, preferredFoot);

  let qualityBase = club.marketRating + randInt(-9, 9);
  if (idx < 3) qualityBase += 11;
  if (idx > 20) qualityBase -= 5;

  const homegrown  = age <= 22 && Math.random() < 0.18;
  const rosterRole = idx < 18 ? "Senior" : idx < 24 ? "Supplemental" : "Reserve";
  const attributes = makeAttributes(position, clamp(qualityBase, 48, 84), age);
  const ovr        = overall({ attributes });
  const potential  = clamp(ovr + randInt(-2, 12) + (age <= 22 ? 6 : 0), ovr, 91);

  const salaryBase = estimateSalaryByProfile(position, ovr, age, rosterRole);

  let designation = null;
  if ((idx < 2 && ovr >= 74) || (ovr >= 77 && Math.random() < 0.42)) designation = "DP";
  else if (age <= 22 && potential >= 70 && ovr >= 60 && Math.random() < 0.28) designation = "U22";
  else if ((salaryBase > MLS_RULES.maxBudgetCharge && ovr >= 67) || (ovr >= 70 && Math.random() < 0.35)) designation = "TAM";

  const salary = designation === "DP"
    ? Math.max(salaryBase, randInt(2200000, 8200000))
    : designation === "TAM"
      ? clamp(Math.max(salaryBase, randInt(900000, 2200000)), 850000, 2200000)
      : salaryBase;

  return hydratePlayer({
    id:           uuid("p"),
    name:         generateNameForCountry(nationality),
    age,
    nationality,
    domestic,
    preferredFoot,
    clubId:       club.id,
    position,
    rosterRole,
    designation,
    homegrown,
    contract: {
      yearsLeft: randInt(1, 5),
      salary,
      status:    "Active",
    },
    morale:       clamp(65 + randInt(-12, 12), 20, 100),
    injuryProne:  Math.random() < 0.08,
    injuredUntil: null,
    injuryMeta:   null,
    attributes,
    overall:      ovr,
    potential,
    stats: {
      gp: 0, gs: 0, min: 0,
      goals: 0, assists: 0,
      shots: 0, shotsOnTarget: 0, xg: 0,
      yellows: 0, reds: 0,
      cleanSheets: 0, ga: 0,
      motm: 0,
    },
  });
}

function makeAcademyPlayer(team) {
  const age        = randInt(15, 18);
  const position   = pick(POSITIONS);
  const quality    = randInt(42, 56);
  const attributes = makeAttributes(position, quality, age);
  const ovr        = overall({ attributes });
  const potential  = clamp(ovr + randInt(6, 14), ovr + 4, 82);
  const nationality =
    team.country === "Canada" ? pick(["Canada", "USA"]) : "USA";

  return hydratePlayer({
    id:               uuid("a"),
    name:             generateNameForCountry(nationality),
    age,
    nationality,
    domestic:         true,
    preferredFoot:    Math.random() < 0.75 ? "Right" : "Left",
    position,
    status:           "Academy",
    homegrownEligible: true,
    morale:           clamp(68 + randInt(-8, 8), 35, 100),
    attributes,
    overall:          ovr,
    potential,
    notes:            `${pick(COLLEGES)} local product`,
  });
}

// ─── Standings helpers ────────────────────────────────────────────────────────

function initStandingsRow(teamId) {
  return {
    teamId,
    played: 0, wins: 0, draws: 0, losses: 0,
    gf: 0, ga: 0, gd: 0,
    awayGf: 0, awayGa: 0, awayGd: 0,
    homeGf: 0, homeGa: 0, homeGd: 0,
    disciplinePoints: 0,
    points: 0,
    randomTiebreak: Math.random(),
  };
}

export function getBudgetCharge(player) {
  if (player.rosterRole !== "Senior") return 0;
  const { salary } = player.contract;

  if (player.designation === "DP") {
    if (player.age <= 20) return MLS_RULES.youngDpBudgetU20;
    if (player.age <= 23) return MLS_RULES.youngDpBudgetU23;
    return MLS_RULES.maxBudgetCharge;
  }
  if (player.designation === "U22") {
    return player.age <= 20
      ? MLS_RULES.youngDpBudgetU20
      : MLS_RULES.youngDpBudgetU23;
  }
  return Math.min(salary, MLS_RULES.maxBudgetCharge);
}

export function teamOverall(state, teamId) {
  const roster = state.players
    .filter(
      p =>
        p.clubId === teamId &&
        (!p.injuredUntil || p.injuredUntil < state.calendar.absoluteDay)
    )
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 11);

  if (!roster.length) return 50;
  return (
    roster.reduce((sum, p) => sum + p.overall + (p.morale - 60) * 0.03, 0) /
    roster.length
  );
}

export function sortStandingsRows(a, b) {
  const diffs = [
    b.points           - a.points,
    b.wins             - a.wins,
    b.gd               - a.gd,
    b.gf               - a.gf,
    a.disciplinePoints - b.disciplinePoints,
    b.awayGd           - a.awayGd,
    b.awayGf           - a.awayGf,
    b.homeGd           - a.homeGd,
    b.homeGf           - a.homeGf,
    a.randomTiebreak   - b.randomTiebreak,
  ];
  return diffs.find(v => v !== 0) || 0;
}

export function standings(state, conference = null) {
  if (!conference) {
    const allRows = [
      ...state.standings.East,
      ...state.standings.West,
    ];
    return [...state.teams].sort((a, b) => {
      const ra = allRows.find(r => r.teamId === a.id);
      const rb = allRows.find(r => r.teamId === b.id);
      return sortStandingsRows(ra, rb);
    });
  }
  return state.standings[conference]
    .slice()
    .sort(sortStandingsRows)
    .map(row => ({ ...state.teams.find(t => t.id === row.teamId), row }));
}

// ─── Roster accessors ────────────────────────────────────────────────────────

export function getUserTeam(state) {
  return state.teams.find(t => t.id === state.userTeamId);
}

export function getTeamPlayers(state, teamId) {
  return state.players
    .filter(p => p.clubId === teamId)
    .sort((a, b) => b.overall - a.overall);
}

export function getTeamAcademy(state, teamId) {
  return state.academies[teamId] || [];
}

export function getCapSummary(state, teamId) {
  const players      = getTeamPlayers(state, teamId);
  const senior       = players.filter(p => p.rosterRole === "Senior");
  const supplemental = players.filter(p => p.rosterRole === "Supplemental");
  const reserve      = players.filter(p => p.rosterRole === "Reserve");
  const budgetUsed   = senior.reduce((sum, p) => sum + getBudgetCharge(p), 0);
  const intlUsed     = players.filter(p => !p.domestic && !p.hasGreenCard).length;
  const team         = state.teams.find(t => t.id === teamId);

  return {
    seniorCount:       senior.length,
    supplementalCount: supplemental.length,
    reserveCount:      reserve.length,
    budgetUsed,
    budgetRoom:  team.salaryBudget - budgetUsed,
    intlUsed,
    intlTotal:   team.internationalSlots,
    dpCount:     players.filter(p => p.designation === "DP").length,
    dpSlots:     team.dpSlots ?? 3,
    u22Count:    players.filter(p => p.designation === "U22").length,
    u22Slots:    team.u22Slots ?? 3,
    gam:         team.gam ?? 0,
    tam:         team.tam ?? 0,
  };
}

// ─── Free agents seed ────────────────────────────────────────────────────────

function seedFreeAgents(state) {
  const freeAgents = [];
  for (let i = 0; i < 110; i++) {
    const fakeClub = { id: null, marketRating: randInt(52, 73), country: "USA" };
    const p = makePlayer(fakeClub, i, pick(POSITIONS));
    p.clubId            = null;
    p.contract.status   = "Free Agent";
    p.contract.salary   = clamp(
      Math.round(p.contract.salary * randFloat(0.6, 1.15)),
      88025,
      1200000
    );
    freeAgents.push(p);
  }
  state.freeAgents = freeAgents;
}

// ─── Schedule builder (guaranteed 34 per team) ───────────────────────────────

function makeSchedule(state) {
  const teams = [...state.teams];

  function buildRoundRobinRounds(teamList) {
    const ids = teamList.map(t => t.id);
    const n = ids.length;
    let arr = [...ids];
    const rounds = [];

    for (let round = 0; round < n - 1; round++) {
      const pairings = [];
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i];
        const b = arr[n - 1 - i];
        const flip = round % 2 === 0;
        pairings.push(flip ? [a, b] : [b, a]);
      }
      rounds.push(pairings);

      arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
    }
    return rounds;
  }

  const baseRounds = buildRoundRobinRounds(teams); // 29 weeks, everyone plays once
  const extraRounds = baseRounds.slice(0, 5).map(round =>
    round.map(([home, away]) => [away, home])
  ); // 5 more weeks = 34 total

  const allRounds = [...baseRounds, ...extraRounds];
  const matches = [];

  allRounds.forEach((pairings, idx) => {
    const week = idx + 1;
    for (const [homeTeamId, awayTeamId] of pairings) {
      const homeTeam = teams.find(t => t.id === homeTeamId);
      const awayTeam = teams.find(t => t.id === awayTeamId);
      matches.push({
        id: uuid("m"),
        type: "Regular Season",
        week,
        played: false,
        homeTeamId,
        awayTeamId,
        homeConf: homeTeam.conference,
        awayConf: awayTeam.conference,
        result: null,
      });
    }
  });

  state.schedule = matches.sort((a, b) => a.week - b.week);
}

// ─── Goal scoring helpers ─────────────────────────────────────────────────────

function chooseScorer(players) {
  const weights = players.map(p => {
    const bucket = posBucket(p.position);
    let weight = 1;
    if      (bucket === "ATT") weight = 5;
    else if (bucket === "MID") weight = 3;
    else if (bucket === "DEF") weight = 1.2;
    else                       weight = 0.25;
    weight *= Math.max(0.5, p.overall / 70);
    return { value: p, weight };
  });
  return weightedRandom(weights);
}

function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function rivalryBoost(homeName, awayName) {
  return RIVALRIES.some(
    ([a, b]) => (a === homeName && b === awayName) || (a === awayName && b === homeName)
  ) ? 0.08 : 0;
}

// ─── Transaction log ─────────────────────────────────────────────────────────

function addTransaction(state, type, text) {
  state.transactions.unshift({
    id:     uuid("tx"),
    season: state.season.year,
    day:    state.calendar.absoluteDay,
    type,
    text,
  });
  if (state.transactions.length > 500) state.transactions.pop();
}

// ─── Standings update ─────────────────────────────────────────────────────────

function applyStandings(state, match) {
  const homeRow = state.standings[match.homeConf].find(r => r.teamId === match.homeTeamId);
  const awayRow = state.standings[match.awayConf].find(r => r.teamId === match.awayTeamId);
  const { homeGoals, awayGoals, homeYellows, awayYellows, homeReds, awayReds } = match.result;

  homeRow.played += 1;
  awayRow.played += 1;

  homeRow.gf += homeGoals;  homeRow.ga += awayGoals;  homeRow.gd = homeRow.gf - homeRow.ga;
  awayRow.gf += awayGoals;  awayRow.ga += homeGoals;  awayRow.gd = awayRow.gf - awayRow.ga;

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
    homeRow.points++;  awayRow.points++;
  }

  state.standings[match.homeConf].sort(sortStandingsRows);
  state.standings[match.awayConf].sort(sortStandingsRows);
}

// ─── Player match stats ───────────────────────────────────────────────────────

function giveStats(state, teamId, teamGoals, oppGoals, xg, shots, sot, yellows, reds, resultType) {
  const starters = state.players
    .filter(p =>
      p.clubId === teamId &&
      (!p.injuredUntil || p.injuredUntil < state.calendar.absoluteDay)
    )
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 11);

  starters.forEach(p => {
    p.stats.gp  += 1;
    p.stats.gs  += 1;
    p.stats.min += 90;
    p.morale = clamp(
      p.morale + (resultType === "win" ? 2 : resultType === "loss" ? -2 : 0),
      10,
      100
    );
  });

  const gk = starters.find(p => p.position === "GK");
  if (gk) {
    gk.stats.ga += oppGoals;
    if (oppGoals === 0) gk.stats.cleanSheets += 1;
  }

  for (let i = 0; i < teamGoals; i++) {
    const scorer = chooseScorer(starters);
    scorer.stats.goals         += 1;
    scorer.stats.shots         += randInt(1, 3);
    scorer.stats.shotsOnTarget += 1;
    scorer.stats.xg            += xg / Math.max(1, teamGoals);
    if (Math.random() < 0.72) {
      const pool = starters.filter(p => p.id !== scorer.id);
      if (pool.length) chooseScorer(pool).stats.assists += 1;
    }
  }

  for (let i = 0; i < yellows; i++) pick(starters).stats.yellows += 1;
  for (let i = 0; i < reds; i++) {
    const outfield = starters.filter(p => p.position !== "GK");
    if (outfield.length) pick(outfield).stats.reds += 1;
  }
}

// ─── Core match simulation ────────────────────────────────────────────────────

export function simulateMatch(state, match, opts = {}) {
  const homeTeam = state.teams.find(t => t.id === match.homeTeamId);
  const awayTeam = state.teams.find(t => t.id === match.awayTeamId);

  const homePower = teamOverall(state, homeTeam.id);
  const awayPower = teamOverall(state, awayTeam.id);
  const rivalry   = rivalryBoost(homeTeam.name, awayTeam.name);

  let homeXg = clamp(1.2 + (homePower - awayPower) * 0.018 + 0.28 + rivalry * 0.5 + randFloat(-0.18, 0.35), 0.2, 3.8);
  let awayXg = clamp(1.02 + (awayPower - homePower) * 0.016 + rivalry * 0.25 + randFloat(-0.18, 0.30), 0.1, 3.4);

  let homeGoals = poisson(homeXg);
  let awayGoals = poisson(awayXg);
  let penalties  = null;
  let extraTime  = false;

  if (opts.singleElimination && homeGoals === awayGoals) {
    extraTime  = true;
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
  const homeSot   = clamp(homeGoals + randInt(1, 5), homeGoals, homeShots);
  const awaySot   = clamp(awayGoals + randInt(1, 5), awayGoals, awayShots);
  const homePoss  = clamp(Math.round(50 + (homePower - awayPower) * 0.42 + randInt(-6, 6)), 35, 65);
  const awayPoss  = 100 - homePoss;
  const homeYellows = randInt(0, 4);
  const awayYellows = randInt(0, 4);
  const homeReds    = Math.random() < 0.05 ? 1 : 0;
  const awayReds    = Math.random() < 0.05 ? 1 : 0;

  const homePlayers = state.players.filter(p => p.clubId === homeTeam.id).sort((a,b)=>b.overall-a.overall).slice(0,11);
  const awayPlayers = state.players.filter(p => p.clubId === awayTeam.id).sort((a,b)=>b.overall-a.overall).slice(0,11);

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
    homeGoals,  awayGoals,
    homeXg: Number(homeXg.toFixed(2)),
    awayXg: Number(awayXg.toFixed(2)),
    homeShots, awayShots, homeSot, awaySot,
    homePoss,  awayPoss,
    homeYellows, awayYellows,
    homeReds,  awayReds,
    events,    penalties,  extraTime,
  };

  const homeResult = penalties
    ? (penalties.home > penalties.away ? "win" : "loss")
    : homeGoals > awayGoals ? "win" : homeGoals < awayGoals ? "loss" : "draw";
  const awayResult = penalties
    ? (penalties.away > penalties.home ? "win" : "loss")
    : awayGoals > homeGoals ? "win" : awayGoals < homeGoals ? "loss" : "draw";

  giveStats(state, homeTeam.id, homeGoals, awayGoals, homeXg, homeShots, homeSot, homeYellows, homeReds, homeResult);
  giveStats(state, awayTeam.id, awayGoals, homeGoals, awayXg, awayShots, awaySot, awayYellows, awayReds, awayResult);

  if (match.type === "Regular Season") applyStandings(state, match);

  return match.result;
}

// ─── Injury / offer events ────────────────────────────────────────────────────

function maybeInjurePlayers(state) {
  const active = state.players.filter(
    p => p.clubId && (!p.injuredUntil || p.injuredUntil < state.calendar.absoluteDay)
  );
  for (const player of active) {
    const risk = player.injuryProne ? 0.018 : 0.008;
    if (Math.random() < risk) {
      const injury = rollInjury(player.injuryProne);
      player.injuredUntil = state.calendar.absoluteDay + injury.days;
      player.injuryMeta   = injury;
      addTransaction(
        state,
        "Injury",
        `${player.name} suffered ${injury.type} (${injury.severity}, ${injury.days} days).`
      );
    }
  }
}

function maybeExternalOffer(state) {
  const userTeam = getUserTeam(state);
  const players  = getTeamPlayers(state, userTeam.id).filter(p => p.age >= 20);
  if (!players.length || Math.random() > 0.16) return;

  const target = pick(players.slice(0, 12));
  const offer  = Math.round(target.contract.salary * randFloat(1.3, 3.2) + target.overall * 55000);
  state.pendingOffer = {
    id:       uuid("offer"),
    playerId: target.id,
    bidClub:  pick(state.teams.filter(t => t.id !== userTeam.id)).name,
    amount:   offer,
  };
  addTransaction(
    state,
    "Offer",
    `${state.pendingOffer.bidClub} offered ${offer.toLocaleString()} for ${target.name}.`
  );
}

// ─── Playoffs ─────────────────────────────────────────────────────────────────

function buildPlayoffs(state) {
  const east = state.standings.East.slice().sort(sortStandingsRows).map((row, idx) => ({ ...row, seed: idx + 1 }));
  const west = state.standings.West.slice().sort(sortStandingsRows).map((row, idx) => ({ ...row, seed: idx + 1 }));
  return {
    conferenceSeeds: { East: east, West: west },
    currentRound: "Wild Card",
    rounds: {
      wildCard:         [],
      roundOne:         [],
      semifinals:       [],
      conferenceFinals: [],
      cup:              [],
    },
    championTeamId: null,
  };
}

function winnerOf(match) {
  if (!match.result) return null;
  if (match.result.penalties)
    return match.result.penalties.home > match.result.penalties.away
      ? match.homeTeamId
      : match.awayTeamId;
  return match.result.homeGoals > match.result.awayGoals
    ? match.homeTeamId
    : match.awayTeamId;
}

function createRoundOneSeries(playoffs, conf) {
  const seeds = playoffs.conferenceSeeds[conf];
  const wild  = seeds.find(s => s.seed === 8)._wildCardWinner;
  return [
    { higher: seeds.find(s => s.seed === 1).teamId, lower: wild,                                    conference: conf },
    { higher: seeds.find(s => s.seed === 2).teamId, lower: seeds.find(s => s.seed === 7).teamId,   conference: conf },
    { higher: seeds.find(s => s.seed === 3).teamId, lower: seeds.find(s => s.seed === 6).teamId,   conference: conf },
    { higher: seeds.find(s => s.seed === 4).teamId, lower: seeds.find(s => s.seed === 5).teamId,   conference: conf },
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
        id: uuid("wc"), type: "Wild Card", played: false,
        homeTeamId: seed8.teamId, awayTeamId: seed9.teamId,
        homeConf: conf, awayConf: conf, result: null,
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
        [series.lower,  series.higher],
        [series.higher, series.lower],
      ];
      for (const [home, away] of games) {
        if (wins[series.higher] === 2 || wins[series.lower] === 2) break;
        const match = {
          id: uuid("r1"), type: "Round One", played: false,
          homeTeamId: home, awayTeamId: away,
          homeConf: series.conference, awayConf: series.conference, result: null,
        };
        simulateMatch(state, match, { penaltyOnDraw: true });
        wins[winnerOf(match)] += 1;
        p.rounds.roundOne.push(match);
      }
      p.rounds.roundOne.push({
        seriesSummary: true,
        conference:    series.conference,
        higher:        series.higher,
        lower:         series.lower,
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
      winners.sort((a, b) =>
        seeds.find(s => s.teamId === a).seed - seeds.find(s => s.teamId === b).seed
      );
      const pairs = [[winners[0], winners[3]], [winners[1], winners[2]]];
      for (const [a, b] of pairs) {
        const seedA = seeds.find(s => s.teamId === a).seed;
        const seedB = seeds.find(s => s.teamId === b).seed;
        const home  = seedA < seedB ? a : b;
        const away  = home === a ? b : a;
        const match = {
          id: uuid("sf"), type: "Conference Semifinal", played: false,
          homeTeamId: home, awayTeamId: away,
          homeConf: conf, awayConf: conf, result: null,
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
      const seeds   = p.conferenceSeeds[conf];
      winners.sort((a, b) =>
        seeds.find(s => s.teamId === a).seed - seeds.find(s => s.teamId === b).seed
      );
      const match = {
        id: uuid("cf"), type: "Conference Final", played: false,
        homeTeamId: winners[0], awayTeamId: winners[1],
        homeConf: conf, awayConf: conf, result: null,
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
    const eastSeed   = p.conferenceSeeds.East.find(r => r.teamId === eastWinner).seed;
    const westSeed   = p.conferenceSeeds.West.find(r => r.teamId === westWinner).seed;
    const home       = eastSeed < westSeed ? eastWinner : westWinner;
    const away       = home === eastWinner ? westWinner : eastWinner;
    const cup = {
      id: uuid("cup"), type: "MLS Cup", played: false,
      homeTeamId: home, awayTeamId: away,
      homeConf: state.teams.find(t => t.id === home).conference,
      awayConf: state.teams.find(t => t.id === away).conference,
      result: null,
    };
    simulateMatch(state, cup, { singleElimination: true });
    p.rounds.cup.push(cup);
    p.championTeamId = winnerOf(cup);
    awardSeason(state);
    state.season.phase = "Draft";
    initializeDraft(state);
    addTransaction(
      state,
      "Champion",
      `${state.teams.find(t => t.id === p.championTeamId).name} won MLS Cup ${state.season.year}.`
    );
    addTransaction(
      state,
      "Draft",
      `The ${state.season.year + 1} MLS SuperDraft order is set.`
    );
  }
}

// ─── Season awards ─────────────────────────────────────────────────────────────

function awardSeason(state) {
  const active = state.players.filter(p => p.clubId);
  const mvp = [...active].sort((a, b) =>
    (b.stats.goals + b.stats.assists * 0.8 + b.stats.motm * 2 + b.overall * 0.1) -
    (a.stats.goals + a.stats.assists * 0.8 + a.stats.motm * 2 + a.overall * 0.1)
  )[0];
  const goldenBoot = [...active].sort((a, b) => b.stats.goals - a.stats.goals)[0];
  const gk = [...active]
    .filter(p => p.position === "GK")
    .sort((a, b) =>
      (b.stats.cleanSheets * 3 - b.stats.ga * 0.12) -
      (a.stats.cleanSheets * 3 - a.stats.ga * 0.12)
    )[0];

  state.awardsHistory.push({
    year:       state.season.year,
    mvp:        mvp?.name        || "—",
    goldenBoot: goldenBoot?.name || "—",
    goalkeeper: gk?.name         || "—",
  });
}

// ─── Draft ───────────────────────────────────────────────────────────────────

function generateDraftPool(state) {
  const pool = [];
  for (let i = 0; i < 260; i++) {
    const fakeClub = { id: null, marketRating: randInt(42, 59), country: "USA" };
    const pos = pick(POSITIONS);
    const p   = makePlayer(fakeClub, i + 20, pos);
    p.age             = randInt(18, 23);
    p.name            = generateNameForCountry("USA");
    p.college         = pick(COLLEGES);
    p.homegrown       = false;
    p.clubId          = null;
    p.designation     = null;
    p.rosterRole      = "Supplemental";
    p.contract.status = "Draft Eligible";
    // Bring SuperDraft talent closer to real MLS depth: mostly low 40s to upper 50s, with only a few 60 OVR types.
    const targetOverall = clamp(randInt(39, 55) + (i < 14 ? randInt(0, 4) : 0), 38, 60);
    for (const key of Object.keys(p.attributes)) {
      p.attributes[key] = clamp(Math.round(p.attributes[key] + (targetOverall - p.overall) * 0.75 + randInt(-3, 3)), 22, 82);
    }
    p.overall         = overall(p);
    p.potential       = clamp(p.overall + randInt(2, 9), p.overall + 1, 72);
    p.contract.salary = 88025;
    p.detailed        = makeDetailedRatings(p.position, p.attributes);
    p.traits          = deriveTraits(p);
    pool.push(p);
  }
  state.draft.pool = pool.sort(
    (a, b) => (b.potential + b.overall * 0.55) - (a.potential + a.overall * 0.55)
  );
}

function draftOrder(state) {
  return [...state.standings.East, ...state.standings.West]
    .sort((a, b) => {
      if (a.points !== b.points) return a.points - b.points;
      if (a.wins   !== b.wins)   return a.wins   - b.wins;
      if (a.gd     !== b.gd)     return a.gd     - b.gd;
      return a.gf - b.gf;
    })
    .map(r => r.teamId);
}

function runDraft(state) {
  generateDraftPool(state);
  const order = draftOrder(state);

  for (let round = 1; round <= 3; round++) {
    for (const teamId of order) {
      const choiceIndex = Math.min(randInt(0, 7), state.draft.pool.length - 1);
      const player = state.draft.pool.splice(choiceIndex, 1)[0];
      if (!player) continue;
      player.clubId           = teamId;
      player.contract.status  = "Active";
      player.contract.yearsLeft = randInt(2, 4);
      player.contract.salary  = round === 1 ? 113400 : 88025;
      player.rosterRole       = round === 1 ? "Supplemental" : "Reserve";
      player.designation      = round === 1 && Math.random() < 0.35 ? "U22" : null;
      player.domestic         = true;
      state.players.push(player);
      autoAssignTeamDesignations(state, teamId);
      addTransaction(
        state,
        "Draft",
        `${state.teams.find(t => t.id === teamId).name} selected ${player.name} in Round ${round}.`
      );
    }
  }
}


function ensureDraftPickLedger(state, startYear = (state.season?.year || MLS_RULES.seasonStartYear) + 1, yearsAhead = 2) {
  if (!state.draft) state.draft = {};
  if (!Array.isArray(state.draft.picks)) state.draft.picks = [];
  for (let year = startYear; year < startYear + yearsAhead; year++) {
    for (const team of state.teams) {
      for (let round = 1; round <= 3; round++) {
        const exists = state.draft.picks.find(
          p => p.year === year && p.round === round && p.originalTeamId === team.id
        );
        if (!exists) {
          state.draft.picks.push({
            id: uuid("pick"),
            year,
            round,
            originalTeamId: team.id,
            ownerTeamId: team.id,
          });
        }
      }
    }
  }
}

function draftPickValue(pickObj, currentSeasonYear) {
  const base = { 1: 850000, 2: 420000, 3: 210000 }[pickObj.round] || 150000;
  const yearsOut = Math.max(0, pickObj.year - (currentSeasonYear + 1));
  return Math.round(base * Math.max(0.55, 1 - yearsOut * 0.18));
}

function playerTradeValue(player) {
  return Math.round(
    player.overall * 18000 +
    player.potential * 9000 +
    Math.max(0, 24 - player.age) * 12000 -
    Math.min(player.contract?.salary || 0, 4000000) * 0.18 +
    (player.designation === "DP" ? 280000 : 0) +
    (player.designation === "U22" ? 220000 : 0) +
    (player.homegrown ? 90000 : 0)
  );
}

function describeDraftPick(state, pickObj) {
  const owner = state.teams.find(t => t.id === pickObj.ownerTeamId);
  return `${pickObj.year} Round ${pickObj.round} (${owner?.shortName || owner?.name || "Unknown"})`;
}

function createDraftSelectionRecord(state, pickObj, player, teamId) {
  const team = state.teams.find(t => t.id === teamId);
  player.clubId             = teamId;
  player.contract.status    = "Active";
  player.contract.yearsLeft = randInt(2, 4);
  player.contract.salary    = pickObj.round === 1 ? 113400 : 88025;
  player.contract.expiresYear = state.season.year + player.contract.yearsLeft;
  player.rosterRole         = pickObj.round === 1 ? "Supplemental" : "Reserve";
  player.designation        = pickObj.round === 1 && player.age <= 22 && Math.random() < 0.35 ? "U22" : null;
  player.domestic           = true;
  state.players.push(player);
  autoAssignTeamDesignations(state, teamId);
  state.draft.pool = state.draft.pool.filter(p => p.id !== player.id);
  const historyItem = {
    id: uuid("draftsel"),
    kind: "pick",
    year: pickObj.year,
    round: pickObj.round,
    teamId,
    pickId: pickObj.id,
    playerId: player.id,
    playerName: player.name,
    teamName: team.name,
    overall: player.overall,
    potential: player.potential,
    text: `${team.name} selected ${player.name} in Round ${pickObj.round}.`,
  };
  state.draft.history.unshift(historyItem);
  addTransaction(state, "Draft", historyItem.text);
  state.draft.currentPickIndex += 1;
  state.draft.currentRound = state.draft.order[state.draft.currentPickIndex]
    ? state.draft.picks.find(p => p.id === state.draft.order[state.draft.currentPickIndex])?.round || pickObj.round
    : pickObj.round;
  if (state.draft.currentPickIndex >= state.draft.order.length || !state.draft.pool.length) {
    state.draft.completed = true;
    state.draft.started = false;
    state.season.phase = "Contract Extensions";
    addTransaction(state, "Draft", `${state.draft.year} MLS SuperDraft completed.`);
    ensureDraftPickLedger(state, state.season.year + 2, 3);
  }
  return historyItem;
}

export function initializeDraft(state) {
  ensureDraftPickLedger(state, state.season.year + 1, 3);
  if (!state.draft) state.draft = {};
  const draftYear = state.season.year + 1;

  if (
    state.draft.year === draftYear &&
    Array.isArray(state.draft.order) &&
    state.draft.order.length &&
    !state.draft.completed &&
    Array.isArray(state.draft.pool) &&
    state.draft.pool.length
  ) {
    return state.draft;
  }

  generateDraftPool(state);
  const orderTeams = draftOrder(state);
  const order = [];

  for (let round = 1; round <= 3; round++) {
    for (const originalTeamId of orderTeams) {
      let pickObj = state.draft.picks.find(
        p => p.year === draftYear && p.round === round && p.originalTeamId === originalTeamId
      );
      if (!pickObj) {
        pickObj = {
          id: uuid("pick"),
          year: draftYear,
          round,
          originalTeamId,
          ownerTeamId: originalTeamId,
        };
        state.draft.picks.push(pickObj);
      }
      order.push(pickObj.id);
    }
  }

  state.draft.year = draftYear;
  state.draft.order = order;
  state.draft.history = [];
  state.draft.started = false;
  state.draft.completed = false;
  state.draft.currentPickIndex = 0;
  state.draft.currentRound = 1;
  return state.draft;
}

export function startDraft(state) {
  initializeDraft(state);
  state.draft.started = true;
  state.season.phase = "Draft";
  return { ok: true };
}

export function getCurrentDraftPick(state) {
  if (!state.draft?.order?.length) return null;
  const pickId = state.draft.order[state.draft.currentPickIndex];
  if (!pickId) return null;
  return state.draft.picks.find(p => p.id === pickId) || null;
}

function maybeRunDraftTrade(state) {
  if (!state.draft?.started || state.draft.completed) return false;
  if (Math.random() > 0.11) return false;
  const currentIndex = state.draft.currentPickIndex;
  if (currentIndex >= state.draft.order.length - 2) return false;

  const currentPick = getCurrentDraftPick(state);
  if (!currentPick) return false;

  const maxIndex = Math.min(state.draft.order.length - 1, currentIndex + 10);
  const laterCandidates = [];
  for (let i = currentIndex + 1; i <= maxIndex; i++) {
    const p = state.draft.picks.find(x => x.id === state.draft.order[i]);
    if (p && p.ownerTeamId !== currentPick.ownerTeamId) laterCandidates.push(p);
  }
  if (!laterCandidates.length) return false;

  const laterPick = pick(laterCandidates);
  const teamUp = state.teams.find(t => t.id === laterPick.ownerTeamId);
  const teamDown = state.teams.find(t => t.id === currentPick.ownerTeamId);
  const gamBonus = randInt(0, 1) ? randInt(50000, 180000) : 0;

  if (gamBonus > 0 && teamUp.gam >= gamBonus) {
    teamUp.gam -= gamBonus;
    teamDown.gam += gamBonus;
  }

  const oldCurrentOwner = currentPick.ownerTeamId;
  currentPick.ownerTeamId = laterPick.ownerTeamId;
  laterPick.ownerTeamId = oldCurrentOwner;

  const text = `${teamUp.name} traded up for ${describeDraftPick(state, currentPick)} with ${teamDown.name} for ${describeDraftPick(state, laterPick)}${gamBonus ? ` and ${gamBonus.toLocaleString()} GAM` : ""}.`;
  state.draft.history.unshift({ id: uuid("drafttrade"), kind: "trade", text });
  addTransaction(state, "Draft Trade", text);
  return true;
}

export function simulateNextDraftPick(state, forceUserAuto = false) {
  initializeDraft(state);
  state.draft.started = true;
  state.season.phase = "Draft";

  if (state.draft.completed) return { ok: true, completed: true };

  maybeRunDraftTrade(state);

  const pickObj = getCurrentDraftPick(state);
  if (!pickObj) {
    state.draft.completed = true;
    state.season.phase = "Contract Extensions";
    return { ok: true, completed: true };
  }

  if (pickObj.ownerTeamId === state.userTeamId && !forceUserAuto) {
    return { ok: false, waitingOnUser: true, pick: pickObj };
  }

  const board = state.draft.pool
    .slice()
    .sort((a, b) => (b.potential + b.overall * 0.55) - (a.potential + a.overall * 0.55));
  const player = board[Math.min(randInt(0, 4), Math.max(0, board.length - 1))];
  if (!player) {
    state.draft.completed = true;
    state.season.phase = "Contract Extensions";
    return { ok: true, completed: true };
  }

  const historyItem = createDraftSelectionRecord(state, pickObj, player, pickObj.ownerTeamId);
  return { ok: true, completed: !!state.draft.completed, waitingOnUser: false, pick: pickObj, player, historyItem };
}

export function advanceDraftUntilUserOrEnd(state, forceUserAuto = false) {
  initializeDraft(state);
  state.draft.started = true;
  state.season.phase = "Draft";

  while (!state.draft.completed) {
    const result = simulateNextDraftPick(state, forceUserAuto);
    if (result.waitingOnUser || result.completed) return result;
  }
  return { ok: true, completed: true };
}

export function makeUserDraftPick(state, playerId) {
  initializeDraft(state);
  state.draft.started = true;
  state.season.phase = "Draft";

  const pickObj = getCurrentDraftPick(state);
  if (!pickObj) return { ok: false, reason: "No active pick." };
  if (pickObj.ownerTeamId !== state.userTeamId) return { ok: false, reason: "Your club is not on the clock." };
  const player = state.draft.pool.find(p => p.id === playerId);
  if (!player) return { ok: false, reason: "Prospect not found." };

  const historyItem = createDraftSelectionRecord(state, pickObj, player, state.userTeamId);
  return { ok: true, completed: !!state.draft.completed, historyItem };
}

export function getContractDemand(state, player) {
  if (player.contract?.demandYear === state.season.year && player.contract?.demandCache) {
    return player.contract.demandCache;
  }
  const leverage = player.potential > player.overall ? (player.potential - player.overall) * 0.025 : 0;
  const ageFactor = player.age <= 23 ? 1.12 : player.age <= 28 ? 1 : player.age <= 31 ? 0.94 : 0.82;
  const statusFactor = player.designation === "DP" ? 1.24 : player.designation === "U22" ? 1.12 : player.designation === "TAM" ? 1.08 : 1;
  const askSalary = Math.max(88025, Math.round(player.contract.salary * (0.92 + leverage + randFloat(0.06, 0.22)) * ageFactor * statusFactor));
  const askYears = player.age <= 22 ? randInt(3, 5) : player.age <= 28 ? randInt(2, 4) : randInt(1, 3);
  const demand = {
    askSalary,
    askYears,
    minSalary: Math.round(askSalary * 0.9),
    maxSalary: Math.round(askSalary * 1.18),
  };
  player.contract.demandYear = state.season.year;
  player.contract.demandCache = demand;
  return demand;
}

export function getExpiringPlayers(state, teamId) {
  return getTeamPlayers(state, teamId)
    .filter(p => p.contract?.yearsLeft <= 1)
    .sort((a, b) => b.overall - a.overall || a.age - b.age);
}

export function renegotiateContract(state, playerId, years, salary) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { ok: false, reason: "Player not found." };
  if (player.clubId !== state.userTeamId) return { ok: false, reason: "You can only negotiate with your own players." };
  const team = getUserTeam(state);
  const offerYears = Math.max(1, Math.min(5, Number(years) || 0));
  const offerSalary = Math.max(88025, Number(salary) || 0);
  const demand = getContractDemand(state, player);

  if (offerYears < Math.max(1, demand.askYears - 1)) return { ok: false, reason: `${player.name} wants a longer deal.` };
  if (offerSalary < demand.minSalary) return { ok: false, reason: `${player.name} rejected the salary offer.` };
  if (player.designation !== "DP" && team.salaryBudget < offerSalary * 0.55 && player.rosterRole === "Senior") {
    return { ok: false, reason: "Budget structure makes that extension unrealistic." };
  }

  player.contract.salary = Math.round(offerSalary);
  player.contract.yearsLeft = offerYears;
  player.contract.expiresYear = state.season.year + offerYears;
  player.contract.status = "Active";
  delete player.contract.demandYear;
  delete player.contract.demandCache;
  addTransaction(state, "Extension", `${team.name} extended ${player.name} for ${offerYears} year${offerYears === 1 ? "" : "s"} at ${offerSalary.toLocaleString()}.`);
  return { ok: true };
}

function resolveAiContractExtensions(state) {
  for (const team of state.teams) {
    const expiring = getTeamPlayers(state, team.id).filter(p => p.contract?.yearsLeft <= 1).sort((a, b) => b.overall - a.overall);
    for (const player of expiring) {
      const demand = getContractDemand(state, player);
      const keepChance = player.overall >= 73 ? 0.86 : player.overall >= 67 ? 0.63 : 0.28;
      if (Math.random() < keepChance) {
        player.contract.salary = demand.askSalary;
        player.contract.yearsLeft = demand.askYears;
        player.contract.expiresYear = state.season.year + demand.askYears;
        addTransaction(state, "Extension", `${team.name} extended ${player.name}.`);
      }
    }
  }
}

function expireRemainingContracts(state) {
  for (const p of [...state.players]) {
    if (p.clubId && p.contract.yearsLeft <= 0) {
      p.clubId = null;
      p.contract.status = "Free Agent";
      p.contract.yearsLeft = randInt(1, 3);
      p.contract.expiresYear = state.season.year + p.contract.yearsLeft;
      p.designation = null;
      state.freeAgents.push(p);
      addTransaction(state, "Free Agency", `${p.name} entered free agency.`);
    }
  }
  state.players = state.players.filter(p => p.clubId || p.contract.status !== "Free Agent");
}

function runFreeAgencyWindow(state) {
  expireRemainingContracts(state);
  aiFillRosters(state);
  addTransaction(state, "Free Agency", `Free agency activity processed for ${state.season.year}.`);
}

function finalizeOffseason(state) {
  ageAndDevelop(state);
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
  autoAssignAllDesignations(state);
  ensureOpenCupState(state);

  ensureDraftPickLedger(state, state.season.year + 1, 3);
  state.draft = {
    pool: [],
    picks: state.draft?.picks || [],
    order: [],
    history: [],
    started: false,
    completed: false,
    year: state.season.year + 1,
    currentPickIndex: 0,
    currentRound: 1,
  };

  addTransaction(state, "Season", `Opened ${state.season.year} season.`);
}

export function updateTeamBudget(state, teamId, updates = {}) {
  const team = state.teams.find(t => t.id === teamId);
  if (!team) return { ok: false, reason: "Team not found." };
  const asNum = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  team.salaryBudget = Math.max(0, asNum(updates.salaryBudget, team.salaryBudget));
  team.gam = Math.max(0, asNum(updates.gam, team.gam));
  team.tam = Math.max(0, asNum(updates.tam, team.tam));
  team.internationalSlots = Math.max(0, asNum(updates.internationalSlots, team.internationalSlots));
  team.dpSlots = Math.max(0, asNum(updates.dpSlots, team.dpSlots ?? 3));
  team.u22Slots = Math.max(0, asNum(updates.u22Slots, team.u22Slots ?? 3));
  return { ok: true };
}

export function setPlayerDesignation(state, playerId, designation) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { ok: false, reason: "Player not found." };
  const team = state.teams.find(t => t.id === player.clubId);
  if (!team) return { ok: false, reason: "Team not found." };
  const nextValue = designation === "None" || designation === "" ? null : designation;
  if (nextValue === "U22" && player.age > 23) return { ok: false, reason: "U22 Initiative players must be 23 or younger." };
  const teamPlayers = getTeamPlayers(state, team.id);
  const otherDp = teamPlayers.filter(p => p.id !== player.id && p.designationMode === "manual" && p.designation === "DP").length;
  const otherU22 = teamPlayers.filter(p => p.id !== player.id && p.designationMode === "manual" && p.designation === "U22").length;
  if (nextValue === "DP" && otherDp >= (team.dpSlots ?? 3)) return { ok: false, reason: "No DP slots available." };
  if (nextValue === "U22" && otherU22 >= (team.u22Slots ?? 3)) return { ok: false, reason: "No U22 slots available." };
  if (designation === "Auto") {
    player.designationMode = "auto";
    player.designation = null;
    autoAssignTeamDesignations(state, team.id);
    return { ok: true };
  }
  player.designationMode = "manual";
  player.designation = nextValue;
  autoAssignTeamDesignations(state, team.id);
  return { ok: true };
}

export function proposeTrade(state, proposal) {
  const userTeam = state.teams.find(t => t.id === state.userTeamId);
  const partner = state.teams.find(t => t.id === proposal.partnerTeamId);
  if (!userTeam || !partner) return { ok: false, reason: "Trade partner not found." };

  const outgoingPlayers = (proposal.outgoingPlayerIds || []).map(id => state.players.find(p => p.id === id)).filter(Boolean);
  const incomingPlayers = (proposal.incomingPlayerIds || []).map(id => state.players.find(p => p.id === id)).filter(Boolean);
  const outgoingPicks = (proposal.outgoingPickIds || []).map(id => state.draft?.picks?.find(p => p.id === id)).filter(Boolean);
  const incomingPicks = (proposal.incomingPickIds || []).map(id => state.draft?.picks?.find(p => p.id === id)).filter(Boolean);

  if (!outgoingPlayers.length && !incomingPlayers.length && !outgoingPicks.length && !incomingPicks.length && !proposal.outgoingGAM && !proposal.incomingGAM && !proposal.outgoingTAM && !proposal.incomingTAM && !proposal.outgoingIntlSlots && !proposal.incomingIntlSlots) {
    return { ok: false, reason: "Build a real offer first." };
  }
  if (outgoingPlayers.some(p => p.clubId !== userTeam.id)) return { ok: false, reason: "One of your outgoing players is no longer on your roster." };
  if (incomingPlayers.some(p => p.clubId !== partner.id)) return { ok: false, reason: "One of the requested players is no longer on that roster." };
  if (outgoingPicks.some(p => p.ownerTeamId !== userTeam.id)) return { ok: false, reason: "One of your draft picks is not available." };
  if (incomingPicks.some(p => p.ownerTeamId !== partner.id)) return { ok: false, reason: "One requested draft pick is not available." };

  const outgoingGAM = Math.max(0, Number(proposal.outgoingGAM) || 0);
  const incomingGAM = Math.max(0, Number(proposal.incomingGAM) || 0);
  const outgoingTAM = Math.max(0, Number(proposal.outgoingTAM) || 0);
  const incomingTAM = Math.max(0, Number(proposal.incomingTAM) || 0);
  const outgoingIntlSlots = Math.max(0, Number(proposal.outgoingIntlSlots) || 0);
  const incomingIntlSlots = Math.max(0, Number(proposal.incomingIntlSlots) || 0);

  if (userTeam.gam < outgoingGAM) return { ok: false, reason: "Not enough GAM available." };
  if (userTeam.tam < outgoingTAM) return { ok: false, reason: "Not enough TAM available." };
  if (partner.gam < incomingGAM) return { ok: false, reason: `${partner.name} does not have that much GAM.` };
  if (partner.tam < incomingTAM) return { ok: false, reason: `${partner.name} does not have that much TAM.` };
  if (userTeam.internationalSlots < outgoingIntlSlots) return { ok: false, reason: "Not enough international slots to send." };
  if (partner.internationalSlots < incomingIntlSlots) return { ok: false, reason: `${partner.name} does not have that many international slots.` };

  const userRosterCount = getTeamPlayers(state, userTeam.id).length;
  const partnerRosterCount = getTeamPlayers(state, partner.id).length;
  if (userRosterCount - outgoingPlayers.length + incomingPlayers.length > 30) return { ok: false, reason: "Your roster would exceed 30 players." };
  if (partnerRosterCount - incomingPlayers.length + outgoingPlayers.length > 30) return { ok: false, reason: `${partner.name}'s roster would exceed 30 players.` };

  const valueOfPlayers = players => players.reduce((sum, p) => {
    const contractBonus = Math.max(-220000, ((p.contract?.yearsLeft || 1) - 1) * 75000);
    const ageCurve = p.age <= 23 ? 160000 : p.age <= 28 ? 90000 : p.age <= 31 ? 0 : -150000;
    return sum + playerTradeValue(p) + contractBonus + ageCurve;
  }, 0);

  const userOutgoingValue = valueOfPlayers(outgoingPlayers) + outgoingPicks.reduce((sum, p) => sum + draftPickValue(p, state.season.year), 0) + outgoingGAM + outgoingTAM * 0.92 + outgoingIntlSlots * 260000;
  const userIncomingValue = valueOfPlayers(incomingPlayers) + incomingPicks.reduce((sum, p) => sum + draftPickValue(p, state.season.year), 0) + incomingGAM + incomingTAM * 0.92 + incomingIntlSlots * 260000;

  const partnerPlayers = getTeamPlayers(state, partner.id);
  const posCount = pos => partnerPlayers.filter(p => p.position === pos).length;
  const partnerStandings = state.standings[partner.conference]?.find(r => r.teamId === partner.id);
  const contending = partnerStandings ? partnerStandings.points / Math.max(1, partnerStandings.played) > 1.55 : false;

  let fitBonus = 0;
  for (const p of incomingPlayers) {
    if (p.position === "GK" && posCount("GK") < 2) fitBonus += 260000;
    if (["CB"].includes(p.position) && posCount("CB") < 3) fitBonus += 220000;
    if (["LB","RB"].includes(p.position) && posCount(p.position) < 2) fitBonus += 180000;
    if (["CDM","CM","CAM"].includes(p.position) && posCount(p.position) < 2) fitBonus += 130000;
    if (["LW","RW","ST"].includes(p.position) && posCount(p.position) < 2) fitBonus += 175000;
    if (contending && p.overall >= 72) fitBonus += 120000;
    if (!contending && p.age <= 23 && p.potential >= p.overall + 6) fitBonus += 90000;
  }

  let outgoingPenalty = 0;
  for (const p of outgoingPlayers) {
    if (contending && p.overall >= 71) outgoingPenalty += 180000;
    if (!contending && p.age <= 24 && p.potential >= p.overall + 7) outgoingPenalty += 160000;
    if (p.position === "GK" && posCount("GK") <= 2) outgoingPenalty += 240000;
    if (["CB"].includes(p.position) && posCount("CB") <= 3) outgoingPenalty += 200000;
  }

  const salarySwing = incomingPlayers.reduce((sum, p) => sum + (p.contract?.salary || 0), 0) - outgoingPlayers.reduce((sum, p) => sum + (p.contract?.salary || 0), 0);
  const salaryPenalty = contending && salarySwing > 650000 ? salarySwing * 0.28 : salarySwing > 1100000 ? salarySwing * 0.2 : 0;

  const demandedReturn = userOutgoingValue + outgoingPenalty + salaryPenalty;
  const offeredReturn = userIncomingValue + fitBonus;
  const strictness = contending ? randFloat(1.04, 1.16) : randFloat(0.98, 1.10);

  if (offeredReturn < demandedReturn * strictness) {
    return {
      ok: false,
      reason: `${partner.name} rejected the offer.`,
      evaluation: {
        demandedReturn: Math.round(demandedReturn * strictness),
        offeredReturn: Math.round(offeredReturn),
        fitBonus,
        outgoingPenalty: Math.round(outgoingPenalty),
        salaryPenalty: Math.round(salaryPenalty),
      },
    };
  }

  outgoingPlayers.forEach(p => { p.clubId = partner.id; });
  incomingPlayers.forEach(p => { p.clubId = userTeam.id; });
  userTeam.gam += incomingGAM - outgoingGAM;
  partner.gam += outgoingGAM - incomingGAM;
  userTeam.tam += incomingTAM - outgoingTAM;
  partner.tam += outgoingTAM - incomingTAM;
  userTeam.internationalSlots += incomingIntlSlots - outgoingIntlSlots;
  partner.internationalSlots += outgoingIntlSlots - incomingIntlSlots;
  autoAssignTeamDesignations(state, userTeam.id);
  autoAssignTeamDesignations(state, partner.id);
  outgoingPicks.forEach(p => { p.ownerTeamId = partner.id; });
  incomingPicks.forEach(p => { p.ownerTeamId = userTeam.id; });

  const sentBits = [];
  const recvBits = [];
  if (outgoingPlayers.length) sentBits.push(outgoingPlayers.map(p => p.name).join(", "));
  if (outgoingPicks.length) sentBits.push(outgoingPicks.map(p => describeDraftPick(state, p)).join(", "));
  if (outgoingGAM) sentBits.push(`${outgoingGAM.toLocaleString()} GAM`);
  if (outgoingTAM) sentBits.push(`${outgoingTAM.toLocaleString()} TAM`);
  if (outgoingIntlSlots) sentBits.push(`${outgoingIntlSlots} INTL slot${outgoingIntlSlots === 1 ? "" : "s"}`);
  if (incomingPlayers.length) recvBits.push(incomingPlayers.map(p => p.name).join(", "));
  if (incomingPicks.length) recvBits.push(incomingPicks.map(p => describeDraftPick(state, p)).join(", "));
  if (incomingGAM) recvBits.push(`${incomingGAM.toLocaleString()} GAM`);
  if (incomingTAM) recvBits.push(`${incomingTAM.toLocaleString()} TAM`);
  if (incomingIntlSlots) recvBits.push(`${incomingIntlSlots} INTL slot${incomingIntlSlots === 1 ? "" : "s"}`);
  const text = `${userTeam.name} traded ${sentBits.join(" + ") || "nothing"} to ${partner.name} for ${recvBits.join(" + ") || "nothing"}.`;
  addTransaction(state, "Trade", text);
  return { ok: true, text, evaluation: { demandedReturn: Math.round(demandedReturn * strictness), offeredReturn: Math.round(offeredReturn), fitBonus } };
}

// ─── Offseason ────────────────────────────────────────────────────────────────

function ageAndDevelop(state) {
  for (const p of state.players) {
    p.age += 1;
    const delta =
      p.age <= 21 ? randInt(1, 5) :
      p.age <= 25 ? randInt(0, 3) :
      p.age <= 29 ? randInt(-1, 2) :
      randInt(-4, 1);

    for (const key of Object.keys(p.attributes)) {
      p.attributes[key] = clamp(
        p.attributes[key] + Math.sign(delta) * randInt(0, Math.abs(delta) + 1),
        25, 98
      );
    }
    p.overall = overall(p);
    p.morale  = clamp(p.morale + randInt(-8, 8), 10, 100);
    if (p.contract.yearsLeft > 0) p.contract.yearsLeft -= 1;
    p.contract.expiresYear = state.season.year + Math.max(0, p.contract.yearsLeft);
    p.stats = {
      gp: 0, gs: 0, min: 0,
      goals: 0, assists: 0,
      shots: 0, shotsOnTarget: 0, xg: 0,
      yellows: 0, reds: 0,
      cleanSheets: 0, ga: 0,
      motm: 0,
    };
    p.injuredUntil = null;
    p.injuryMeta   = null;
  }

  for (const team of state.teams) {
    const academy = state.academies[team.id] || [];
    academy.forEach(a => {
      a.age += 1;
      for (const key of Object.keys(a.attributes)) {
        a.attributes[key] = clamp(a.attributes[key] + randInt(0, 1), 25, 98);
      }
      a.overall   = overall(a);
      a.potential = clamp(a.potential + randInt(-1, 1), a.overall, 86);
      a.morale    = clamp(a.morale + randInt(-5, 4), 20, 100);
    });
    while ((state.academies[team.id] || []).length < state.settings.academyPerTeam) {
      state.academies[team.id].push(makeAcademyPlayer(team));
    }
  }
}

function expireContracts(state) {
  for (const p of [...state.players]) {
    if (p.clubId && p.contract.yearsLeft <= 0) {
      p.clubId           = null;
      p.contract.status  = "Free Agent";
      p.contract.yearsLeft = randInt(1, 3);
      state.freeAgents.push(p);
      addTransaction(state, "Free Agency", `${p.name} became a free agent.`);
    }
  }
}

function aiFillRosters(state) {
  for (const team of state.teams) {
    const squad = getTeamPlayers(state, team.id);
    let needs   = 26 - squad.length;
    while (needs > 0 && state.freeAgents.length) {
      const player = [...state.freeAgents].sort((a, b) => b.overall - a.overall)[0];
      if (!player) break;
      player.clubId           = team.id;
      player.contract.status  = "Active";
      player.contract.yearsLeft = randInt(1, 3);
      player.contract.expiresYear = state.season.year + player.contract.yearsLeft;
      player.rosterRole =
        squad.length < 20 ? "Senior" :
        squad.length < 24 ? "Supplemental" : "Reserve";
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
  state.playoffs    = null;
  state.pendingOffer = null;
  ensureOpenCupState(state);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function createNewState(options) {
  const teams = [];
  let ordinal = 0;

  for (const [conference, names] of Object.entries(CONFERENCES)) {
    for (const name of names) {
      teams.push({
        id:                uuid("t"),
        ordinal:           ordinal++,
        name,
        shortName:         shortName(name),
        conference,
        country:           clubCountry(name),
        marketRating:      randInt(58, 77),
        gam:               Number(options.gamAnnual),
        tam:               Number(options.tamAnnual),
        salaryBudget:      Number(options.salaryBudget),
        internationalSlots: MLS_RULES.intlSlotsDefault,
        dpSlots:           3,
        u22Slots:          3,
        finances: {
          cash:       randInt(5000000, 26000000),
          ticketBase: randInt(17000, 42000),
          sponsor:    randInt(9000000, 25000000),
        },
      });
    }
  }

  const players = [];
  for (const team of teams) {
    const rolePlan = [
      "GK","GK","CB","CB","CB","LB","RB","LB","RB","CDM","CDM","CM",
      "CM","CAM","LM","RM","LW","RW","ST","ST","CB","CM","GK","LW","RW","ST",
    ];
    rolePlan.forEach((pos, idx) => players.push(makePlayer(team, idx, pos)));
  }

  const academies = {};
  for (const team of teams) {
    academies[team.id] = Array.from(
      { length: Number(options.academyPerTeam) },
      () => makeAcademyPlayer(team)
    );
  }

  const state = {
    version: 6,
    season:  { year: 2026, phase: "Regular Season" },
    calendar: { week: 1, absoluteDay: 0 },
    teams,
    players,
    academies,
    standings: {
      East: teams.filter(t => t.conference === "East").map(t => initStandingsRow(t.id)),
      West: teams.filter(t => t.conference === "West").map(t => initStandingsRow(t.id)),
    },
    schedule:      [],
    playoffs:      null,
    draft:         { pool: [], picks: [], order: [], history: [], started: false, completed: false, year: 2027, currentPickIndex: 0, currentRound: 1 },
    freeAgents:    [],
    transactions:  [],
    awardsHistory: [],
    pendingOffer:  null,
    userTeamId:    teams.find(t => t.name === options.userTeamName)?.id || teams[0].id,
    saveSlot:      options.saveSlot || "slot1",
    settings: {
      academyPerTeam: Number(options.academyPerTeam),
      salaryBudget:   Number(options.salaryBudget),
      gamAnnual:      Number(options.gamAnnual),
      tamAnnual:      Number(options.tamAnnual),
    },
  };

  autoAssignAllDesignations(state);
  makeSchedule(state);
  ensureOpenCupState(state);
  seedFreeAgents(state);
  ensureDraftPickLedger(state, state.season.year + 1, 3);
  addTransaction(state, "League", `League initialized for ${state.season.year}.`);
  return state;
}

export function signFreeAgent(state, playerId, teamId) {
  const player = state.freeAgents.find(p => p.id === playerId);
  if (!player) return { ok: false, reason: "Player not found" };

  const cap  = getCapSummary(state, teamId);
  const team = state.teams.find(t => t.id === teamId);

  if (!player.domestic && cap.intlUsed >= team.internationalSlots) {
    return { ok: false, reason: "No international slot available" };
  }

  const projectedCharge = getBudgetCharge({
    ...player,
    rosterRole: cap.seniorCount < 20 ? "Senior" : "Supplemental",
  });
  if (cap.seniorCount < 20 && cap.budgetRoom < projectedCharge) {
    return { ok: false, reason: "Not enough cap room" };
  }

  player.clubId           = teamId;
  player.contract.status  = "Active";
  player.contract.yearsLeft = randInt(1, 3);
  player.contract.expiresYear = state.season.year + player.contract.yearsLeft;
  player.rosterRole =
    cap.seniorCount < 20 ? "Senior" :
    cap.supplementalCount < 4 ? "Supplemental" : "Reserve";
  state.freeAgents = state.freeAgents.filter(p => p.id !== playerId);
  state.players.push(player);
  autoAssignTeamDesignations(state, team.id);
  addTransaction(state, "Signing", `${team.name} signed free agent ${player.name}.`);
  return { ok: true };
}

export function callUpAcademyPlayer(state, academyPlayerId, teamId) {
  const academy  = state.academies[teamId] || [];
  const prospect = academy.find(p => p.id === academyPlayerId);
  if (!prospect) return { ok: false, reason: "Prospect not found" };

  const teamPlayers = getTeamPlayers(state, teamId);
  if (teamPlayers.length >= 30) return { ok: false, reason: "Roster full" };

  const signed = hydratePlayer({
    id:           uuid("p"),
    name:         prospect.name,
    age:          prospect.age,
    nationality:  prospect.nationality,
    domestic:     true,
    preferredFoot: prospect.preferredFoot,
    clubId:       teamId,
    position:     prospect.position,
    rosterRole:   teamPlayers.length < 20 ? "Supplemental" : "Reserve",
    designation:  null,
    homegrown:    true,
    contract: { yearsLeft: 3, salary: 88025, status: "Active" },
    morale:       prospect.morale,
    injuryProne:  false,
    injuredUntil: null,
    injuryMeta:   null,
    attributes:   prospect.attributes,
    overall:      prospect.overall,
    potential:    prospect.potential,
    stats: {
      gp: 0, gs: 0, min: 0,
      goals: 0, assists: 0,
      shots: 0, shotsOnTarget: 0, xg: 0,
      yellows: 0, reds: 0,
      cleanSheets: 0, ga: 0,
      motm: 0,
    },
  });

  state.players.push(signed);
  autoAssignTeamDesignations(state, teamId);
  state.academies[teamId] = academy.filter(p => p.id !== academyPlayerId);
  state.academies[teamId].push(makeAcademyPlayer(state.teams.find(t => t.id === teamId)));
  addTransaction(
    state,
    "Academy",
    `${signed.name} called up from academy by ${state.teams.find(t => t.id === teamId).name}.`
  );
  return { ok: true };
}

export function acceptPendingOffer(state) {
  if (!state.pendingOffer) return;
  const offer  = state.pendingOffer;
  const player = state.players.find(p => p.id === offer.playerId);
  const team   = getUserTeam(state);
  if (!player || !team) return;

  player.clubId           = null;
  player.contract.status  = "Free Agent";
  player.contract.yearsLeft = randInt(1, 3);
  player.contract.expiresYear = state.season.year + player.contract.yearsLeft;
  state.freeAgents.push(player);
  team.finances.cash += offer.amount;
  team.gam           += Math.min(400000, Math.round(offer.amount * 0.06));
  addTransaction(
    state,
    "Sale",
    `${player.name} departed after ${offer.bidClub} paid ${offer.amount.toLocaleString()}.`
  );
  state.pendingOffer = null;
}

export function rejectPendingOffer(state) {
  if (!state.pendingOffer) return;
  addTransaction(state, "Offer", `Rejected offer from ${state.pendingOffer.bidClub}.`);
  state.pendingOffer = null;
}

export function advanceOneWeek(state) {
  if (state.season.phase === "Regular Season") {
    ensureOpenCupState(state);
    const matches = state.schedule.filter(
      m => m.week === state.calendar.week && !m.played
    );
    for (const match of matches) simulateMatch(state, match);
    advanceOpenCupWeek(state, state.calendar.week);

    maybeInjurePlayers(state);
    maybeExternalOffer(state);

    state.calendar.week += 1;
    state.calendar.absoluteDay += 7;

    if (state.calendar.week > 34) {
      state.season.phase = "Playoffs";
      state.playoffs = buildPlayoffs(state);
      addTransaction(
        state,
        "Playoffs",
        `MLS Cup Playoffs field set for ${state.season.year}.`
      );
    }
    return;
  }

  if (state.season.phase === "Playoffs") {
    advancePlayoffs(state);
    return;
  }

  if (state.season.phase === "Draft") {
    advanceDraftUntilUserOrEnd(state, true);
    return;
  }

  if (state.season.phase === "Contract Extensions") {
    resolveAiContractExtensions(state);
    state.season.phase = "Free Agency";
    addTransaction(state, "Extensions", `Contract extension window closed for ${state.season.year}.`);
    return;
  }

  if (state.season.phase === "Free Agency") {
    runFreeAgencyWindow(state);
    state.season.phase = "Offseason";
    return;
  }

  if (state.season.phase === "Offseason") {
    finalizeOffseason(state);
  }
}

export function simulateToSeasonEnd(state) {
  while (
    state.season.phase === "Regular Season" ||
    state.season.phase === "Playoffs"
  ) {
    advanceOneWeek(state);
  }
}

export function runOffseason(state) {
  finalizeOffseason(state);
}
