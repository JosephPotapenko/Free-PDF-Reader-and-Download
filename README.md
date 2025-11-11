# Document Reader — TTS

A free, browser-based text-to-speech (TTS) reader for PDFs and text files. Upload documents or paste text, choose from your system's voices, and listen with real-time word highlighting—no subscriptions, no server uploads, 100% local and private.

## ✨ Features

- **📄 PDF & Text Support** — Upload `.pdf` or `.txt` files, or paste text directly
- **🔊 Natural TTS Voices** — Uses your operating system's free voices via Web Speech API
- **🎯 Word-by-Word Highlighting** — Visual highlight follows spoken words in both text area and rendered PDF
- **⚡ Adjustable Playback** — Change speed (0.25×–5×) and volume on the fly; playback auto-resumes from the same word
- **🎙️ Live Voice Switching** — Change voices mid-read without losing your place
- **🖱️ Click-to-Jump** — Double-click anywhere in text or PDF to start reading from that spot
- **🔒 100% Private** — No data leaves your browser; all processing is local
- **📱 Responsive Design** — Works on desktop, tablet, and mobile

## 🚀 Quick Start

1. **Open `index.html` in your browser** (or [try the live demo](#))
2. **Upload a file** or paste text into the reader box
3. **Choose a voice** from the dropdown (click "More…" to add system voices)
4. **Press Play** — text highlights as it reads; adjust speed/volume anytime

## 🎤 Getting More Voices

This reader uses **free, system-level voices**. To add more:

### Windows 10/11
- [Microsoft TTS Voices List](https://support.microsoft.com/windows/appendix-a-supported-languages-and-voices-4486e345-7730-53da-fcfe-55cc64300f01)
- Settings → Accessibility → Narrator → **Add natural voices**
- Settings → Time & Language → **Language Packs** (includes TTS for many languages)
- **Restart your browser** after installing

### macOS
- System Settings → Accessibility → Spoken Content → **Manage Voices**
- [Available macOS Voices](https://support.apple.com/guide/mac-help/available-voices-for-spoken-content-mh27448/mac)
- Works in Safari, Chrome, Firefox, and Edge

### Linux
- Install [eSpeak NG](https://github.com/espeak-ng/espeak-ng): `sudo apt install espeak-ng` (Debian/Ubuntu)
- [Supported Languages](https://github.com/espeak-ng/espeak-ng/blob/master/docs/languages.md)

### Chrome OS
- Voices are built-in and update automatically with Chrome OS

## 🛠️ Tech Stack

- **PDF.js** — Client-side PDF text extraction and rendering
- **Web Speech API** — Browser-native TTS (no external APIs or costs)
- **Vanilla JavaScript** — No frameworks; fast and lightweight
- **Font Awesome** — Icons

## 📂 Project Structure

```
├── index.html       # Main UI layout
├── style.css        # Responsive styling and modal
├── script.js        # TTS logic, PDF parsing, word highlighting
└── README.md        # This file
```

## 🔧 How It Works

1. **Upload/Paste** → Text is loaded into `currentText`; PDFs are parsed via PDF.js and rendered above the text area
2. **Chunking** → Long text is split into 3000-char chunks for smooth playback
3. **Playback** → SpeechSynthesisUtterance reads each chunk; `onboundary` events track word positions
4. **Highlighting** → Current word is selected in the textarea; matching span in PDF view gets `.pdf-reading` class
5. **Settings Changes** → Cancel current utterance, resume from last boundary with new voice/speed/volume

## 📝 Usage Tips

- **Long documents**: Very long text plays fully—it's chunked internally for smooth reading
- **Jumping**: Double-click anywhere in text or PDF to skip to that position
- **Settings mid-read**: Change voice/speed/volume anytime; playback resumes from the current word
- **Multiple files**: Upload multiple files; the last one loads (future: queue/playlist)

## 🐛 Known Limitations

- **Voice availability**: Depends on your OS/browser; some voices may sound robotic
- **Boundary events**: Word highlighting relies on browser `onboundary` support (varies by browser/voice)
- **PDF rendering**: Simple text-layer extraction; complex layouts may not preserve visual fidelity
- **Browser extensions**: TTS extensions (like "Read Aloud") use separate APIs and won't appear in the voice list

## 🤝 Contributing

Pull requests welcome! Some ideas:
- [ ] Dark mode toggle
- [ ] Save reading position/bookmarks
- [ ] Export to audio file (requires workaround; Web Speech API doesn't support direct recording)
- [ ] Cloud TTS integration (Azure, Google, Amazon) with API key input
- [ ] Multi-file playlist/queue

## 📜 License

MIT License — Free to use, modify, and distribute.

## 💡 Why This Exists

Tired of PDF readers charging for basic read-aloud features and browsers hiding TTS behind obscure menus. Built this to make document listening **free, fast, and accessible** for everyone.

## 🤖 Development

This project was created with the help of AI (GitHub Copilot and other AI tools) to rapidly prototype and implement features. The combination of human creativity and AI assistance enabled quick iteration on UI/UX, TTS integration, and accessibility features.

---

**Have feedback or found a bug?** Open an issue or submit a PR. Enjoy your reading! 📖🎧
