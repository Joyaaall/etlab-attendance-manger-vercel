from functools import wraps
from flask import g, jsonify, request

from app.utils.portal import PortalError, decode_session_token


def require_token_auth(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        token = request.headers.get("Authorization", "").strip()
        if token.lower().startswith("bearer"):
            parts = token.split(None, 1)
            token = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else ""
        if token:
            try:
                session = decode_session_token(token)
            except PortalError as error:
                return jsonify({"message": str(error)}), 401
            g.etlab_base_url = session.base_url
            g.etlab_cookie_name = session.cookie_name
            g.etlab_cookie_value = session.cookie_value
            g.etlab_bound_session = token.startswith("am1.")
            # Preserve the raw-cookie interface used by older route code and clients.
            request.environ["HTTP_AUTHORIZATION"] = session.cookie_value
            return func(*args, **kwargs)

        return jsonify({"message": "Token is required"}), 401

    return wrapper
