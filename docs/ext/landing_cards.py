"""Build-time card rendering shared by the landing-page directives."""

from html import escape
import json
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen

from sphinx.errors import ExtensionError

BASE = 'https://analogdevicesinc.github.io/'
CATEGORIES = {
    'system': 'System', 'hdl': 'HDL', 'driver': 'Drivers',
    'library': 'Libraries', 'tool': 'Tools', 'sdk': 'SDKs',
}
ICONS = {
    "chip": "<path fill-rule=\"evenodd\" d=\"M8 8H14L16 10V16H8V8ZM10 10H14V14H10V10Z\"/><path fill-rule=\"evenodd\" d=\"M10 20H14V22H16V20H19C19.5523 20 20 19.5523 20 19V16H22V14H20V10H22V8H20V5C20 4.44772 19.5523 4 19 4H16V2H14V4H10V2H8V4H5C4.44772 4 4 4.44772 4 5V8H2V10H4V14H2V16H4V19C4 19.5523 4.44772 20 5 20H8V22H10V20ZM18 18H6V6H18V18Z\"/>",
    "binary": "<path fill-rule=\"evenodd\" d=\"M7 6V8C7 8.55228 6.55228 9 6 9C5.44772 9 5 8.55228 5 8V6C5 5.44772 5.44772 5 6 5C6.55228 5 7 5.44772 7 6ZM3 6C3 4.34315 4.34315 3 6 3C7.65685 3 9 4.34315 9 6V8C9 9.65685 7.65685 11 6 11C4.34315 11 3 9.65685 3 8V6ZM19 6V8C19 8.55228 18.5523 9 18 9C17.4477 9 17 8.55228 17 8V6C17 5.44772 17.4477 5 18 5C18.5523 5 19 5.44772 19 6ZM15 6C15 4.34315 16.3431 3 18 3C19.6569 3 21 4.34315 21 6V8C21 9.65685 19.6569 11 18 11C16.3431 11 15 9.65685 15 8V6ZM11 3H13V11H11V3ZM19 21V13H17V21H19ZM13 18V16C13 15.4477 12.5523 15 12 15C11.4477 15 11 15.4477 11 16V18C11 18.5523 11.4477 19 12 19C12.5523 19 13 18.5523 13 18ZM12 13C10.3431 13 9 14.3431 9 16V18C9 19.6569 10.3431 21 12 21C13.6569 21 15 19.6569 15 18V16C15 14.3431 13.6569 13 12 13ZM7 13H5V21H7V13Z\"/>",
    "flow": "<path d=\"M6 21.4999C4.067 21.4999 2.5 19.9329 2.5 17.9999C2.5 16.0669 4.067 14.4999 6 14.4999C7.585 14.4999 8.924 15.5539 9.355 16.9999H15V14.9999H17V9.24186L14.757 6.99986H9V8.99986H3V2.99986H9V4.99986H14.757L18 1.75586L22.243 5.99986L19 9.24086V14.9999H21V20.9999H15V18.9999H9.355C8.925 20.4459 7.585 21.4999 6 21.4999ZM6 16.4999C5.172 16.4999 4.5 17.1719 4.5 17.9999C4.5 18.8279 5.172 19.4999 6 19.4999C6.828 19.4999 7.5 18.8279 7.5 17.9999C7.5 17.1719 6.828 16.4999 6 16.4999ZM19 16.9999H17V18.9999H19V16.9999ZM18 4.58586L16.586 5.99986L18 7.41386L19.414 5.99986L18 4.58586ZM7 4.99986H5V6.99986H7V4.99986Z\"/>",
    "stack": "<path d=\"M20.0835 15.1998L21.2856 15.9211C21.5224 16.0632 21.5991 16.3703 21.4571 16.6071C21.4148 16.6775 21.356 16.7364 21.2856 16.7786L12.5146 22.0411C12.198 22.2312 11.8023 22.2312 11.4857 22.0411L2.71475 16.7786C2.47796 16.6365 2.40118 16.3294 2.54325 16.0926C2.58548 16.0222 2.64437 15.9633 2.71475 15.9211L3.91684 15.1998L12.0002 20.0498L20.0835 15.1998ZM20.0835 10.4998L21.2856 11.2211C21.5224 11.3632 21.5991 11.6703 21.4571 11.9071C21.4148 11.9775 21.356 12.0364 21.2856 12.0786L12.0002 17.6498L2.71475 12.0786C2.47796 11.9365 2.40118 11.6294 2.54325 11.3926C2.58548 11.3222 2.64437 11.2633 2.71475 11.2211L3.91684 10.4998L12.0002 15.3498L20.0835 10.4998ZM12.5146 1.30852L21.2856 6.57108C21.5224 6.71315 21.5991 7.02028 21.4571 7.25707C21.4148 7.32745 21.356 7.38635 21.2856 7.42857L12.0002 12.9998L2.71475 7.42857C2.47796 7.2865 2.40118 6.97937 2.54325 6.74258C2.58548 6.6722 2.64437 6.61331 2.71475 6.57108L11.4857 1.30852C11.8023 1.11852 12.198 1.11852 12.5146 1.30852ZM12.0002 3.33221L5.88747 6.99983L12.0002 10.6675L18.1129 6.99983L12.0002 3.33221Z\"/>",
    "tools": "<path d=\"M5.32943 3.27158C6.56252 2.8332 7.9923 3.10749 8.97927 4.09446C9.96652 5.08171 10.2407 6.51202 9.80178 7.74535L20.6465 18.5902L18.5252 20.7115L7.67936 9.86709C6.44627 10.3055 5.01649 10.0312 4.02952 9.04421C3.04227 8.05696 2.7681 6.62665 3.20701 5.39332L5.44373 7.63C6.02952 8.21578 6.97927 8.21578 7.56505 7.63C8.15084 7.04421 8.15084 6.09446 7.56505 5.50868L5.32943 3.27158ZM15.6968 5.15512L18.8788 3.38736L20.293 4.80157L18.5252 7.98355L16.7574 8.3371L14.6361 10.4584L13.2219 9.04421L15.3432 6.92289L15.6968 5.15512ZM8.62572 12.9333L10.747 15.0546L5.79729 20.0044C5.2115 20.5902 4.26175 20.5902 3.67597 20.0044C3.12464 19.453 3.09221 18.5793 3.57867 17.99L3.67597 17.883L8.62572 12.9333Z\"/>"
}
CATEGORY_ICON = {
    'system': 'flow', 'hdl': 'binary', 'driver': 'chip',
    'library': 'chip', 'tool': 'tools', 'sdk': 'stack',
}


