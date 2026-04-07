#!/usr/bin/env python3
"""
Build js/real-mls-data.js from FBref 2025 + 2026 MLS player exports only.

Expected inputs
---------------
CSV exports from FBref MLS player tables. The script is flexible about exact column names,
but it expects to find most of these somewhere across the two files:
- player/name
- squad/team/club
- pos/position
- age
- nation/nationality
- min/mins/minutes
- gls, ast, xg, xag, sh, sot, kp, prgp, prgc, tkl, int, blocks/blk, won, save%, ga90

Usage
-----
python scripts/build_real_mls_from_fbref.py \
    --fbref-2025 fbref_mls_2025.csv \
    --fbref-2026 fbref_mls_2026.csv \
    --out js/real-mls-data.js
"""
from __future__ import annotations
import argparse
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import pandas as pd

TEAM_MAP = {
    'Atlanta Utd': 'Atlanta United',
    'Atlanta United FC': 'Atlanta United',
    'Austin': 'Austin FC',
    'Charlotte': 'Charlotte FC',
    'Chicago Fire': 'Chicago Fire FC',
    'Cincinnati': 'FC Cincinnati',
    'Colorado': 'Colorado Rapids',
    'Columbus': 'Columbus Crew',
    'D.C. United': 'D.C. United',
    'DC United': 'D.C. United',
    'Dallas': 'FC Dallas',
    'Houston Dynamo': 'Houston Dynamo FC',
    'Kansas City': 'Sporting Kansas City',
    'Sporting KC': 'Sporting Kansas City',
    'LA Galaxy': 'LA Galaxy',
    'Los Angeles FC': 'Los Angeles FC',
    'Inter Miami': 'Inter Miami CF',
    'Miami': 'Inter Miami CF',
    'Minnesota Utd': 'Minnesota United FC',
    'Minnesota United': 'Minnesota United FC',
    'Montréal': 'CF Montréal',
    'Montreal': 'CF Montréal',
    'Nashville': 'Nashville SC',
    'New England': 'New England Revolution',
    'NYCFC': 'New York City FC',
    'New York City': 'New York City FC',
    'Red Bulls': 'New York Red Bulls',
    'NY Red Bulls': 'New York Red Bulls',
    'Orlando City': 'Orlando City SC',
    'Philadelphia': 'Philadelphia Union',
    'Portland': 'Portland Timbers',
    'Salt Lake': 'Real Salt Lake',
    'RSL': 'Real Salt Lake',
    'San Diego': 'San Diego FC',
    'SJ Earthquakes': 'San Jose Earthquakes',
    'San Jose': 'San Jose Earthquakes',
    'Seattle': 'Seattle Sounders FC',
    'Sounders FC': 'Seattle Sounders FC',
    'St. Louis': 'St. Louis CITY SC',
    'St. Louis City': 'St. Louis CITY SC',
    'Toronto': 'Toronto FC',
    'Vancouver': 'Vancouver Whitecaps FC',
    'Whitecaps FC': 'Vancouver Whitecaps FC',
}

MLS_TEAMS = {
    'Atlanta United','Austin FC','Charlotte FC','Chicago Fire FC','FC Cincinnati','Colorado Rapids',
    'Columbus Crew','D.C. United','FC Dallas','Houston Dynamo FC','Sporting Kansas City','LA Galaxy',
    'Los Angeles FC','Inter Miami CF','Minnesota United FC','CF Montréal','Nashville SC',
    'New England Revolution','New York City FC','New York Red Bulls','Orlando City SC',
    'Philadelphia Union','Portland Timbers','Real Salt Lake','San Diego FC','San Jose Earthquakes',
    'Seattle Sounders FC','St. Louis CITY SC','Toronto FC','Vancouver Whitecaps FC'
}

