#!/usr/bin/env python3
from pathlib import Path
import os, json
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "js" / "real-mls-data.js"
DATA_DIR = Path.cwd()

TEAM_MAP = {
    "Atlanta United FC": "Atlanta United",
    "Austin FC": "Austin FC",
    "Charlotte FC": "Charlotte FC",
    "Chicago Fire FC": "Chicago Fire FC",
    "FC Cincinnati": "FC Cincinnati",
    "Colorado Rapids": "Colorado Rapids",
    "Columbus Crew": "Columbus Crew",
    "D.C. United": "D.C. United",
    "FC Dallas": "FC Dallas",
    "Houston Dynamo": "Houston Dynamo FC",
    "Inter Miami": "Inter Miami CF",
    "Los Angeles Galaxy": "LA Galaxy",
    "Los Angeles FC": "Los Angeles FC",
    "Minnesota United FC": "Minnesota United FC",
    "CF Montréal": "CF Montréal",
    "Nashville SC": "Nashville SC",
    "New England Revolution": "New England Revolution",
    "New York City FC": "New York City FC",
    "Red Bull New York": "New York Red Bulls",
    "Orlando City SC": "Orlando City SC",
    "Philadelphia Union": "Philadelphia Union",
    "Portland Timbers": "Portland Timbers",
    "Real Salt Lake": "Real Salt Lake",
    "San Diego FC": "San Diego FC",
    "San Jose Earthquakes": "San Jose Earthquakes",
    "Seattle Sounders": "Seattle Sounders FC",
    "Sporting KC": "Sporting Kansas City",
    "St. Louis City SC": "St. Louis CITY SC",
    "Toronto FC": "Toronto FC",
    "Vancouver Whitecaps": "Vancouver Whitecaps FC",
}

def num(v, default=0):
    try:
        if pd.isna(v): return default
        return float(v)
    except Exception:
        return default

def clamp(v, lo, hi):
    return max(lo, min(hi, int(round(v))))

def cm_to_height(cm):
    cm = int(round(num(cm, 178)))
    inches = round(cm / 2.54)
    ft = inches // 12
    inch = inches % 12
    return f"{ft}' {inch}\""

def kg_to_weight(kg):
    kg = num(kg, 75)
    lbs = round(kg * 2.20462)
    return f"{lbs} lb"

def height_rating(cm):
    return clamp(48 + ((num(cm,178) - 157) * 1.35), 40, 95)