def href(value):
    return escape(urljoin(BASE, value), quote=True)


def plural(label):
    return CATEGORIES.get(label, label.capitalize() + 's')


def load_data(env, filename, key):
    """Prefer workflow-downloaded snapshots; fetch once per local build otherwise."""
    path = Path(env.srcdir) / env.config.landing_data_dir / filename
    env.note_dependency(str(path))
    if filename not in env.landing_data:
        remote = {'metadata.json': 'doctools/metadata.json',
                  'collection.json': 'system-level/collection.json'}[filename]
        try:
            if path.is_file():
                data = json.loads(path.read_text(encoding='utf-8'))
            else:
                with urlopen(urljoin(BASE, remote), timeout=30) as response:
                    data = json.load(response)
            if not isinstance(data[key], dict):
                raise ValueError(f'{key} must be an object')
            env.landing_data[filename] = data[key]
        except (OSError, ValueError, KeyError) as exc:
            raise ExtensionError(f'Cannot load landing-page {filename}: {exc}') from exc
    return env.landing_data[filename]


def tabs_html(items, active):
    buttons = ''.join(
        f'<button type="button" role="tab" data-filter="{escape(value)}" '
        f'aria-selected="{str(value == active).lower()}">{escape(label)}</button>'
        for value, label in items
    )
    return f'<div class="tabs" role="tablist">{buttons}</div>'


