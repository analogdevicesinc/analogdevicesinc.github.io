from docutils.parsers.rst import Directive, directives
from docutils.parsers.rst.roles import set_classes
from adi_doctools.directive.node import node_div
from docutils import nodes

import re

class directive_cards(Directive):
    """
    Creates the entry-point for dynamic cards.
    """
    option_spec = {
        'class': directives.class_option,
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

        title = nodes.title(text=self.arguments[0])
        section += title
        section += content
        section += node_cards

        return [section]


class directive_cards_collection(Directive):
    """
    Creates the entry-point for dynamic collection cards.
    """
    option_spec = {
        'class': directives.class_option,
        'category': directives.unchanged_required,
        'filter-label': directives.unchanged_required
    }
    has_content = True
    add_index = True
    final_argument_whitespace = True

    required_arguments = 1
    optional_arguments = 0

    def run(self):
        set_classes(self.options)

        label = self.options.pop('filter-label', None)
        label = re.split(r'(?<!\\)[ ,]', label)
        label = [d.replace('\\ ', ' ') for d in label if d]

        section = nodes.section()
        section['ids'].append(nodes.make_id(self.arguments[0]))
        category = self.options.pop('category', None)
        classes_ = ['cards', 'collection']
        if 'classes' in self.options:
            classes_.extend(self.options.get('classes'))
        node_cards = nodes.container(
            classes=classes_
        )
        node_cards['ids'].append(",".join(label))
        content = nodes.paragraph()
        self.state.nested_parse(self.content, self.content_offset, content)

        title = nodes.title(text=self.arguments[0])
        if category is not None:
            section += nodes.inline(text=category, classes=['collection-category'])
        section += title
        section += content
        section += node_cards

        return [section]

def builder_inited(app):
    if app.builder.format == 'html':
        app.add_js_file("landing-page.umd.js", priority=500, loading_method="async")
        app.add_css_file("landing-page.min.css")

def setup(app):
    app.add_directive('cards', directive_cards)
    app.add_directive('cards-collection', directive_cards_collection)

    app.connect("builder-inited", builder_inited)

    return {
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }

