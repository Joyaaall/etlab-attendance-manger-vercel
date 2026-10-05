import csv
import io
import re

import requests
from bs4 import BeautifulSoup
from flasgger import swag_from
from flask import Blueprint, jsonify, request

from app.docs.swagger import swagger_timetable_spec
from app.utils.portal import authenticated_cookie_jar, upstream_url
from app.utils.token_required import require_token_auth
from config import Config

bp = Blueprint("timetable", __name__, url_prefix="/api")


@bp.route("/timetable", methods=["GET"])
@require_token_auth
@swag_from(swagger_timetable_spec)
def timetable():
    headers = {
        "User-Agent": Config.USER_AGENT,
    }

    response = requests.get(
        upstream_url("/student/timetable?format=csv&yt0="),
        headers=headers,
        cookies=authenticated_cookie_jar(),
        timeout=Config.REQUEST_TIMEOUT,
    )
    soup = BeautifulSoup(response.text, "html.parser")
    if "/user/login" in response.url or soup.select_one('input[name="LoginForm[username]"]') or (soup.title and "login" in soup.title.get_text().lower()):
        return jsonify({"message": "Token expired. Please login again."}), 401
    if response.status_code == 200:
        csv_data = response.text

        timetable = {}

        csv_reader = csv.reader(io.StringIO(csv_data))
        days = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}

        for row in csv_reader:
            if not row:
                continue
            day = row[0].strip().splitlines()[0].lower()
            if day not in days:
                continue
            timetable[day] = {}

            for i, period in enumerate(row[1:], start=1):
                period_name = f"period-{i}"
                parts = re.split(r"<br\s*/?>\s*\[\s*[^]]+\s*\]\s*<br\s*/?>", period, maxsplit=1, flags=re.I)
                period_data = {"name": BeautifulSoup(parts[0], "html.parser").get_text(" ", strip=True)}

                if len(parts) == 2:
                    period_data["teacher"] = BeautifulSoup(parts[1], "html.parser").get_text(" ", strip=True)

                timetable[day][period_name] = period_data

        if not timetable:
            return jsonify({"message": "Time table data not found"}), 404
        return jsonify(timetable), 200
    else:
        return jsonify({"message": "Time table data not found"}), 404
