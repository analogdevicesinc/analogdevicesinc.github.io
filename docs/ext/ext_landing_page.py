def setup(app):
    app.add_js_file("landing-page.umd.js", priority=500, loading_method="async")
    app.add_css_file("landing-page.min.css")

    return {
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }

