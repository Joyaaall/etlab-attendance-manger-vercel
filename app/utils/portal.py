import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from flask import g
from itsdangerous import BadData, URLSafeTimedSerializer
from requests.cookies import RequestsCookieJar

from config import Config


_ALLOWED_SUFFIXES = (".etlab.app", ".etlab.in")
_COOKIE_EXCLUSIONS = ("csrf", "xsrf", "theme", "language", "locale")
_HOST_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


class PortalError(ValueError):
    pass


@dataclass(frozen=True)
class PortalSession:
    base_url: str
    cookie_name: str
    cookie_value: str


def normalize_portal_url(value):
    if not isinstance(value, str) or not value.strip():
        raise PortalError("Enter your college Etlab address.")
    raw = value.strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlsplit(raw)
    if parsed.scheme.lower() != "https":
        raise PortalError("Only secure HTTPS Etlab addresses are supported.")
    if parsed.username or parsed.password:
        raise PortalError("The Etlab address must not contain a username or password.")
    if parsed.query or parsed.fragment:
        raise PortalError("Remove query parameters and fragments from the Etlab address.")
    try:
        port = parsed.port
    except ValueError as error:
        raise PortalError("The Etlab address has an invalid port.") from error
    if port not in (None, 443):
        raise PortalError("Custom ports are not supported.")
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if not hostname:
        raise PortalError("Enter a valid Etlab hostname.")
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise PortalError("IP addresses are not accepted as Etlab portals.")
    labels = hostname.split(".")
    if any(not _HOST_LABEL.fullmatch(label) for label in labels):
        raise PortalError("Enter a valid Etlab hostname.")
    if not any(hostname.endswith(suffix) and hostname != suffix[1:] for suffix in _ALLOWED_SUFFIXES):
        raise PortalError("Use a college portal hosted on etlab.app or etlab.in.")
    return f"https://{hostname}"


def same_origin(url, base_url):
    try:
        parsed = urlsplit(url)
        return f"{parsed.scheme.lower()}://{parsed.hostname.lower()}" == base_url and parsed.port in (None, 443)
    except (AttributeError, ValueError):
        return False


def login_form_present(html):
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    return bool(
        soup.select_one('input[name="LoginForm[username]"]')
        and soup.select_one('input[name="LoginForm[password]"]')
    )


def detect_session_cookie(cookie_jar):
    candidates = []
    for cookie in cookie_jar:
        name = cookie.name.strip()
        lowered = name.lower()
        if not name or any(part in lowered for part in _COOKIE_EXCLUSIONS):
            continue
        score = 0
        if "session" in lowered:
            score += 3
        if lowered.endswith("sid") or lowered.endswith("sessionid"):
            score += 2
        candidates.append((score, name, cookie.value))
    if not candidates:
        raise PortalError("Etlab did not return a usable session cookie.")
    candidates.sort(key=lambda item: (-item[0], item[1]))
    if candidates[0][0] == 0 and len(candidates) > 1:
        raise PortalError("The Etlab session cookie could not be identified safely.")
    return candidates[0][1], candidates[0][2]


def _serializer():
    return URLSafeTimedSerializer(Config.TOKEN_SECRET, salt="attendance-manager-etlab-session-v1")


def encode_session_token(session):
    payload = {"v": 1, "o": session.base_url, "n": session.cookie_name, "c": session.cookie_value}
    return f"am1.{_serializer().dumps(payload)}"


def decode_session_token(token):
    if not token.startswith("am1."):
        return PortalSession(Config.BASE_URL, Config.COOKIE_KEY, token)
    try:
        payload = _serializer().loads(token[4:], max_age=Config.TOKEN_MAX_AGE)
        base_url = normalize_portal_url(payload["o"])
        cookie_name = payload["n"]
        cookie_value = payload["c"]
    except (BadData, KeyError, TypeError, PortalError) as error:
        raise PortalError("The Etlab session is invalid or has expired.") from error
    if not isinstance(cookie_name, str) or not cookie_name or not isinstance(cookie_value, str) or not cookie_value:
        raise PortalError("The Etlab session is invalid or has expired.")
    return PortalSession(base_url, cookie_name, cookie_value)


def authenticated_cookie_jar(session=None):
    bound = session is not None or getattr(g, "etlab_bound_session", False)
    session = session or PortalSession(g.etlab_base_url, g.etlab_cookie_name, g.etlab_cookie_value)
    if not bound:
        return {session.cookie_name: session.cookie_value}
    hostname = urlsplit(session.base_url).hostname
    jar = RequestsCookieJar()
    jar.set(session.cookie_name, session.cookie_value, domain=hostname, path="/", secure=True)
    return jar


def upstream_url(path):
    return f"{g.etlab_base_url}{path}"