def repositories_html(repotoc):
    repos = [(key, value) for key, value in repotoc.items()
             if value.get('visibility') != 'hidden']
    present = {value['category'] for _, value in repos}
    tabs = tabs_html([('', 'All')] + [
        (key, label) for key, label in CATEGORIES.items() if key in present
    ], '')
    cards = []
    for key, value in repos:
        category = value['category']
        icon = ICONS[CATEGORY_ICON.get(category, 'flow')]
        cards.append(
            f'<a class="entry" href="{href(key + "/")}" data-category="{escape(category)}">'
            f'<span><span class="head"><span class="icon" data-category="{escape(category)}" '
            f'aria-hidden="true"><svg class="no-background" viewBox="0 0 24 24" '
            f'width="24" height="24" fill="currentColor">{icon}</svg></span>'
            f'<span class="tag">{escape(plural(category))}</span></span>'
            f'<span class="title">{escape(value["name"])}</span>'
            f'<span class="subtitle">{escape(value.get("description", ""))}</span></span></a>'
        )
    return tabs, ''.join(cards)


def placeholder(name):
    """Static SVG equivalent of the seeded canvas artwork."""
    state = 2166136261
    for char in name:
        state = ((state ^ ord(char)) * 16777619) & 0xffffffff

    def rand():
        nonlocal state
        state = (state + 0x6d2b79f5) & 0xffffffff
        t = ((state ^ (state >> 15)) * (1 | state)) & 0xffffffff
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xffffffff)) ^ t) & 0xffffffff
        return ((t ^ (t >> 14)) & 0xffffffff) / 4294967296

    def clamp(value, low=0, high=1):
        return min(high, max(low, value))

    palette = ['#0067B9', '#8E3DC7', '#0E6D95', '#16744D', '#AE4410', '#C81A28']
    color = palette[int(rand() * len(palette))]
    blobs = [(rand() * 480, rand() * 270, 40 + 70 * rand())
             for _ in range(3 + int(rand() * 3))]
    rects = []
    for row in range(9):
        y = (row + 0.5) * 30
        for column in range(16):
            x = (column + 0.5) * 30
            field = sum(r * r / ((x - bx)**2 + (y - by)**2 + 1)
                        for bx, by, r in blobs)
            value = clamp((field - 0.35) * 0.8 + (rand() - 0.5) * 0.15)
            if value <= 0.08:
                continue
            size = 4 + 14 * value
            alpha = clamp((0.08 + 0.42 * value) * (0.5 + 0.8 * rand()), 0.05, 0.6)
            rects.append(f'<rect x="{x-size/2:.2f}" y="{y-size/2:.2f}" '
                         f'width="{size:.2f}" height="{size:.2f}" opacity="{alpha:.3f}"/>')
    return (f'<svg class="placeholder" aria-hidden="true" viewBox="0 0 480 270" '
            f'style="--placeholder:{color}" fill="{color}">{"".join(rects)}</svg>')


def collection_card(name, value, filters, visible):
    image = (f'<img src="{href(value["image"])}" loading="lazy" alt="">'
             if value.get('image') else placeholder(name))
    description = (f'<hr><div class="description">{escape(value["description"])}</div>'
                   if value.get('description') else '')
    return (
        f'<a class="entry" href="{href(value["docname"] + ".html")}" '
        f'data-filters="{escape(json.dumps(filters))}"{"" if visible else " hidden"}>'
        f'<span><div class="img-container">{image}</div>'
        f'<div class="title">{escape(name)}</div>'
        f'<div class="subtitle">{escape(value.get("subtitle") or "")}</div>'
        f'{description}<span class="spacer"></span></span></a>'
    )


def collections_html(collection, labels, tabs):
    def matching(filters):
        return [(key, value) for key, value in collection.items()
                if all(label in value.get('label', []) for label in filters)][:5]

    initial = matching(labels)
    groups = {label: matching([label]) for label in tabs}
    groups = {label: entries for label, entries in groups.items() if entries}
    initial_keys = {key for key, _ in initial}
    memberships = {}
    for label, entries in groups.items():
        for key, _ in entries:
            memberships.setdefault(key, []).append(label)
    cards = ''.join(
        collection_card(key, value, memberships.get(key, []), key in initial_keys)
        for key, value in collection.items()
        if key in initial_keys or key in memberships
    )
    active = labels[0] if labels else ''
    tabs = tabs_html([(label, plural(label)) for label in groups], active) if groups else ''
    return tabs, cards
