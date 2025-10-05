from os import pardir, path
from shutil import which
import subprocess
import threading
import inspect
import signal
import sys

from adi_doctools.cli.aux_os import aux_killpg

root_dir = path.abspath(path.dirname(__file__))
static_path = path.join(root_dir, 'docs', 'sources')
rollup_bin = path.join(root_dir, 'node_modules', '.bin', 'rollup')
rollup_conf = path.join(root_dir, 'ci', 'rollup.config.landing-page.mjs')
sass_bin = path.join(root_dir, 'node_modules', '.bin', 'sass')
sass_conf = path.join(root_dir, 'style', 'landing-page.bundle.scss') + ':' + path.join(static_path, 'landing-page.min.css')

doctools_assert_exp = path.abspath(path.join(root_dir, 'doctools'))
doctools_assert_at = path.abspath(path.join(path.dirname(inspect.getfile(aux_killpg)), pardir, pardir))

sass_shared = path.join(doctools_assert_exp, 'adi_doctools', 'theme', 'cosmic', 'style')

log = {
    'repos': "Doctools expected at '{}', but at '{}'",
    'node': "Couldn't find the node executable, please install nodejs.",
    'node_': """Couldn't find {}, please install the node_modules at doctools repo root, e.g.:
    npm install rollup \\
        @rollup/plugin-terser \\
        @rollup/plugin-alias \\
        sass \\
        --save-dev""",
}

def main():
    def symbolic_assert(file, msg):
        if not path.isfile(file):
            print(msg.format(file))
            return True
        else:
            return False

    if which("node") is None:
        print(log['node'])
        sys.exit(1)
    if symbolic_assert(rollup_bin, log['node_'].format(rollup_bin)):
        sys.exit(1)
    if doctools_assert_at != doctools_assert_exp:
        print(log['repos'].format(doctools_assert_exp, doctools_assert_at))
        sys.exit(1)

    cmd_rollup = f"{rollup_bin} -c {rollup_conf} --watch"
    cmd_sass = f"{sass_bin} --load-path {sass_shared} --style compressed --watch {sass_conf}"
    rollup_p = subprocess.Popen(cmd_rollup, shell=True, cwd=root_dir,
                                stdout=subprocess.DEVNULL)
    sass_p = subprocess.Popen(cmd_sass, shell=True, cwd=root_dir,
                              stdout=subprocess.DEVNULL)
    shutdown_event = threading.Event()

    def signal_handler(sig, frame):
        aux_killpg(rollup_p)
        aux_killpg(sass_p)
        shutdown_event.set()
        print("Terminated")
        sys.exit()

    signal.signal(signal.SIGINT, signal_handler)

    shutdown_event.wait()

if __name__ == '__main__':
    main()
