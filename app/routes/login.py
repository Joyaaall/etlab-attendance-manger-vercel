import requests
from bs4 import BeautifulSoup
from flasgger import swag_from
from flask import Blueprint, jsonify, request

from app.docs.swagger import swagger_login_spec
from app.utils.portal import (
    PortalError,
    PortalSession,
    detect_session_cookie,
    encode_session_token,
    login_form_present,
    normalize_portal_url,
    same_origin,
)
from config import Config

bp = Blueprint("login", __name__, url_prefix="/api")


@bp.route("/login", methods=["POST"])
@swag_from(swagger_login_spec)
def login():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"message": "A JSON object with username and password is required"}), 400
    username = body.get("username")
    password = body.get("password")

    try:
        base_url = normalize_portal_url(body.get("portal_url", Config.BASE_URL))
    except PortalError as error:
        return jsonify({"message": str(error)}), 400

    if not username or not password:
        return jsonify({"message": "Username and password is required"}), 401

    payload = {
        "LoginForm[username]": username,
        "LoginForm[password]": password,
        "yt0": "",
    }

    headers = {
        "User-Agent": Config.USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
    }

    session = requests.Session()
    try:
        login_page = session.get(
            f"{base_url}/user/login", headers=headers, timeout=Config.REQUEST_TIMEOUT,
            allow_redirects=False,
        )
        login_page.raise_for_status()
        if not same_origin(login_page.url, base_url) or not login_form_present(login_page.text):
            return jsonify({"message": "This address does not appear to be a supported Etlab student portal."}), 422
        form = BeautifulSoup(login_page.text, "html.parser")
        for field in form.select('input[type="hidden"][name]'):
            payload[field["name"]] = field.get("value", "")
        response = session.post(
            f"{base_url}/user/login", data=payload, headers=headers,
            timeout=Config.REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        if not same_origin(response.url, base_url):
            return jsonify({"message": "Etlab redirected the login to an unsupported address."}), 502
        try:
            cookie_name, cookie = detect_session_cookie(session.cookies)
        except PortalError:
            cookie_name, cookie = None, None
    finally:
        session.close()
    soup = BeautifulSoup(response.text, "html.parser")
    if "/user/login" in response.url or soup.select_one('input[name="LoginForm[username]"]') or (soup.title and "login" in soup.title.get_text().lower()):
        return jsonify({"message": "Invalid username or password"}), 401
    if not cookie:
        return jsonify({"message": "Etlab did not return a session cookie"}), 502

    token = encode_session_token(PortalSession(base_url, cookie_name, cookie))
    return jsonify({"message": "Login successful", "token": token, "portal_url": base_url}), 200
