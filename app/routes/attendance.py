import re

import requests
from bs4 import BeautifulSoup
from flasgger import swag_from
from flask import Blueprint, jsonify, request

from app.docs.swagger import swagger_attendance_spec
from app.utils.portal import authenticated_cookie_jar, upstream_url
from app.utils.token_required import require_token_auth
from config import Config

bp = Blueprint("attendance", __name__, url_prefix="/api")


@bp.route("/attendance", methods=["GET"])
@swag_from(swagger_attendance_spec)
@require_token_auth
def attendance():
    semester = request.args.get("semester")
    if not semester:
        return jsonify({"message": "Semester required"}), 400

    try:
        semester = int(semester)
    except ValueError:
        return jsonify({"message": "Semester should be a valid integer"}), 400

    if not (semester >= 1 and semester <= 8):
        return (
            jsonify(
                {"message": "Invalid semester. Semester has to be between 1 and 8"}
            ),
            400,
        )

    headers = {
        "User-Agent": Config.USER_AGENT,
    }
    response = requests.get(
        upstream_url(f"/ktuacademics/student/viewattendancesubjectdutyleave/{semester}"),
        headers=headers,
        cookies=authenticated_cookie_jar(),
        timeout=Config.REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    if "/user/login" in response.url or soup.select_one('input[name="LoginForm[username]"]') or (soup.title and "login" in soup.title.get_text().lower()):
        return jsonify({"message": "Token expired. Please login again."}), 401

    response_body = {}
    table = soup.find("table", class_="items")
    if not table:
        return jsonify({"message": "Unexpected Etlab attendance page structure."}), 502
    table_headers = table.find_all("th")
    table_data = table.find_all("td")
    if len(table_data) < 5 or len(table_headers) != len(table_data):
        return jsonify({"message": "Attendance data not available for this semester."}), 404

    response_body["university_reg_no"] = table_data[0].text
    response_body["roll_no"] = table_data[1].text
    response_body["name"] = table_data[2].text

    summary_headers = {"total", "duty leave", "percentage", "duty leave percentage"}
    header_names = [header.get_text(" ", strip=True).lower() for header in table_headers]
    subject_indexes = [
        i for i in range(3, len(table_data)) if header_names[i] not in summary_headers
    ]

    for i in subject_indexes:
        subject_code = table_headers[i].text.strip()
        attendance_str = table_data[i].text.strip()
        attendance_match = re.search(
            r"(\d+)\s*/\s*(\d+)\s*\(\s*([^)]*%?)\s*\)", attendance_str
        )
        if not attendance_match:
            return jsonify({"message": "Unexpected Etlab attendance page structure."}), 502
        present_hours, total_hours, attendance_percentage = (
            value.strip() for value in attendance_match.groups()
        )

        subject_attendance = {}
        subject_attendance["present_hours"] = present_hours
        subject_attendance["total_hours"] = total_hours
        subject_attendance["attendance_percentage"] = attendance_percentage

        # Some portal versions carry full names in header tooltips.
        header = table_headers[i]
        labelled = header if header.get("title") else header.select_one("[title]")
        label = labelled.get("title", "").strip() if labelled else ""
        prefix = f"{subject_code} - "
        if label.startswith(prefix):
            label = label[len(prefix):].strip()
        if label and label != subject_code:
            subject_attendance["subject_name"] = label

        response_body[subject_code] = subject_attendance

    try:
        total_index = header_names.index("total")
        percentage_index = header_names.index("percentage")
    except ValueError:
        return jsonify({"message": "Unexpected Etlab attendance page structure."}), 502

    total_match = re.search(r"(\d+)\s*/\s*(\d+)", table_data[total_index].get_text(" ", strip=True))
    if not total_match:
        return jsonify({"message": "Unexpected Etlab attendance page structure."}), 502
    total_present, total_hours = total_match.groups()

    duty_leave_hours = "0"
    if "duty leave" in header_names:
        duty_leave_index = header_names.index("duty leave")
        duty_leave_match = re.search(r"\d+", table_data[duty_leave_index].get_text(" ", strip=True))
        if duty_leave_match:
            duty_leave_hours = duty_leave_match.group()
        total_present = str(min(int(total_hours), int(total_present) + int(duty_leave_hours)))

    adjusted_percentage_index = (
        header_names.index("duty leave percentage")
        if "duty leave percentage" in header_names
        else percentage_index
    )
    response_body["total_present_hours"] = total_present
    response_body["total_hours"] = total_hours
    response_body["total_percentage"] = table_data[adjusted_percentage_index].get_text(strip=True)
    response_body["duty_leave_hours"] = duty_leave_hours
    response_body["total_perecentage"] = response_body["total_percentage"]

    return jsonify(response_body), 200
