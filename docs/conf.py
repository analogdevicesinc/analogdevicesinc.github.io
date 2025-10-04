from os import path
import sys
sys.path.insert(0, path.abspath('ext'))

# -- Project information -----------------------------------------------------

repository = 'analogdevicesinc.github.io'
project = 'Landing page'
copyright = '2025, Analog Devices, Inc.'
author = 'Analog Devices, Inc.'

language = 'en'

# -- General configuration ---------------------------------------------------

extensions = [
    'adi_doctools',
    'ext_landing_page',
]

needs_extensions = {
    'adi_doctools': '0.4'
}

exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']
source_suffix = '.rst'

# -- Custom extensions configuration ------------------------------------------

landing_repo = True

# -- Options for HTML output --------------------------------------------------

html_theme = 'harmonic'

html_theme_options = {}

html_static_path = ["sources"]
html_favicon = path.join("sources", "icon.svg")
