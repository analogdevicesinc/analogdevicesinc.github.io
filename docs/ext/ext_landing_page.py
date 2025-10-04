def setup(app):
    app.add_js_file('landing-page.js')
    app.add_css_file('landing-page.css')

    return {
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }

