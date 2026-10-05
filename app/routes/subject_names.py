import requests
from bs4 import BeautifulSoup
from flask import Blueprint, jsonify, request

from app.utils.portal import authenticated_cookie_jar, upstream_url
from app.utils.token_required import require_token_auth
from config import Config

bp = Blueprint("subject_names", __name__, url_prefix="/api")


def selected_value(soup, name):
    option = soup.select_one(f'select[name="{name}"] option[selected]')
    try:
        return int(option["value"]) if option else None
    except (KeyError, ValueError):
        return None


def expired(response, soup):
    return (
        "/user/login" in response.url
        or soup.select_one('input[name="LoginForm[username]"]') is not None
        or (soup.title is not None and "login" in soup.title.get_text().lower())
    )


def names_from_month(soup):
    names = {}
    for cell in soup.select('#itsthetable td.present, #itsthetable td.absent'):
        lines = cell.get_text("\n", strip=True).splitlines()
        if not lines:
            continue
        code, separator, name = lines[0].partition(" - ")
        if separator and code.strip() and name.strip():
            names.setdefault(code.strip(), name.strip())
    return names


@bp.route("/subject-names", methods=["GET"])
@require_token_auth
def subject_names():
    try:
        semester = int(request.args.get("semester", ""))
    except ValueError:
        return jsonify({"message": "Semester must be an integer from 1 to 8."}), 400
    if not 1 <= semester <= 8:
        return jsonify({"message": "Semester must be an integer from 1 to 8."}), 400

    url = upstream_url("/ktuacademics/student/attendance")
    options = {
        "headers": {"User-Agent": Config.USER_AGENT},
        "cookies": authenticated_cookie_jar(),
        # Optional enrichment stays below the production worker timeout even
        # when a different semester requires all three upstream requests.
        "timeout": min(Config.REQUEST_TIMEOUT, 8),
    }
    response = requests.get(url, **options)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    if expired(response, soup):
        return jsonify({"message": "Token expired. Please login again."}), 401
    month = selected_value(soup, "month")
    year = selected_value(soup, "year")
    if not month or not 1 <= month <= 12 or not year or not soup.select_one('#itsthetable'):
        return jsonify({"message": "Unexpected Etlab attendance page structure."}), 502

    # Use the portal's reporting months, not a guessed semester or local date.
    previous = []
    for option in soup.select('select[name="month"] option[value]'):
        try:
            value = int(option["value"])
        except ValueError:
            continue
        if 1 <= value < month:
            previous.append(value)
    months = [month] + sorted(set(previous), reverse=True)[:1]
    names = {}
    for index, reporting_month in enumerate(months):
        try:
            if index != 0 or selected_value(soup, "semester") != semester:
                response = requests.post(url, data={"semester": semester, "month": reporting_month, "year": year}, **options)
                response.raise_for_status()
                soup = BeautifulSoup(response.text, "html.parser")
            if expired(response, soup):
                return jsonify({"message": "Token expired. Please login again."}), 401
            if selected_value(soup, "semester") != semester or not soup.select_one('#itsthetable'):
                if index == 0:
                    return jsonify({"message": "Unexpected Etlab attendance page structure."}), 502
                continue
            for code, name in names_from_month(soup).items():
                names.setdefault(code, name)
        except requests.exceptions.RequestException:
            if index == 0:
                raise
            # Name enrichment is optional; retain any successfully read labels.
            break
    return jsonify({"subject_names": names}), 200
