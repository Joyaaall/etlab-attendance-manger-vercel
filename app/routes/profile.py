import requests
from bs4 import BeautifulSoup
from flasgger import swag_from
from flask import Blueprint, jsonify, request

from app.docs.swagger import swagger_profile_spec
from app.utils.portal import authenticated_cookie_jar, upstream_url
from app.utils.token_required import require_token_auth
from config import Config

bp = Blueprint("profile", __name__, url_prefix="/api")


@bp.route("/profile", methods=["GET"])
@require_token_auth
@swag_from(swagger_profile_spec)
def profile():
    headers = {
        "User-Agent": Config.USER_AGENT,
    }
    response = requests.get(
        upstream_url("/student/profile"),
        headers=headers,
        cookies=authenticated_cookie_jar(),
        timeout=Config.REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    if "/user/login" in response.url or soup.select_one('input[name="LoginForm[username]"]') or (soup.title and "login" in soup.title.get_text().lower()):
        return jsonify({"message": "Token expired. Please login again."}), 401

    labels = ["Name", "Date of Birth", "Admission No", "University Reg No"]
    if any(not soup.find("th", string=label) or not soup.find("th", string=label).find_next("td") for label in labels):
        return jsonify({"message": "Unexpected Etlab profile page structure."}), 502
    name = soup.find("th", string="Name").find_next("td").get_text(strip=True)
    dob = soup.find("th", string="Date of Birth").find_next("td").get_text(strip=True)
    admission_no = (
        soup.find("th", string="Admission No").find_next("td").get_text(strip=True)
    )
    university_roll_no = (
        soup.find("th", string="University Reg No").find_next("td").get_text(strip=True)
    )

    json_repsonse = {
        "name": name,
        "dob": dob,
        "admission_no": admission_no,
        "university_roll_no": university_roll_no,
    }
    return (
        jsonify(
            {"message": "Successfully fetched data", "profile_details": json_repsonse}
        ),
        200,
    )
