# analogdevicesinc.github.io

## Development

Development mode allows to edit the source code and apply the changes in watch
mode.

### Install doctools

With `doctools` cloned alongside this repository, do a symbolic install
```
cd ../doctools
pip install -e . --upgrade
```

### Install the web compiler

If you care about the web scripts (`js modules`) and style sheets (`sass`),
install `npm` first, if not, just skip this section.

> **_NOTE:_** If the ``npm`` provided by your package manager is too old and
> updating with `npm install npm -g` fails, consider installing with
> [NodeSource](https://github.com/nodesource/distributions).

At the **doctools** repository root, install the `npm` dependencies locally:
```
npm install rollup sass \
    @rollup/plugin-terser \
    @rollup/plugin-alias \
    --save-dev
```

### Launch the servers

In two terminals, launch `adoc serve` to watch the doc:

```
cd docs
adoc serve
```

Then, in the second, the source code watcher:

```
python3 dev_server.py
```

This way, changes to `./scripts` and `./style` are re-evaluated.