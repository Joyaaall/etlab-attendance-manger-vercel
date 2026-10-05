import requests
from bs4 import BeautifulSoup
from flasgger import swag_from
from flask import Blueprint, jsonify, request

from app.docs.swagger import swagger_present_spec
from app.utils.portal import authenticated_cookie_jar, upstream_url
from app.utils.token_required import require_token_auth
from config import Config

bp = Blueprint("present", __name__, url_prefix="/api")


@bp.route("/present", methods=["GET"])
@require_token_auth
@swag_from(swagger_present_spec)
def present():
    try:
        month = int(request.args.get("month"))
        semester = int(request.args.get("semester"))
        year = int(request.args.get("year"))
    except (ValueError, TypeError):
        return jsonify({"message": "Invalid parameters"}), 400

    if not (month >= 1 and month <= 12):
        return jsonify({"message": "Invalid month"}), 400

    if not (semester >= 1 and semester <= 8):
        return jsonify({"message": "Invalid semester"}), 400

    headers = {
        "User-Agent": Config.USER_AGENT,
    }


    payload = {
        "month": month,
        "semester": semester,
        "year": year,
    }
    response = requests.post(
        upstream_url("/ktuacademics/student/attendance"),
        headers=headers,
        cookies=authenticated_cookie_jar(),
        data=payload,
        timeout=Config.REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    if "/user/login" in response.url or soup.select_one('input[name="LoginForm[username]"]') or (soup.title and "login" in soup.title.get_text().lower()):
        return jsonify({"message": "Token expired. Please login again."}), 401

    try:
        semester_element = soup.find("select", {"name": "semester"}).find(
            "option", {"selected": "selected"}
        )
        semester = semester_element.get_text(strip=True).lower()
        semester_num = semester_element["value"]

        month_element = soup.find("select", {"name": "month"}).find(
            "option", {"selected": "selected"}
        )
        month = month_element.get_text(strip=True).lower()
        month_num = month_element["value"]
        year = (
            soup.find("select", {"name": "year"})
            .find("option", {"selected": "selected"})
            .text
        ).strip()

        present_hours_data = []

        table = soup.find("table", {"id": "itsthetable"})

        rows = table.select("tbody tr")
        for row in rows:
            day = row.find("th").text.strip()
            cols = row.find_all("td")

            if len(cols) == 1:
                continue

            for hour, col in enumerate(cols, start=1):
                if "present" in (col.get("class") or []):
                    present_hour_data = {}
                    suffixes = ["st", "nd", "rd", "th"]
                    if day.endswith(tuple(suffixes)):
                        day = day[:-2]
                    present_hour_data["day"] = int(day)
                    present_hour_data["hour"] = hour
                    subject = col.get_text("\n", strip=True).splitlines()[0]
                    code, separator, name = subject.partition(" - ")
                    present_hour_data["subject_code"] = code.strip()
                    present_hour_data["subject_name"] = name.strip() if separator else ""
                    present_hours_data.append(present_hour_data)

        respone_dict = {
            "month": month,
            "month_num": month_num,
            "semester": semester,
            "semester_num": semester_num,
            "year": year,
            "present_hours": present_hours_data,
        }
        return (
            jsonify({"message": "Successfully fetched data", "data": respone_dict}),
            200,
        )
    except (AttributeError, IndexError, TypeError, ValueError):
        return jsonify({"message": "Unexpected Etlab attendance page structure."}), 502
