from docutils.parsers.rst import Directive, directives
from docutils.parsers.rst.roles import set_classes
from docutils import nodes
import re

from landing_cards import load_data, repositories_html, collections_html

ARROW = (
    '<svg class="view-all-icon no-background" viewBox="0 0 24 24" width="1.25em" '
    'height="1.25em" fill="none" stroke="currentColor" stroke-width="2" '
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    '<path d="M5 12h14M13 6l6 6-6 6"/></svg>'
)


def split_list(value):
    items = re.split(r'(?<!\\)[ ,]', value or '')
    return [d.replace('\\ ', ' ') for d in items if d]


def section_head(section, title, category):
    section += nodes.title(text=title)
    if category is not None:
        section += nodes.inline(text=category, classes=['collection-category'])


class directive_hero(Directive):
    required_arguments = 1
    final_argument_whitespace = True
    has_content = True
    option_spec = {
        'word': directives.unchanged_required,
    }

    def run(self):
        hero = nodes.container(classes=['hero'])
        panel = nodes.container(classes=['hero-panel'])
        inner = nodes.section(classes=['hero-inner'], ids=['hero-introduction'])
        eyebrow = nodes.container(classes=['hero-eyebrow'])
        eyebrow += nodes.inline(text='ADI')
        eyebrow += nodes.Text(' ')
        eyebrow += nodes.inline(text='Open Source')
        title = nodes.title(classes=['hero-headline'])
        title += nodes.Text(self.arguments[0] + ' ')
        title += nodes.inline(text=self.options.get('word', 'ship faster.'), classes=['hero-word'])
        inner += eyebrow
        inner += title
        content = nodes.container()
        self.state.nested_parse(self.content, self.content_offset, content)
        for child in content.children:
            child['classes'].append('hero-lead')
            inner += child
        panel += inner
        hero += panel
        return [hero]


class directive_cards(Directive):
    """
    Renders repository cards.
    """
    option_spec = {
        'class': directives.class_option,
        'category': directives.unchanged_required,
    }
    has_content = True
    add_index = True
    final_argument_whitespace = True

    required_arguments = 1
    optional_arguments = 0

    def run(self):
        set_classes(self.options)
        section = nodes.section()
        section['ids'].append(nodes.make_id(self.arguments[0]))
        classes_ = ['cards']
        if 'classes' in self.options:
            classes_.extend(self.options.get('classes'))
        node_cards = nodes.container(
            classes=classes_
        )
        content = nodes.paragraph()
        self.state.nested_parse(self.content, self.content_offset, content)

        section_head(section, self.arguments[0], self.options.get('category'))
        section += content
        if 'repositories' in classes_:
            env = self.state.document.settings.env
            tabs, cards = repositories_html(load_data(env, 'metadata.json', 'repotoc'))
            section += nodes.raw('', tabs, format='html')
            node_cards += nodes.raw('', cards, format='html')
        section += node_cards

        return [section]


class directive_cards_collection(Directive):
    """
    Renders collection cards and their tab contents.
    """
    option_spec = {
        'class': directives.class_option,
        'category': directives.unchanged_required,
        'filter-label': directives.unchanged_required,
        'tabs': directives.unchanged,
        'view-all': directives.uri,
    }
    has_content = True
    add_index = True
    final_argument_whitespace = True

    required_arguments = 1
    optional_arguments = 0

    def run(self):
        set_classes(self.options)

        label = split_list(self.options.pop('filter-label', None))
        tabs = split_list(self.options.pop('tabs', None))

        section = nodes.section()
        section['ids'].append(nodes.make_id(self.arguments[0]))
        category = self.options.pop('category', None)
        classes_ = ['cards', 'collection']
        if 'classes' in self.options:
            classes_.extend(self.options.get('classes'))
        node_cards = nodes.container(
            classes=classes_
        )
        env = self.state.document.settings.env
        tabs_html, cards_html = collections_html(
            load_data(env, 'collection.json', 'collection'), label, tabs,
        )
        node_cards += nodes.raw('', cards_html, format='html')
        if 'view-all' in self.options:
            view_all = nodes.reference(
                '', '', refuri=self.options['view-all'],
                classes=['entry', 'view-all'],
            )
            inner = nodes.inline()
            inner += nodes.inline(text='View all', classes=['title'])
            inner += nodes.raw('', ARROW, format='html')
            view_all += inner
            wrapper = nodes.paragraph(classes=['view-all-card'])
            wrapper += view_all
            node_cards += wrapper
        content = nodes.paragraph()
        self.state.nested_parse(self.content, self.content_offset, content)

        section_head(section, self.arguments[0], category)
        section += content
        if tabs_html:
            section += nodes.raw('', tabs_html, format='html')
        section += node_cards

        return [section]

class directive_section(Directive):
    """
    Creates a titled section holding arbitrary content, as a sibling of the
    cards sections, so what follows it is not nested under its title.
    """
    option_spec = {
        'class': directives.class_option,
        'category': directives.unchanged_required,
    }
    has_content = True
    final_argument_whitespace = True

    required_arguments = 1
    optional_arguments = 0

    def run(self):
        set_classes(self.options)
        section = nodes.section(classes=self.options.get('classes', []))
        section['ids'].append(nodes.make_id(self.arguments[0]))
        section_head(section, self.arguments[0], self.options.get('category'))
        self.state.nested_parse(self.content, self.content_offset, section)

        return [section]

def builder_inited(app):
    app.env.landing_data = {}
    if app.builder.format == 'html':
        app.add_js_file("custom.umd.js", priority=500, loading_method="async")
        app.add_css_file("custom.min.css")

def setup(app):
    app.add_config_value('landing_data_dir', '_data', 'env')

    app.add_directive('hero', directive_hero)
    app.add_directive('cards', directive_cards)
    app.add_directive('cards-collection', directive_cards_collection)
    app.add_directive('section', directive_section)

    app.connect("builder-inited", builder_inited)

    return {
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
