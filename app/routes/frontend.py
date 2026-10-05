from flask import Blueprint, render_template

bp = Blueprint("frontend", __name__)


@bp.route("/")
def index():
    # The app applies no-store and security headers to the rendered document.
    return render_template("index.html")
