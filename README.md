# Rubin IT on GitHub

The project showcase for Rubin IT Computers and Telecom, published with GitHub Pages at
https://rubinitcomptelecom.github.io/

## Adding a project

The grid is drawn from `projects.json`. To add a square, add one entry:

```json
{
  "name": "repo-name",
  "title": "Shown title",
  "blurb": "One or two sentences on what it does.",
  "tags": ["PowerShell", "Windows"],
  "icon": "tool",
  "repo": "https://github.com/RubinITCompTelecom/repo-name"
}
```

`icon` is one of `usb`, `mail`, `broom`, `globe`, `clock`, `pulse`, `tool`. Only `https://github.com/...` links
are accepted for `repo`.

The site is plain HTML, CSS and JavaScript with no build step. Colours follow rubinit.net: navy `#352D59` and
orange `#E88829`.

Each square with a `repo` opens its own page, `project.html?p=<name>`, with the download, the
latest release notes, and the README (screenshots and instructions). Add `"releases": "owner/repo"` to show
the latest GitHub release there and a Download button on the square.

Leave out `repo` to show a placeholder square ("Coming soon", no link). Right now every square is a
placeholder: replace one with a real entry once that project's public repo exists.

Licensed under the MIT license (see `LICENSE`).
