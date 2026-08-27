---
description: Binding a comic-book bubble chain to the account's real SMS history
paths:
  - frontend/src/skins/comic-book/PanelBubbles.tsx
  - frontend/src/skins/comic-book/PanelBubbleChain.tsx
  - frontend/src/skins/comic-book/bubbleChain.ts
  - frontend/src/skins/comic-book/phoneInput.ts
  - frontend/src/hooks/useSmsConversations.ts
  - frontend/src/lib/smsConversation.ts
---

# Rule: A comic-book chain bound to real SMS

> **Scope:** the `sms: true` half of a bubble chain. How a chain is *drawn* — templates,
> columns, rows, the window — is `.claude/rules/skin-comic-book.md`, and how one is
> *authored* is `frontend/src/skins/comic-book/editor/README.md`. This file is only
> about what changes once the conversation is somebody's real one.

`sms: true` stops a chain being a drawing. The transcript then comes from the carrier
instead of from `messages`, and Enter in the composer **sends for real** — there is no
safe mode, and the account is billed.

## Which conversation is not stored on the chain

It is whichever number the panel's picker balloon carries: `peerPickerOn` takes the first
`content: 'wheel'` **or** `content: 'dial'` balloon on the panel **that is not itself in a
chain**, because a picker inside a conversation is choosing what to *say*, not who to say
it to. A `dial` contributes the number in its field rather than the row it is parked on,
since that field is the one the reader has been typing into. The
option is read through `toE164` (`phoneInput.ts`), so the same number written three ways
is one thread; an option that is a name resolves to null and binds nothing. The two
halves are separate balloons on purpose — the picker says *who*, the chain says *what* —
which is how the panel reads as a phone rather than as a form.

## The data still obeys the three-layer rule

Nothing in the skin fetches (`.claude/rules/skin-architecture.md`). `App.tsx` owns
`useSmsConversations()` and passes it as `LayoutProps.sms`; `PanelBubbles` calls
`subscribe(peer)` and reads what comes back. The hook polls (`SMS_POLL_MS`) only while
somebody is subscribed and shares one request between subscribers, so a page whose panels
bind nothing costs nothing — which is what lets `App` mount it for every skin.

A chain is drawn by the Layout rather than by a view, which is why this arrives as a
subscription on a Layout prop instead of as a hook result on a view's props: skin chrome
has no view whose props could carry it, and only the skin knows which number the reader
chose on the picker.

A sent message is drawn optimistically and retires when its own row returns from the
server (`mergeMessages`); until then it carries `is-sending`, and a refused send carries
`is-failed`.

## Two things a bound chain must never do

Both are asserted in `src/tests/skins/PanelBubblesSms.test.tsx`.

- **Never fall back to the authored transcript.** A bound chain that resolved no number
  shows an empty conversation. The fallback would put the author's lettering into
  somebody's real thread.
- **Never bind in edit mode.** The editor is the author placing balloons; a panel under
  it must not poll a carrier, and Enter in a composer there must not spend money.
