"""SQLite storage for doctors, slots and appointments.

Everything the agent's tools and the dashboard's REST API need lives here, so
both sides read and write the same rows. Slots are generated relative to
today on first run, which keeps the demo data fresh whenever it is reset.
"""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterator

DB_PATH = Path(os.getenv("DB_PATH", Path(__file__).parent / "clinic.db"))

DOCTORS = [
    # id, name, specialty, room, working weekdays (Mon=0), slot times
    ("d1", "Dr. Ananya Rao", "General Physician", "Room 2", [0, 1, 2, 3, 4], ["09:30", "10:00", "10:30", "11:00", "16:00", "16:30"]),
    ("d2", "Dr. Vikram Mehta", "Cardiologist", "Room 5", [0, 2, 4], ["10:00", "11:00", "12:00", "15:00"]),
    ("d3", "Dr. Sara Iqbal", "Dermatologist", "Room 3", [1, 3, 5], ["11:00", "11:30", "12:00", "17:00", "17:30"]),
    ("d4", "Dr. Rohan Das", "Paediatrician", "Room 1", [0, 1, 3, 4, 5], ["09:00", "09:30", "10:00", "14:00", "14:30"]),
    ("d5", "Dr. Meera Krishnan", "Orthopaedic Surgeon", "Room 6", [1, 2, 4], ["13:00", "13:30", "14:00", "18:00"]),
]

DAYS_AHEAD = 7

SCHEMA = """
CREATE TABLE IF NOT EXISTS doctors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    room TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id TEXT NOT NULL REFERENCES doctors(id),
    starts_at TEXT NOT NULL,              -- 'YYYY-MM-DDTHH:MM', clinic local time
    booked INTEGER NOT NULL DEFAULT 0,
    UNIQUE (doctor_id, starts_at)
);
CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id INTEGER NOT NULL REFERENCES slots(id),
    patient_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'booked', -- 'booked' | 'cancelled'
    created_at TEXT NOT NULL,
    cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appt_phone ON appointments(phone);
"""


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init(reset: bool = False) -> None:
    if reset and DB_PATH.exists():
        DB_PATH.unlink()
    with connect() as c:
        c.executescript(SCHEMA)
        if c.execute("SELECT COUNT(*) FROM doctors").fetchone()[0]:
            return
        today = date.today()
        for doc_id, name, specialty, room, weekdays, times in DOCTORS:
            c.execute("INSERT INTO doctors VALUES (?, ?, ?, ?)", (doc_id, name, specialty, room))
            for offset in range(DAYS_AHEAD):
                day = today + timedelta(days=offset)
                if day.weekday() not in weekdays:
                    continue
                for t in times:
                    c.execute(
                        "INSERT INTO slots (doctor_id, starts_at) VALUES (?, ?)",
                        (doc_id, f"{day.isoformat()}T{t}"),
                    )


# ---------------------------------------------------------------- helpers


