import os
import requests
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import json
import sys
from dotenv import load_dotenv

load_dotenv()

CURRENT_LOCATION = os.getenv("CURRENT_LOCATION", "America/Los_Angeles")

target_date = datetime.now(ZoneInfo(CURRENT_LOCATION)).date()

time_min = datetime.combine(target_date, datetime.min.time(), ZoneInfo(CURRENT_LOCATION)).isoformat()
time_max = datetime.combine(target_date + timedelta(days=1), datetime.min.time(), ZoneInfo(CURRENT_LOCATION)).isoformat()
class Event:
    def __init__(self, start_time, end_time, title):
        self.start_time = start_time
        self.end_time = end_time
        self.title = title
    def to_military(self, time_str):
        return datetime.strptime(time_str.lower(), "%I:%M%p").strftime("%H:%M")
    def getStart(self):
        return self.start_time
    def getEnd(self):
        return self.end_time
    def getRange(self):
        return (self.to_military(self.start_time), self.to_military(self.end_time))
    def getTitle(self):
        return self.title
    def __str__(self):
        return f"{self.to_military(self.start_time)} - {self.to_military(self.end_time)}      ||      {self.title}"
    def to_dict(self):
        return {
            "startTime": self.to_military(self.start_time),
            "endTime": self.to_military(self.end_time),
            "title": self.title
        }


def get_time_range_for_day(date, tz=ZoneInfo("America/Los_Angeles")):
    time_min = datetime.combine(date, datetime.min.time(), tz).isoformat()
    time_max = datetime.combine(date + timedelta(days=1), datetime.min.time(), tz).isoformat()
    return time_min, time_max

def fetch_calendar_events(calendar_id, api_key, time_min, time_max):
    try:
        url = f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
        params = {
            "key": api_key,
            "timeMin": time_min,
            "timeMax": time_max,
            "singleEvents": True,
            "orderBy": "startTime"
        }
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()  # Raises an HTTPError for bad responses
        return response.json()
    except requests.exceptions.RequestException as e:
        raise Exception(f"Failed to fetch calendar data: {str(e)}")

def extract_bell_schedule_description(events):
    for event in events:
        if "Bell" in event.get("summary", ""):
            return event.get("description", "")
    return ""

def parse_schedule_description(description):
    lines = description.split("\n")
    cleaned = [line.replace("\xa0", " ").strip() for line in lines if line.strip()]
    return [line for line in cleaned if not line.lower().startswith(("bell schedule", "date:"))]

def parse_event_line(line):
    time_part, _, title_part = line.rpartition(":")
    if time_part.count(":") > 2:
        tp, _, tipa = time_part.rpartition(":")
        time_part = tp
        title_part = tipa.replace(" ", "") + ": " + title_part.lstrip()
    title = title_part.strip()
    if "includes" in title:
        title = title.split("includes")[0].strip()
    start_time = time_part.rpartition(" - ")[0].strip()
    end_time = time_part.rpartition(" - ")[2].strip()
    if start_time and end_time:
        return Event(start_time, end_time, title)
    return None

def build_event_list(period_lines):
    events = []
    for line in period_lines:
        try:
            event = parse_event_line(line)
            if event:
                events.append(event)
        except ValueError:
            print(f"Skipping event due to time format error: {line}")
    return events





#################################### MAIN ####################################

if __name__ == "__main__":
    CURRENT_LOCATION = os.getenv("CURRENT_LOCATION")
    CALENDAR_ID = os.getenv("CALENDAR_ID")
    API_KEY = os.getenv("API_KEY")
    if not CURRENT_LOCATION:
        raise RuntimeError("CURRENT_LOCATION is not set in .env")

    target_date = datetime.now(ZoneInfo(CURRENT_LOCATION)).date()
    time_min, time_max = get_time_range_for_day(target_date, ZoneInfo(CURRENT_LOCATION))

    data = fetch_calendar_events(CALENDAR_ID, API_KEY, time_min, time_max)
    items = data.get("items", [])
    description = extract_bell_schedule_description(items)
    period_lines = parse_schedule_description(description)
    events = build_event_list(period_lines)

    events_dict = [event.to_dict() for event in events]
    print(json.dumps(events_dict))
