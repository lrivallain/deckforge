# Security policy

## Supported versions

Only the latest release and `master` receive security fixes.

## Report a vulnerability

**Don't open a public issue.** Report it privately with
[GitHub private vulnerability reporting](https://github.com/lrivallain/deckforge/security/advisories/new).

Include the affected version or commit, the steps to reproduce, and the impact you expect.
You should get an answer within a week. After a fix is released, you'll be credited in the advisory unless you ask otherwise.

## Scope

These parts are especially in scope:

- the local editor server (`deckforge edit` / `serve`): token and cookie handling, Host and Origin checks, path handling, uploads;
- HTML output: escaping of slot text, the rich-text allow-list, theme value validation, SVG upload filtering;
- the Copilot assistant's tool boundary: it must not reach files, the shell or the network.

The design is described in the [security model](https://ludovic.rivallain.fr/deckforge/reference/security).
