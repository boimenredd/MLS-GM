#!/usr/bin/env python3
"""
Build js/real-mls-data.js from FBref season exports.

Usage:
  python scripts/build_real_mls_from_fbref.py \
      --fbref-2025 data/fbref_mls_2025.csv \
      --fbref-2026 data/fbref_mls_2026.csv \
      --base-csv EAFC26-Men.csv \
      --out js/real-mls-data.js

Notes
-----
- This script keeps only MLS players from the base CSV for roster identity/meta.
- It recomputes ratings from 2025 + 2026 stat inputs rather than trusting the FC OVR column.
- FBref season tables can be exported to CSV from FBref or collected with soccerdata.
"""
from __future__ import annotations
import argparse, json, math, re
from pathlib import Path
import pandas as pd

TEAM_MAP = {
    'New England': 'New England Revolution',
    'Orlando City': 'Orlando City SC',
    'Philadelphia': 'Philadelphia Union',
    'Red Bulls': 'New York Red Bulls',
    'SJ Earthquakes': 'San Jose Earthquakes',
    'Sounders FC': 'Seattle Sounders FC',
    'Sporting KC': 'Sporting Kansas City',
    'Whitecaps FC': 'Vancouver Whitecaps FC',
    'LAFC': 'Los Angeles FC',
    'Houston Dynamo': 'Houston Dynamo FC',
    'Houston Dynamo FC': 'Houston Dynamo FC',
    'Minnesota United': 'Minnesota United FC',
}

KEEP_COLS = {
    'Name':'name','Age':'age','Nation':'nation','TeamMapped':'team','Position':'position',
    'Alternative positions':'altPositions','Preferred foot':'preferredFoot','Height':'height','Weight':'weight',
    'PAC':'pac','SHO':'sho','PAS':'pas','DRI':'dri','DEF':'deff','PHY':'phy',
    'Acceleration':'acceleration','Sprint Speed':'sprintSpeed','Positioning':'positioning',
    'Finishing':'finishing','Shot Power':'shotPower','Long Shots':'longShots','Volleys':'volleys','Penalties':'penalties',
    'Vision':'vision','Crossing':'crossing','Free Kick Accuracy':'freeKickAccuracy','Short Passing':'shortPassing',
    'Long Passing':'longPassing','Curve':'curve','Dribbling':'dribbling','Agility':'agility','Balance':'balance',
    'Reactions':'reactions','Ball Control':'ballControl','Composure':'composure',
    'Interceptions':'interceptions','Heading Accuracy':'headingAccuracy','Def Awareness':'defAwareness',
    'Standing Tackle':'standingTackle','Sliding Tackle':'slidingTackle','Jumping':'jumping','Stamina':'stamina',
    'Strength':'strength','Aggression':'aggression','Weak foot':'weakFoot','Skill moves':'skillMoves',
    'GK Diving':'gkDiv','GK Handling':'gkHan','GK Kicking':'gkKic','GK Positioning':'gkPos','GK Reflexes':'gkRef',
    'play style':'playStyle','card':'photoUrl','url':'profileUrl'
}

def clamp(v, lo, hi):
    return max(lo, min(hi, int(round(v))))

