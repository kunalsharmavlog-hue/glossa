<p align="center"><img src="docs/assets/icon-128.png" width="72" alt="Glossa logo"></p>

# Glossa

**Learn the words you hear.** Glossa is a free Chrome extension that reads the English subtitles while you watch Netflix.

**Website:** https://kunalsharmavlog-hue.github.io/glossa/

- **Pause & Pick.** Pause the movie and the subtitle turns into text you can select. Click a word, or drag across a phrase or the whole line, to see its meaning in English, Hindi and Hinglish. 🔊 plays the pronunciation, and ★ saves it to the movie's PDF.
- **Automatic vocabulary PDF.** When the movie ends, a PDF of every hard word downloads by itself. Each word has a short meaning, Hindi, Hinglish, similar words and the line it was spoken in, with a timestamp. Your picks come first.
- **Your level.** Collect all hard words, medium and hard words, or only the hardest.
- **Private.** No account and no server. Subtitles stay in your browser's storage. Only the words being looked up are sent to free services: [Free Dictionary API](https://dictionaryapi.dev), [Wiktionary](https://en.wiktionary.org), [MyMemory](https://mymemory.translated.net) and [Datamuse](https://www.datamuse.com/api/).

## Install

1. Download [`glossa.zip`](https://github.com/kunalsharmavlog-hue/glossa/releases/latest/download/glossa.zip) and unzip it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped `glossa` folder.

Then play anything on Netflix with English subtitles available. The icon shows a green **REC** badge while it is collecting.

## Files

| File | What it does |
| --- | --- |
| `content.js` | Records each subtitle line while the movie plays |
| `learn.js` | Pause & Pick: the selectable subtitle and the meaning card |
| `page-bridge.js` | Reads the title and switches on English subtitles |
| `background.js` | Looks up meanings and builds the PDF |
| `vocab.js` | Picks the hard words out of the subtitles |
| `pdf.js` | A small PDF writer with no dependencies |
| `hinglish.js` | Turns Hindi script into Hinglish |
| `icons/` | Extension icons |
| `docs/` | The website, served by GitHub Pages |

## Disclaimer

Glossa is an independent project. It is not affiliated with, endorsed by or sponsored by Netflix. Netflix is a trademark of Netflix, Inc.

## License

[MIT](LICENSE)
