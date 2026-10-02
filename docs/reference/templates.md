# Template files

A template is one `.html` file with YAML front-matter, an HTML body and scoped CSS. Put it in
`<deck>/templates/<name>.html` or `~/.config/deckforge/templates/<name>.html`. You can also create it with the editor's
**Templates** button. The built-in templates are in
[`templates/`](https://github.com/lrivallain/deckforge/tree/master/templates).

```html
---
name: team-grid                 # must match the file name
label: Team grid
description: Up to three cards under a headline.
category: content               # essentials | structure | diagram | content | media (template picker groups)
order: 10                       # optional sort order in the picker
class: map-slide                # optional extra classes on the <section>
slots:
  eyebrow: { type: text, max: 40, sample: "Section / topic" }
  title:   { type: richtext, max: 60, required: true, sample: 'A clear <span class="blue">headline</span>' }
  cards:
    type: cards
    max: 3                      # characters for text, items for list/cards (soft limit)
    fields:
      icon:  { type: icon }
      title: { type: text, max: 24 }
      focus: { type: boolean }
    sample:
      - { icon: users, title: First }
---
<header class="header reveal">
  <div><p class="eyebrow">{{eyebrow}}</p><h1 id="{{slide.titleId}}">{{title}}</h1></div>
</header>
<div class="grid">
  {{#each cards}}<article class="card{{#if focus}} focus{{/if}} reveal">{{icon}}<h2>{{title}}</h2></article>{{/each}}
</div>
{{> foot}}

<style scoped>
.grid { flex: 1; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--df-space-grid); }
:scope .header { flex: 0 0 9cqw; }   /* :scope = this template's slide */
</style>
```

::: v-pre

## Slot types

| Type | Value | Notes |
|---|---|---|
| `text` | string | HTML-escaped. Newlines become `<br>` |
| `richtext` | string | Sanitized inline HTML: `b strong i em u s small sub sup code kbd br span a abbr`. Allowed classes: `old muted primary accent blue amber ok mono nowrap`. Links only allow `http(s)`, `mailto`, `#` and relative URLs |
| `list` | string[] | Use `of: text \| richtext`. `maxLength` limits each item |
| `cards` | object[] | `fields` declares the slot type of each item field |
| `icon` | icon name | One of the built-in outline icons, such as `pen review book user users shield lock cloud server database code gear chart target flag idea rocket link search clock calendar mail chat globe layers box bolt check alert arrow star heart home file folder eye sparkles puzzle flow agent network money building` |
| `link` | `{label, href}` | Rendered as a safe external link |
| `boolean` | true/false | Use it in `{{#if}}` blocks |
| `image` | `{src, alt, fit, focus}` | `src` is `assets/<file>` or `https://…`; `alt` is required (warned when empty); `fit: cover\|contain`; `focus: "x% y%"` (kept visible when cropping). Rendered as `<img loading="lazy" decoding="async">`; empty renders nothing, so wrap optional ones in `{{#if}}`. The base kit's `.media` class gives a framed box the image fills |


## Syntax

- `{{slot}}` outputs a value. Text is escaped and rich text is sanitized. Inside an attribute, the value becomes plain text.
- `{{#each slot}}…{{else}}…{{/each}}` loops over a list. Inside the loop, use `{{this}}`, `{{field}}`, `{{@index}}`, `{{@number}}` (01, 02…), `{{@first}}` and `{{@last}}`.
- `{{#if slot}}…{{else}}…{{/if}}` and `{{#unless slot}}…{{/unless}}` render conditionally.
- `{{slide.number}} {{slide.total}} {{slide.titleId}} {{slide.footer}}` and `{{deck.title}} {{deck.author}} {{deck.date}}` output deck metadata.
- `{{> foot}}` renders the standard footer. `{{! comment }}` is a comment.
- `<style scoped>` scopes every selector to `.df-t-<name>`.
- Add `class="reveal"` for staged entrances. The viewer staggers delays in reading order unless you set `style="--delay:.3s"`.


## Base kit

The viewer CSS provides a base kit with the classes `header eyebrow subtitle outcome foot pill card
icon arrow`, `h1 .old`, `.blue/.primary` and `.amber/.accent`.

:::

## Checks

`deckforge build` and the inspector warn about empty required slots and values over a `max` limit.
The template editor also flags unknown slots, and it measures the sample slide at 1280×720 to find content that overflows.
