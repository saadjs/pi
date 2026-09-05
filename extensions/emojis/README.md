# @saadjs/pi-emojis

Emoji shortcode autocomplete for pi.

## Usage

Type `:` followed by at least two characters to get suggestions from the native autocomplete:

```text
Please fix this :thumbs
```

Selecting `thumbsup` inserts `👍`. Complete shortcodes such as `:tada:` are converted to `🎉` on submit, so they also work in print and RPC modes.

Names are GitHub shortcodes (`tada`, `+1`, `thumbsup`) plus Unicode slugs (`party_popper`, `thumbs_up`), sourced from `gemoji` and `unicode-emoji-json`. Matching is prefix-based and case-insensitive. Skin-tone variants are not supported.

## Install

```bash
pi install npm:@saadjs/pi-emojis
```
