# TOEFL Study App

Practice for the TOEFL in two forms:

- **Public site** (reading only): https://shutouyusei.github.io/english_reading/
- **Local app** for macOS and Linux: reading, listening and writing, with a dashboard
  that analyses your results

> ⚠️ All passages, questions and explanations are AI-generated and not reviewed by an
> expert. Unofficial material, not affiliated with ETS or TOEFL.

## What it does

- **Reading**: solve a passage in the real test layout, then study it. Click any word for
  an English note (etymology, definition, role in the passage) and add it to Anki
- **Writing**: email and academic discussion tasks, graded by Claude through the `claude`
  CLI of Claude Code (no API key)
- **Listening**: sets can be opened and their scripts studied. **Audio does not work yet**
- **Dashboard**: sets done and average score per section, where you lose points by
  question type, a set to do next, and written advice from Claude on request
- **Speaking**: not built yet

## Run the local app

```bash
bash app-shell/build.sh
TOEFL_REPO_ROOT="$(pwd)" app-shell/target/release/app_shell
```

- **macOS**: `sh app-shell/install-macos.sh` adds `TOEFL Study.app` to `/Applications`.
  It starts the binary built here, so keep this folder where it is
- **Linux** (Ubuntu 24.04), install these first:
  `sudo apt install -y pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libdbus-1-dev libxdo-dev`
- **Grading and advice** need Claude Code installed and logged in. If `claude` is not on
  PATH, set `TOEFL_CLAUDE_BIN` to its full path
- **Your records** are appended to `.jsonl` files in `~/Documents/TOEFLReading/` (macOS)
  or `~/.local/share/toefl-reading/` (Linux)

## Run the public site locally

```bash
python3 -m http.server 8000 -d docs    # then open http://localhost:8000/
```

To add Anki cards from the public site, allow `https://shutouyusei.github.io` in
AnkiConnect's `webCorsOriginList`
([setup guide](https://shutouyusei.github.io/english_reading/guide.html#anki)).

## Add questions

Run one of these in Claude Code. The app picks up new files without a rebuild.

| Command | Adds to |
|---|---|
| `/new-passage` | `docs/data/reading/` |
| `/new-listening` | `docs/data/listening/` |
| `/new-writing` | `docs/data/writing/` |

## Tests

```bash
python3 -m unittest discover -s tests/python   # content scripts
node --test "tests/js/**/*.test.js"            # screens
(cd core && cargo test)                        # Rust core
(cd app-shell && cargo test)                   # Rust app shell
```

## Contributing

Improvements are welcome as pull requests to this repository.

## Licence

[MIT](LICENSE). The common-words list in `scripts/common_words.txt` comes from
[google-10000-english](https://github.com/first20hours/google-10000-english).
