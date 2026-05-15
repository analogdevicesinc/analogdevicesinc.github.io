from os import pardir, path
from shutil import which
import subprocess
import threading
import inspect
import signal
import sys
import os

from adi_doctools.cli.aux_os import aux_killpg

root_dir = path.abspath(path.dirname(__file__))
static_path = path.join(root_dir, 'docs', 'sources')
rollup_conf = path.join(root_dir, 'scripts', 'rollup.config.mjs')
sass_conf = path.join(root_dir, 'style', 'bundle.scss') + ':' + path.join(static_path, 'custom.min.css')

doctools_path = path.abspath(path.join(path.dirname(inspect.getfile(aux_killpg)), pardir, pardir))
sass_shared = path.join(doctools_path, 'adi_doctools', 'theme', 'harmonic', 'style')
node_modules = path.join(doctools_path, 'node_modules')
rollup_bin = path.join(doctools_path, 'node_modules', '.bin', 'rollup')
sass_bin = path.join(doctools_path, 'node_modules', '.bin', 'sass')

log = {
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

    node_modules_link = path.join(root_dir, 'node_modules')
    link_created = False
    if not path.exists(node_modules_link):
        os.symlink(node_modules, node_modules_link)
        link_created = True

    cmd_rollup = f"{rollup_bin} -c {rollup_conf} --watch  --environment DOCTOOLS_PATH:{doctools_path}"
    cmd_sass = f"{sass_bin} --load-path {sass_shared} --style compressed --watch {sass_conf}"
    rollup_p = subprocess.Popen(cmd_rollup, shell=True, cwd=root_dir,
                                stdout=subprocess.DEVNULL)
    sass_p = subprocess.Popen(cmd_sass, shell=True, cwd=root_dir,
                              stdout=subprocess.DEVNULL)
    shutdown_event = threading.Event()

    def signal_handler(sig, frame):
        aux_killpg(rollup_p)
        aux_killpg(sass_p)
        if link_created and path.islink(node_modules_link):
            os.unlink(node_modules_link)
        shutdown_event.set()
        print("Terminated")
        sys.exit()

    signal.signal(signal.SIGINT, signal_handler)

    shutdown_event.wait()

if __name__ == '__main__':
    main()
