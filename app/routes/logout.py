import requests
from bs4 import BeautifulSoup
from flasgger import swag_from
from flask import Blueprint, jsonify, request

from app.docs.swagger import swagger_logout_spec
from app.utils.portal import authenticated_cookie_jar, upstream_url
from app.utils.token_required import require_token_auth
from config import Config

bp = Blueprint("logout", __name__, url_prefix="/api")


@bp.route("/logout", methods=["GET"])
@require_token_auth
@swag_from(swagger_logout_spec)
def logout():
    headers = {
        "User-Agent": Config.USER_AGENT,
    }
    response = requests.get(
        upstream_url("/user/logout"),
        headers=headers,
        cookies=authenticated_cookie_jar(),
        timeout=Config.REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    if "/user/login" in response.url or soup.select_one('input[name="LoginForm[username]"]') or (soup.title and "login" in soup.title.get_text().lower()):
        return (
            jsonify({"message": "Logged out successfully"}),
            200,
        )
    return (
        jsonify({"message": "Error logging out"}),
        500,
    )