METRIC_ALIASES = {
    'player': ['player', 'name'],
    'team': ['squad', 'team', 'club'],
    'position': ['pos', 'position'],
    'age': ['age'],
    'nation': ['nation', 'nationality'],
    'minutes': ['min', 'mins', 'minutes'],
    'gls': ['gls', 'goals'],
    'ast': ['ast', 'assists'],
    'xg': ['xg'],
    'xag': ['xag'],
    'shots': ['sh', 'shots'],
    'sot': ['sot'],
    'kp': ['kp', 'key passes'],
    'prgp': ['prgp', 'progressive passes'],
    'prgc': ['prgc', 'progressive carries'],
    'tkl': ['tkl', 'tackles'],
    'interceptions': ['int', 'interceptions'],
    'blocks': ['blocks', 'blk'],
    'aerial_won': ['won', 'aerials won'],
    'save_pct': ['save%', 'save_pct', 'save percentage'],
    'ga90': ['ga90'],
}


def slug(text: object) -> str:
    return re.sub(r'[^a-z0-9]+', '', str(text or '').lower())


def clamp(value: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(round(value))))


def map_team(name: object) -> Optional[str]:
    raw = str(name or '').strip()
    mapped = TEAM_MAP.get(raw, raw)
    return mapped if mapped in MLS_TEAMS else None


def safe_float(value: object) -> float:
    try:
        if pd.isna(value):
            return 0.0
        txt = str(value).strip().replace(',', '')
        if txt in {'', 'nan', 'None'}:
            return 0.0
        return float(txt)
    except Exception:
        return 0.0


@dataclass
class FbrefRow:
    key: str
    name: str
    team: str
    age: int
    nation: str
    position: str
    minutes: float
    season_weight: float
    metrics: Dict[str, float]


def pick_col(columns: Dict[str, str], aliases: Iterable[str]) -> Optional[str]:
    for alias in aliases:
        if alias in columns:
            return columns[alias]
    return None


def load_fbref_csv(path: Path, season_weight: float) -> List[FbrefRow]:
    df = pd.read_csv(path)
    cols = {str(c).strip().lower(): c for c in df.columns}
    player_col = pick_col(cols, METRIC_ALIASES['player'])
    team_col = pick_col(cols, METRIC_ALIASES['team'])
    pos_col = pick_col(cols, METRIC_ALIASES['position'])
    age_col = pick_col(cols, METRIC_ALIASES['age'])
    nation_col = pick_col(cols, METRIC_ALIASES['nation'])
    minutes_col = pick_col(cols, METRIC_ALIASES['minutes'])
    if not player_col or not team_col:
        raise ValueError(f'{path} is missing player/team columns.')
    out: List[FbrefRow] = []
    for _, row in df.iterrows():
        team = map_team(row.get(team_col))
        if not team:
            continue
        name = str(row.get(player_col, '')).strip()
        if not name:
            continue
        age = int(safe_float(row.get(age_col))) if age_col else 24
        nation = str(row.get(nation_col, '')).strip() if nation_col else ''
        pos = str(row.get(pos_col, '')).strip() if pos_col else ''
        minutes = safe_float(row.get(minutes_col)) if minutes_col else 0.0
        metrics: Dict[str, float] = {}
        for metric_name, aliases in METRIC_ALIASES.items():
            if metric_name in {'player', 'team', 'position', 'age', 'nation', 'minutes'}:
                continue
            col = pick_col(cols, aliases)
            metrics[metric_name] = safe_float(row.get(col)) if col else 0.0
        out.append(FbrefRow(
            key=f'{slug(name)}|{slug(team)}',
            name=name,
            team=team,
            age=age or 24,
            nation=nation,
            position=pos,
            minutes=minutes,
            season_weight=season_weight,
            metrics=metrics,
        ))
    return out


def weighted_metric(rows: List[FbrefRow], metric_name: str) -> float:
    denom = sum(max(0.0, r.minutes) * r.season_weight for r in rows)
    if denom <= 0:
        return 0.0
    numer = sum(r.metrics.get(metric_name, 0.0) * max(0.0, r.minutes) * r.season_weight for r in rows)
    return numer / denom


def normalized_fbref_pos(raw: str) -> str:
    txt = str(raw or '').upper()
    if 'GK' in txt:
        return 'GK'
    if 'FW' in txt and 'MF' in txt:
        return 'AM/W'
    if 'FW' in txt:
        return 'ST'
    if 'DF' in txt and 'MF' in txt:
        return 'FB/DM'
    if 'DF' in txt:
        return 'CB'
    if 'MF' in txt:
        return 'CM'
    return 'CM'


