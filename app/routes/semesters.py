import requests
from bs4 import BeautifulSoup
from flasgger import swag_from
from flask import Blueprint, jsonify, request

from app.utils.portal import authenticated_cookie_jar, upstream_url
from app.utils.token_required import require_token_auth
from config import Config

bp = Blueprint("semesters", __name__, url_prefix="/api")


@bp.route("/semesters", methods=["GET"])
@require_token_auth
@swag_from({
    "parameters": [{"name": "Authorization", "in": "header", "type": "string", "required": True}],
    "responses": {200: {"description": "Current and available semester identifiers"},
                  401: {"description": "Missing or expired Etlab session"},
                  502: {"description": "Unexpected upstream page or unavailable Etlab"}},
})
def semesters():
    response = requests.get(
        upstream_url("/ktuacademics/student/attendance"),
        headers={"User-Agent": Config.USER_AGENT},
        cookies=authenticated_cookie_jar(),
        timeout=Config.REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    if (
        "/user/login" in response.url
        or soup.select_one('input[name="LoginForm[username]"]')
        or (soup.title and "login" in soup.title.get_text().lower())
    ):
        return jsonify({"message": "Token expired. Please login again."}), 401
    select = soup.select_one('select[name="semester"]')
    if select is None:
        return jsonify({"message": "Unable to discover Etlab semesters. Please select one manually."}), 502
    options = []
    current = None
    for option in select.select("option[value]"):
        try:
            value = int(option["value"])
        except (TypeError, ValueError):
            continue
        if not 1 <= value <= 8:
            continue
        options.append({"value": value, "label": option.get_text(strip=True)})
        if option.has_attr("selected"):
            current = value
    if not options:
        return jsonify({"message": "No supported semesters were found in Etlab."}), 502
    return jsonify({"current": current, "semesters": options}), 200