def slug_name(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', str(name).lower())

def load_fbref_csv(path: Path, season_weight: float):
    df = pd.read_csv(path)
    cols = {c.lower(): c for c in df.columns}
    name_col = next((cols[c] for c in cols if c in {'player','name'}), None)
    team_col = next((cols[c] for c in cols if c in {'squad','team','club'}), None)
    mins_col = next((cols[c] for c in cols if c in {'min','minutes','mins'}), None)
    if not name_col or not team_col:
        raise ValueError(f"{path} is missing player/team columns")
    numeric_map = {
        'gls': ['gls','goals'],
        'ast': ['ast','assists'],
        'xg': ['xg'],
        'xag': ['xag'],
        'shots': ['sh','shots'],
        'sot': ['sot'],
        'kp': ['kp','key passes'],
        'prgp': ['prgp','progressive passes'],
        'prgc': ['prgc','progressive carries'],
        'tkl': ['tkl','tackles'],
        'int': ['int','interceptions'],
        'blocks': ['blocks','blk'],
        'aerial_won': ['won','aerials won'],
        'save_pct': ['save%','save_pct'],
        'ga90': ['ga90'],
    }
    out = []
    for _, row in df.iterrows():
        rec = {
            'key': slug_name(row[name_col]) + '|' + slug_name(TEAM_MAP.get(str(row[team_col]), str(row[team_col]))),
            'player': str(row[name_col]),
            'team': TEAM_MAP.get(str(row[team_col]), str(row[team_col])),
            'minutes': float(row[mins_col]) if mins_col and pd.notna(row[mins_col]) else 0.0,
            'weight': season_weight,
        }
        for k, aliases in numeric_map.items():
            col = next((cols[a] for a in cols if a in aliases), None)
            rec[k] = float(row[col]) if col and pd.notna(row[col]) else 0.0
        out.append(rec)
    return pd.DataFrame(out)

def blended_metric(group: pd.DataFrame, metric: str) -> float:
    denom = (group['minutes'] * group['weight']).sum()
    if denom <= 0:
        return 0.0
    return ((group[metric] * group['minutes'] * group['weight']).sum()) / denom

def build(args):
    base = pd.read_csv(args.base_csv)
    base = base[base['League'].eq('MLS')].copy()
    base['TeamMapped'] = base['Team'].map(TEAM_MAP).fillna(base['Team'])
    base['merge_key'] = base['Name'].map(slug_name) + '|' + base['TeamMapped'].map(slug_name)

    s2025 = load_fbref_csv(Path(args.fbref_2025), season_weight=0.65)
    s2026 = load_fbref_csv(Path(args.fbref_2026), season_weight=1.00)
    fb = pd.concat([s2025, s2026], ignore_index=True)
    agg = fb.groupby('key', as_index=False).apply(lambda g: pd.Series({
        'fb_minutes': g['minutes'].sum(),
        'fb_goals': blended_metric(g, 'gls'),
        'fb_assists': blended_metric(g, 'ast'),
        'fb_xg': blended_metric(g, 'xg'),
        'fb_xag': blended_metric(g, 'xag'),
        'fb_shots': blended_metric(g, 'shots'),
        'fb_sot': blended_metric(g, 'sot'),
        'fb_kp': blended_metric(g, 'kp'),
        'fb_prgp': blended_metric(g, 'prgp'),
        'fb_prgc': blended_metric(g, 'prgc'),
        'fb_tkl': blended_metric(g, 'tkl'),
        'fb_int': blended_metric(g, 'int'),
        'fb_blocks': blended_metric(g, 'blocks'),
        'fb_aerial_won': blended_metric(g, 'aerial_won'),
        'fb_save_pct': blended_metric(g, 'save_pct'),
        'fb_ga90': blended_metric(g, 'ga90'),
    })).reset_index(drop=True)

    merged = base.merge(agg, how='left', left_on='merge_key', right_on='key')
    merged.fillna(0, inplace=True)

    out = []
    for _, row in merged.iterrows():
        rec = {}
        for src, dst in KEEP_COLS.items():
            val = row[src]
            rec[dst] = None if pd.isna(val) else (int(val) if isinstance(val, float) and float(val).is_integer() else val)
        rec['fbrefMinutes'] = int(row['fb_minutes'])
        rec['fbrefGoals'] = round(float(row['fb_goals']), 4)
        rec['fbrefAssists'] = round(float(row['fb_assists']), 4)
        rec['fbrefXg'] = round(float(row['fb_xg']), 4)
        rec['fbrefXag'] = round(float(row['fb_xag']), 4)
        rec['fbrefShots'] = round(float(row['fb_shots']), 4)
        rec['fbrefSot'] = round(float(row['fb_sot']), 4)
        rec['fbrefKeyPasses'] = round(float(row['fb_kp']), 4)
        rec['fbrefProgPasses'] = round(float(row['fb_prgp']), 4)
        rec['fbrefProgCarries'] = round(float(row['fb_prgc']), 4)
        rec['fbrefTackles'] = round(float(row['fb_tkl']), 4)
        rec['fbrefInterceptions'] = round(float(row['fb_int']), 4)
        rec['fbrefBlocks'] = round(float(row['fb_blocks']), 4)
        rec['fbrefAerialWon'] = round(float(row['fb_aerial_won']), 4)
        rec['fbrefSavePct'] = round(float(row['fb_save_pct']), 4)
        rec['fbrefGa90'] = round(float(row['fb_ga90']), 4)
        out.append(rec)

    js = "// Generated from FC base roster + FBref season exports\\n"
    js += "export const REAL_MLS_PLAYERS = " + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ";\\n"
    Path(args.out).write_text(js, encoding='utf-8')
    print(f"Wrote {len(out)} MLS players to {args.out}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fbref-2025', required=True)
    parser.add_argument('--fbref-2026', required=True)
    parser.add_argument('--base-csv', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    build(args)

if __name__ == '__main__':
    main()