def infer_specific_position(record: Dict[str, object]) -> str:
    raw = normalized_fbref_pos(str(record.get('fbrefPos', 'CM')))
    shots = float(record.get('fbrefShots', 0.0))
    xg = float(record.get('fbrefXg', 0.0))
    ast = float(record.get('fbrefAssists', 0.0))
    xag = float(record.get('fbrefXag', 0.0))
    kp = float(record.get('fbrefKeyPasses', 0.0))
    prgc = float(record.get('fbrefProgCarries', 0.0))
    tkl = float(record.get('fbrefTackles', 0.0))
    itc = float(record.get('fbrefInterceptions', 0.0))
    aerial = float(record.get('fbrefAerialWon', 0.0))
    if raw == 'GK':
        return 'GK'
    if raw == 'ST':
        return 'LW' if (ast + xag + kp) >= (xg + shots * 0.12) else 'ST'
    if raw == 'AM/W':
        if xg + shots * 0.15 > ast + xag + kp * 0.35:
            return 'LW'
        return 'CAM'
    if raw == 'FB/DM':
        if tkl + itc > prgc + kp + xag * 2.4:
            return 'CDM'
        return 'LB'
    if raw == 'CB':
        if prgc + kp + xag * 2.2 > aerial + tkl + itc:
            return 'LB'
        return 'CB'
    if tkl + itc > kp + xag * 3.0:
        return 'CDM'
    if kp + xag * 3.0 > tkl + itc + xg * 2.0:
        return 'CAM'
    return 'CM'


def mean(values: Iterable[float]) -> float:
    vals = [float(v) for v in values if v is not None]
    return sum(vals) / len(vals) if vals else 0.0


def category_average(category: Dict[str, float]) -> float:
    vals = [float(v) for v in category.values()]
    return sum(vals) / len(vals) if vals else 0.0


def position_weights(position: str) -> Dict[str, float]:
    return {
        'GK': {'goalkeeping': 0.72, 'physical': 0.12, 'mentality': 0.08, 'passing': 0.06, 'defense': 0.02},
        'CB': {'defense': 0.44, 'physical': 0.24, 'mentality': 0.12, 'passing': 0.10, 'skill': 0.05, 'shooting': 0.05},
        'LB': {'defense': 0.24, 'physical': 0.22, 'passing': 0.18, 'skill': 0.16, 'mentality': 0.10, 'shooting': 0.10},
        'RB': {'defense': 0.24, 'physical': 0.22, 'passing': 0.18, 'skill': 0.16, 'mentality': 0.10, 'shooting': 0.10},
        'CDM': {'defense': 0.24, 'passing': 0.22, 'physical': 0.18, 'mentality': 0.16, 'skill': 0.12, 'shooting': 0.08},
        'CM': {'passing': 0.24, 'skill': 0.20, 'mentality': 0.18, 'physical': 0.16, 'defense': 0.12, 'shooting': 0.10},
        'CAM': {'passing': 0.26, 'skill': 0.24, 'mentality': 0.14, 'shooting': 0.18, 'physical': 0.10, 'defense': 0.08},
        'LM': {'skill': 0.24, 'passing': 0.20, 'physical': 0.18, 'shooting': 0.16, 'mentality': 0.12, 'defense': 0.10},
        'RM': {'skill': 0.24, 'passing': 0.20, 'physical': 0.18, 'shooting': 0.16, 'mentality': 0.12, 'defense': 0.10},
        'LW': {'skill': 0.28, 'shooting': 0.22, 'passing': 0.16, 'physical': 0.14, 'mentality': 0.12, 'defense': 0.08},
        'RW': {'skill': 0.28, 'shooting': 0.22, 'passing': 0.16, 'physical': 0.14, 'mentality': 0.12, 'defense': 0.08},
        'ST': {'shooting': 0.34, 'skill': 0.20, 'physical': 0.18, 'mentality': 0.14, 'passing': 0.10, 'defense': 0.04},
    }.get(position, {'physical': 0.17, 'passing': 0.17, 'shooting': 0.17, 'skill': 0.17, 'mentality': 0.16, 'defense': 0.16})