def build_dataset():
    csv_files = sorted([DATA_DIR / f for f in os.listdir(DATA_DIR) if f.startswith("players") and f.endswith(".csv")])
    if not csv_files:
        raise SystemExit("No players (*.csv) files found in the current folder.")
    df = pd.concat([pd.read_csv(p) for p in csv_files], ignore_index=True)
    df["team_mls"] = df["info.teams.club_team.name"].map(TEAM_MAP)
    df = df[df["team_mls"].notna()].copy()
    rows = []
    for _, r in df.iterrows():
        known = str(r.get("info.name.knownas") or "").strip()
        first = str(r.get("info.name.firstname") or "").strip()
        last = str(r.get("info.name.lastname") or "").strip()
        name = known if known and known != "-" and known.lower() != "nan" else f"{first} {last}".strip()
        if not name:
            name = str(r.get("info.name.playerjerseyname") or "").strip() or "Unknown"
        skillmoves = num(r.get("info.skillmoves"), 2)
        skillmoves_rating = clamp(15 + skillmoves * 15, 20, 90)
        detailed = {
            "physical": {
                "height": height_rating(r.get("info.height")),
                "strength": clamp(num(r.get("attributes.strength"), 55), 1, 99),
                "sprintSpeed": clamp(num(r.get("attributes.sprintspeed"), 55), 1, 99),
                "acceleration": clamp(num(r.get("attributes.acceleration"), 55), 1, 99),
                "stamina": clamp(num(r.get("attributes.stamina"), 55), 1, 99),
                "agility": clamp(num(r.get("attributes.agility"), 55), 1, 99),
                "jumping": clamp(num(r.get("attributes.jumping"), 55), 1, 99),
                "balance": clamp(num(r.get("attributes.balance"), 55), 1, 99),
            },
            "technical": {
                "vision": clamp(num(r.get("attributes.vision"), 55), 1, 99),
                "passPower": clamp((num(r.get("attributes.longpassing"),55) + num(r.get("attributes.shotpower"),55)) / 2, 1, 99),
                "shortPassing": clamp(num(r.get("attributes.shortpassing"), 55), 1, 99),
                "crossing": clamp(num(r.get("attributes.crossing"), 55), 1, 99),
                "longPassing": clamp(num(r.get("attributes.longpassing"), 55), 1, 99),
                "shotPower": clamp(num(r.get("attributes.shotpower"), 55), 1, 99),
                "headingAccuracy": clamp(num(r.get("attributes.headingaccuracy"), 55), 1, 99),
                "volleys": clamp(num(r.get("attributes.volleys"), 55), 1, 99),
                "freeKickAccuracy": clamp(num(r.get("attributes.freekickaccuracy"), 55), 1, 99),
                "curve": clamp(num(r.get("attributes.curve"), 55), 1, 99),
                "dribbling": clamp(num(r.get("attributes.dribbling"), 55), 1, 99),
                "firstTouch": clamp(num(r.get("attributes.ballcontrol"), 55), 1, 99),
                "skillMoves": skillmoves_rating,
                "finishing": clamp(num(r.get("attributes.finishing"), 55), 1, 99),
                "longShots": clamp(num(r.get("attributes.longshots"), 55), 1, 99),
                "setPieces": clamp((num(r.get("attributes.freekickaccuracy"),55)+num(r.get("attributes.curve"),55))/2,1,99),
            },
            "mentality": {
                "aggression": clamp(num(r.get("attributes.aggression"), 55), 1, 99),
                "positioning": clamp(num(r.get("attributes.positioning"), 55), 1, 99),
                "penalties": clamp(num(r.get("attributes.penalties"), 55), 1, 99),
                "composure": clamp(num(r.get("attributes.composure"), 55), 1, 99),
                "reactions": clamp(num(r.get("attributes.reactions"), 55), 1, 99),
            },
            "defending": {
                "marking": clamp(num(r.get("attributes.marking"), 55), 1, 99),
                "tackling": clamp(num(r.get("attributes.standingtackle"), 55), 1, 99),
                "slidingTackle": clamp(num(r.get("attributes.slidingtackle"), 55), 1, 99),
                "interceptions": clamp(num(r.get("attributes.interceptions"), 55), 1, 99),
                "heading": clamp(num(r.get("attributes.headingaccuracy"), 55), 1, 99),
                "positioning": clamp(num(r.get("attributes.positioning"), 55), 1, 99),
            },
            "goalkeeping": {
                "diving": clamp(num(r.get("attributes.gkdiving"), 12), 1, 99),
                "handling": clamp(num(r.get("attributes.gkhandling"), 12), 1, 99),
                "kicking": clamp(num(r.get("attributes.gkkicking"), 12), 1, 99),
                "positioning": clamp(num(r.get("attributes.gkpositioning"), 12), 1, 99),
                "reflexes": clamp(num(r.get("attributes.gkreflexes"), 12), 1, 99),
                "oneOnOnes": clamp((num(r.get("attributes.gkdiving"),12)+num(r.get("attributes.gkreflexes"),12))/2,1,99),
                "command": clamp(num(r.get("attributes.gkpositioning"),12),1,99),
            }
        }
        category_ratings = {
            "physical": round(np.mean([detailed["physical"][k] for k in ["height","strength","sprintSpeed","acceleration","stamina"]])),
            "passing": round(np.mean([detailed["technical"][k] for k in ["vision","passPower","shortPassing","crossing","longPassing"]])),
            "shooting": round(np.mean([detailed["technical"][k] for k in ["shotPower","headingAccuracy","volleys","freeKickAccuracy","curve"]])),
            "skill": round(np.mean([detailed["technical"][k] for k in ["dribbling","firstTouch","skillMoves"]])),
            "mentality": round(np.mean([detailed["mentality"][k] for k in ["aggression","positioning","penalties","composure"]])),
            "defense": round(np.mean([detailed["defending"][k] for k in ["marking","tackling","slidingTackle","interceptions"]])),
            "goalkeeping": round(np.mean([detailed["goalkeeping"][k] for k in ["diving","handling","kicking","positioning","reflexes"]])),
        }
        photo = r.get("info.headshot")
        photo = None if pd.isna(photo) or str(photo).strip() in ("", "-") else str(photo).strip()
        other_positions = [] if pd.isna(r.get("other_positions")) else [x.strip() for x in str(r.get("other_positions")).split("|") if x.strip() and x.strip() != "-"]
        traits = []
        for col in ["info.traits.trait1", "info.traits.trait2"]:
            val = r.get(col)
            if pd.notna(val) and str(val).strip() and str(val).strip() != "-":
                traits.append(str(val).strip())
        rows.append({
            "name": name,
            "team": r["team_mls"],
            "position": str(r.get("primary_position") or "CM").strip(),
            "otherPositions": other_positions,
            "age": int(num(r.get("info.age"), 24)),
            "nation": str(r.get("info.nation.name") or "Unknown"),
            "preferredFoot": str(r.get("info.preferredfoot") or "Right"),
            "height": cm_to_height(r.get("info.height")),
            "weight": kg_to_weight(r.get("info.weight")),
            "photoUrl": photo,
            "profileUrl": None,
            "overallRating": int(num(r.get("info.overallrating"), 60)),
            "potential": int(num(r.get("info.potential"), int(num(r.get("info.overallrating"), 60)))),
            "attributes": {
                "pace": int(num(r.get("card_attrs.pac"), 55)),
                "shooting": int(num(r.get("card_attrs.sho"), 55)),
                "passing": int(num(r.get("card_attrs.pas"), 55)),
                "dribbling": int(num(r.get("card_attrs.dri"), 55)),
                "defense": int(num(r.get("card_attrs.def"), 40)),
                "physical": int(num(r.get("card_attrs.phy"), 55)),
            },
            "detailed": detailed,
            "categoryRatings": category_ratings,
            "sourcePlayerId": str(int(num(r.get("info.playerid"), 0))) if num(r.get("info.playerid"), 0) else None,
            "realFace": bool(r.get("info.real_face")) if not pd.isna(r.get("info.real_face")) else False,
            "traits": traits,
            "valueUSD": int(num(r.get("info.valueUSD"), 0)),
            "wageUSD": int(num(r.get("info.wageUSD"), 0)),
            "contractEnd": str(r.get("info.contract.enddate")) if pd.notna(r.get("info.contract.enddate")) else None,
            "jerseyNumber": int(num(r.get("info.teams.club_team.jerseynumber"), 0)) if num(r.get("info.teams.club_team.jerseynumber"), 0) else None,
        })
    rows = sorted(rows, key=lambda x: (x["team"], -x["overallRating"], x["age"], x["name"]))
    meta = {
        "source": "csv-upload",
        "playerCount": len(rows),
        "clubs": sorted(set(r["team"] for r in rows)),
        "generatedAt": "2026-04-07",
        "notes": "Built from uploaded player CSV files; MLS clubs only; ratings and photos taken directly from CSV rows.",
    }
    OUT.write_text("export const REAL_MLS_DATA_META = " + json.dumps(meta, ensure_ascii=False) + ";\n\nexport const REAL_MLS_PLAYERS = " + json.dumps(rows, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"Wrote {OUT} with {len(rows)} MLS players.")

if __name__ == "__main__":
    build_dataset()
