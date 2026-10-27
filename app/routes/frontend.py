import os

from flask import Blueprint, Response, render_template

bp = Blueprint("frontend", __name__)


@bp.route("/")
def index():
    # The app applies no-store and security headers to the rendered document.
    return render_template("index.html", google_site_verification=os.environ.get("GOOGLE_SITE_VERIFICATION", ""))


@bp.get("/robots.txt")
def robots():
    return Response(
        "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /apidocs/\n"
        "Disallow: /apispec_1.json\nSitemap: https://collegepono.vercel.app/sitemap.xml\n",
        mimetype="text/plain",
    )


@bp.get("/sitemap.xml")
def sitemap():
    return Response(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        '<url><loc>https://collegepono.vercel.app/</loc></url></urlset>\n',
        mimetype="application/xml",
    )