def age_modifier(age: int, position: str) -> int:
    n = int(age or 24)
    prime_end = 34 if position == 'GK' else 29
    if n <= 18:
        return -10
    if n <= 20:
        return -7
    if n <= 22:
        return -4
    if n <= 24:
        return -1
    if n <= prime_end:
        return 1
    if n <= (36 if position == 'GK' else 31):
        return 0
    if n <= (38 if position == 'GK' else 33):
        return -2
    return -5


def compute_profile(record: Dict[str, object]) -> Dict[str, object]:
    position = infer_specific_position(record)
    age = int(record.get('age', 24) or 24)
    minutes = float(record.get('fbrefMinutes', 0.0) or 0.0)
    sample_boost = 1.0 if minutes >= 1800 else 0.92 if minutes >= 900 else 0.84 if minutes >= 450 else 0.75
    gk = position == 'GK'

    goal = float(record.get('fbrefGoals', 0.0))
    ast = float(record.get('fbrefAssists', 0.0))
    xg = float(record.get('fbrefXg', 0.0))
    xag = float(record.get('fbrefXag', 0.0))
    shots = float(record.get('fbrefShots', 0.0))
    sot = float(record.get('fbrefSot', 0.0))
    kp = float(record.get('fbrefKeyPasses', 0.0))
    prgp = float(record.get('fbrefProgPasses', 0.0))
    prgc = float(record.get('fbrefProgCarries', 0.0))
    tkl = float(record.get('fbrefTackles', 0.0))
    itc = float(record.get('fbrefInterceptions', 0.0))
    blk = float(record.get('fbrefBlocks', 0.0))
    aerial = float(record.get('fbrefAerialWon', 0.0))
    save_pct = float(record.get('fbrefSavePct', 0.0))
    ga90 = float(record.get('fbrefGa90', 0.0))

    height_guess = 186 if gk else 183 if position == 'CB' else 179

    def pct(value: float, average: float, spread: float = 1.0, lo: int = 18, hi: int = 92) -> int:
        safe = max(0.08, spread)
        score = 50 + ((value - average) / safe) * 18
        return clamp(score, lo, hi)

    physical = {
        'Height': clamp((height_guess - 150) * 0.9, 35, 92),
        'Strength': pct(aerial + blk * 0.4, 2.0, 1.2),
        'SprintSpeed': pct(prgc, 3.0, 1.8),
        'Acceleration': pct(prgc + kp * 0.25, 3.6, 2.0),
        'Endurance': clamp((minutes / 30.0), 22, 92),
    }
    passing = {
        'Vision': pct(kp + xag * 2.0, 1.3, 0.95),
        'Power': pct(prgp, 4.8, 2.2),
        'Accuracy': pct(prgp + kp * 0.5 - blk * 0.08, 5.3, 2.1),
        'Crossing': 8 if gk else pct(xag + kp * 0.3 + prgc * 0.2, 1.1, 0.8),
        'LongPassing': pct(prgp, 5.0, 2.3),
    }
    shooting = {
        'ShotPower': 8 if gk else pct(shots + xg * 2.0, 2.2, 1.6),
        'HeadingAccuracy': 12 if gk else pct(aerial + goal * 0.3, 2.4, 1.3),
        'Volleys': 6 if gk else pct(goal + sot * 0.35, 0.7, 0.7),
        'FreeKickAccuracy': 5 if gk else pct(kp + xag, 1.0, 0.7),
        'Curve': 5 if gk else pct(xag + kp * 0.35, 1.1, 0.75),
    }
    skill = {
        'Dribbling': 10 if gk else pct(prgc + shots * 0.25, 4.0, 2.0),
        'BallControl': 16 if gk else pct(prgc + prgp * 0.25, 5.2, 2.3),
        'SkillMoves': 4 if gk else pct(prgc, 3.2, 1.7),
    }
    mentality = {
        'Aggression': pct(tkl + blk * 0.5, 2.5, 1.5),
        'Positioning': pct(save_pct - ga90 * 5, 45, 10) if gk else pct(xg + kp * 0.3 + itc * 0.18, 1.5, 0.9),
        'Penalties': 6 if gk else pct(goal + xg * 0.8, 0.8, 0.8),
        'Composure': pct(kp + prgp * 0.22 + prgc * 0.16, 2.1, 1.0),
    }
    defense = {
        'Awareness': 18 if gk else pct(itc + blk * 0.55, 2.2, 1.1),
        'StandingTackle': 12 if gk else pct(tkl, 1.8, 1.0),
        'SlidingTackle': 8 if gk else pct(tkl * 0.8 + blk * 0.2, 1.5, 0.9),
        'Interceptions': 12 if gk else pct(itc, 1.2, 0.8),
    }
    goalkeeping = {
        'Diving': clamp(pct(save_pct, 68, 9), 35, 92) if gk else 5,
        'Handling': clamp(pct(save_pct - ga90 * 3, 66, 9), 34, 92) if gk else 5,
        'Kicking': clamp(pct(prgp, 4.0, 2.2), 28, 88) if gk else 5,
        'Positioning': clamp(pct(80 - ga90 * 10 + save_pct * 0.2, 70, 9), 34, 92) if gk else 5,
        'Reflexes': clamp(pct(save_pct + shots * 0.3, 70, 10), 35, 94) if gk else 5,
    }

    category_ratings = {
        'physical': category_average(physical),
        'passing': category_average(passing),
        'shooting': category_average(shooting),
        'skill': category_average(skill),
        'mentality': category_average(mentality),
        'defense': category_average(defense),
        'goalkeeping': category_average(goalkeeping),
    }
    overall_base = sum(category_ratings[k] * w for k, w in position_weights(position).items())
    overall = clamp(overall_base * sample_boost + age_modifier(age, position), 42, 88)

    detailed = {
        'physical': {
            'acceleration': clamp(physical['Acceleration'], 5, 99),
            'sprintSpeed': clamp(physical['SprintSpeed'], 5, 99),
            'agility': clamp((skill['Dribbling'] + skill['BallControl']) / 2, 5, 99),
            'stamina': clamp(physical['Endurance'], 5, 99),
            'strength': clamp(physical['Strength'], 5, 99),
            'jumping': clamp((physical['Height'] + shooting['HeadingAccuracy']) / 2, 5, 99),
        },
        'technical': {
            'finishing': clamp((shooting['ShotPower'] + mentality['Positioning'] + shooting['Volleys']) / 3, 5, 99),
            'longShots': clamp((shooting['ShotPower'] + shooting['Curve']) / 2, 5, 99),
            'crossing': clamp(passing['Crossing'], 5, 99),
            'shortPassing': clamp(passing['Accuracy'], 5, 99),
            'vision': clamp(passing['Vision'], 5, 99),
            'dribbling': clamp(skill['Dribbling'], 5, 99),
            'firstTouch': clamp(skill['BallControl'], 5, 99),
            'setPieces': clamp((shooting['FreeKickAccuracy'] + shooting['Curve']) / 2, 5, 99),
        },
        'defending': {
            'marking': clamp(defense['Awareness'], 5, 99),
            'tackling': clamp((defense['StandingTackle'] + defense['SlidingTackle']) / 2, 5, 99),
            'interceptions': clamp(defense['Interceptions'], 5, 99),
            'heading': clamp(shooting['HeadingAccuracy'], 5, 99),
            'positioning': clamp(mentality['Positioning'], 5, 99),
        },
        'goalkeeping': {
            'handling': clamp(goalkeeping['Handling'], 1, 99),
            'reflexes': clamp(goalkeeping['Reflexes'], 1, 99),
            'oneOnOnes': clamp((goalkeeping['Diving'] + goalkeeping['Reflexes']) / 2, 1, 99),
            'kicking': clamp(goalkeeping['Kicking'], 1, 99),
            'command': clamp(goalkeeping['Positioning'], 1, 99),
        },
    }

    attributes = {
        'pace': clamp((physical['Acceleration'] + physical['SprintSpeed']) / 2 * (0.75 if gk else 1.0), 20, 98),
        'shooting': clamp(category_ratings['shooting'] * (0.18 if gk else 1.0), 5 if gk else 20, 18 if gk else 96),
        'passing': clamp((category_ratings['passing'] + goalkeeping['Kicking']) / 2 if gk else category_ratings['passing'], 20, 96),
        'dribbling': clamp(category_ratings['skill'] * (0.45 if gk else 1.0), 10 if gk else 20, 48 if gk else 96),
        'defense': clamp(category_ratings['goalkeeping'] if gk else category_ratings['defense'], 20 if not gk else 40, 95 if gk else 96),
        'physical': clamp((category_ratings['physical'] + goalkeeping['Positioning']) / 2 if gk else category_ratings['physical'], 20 if not gk else 35, 92 if gk else 96),
    }

    return {
        **record,
        'position': position,
        'fbrefDerived': True,
        'categoryRatings': category_ratings,
        'attributes': attributes,
        'detailed': detailed,
        'overallRating': overall,
    }