def normalize_phone(raw: str) -> str | None:
    """Reduce a spoken/typed number to 10 digits, dropping a +91 / 0 prefix."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower().replace("dr.", "").replace("doctor", ""))


# Lay terms callers actually use -> specialty.
SYNONYMS = {
    "skin": "dermatolog", "rash": "dermatolog", "acne": "dermatolog",
    "heart": "cardio", "chest": "cardio", "bloodpressure": "cardio",
    "child": "paediatric", "kid": "paediatric", "baby": "paediatric", "pediatric": "paediatric",
    "bone": "orthopaedic", "joint": "orthopaedic", "knee": "orthopaedic", "back": "orthopaedic", "orthopedic": "orthopaedic",
    "general": "generalphysician", "fever": "generalphysician", "gp": "generalphysician", "familydoctor": "generalphysician",
}


def find_doctors(query: str | None) -> list[sqlite3.Row]:
    """Match a doctor by (partial) name or specialty. Empty query -> all."""
    with connect() as c:
        rows = c.execute("SELECT * FROM doctors ORDER BY id").fetchall()
    if not query:
        return rows
    q = _norm(query)
    for word, target in SYNONYMS.items():
        if word in q:
            q = target
            break
    hits = [r for r in rows if q and (q in _norm(r["name"]) or q in _norm(r["specialty"]))]
    if hits:
        return hits
    # Fall back to any single word match ("Mehta", "skin" won't match, but "cardio" will).
    words = [w for w in re.split(r"\s+", query.lower()) if len(w) > 2 and w not in {"doctor", "dr."}]
    return [r for r in rows if any(_norm(w) in _norm(r["name"] + r["specialty"]) for w in words)]


def _slot_dict(r: sqlite3.Row) -> dict:
    dt = datetime.fromisoformat(r["starts_at"])
    return {
        "slot_id": r["id"],
        "date": dt.date().isoformat(),
        "time": dt.strftime("%H:%M"),
        "spoken": dt.strftime("%A %d %B, %I:%M %p").replace(" 0", " "),
    }


# ---------------------------------------------------------------- tool logic


def availability(doctor: str | None = None, on_date: str | None = None, limit_per_doctor: int = 8) -> dict:
    doctors = find_doctors(doctor)
    if not doctors:
        return {"error": f"No doctor or specialty matches '{doctor}'.", "doctors": [dict(d) for d in find_doctors(None)]}
    now = datetime.now().strftime("%Y-%m-%dT%H:%M")
    out = []
    with connect() as c:
        for d in doctors:
            sql = "SELECT * FROM slots WHERE doctor_id = ? AND booked = 0 AND starts_at > ?"
            args: list = [d["id"], now]
            if on_date:
                sql += " AND substr(starts_at, 1, 10) = ?"
                args.append(on_date)
            rows = c.execute(sql + " ORDER BY starts_at LIMIT ?", (*args, limit_per_doctor)).fetchall()
            out.append({
                "doctor_id": d["id"],
                "doctor": d["name"],
                "specialty": d["specialty"],
                "open_slots": [_slot_dict(r) for r in rows],
            })
    return {"date_filter": on_date, "results": out}


def book(slot_id: int, patient_name: str, phone: str) -> dict:
    number = normalize_phone(phone)
    if not number:
        return {"error": "Phone number must have 10 digits. Ask the caller to repeat it."}
    with connect() as c:
        slot = c.execute(
            "SELECT s.*, d.name AS doctor, d.specialty, d.room FROM slots s JOIN doctors d ON d.id = s.doctor_id WHERE s.id = ?",
            (slot_id,),
        ).fetchone()
        if not slot:
            return {"error": f"Slot {slot_id} does not exist. Check availability again."}
        if slot["booked"]:
            return {"error": "That slot was just taken. Offer the caller another time."}
        c.execute("UPDATE slots SET booked = 1 WHERE id = ?", (slot_id,))
        cur = c.execute(
            "INSERT INTO appointments (slot_id, patient_name, phone, created_at) VALUES (?, ?, ?, ?)",
            (slot_id, patient_name.strip() or "Caller", number, _now()),
        )
        appt_id = cur.lastrowid
    return {"ok": True, "appointment": get_appointment(appt_id)}


def appointments_for_phone(phone: str) -> list[dict]:
    number = normalize_phone(phone)
    if not number:
        return []
    now = datetime.now().strftime("%Y-%m-%dT%H:%M")
    return [
        a for a in list_appointments() if a["phone"] == number and a["status"] == "booked" and a["starts_at"] > now
    ]


def cancel(phone: str, appointment_id: int | None = None) -> dict:
    number = normalize_phone(phone)
    if not number:
        return {"error": "Phone number must have 10 digits. Ask the caller to repeat it."}
    active = appointments_for_phone(number)
    if not active:
        return {"error": f"No upcoming appointment found for {number}."}
    if appointment_id is None:
        if len(active) > 1:
            return {
                "needs_choice": True,
                "message": "This number has several appointments. Ask which one to cancel, then call again with appointment_id.",
                "appointments": active,
            }
        target = active[0]
    else:
        target = next((a for a in active if a["id"] == appointment_id), None)
        if not target:
            return {"error": "That appointment does not belong to this number.", "appointments": active}
    with connect() as c:
        c.execute("UPDATE appointments SET status = 'cancelled', cancelled_at = ? WHERE id = ?", (_now(), target["id"]))
        c.execute("UPDATE slots SET booked = 0 WHERE id = ?", (target["slot_id"],))
    return {"ok": True, "appointment": get_appointment(target["id"])}


# ---------------------------------------------------------------- dashboard reads

_APPT_SQL = """
SELECT a.*, s.starts_at, s.doctor_id, d.name AS doctor, d.specialty, d.room
FROM appointments a JOIN slots s ON s.id = a.slot_id JOIN doctors d ON d.id = s.doctor_id
"""


def _appt_dict(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["spoken"] = _slot_dict({"id": r["slot_id"], "starts_at": r["starts_at"]})["spoken"]  # type: ignore[arg-type]
    return d


def get_appointment(appt_id: int) -> dict:
    with connect() as c:
        return _appt_dict(c.execute(_APPT_SQL + " WHERE a.id = ?", (appt_id,)).fetchone())


def list_appointments() -> list[dict]:
    with connect() as c:
        rows = c.execute(_APPT_SQL + " ORDER BY s.starts_at").fetchall()
    return [_appt_dict(r) for r in rows]


def schedule() -> list[dict]:
    """Doctors with every slot (open and booked) for the dashboard grid."""
    with connect() as c:
        doctors = c.execute("SELECT * FROM doctors ORDER BY id").fetchall()
        slots = c.execute("SELECT * FROM slots ORDER BY starts_at").fetchall()
    by_doc: dict[str, list] = {}
    for s in slots:
        by_doc.setdefault(s["doctor_id"], []).append({"id": s["id"], "starts_at": s["starts_at"], "booked": bool(s["booked"])})
    return [dict(d) | {"slots": by_doc.get(d["id"], [])} for d in doctors]


def roster_text() -> str:
    lines = []
    for doc_id, name, specialty, _room, weekdays, _times in DOCTORS:
        days = ", ".join(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][w] for w in weekdays)
        lines.append(f"- {name}, {specialty} ({days})")
    return "\n".join(lines)
