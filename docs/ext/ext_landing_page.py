from docutils.parsers.rst import Directive, directives
from docutils.parsers.rst.roles import set_classes
from adi_doctools.directive.node import node_div
from docutils import nodes

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

def setup(app):
    app.add_directive('cards', directive_cards)

    app.add_js_file("landing-page.umd.js", priority=500, loading_method="async")
    app.add_css_file("landing-page.min.css")

    return {
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }

