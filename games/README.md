# 23 Studios — Games Catalog

Generated Playdate games shipped through the 23 Studios bible-to-Playdate pipeline.

## Layout

```
games/
├── <platform>/                    # playdate (canonical target)
│   ├── <genre>/                   # phreaker_noir, cyberpunk_horror, etc
│   │   └── <title>/               # snake_case game id
│   │       ├── README.md          # game spec + credits + sideload note
│   │       ├── BIBLE.md           # full story bible
│   │       └── releases/
│   │           └── <tag>/
│   │               ├── <title>-<tag>.pdx.zip
│   │               ├── manifest.json   # sha256 + file count + cost
│   │               └── CHANGELOG.md
```

## Index

| Game | Platform | Genre | Latest |
|---|---|---|---|
| [hakcd](playdate/phreaker_noir/hakcd/) | Playdate | phreaker_noir | v0.0.1-from-bible |

New games ship here as the pipeline produces them. Each release directory is
self-contained — the `.pdx.zip` is the sideloadable artifact, `manifest.json`
is the receipt, `CHANGELOG.md` is the build log.
