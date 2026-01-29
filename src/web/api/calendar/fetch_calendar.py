import requests
from datetime import datetime, timedelta
import json
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from google_calendar import fetch_calendar_events, extract_bell_schedule_description, parse_schedule_description, build_event_list, get_time_range_for_day, Event
    from zoneinfo import ZoneInfo
except ImportError as e:
    print(json.dumps({"error": f"Import error: {str(e)}"}))
    sys.exit(1)

CALENDAR_ID = "mugmv777bfti0bfcp8covuqulv4fedhm@import.calendar.google.com"
API_KEY = "AIzaSyDtLRQUX6lbu0XHvu6SVEt9O15LCD249gU"

def main():
    try:
        if len(sys.argv) > 1:
            try:
                target_date = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
                print(f"Using provided date: {target_date}", file=sys.stderr)
            except ValueError:
                print(json.dumps({"error": f"Invalid date format: {sys.argv[1]}. Use YYYY-MM-DD"}))
                return
        else:
            target_date = datetime.now(ZoneInfo("America/Los_Angeles")).date()
        
        #target_date = datetime(2025, 12, 8).date()
        time_min, time_max = get_time_range_for_day(target_date)
        data = fetch_calendar_events(CALENDAR_ID, API_KEY, time_min, time_max)
        items = data.get("items", [])
        
        if not items:
            print(json.dumps({"error": f"No calendar events found for {target_date}"}))
            return
        
        description = extract_bell_schedule_description(items)
        
        if not description:
            print(json.dumps({"error": f"No bell schedule found in calendar events for {target_date}"}))
            return
            
        period_lines = parse_schedule_description(description)
        events = build_event_list(period_lines)
        
        result = {
            "date": target_date.isoformat(),
            "events": [event.to_dict() for event in events]
        }
        print(json.dumps(result))
        
    except Exception as e:
        error_msg = f"Error processing calendar data: {str(e)}"
        print(json.dumps({"error": error_msg}))
        sys.exit(1)

if __name__ == "__main__":
    main()