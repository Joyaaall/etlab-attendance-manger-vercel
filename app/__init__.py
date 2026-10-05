from flask import Flask, jsonify, request
from requests.exceptions import RequestException, Timeout
from config import Config


def create_app():
    app = Flask(__name__, static_folder=None)

    app.config.from_object(Config)

    @app.after_request
    def protect_browser_responses(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.path == "/" or request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        if request.path == "/":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "font-src 'self'; img-src 'self' data:; connect-src 'self'; "
                "form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
            )
        return response

    @app.errorhandler(Timeout)
    def upstream_timeout(error):
        return jsonify({"message": "Etlab request timed out. Please try again."}), 504

    @app.errorhandler(RequestException)
    def upstream_failure(error):
        return jsonify({"message": "Unable to retrieve data from Etlab."}), 502

    from app.routes import status, login, profile, logout, attendance, timetable, present, absent
    from app.routes import frontend, portal, semesters, subject_names

    app.register_blueprint(frontend.bp)
    app.register_blueprint(portal.bp)
    app.register_blueprint(semesters.bp)
    app.register_blueprint(subject_names.bp)
    app.register_blueprint(status.bp)
    app.register_blueprint(login.bp)
    app.register_blueprint(profile.bp)
    app.register_blueprint(logout.bp)
    app.register_blueprint(attendance.bp)
    app.register_blueprint(timetable.bp)
    app.register_blueprint(present.bp)
    app.register_blueprint(absent.bp)

    return app