def merge_rows(rows2025: List[FbrefRow], rows2026: List[FbrefRow]) -> List[Dict[str, object]]:
    grouped: Dict[str, List[FbrefRow]] = {}
    for row in rows2025 + rows2026:
        grouped.setdefault(row.key, []).append(row)
    out: List[Dict[str, object]] = []
    for rows in grouped.values():
        rows = sorted(rows, key=lambda r: (r.season_weight, r.minutes), reverse=True)
        newest = rows[0]
        rec: Dict[str, object] = {
            'name': newest.name,
            'team': newest.team,
            'age': newest.age,
            'nation': newest.nation,
            'fbrefPos': newest.position,
            'preferredFoot': 'Right',
            'height': None,
            'weight': None,
            'photoUrl': None,
            'profileUrl': None,
            'fbrefMinutes': int(sum(r.minutes for r in rows)),
            'fbrefGoals': round(weighted_metric(rows, 'gls'), 4),
            'fbrefAssists': round(weighted_metric(rows, 'ast'), 4),
            'fbrefXg': round(weighted_metric(rows, 'xg'), 4),
            'fbrefXag': round(weighted_metric(rows, 'xag'), 4),
            'fbrefShots': round(weighted_metric(rows, 'shots'), 4),
            'fbrefSot': round(weighted_metric(rows, 'sot'), 4),
            'fbrefKeyPasses': round(weighted_metric(rows, 'kp'), 4),
            'fbrefProgPasses': round(weighted_metric(rows, 'prgp'), 4),
            'fbrefProgCarries': round(weighted_metric(rows, 'prgc'), 4),
            'fbrefTackles': round(weighted_metric(rows, 'tkl'), 4),
            'fbrefInterceptions': round(weighted_metric(rows, 'interceptions'), 4),
            'fbrefBlocks': round(weighted_metric(rows, 'blocks'), 4),
            'fbrefAerialWon': round(weighted_metric(rows, 'aerial_won'), 4),
            'fbrefSavePct': round(weighted_metric(rows, 'save_pct'), 4),
            'fbrefGa90': round(weighted_metric(rows, 'ga90'), 4),
        }
        out.append(compute_profile(rec))
    out.sort(key=lambda r: (str(r['team']), -int(r['overallRating']), str(r['name'])))
    return out


def build(args: argparse.Namespace) -> None:
    rows2025 = load_fbref_csv(Path(args.fbref_2025), season_weight=0.65)
    rows2026 = load_fbref_csv(Path(args.fbref_2026), season_weight=1.00)
    players = merge_rows(rows2025, rows2026)
    meta = {
        'source': 'fbref-only',
        'ready': True,
        'seasons': [2025, 2026],
        'builtAt': datetime.now(timezone.utc).isoformat(),
        'playerCount': len(players),
        'note': 'Built only from FBref MLS 2025 + 2026 exports.',
    }
    js = (
        '// Generated from FBref MLS 2025 + 2026 exports only.\n'
        f'export const REAL_MLS_DATA_META = {json.dumps(meta, ensure_ascii=False, separators=(",", ":"))};\n'
        f'export const REAL_MLS_PLAYERS = {json.dumps(players, ensure_ascii=False, separators=(",", ":"))};\n'
    )
    Path(args.out).write_text(js, encoding='utf-8')
    print(f'Wrote {len(players)} FBref-derived MLS players to {args.out}')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--fbref-2025', required=True)
    parser.add_argument('--fbref-2026', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    build(args)


if __name__ == '__main__':
    main()
