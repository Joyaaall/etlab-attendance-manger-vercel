import requests
from flask import Blueprint, jsonify, request

from app.utils.portal import PortalError, login_form_present, normalize_portal_url, same_origin
from config import Config

bp = Blueprint("portal", __name__, url_prefix="/api/portal")


@bp.route("/check", methods=["POST"])
def check_portal():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"message": "A college Etlab address is required."}), 400
    try:
        base_url = normalize_portal_url(body.get("portal_url"))
    except PortalError as error:
        return jsonify({"message": str(error)}), 400

    response = requests.get(
        f"{base_url}/user/login",
        headers={"User-Agent": Config.USER_AGENT},
        timeout=Config.REQUEST_TIMEOUT,
        allow_redirects=False,
    )
    response.raise_for_status()
    if not same_origin(response.url, base_url) or not login_form_present(response.text):
        return jsonify({"message": "This address does not appear to be a supported Etlab student portal."}), 422
    return jsonify({"portal_url": base_url, "hostname": base_url.removeprefix("https://")}), 200
