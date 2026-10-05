import os
import secrets


def deployment_token_secret():
    configured = os.environ.get("ETLAB_TOKEN_SECRET")
    if configured:
        return configured
    if os.environ.get("VERCEL"):
        raise RuntimeError(
            "ETLAB_TOKEN_SECRET must be configured in Vercel so signed Etlab sessions work across function instances."
        )
    return secrets.token_urlsafe(48)


class Config:
    USER_AGENT = "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.95 Safari/537.36"
    BASE_URL = os.environ.get("ETLAB_BASE_URL", "https://asiet.etlab.app").rstrip("/")
    COOKIE_KEY = os.environ.get("ETLAB_COOKIE_KEY", "ASIETSESSIONID")
    REQUEST_TIMEOUT = 20
    TOKEN_SECRET = deployment_token_secret()
    TOKEN_MAX_AGE = int(os.environ.get("ETLAB_TOKEN_MAX_AGE", "43200"))
