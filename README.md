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

Leave out `repo` to show a named upcoming project with a “Coming soon” status. An empty list displays
a single release message. Add a project when you have a title and description to share.

Licensed under the MIT license (see `LICENSE`).
