# FIRST branding

Moved verbatim from `CLAUDE.md` (Conventions) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

### FIRST branding

The app is a FIRST LEGO League Challenge tool and reads as one. The rules
below come from three documents that were downloaded and read, not
remembered: the FIRST Branding & Design Guidelines, the FIRST LEGO League
Branding & Lockup Guidelines, and the Policy on the Use of FIRST Trademarks
and Copyrighted Materials. They live in `local-assets/brand/` (gitignored;
they are FIRST's documents), and `src/lib/brand/rules.ts` quotes the clause
behind every rule with its page number.

- **THE MARKS ARE TRACKED, AND THEY ARE THE ONLY OFFICIAL ARTWORK THAT IS.**
  `static/brand/` holds nine files from the official downloads, byte for
  byte. A currently registered FIRST team may use the FIRST and joint
  FIRST/LEGO logos for its own team activities without permission or
  disclaimer (IP policy II.1), on materials including its website, "as long
  as team identification (team name/number) appears in conjunction with the
  logo(s)" (Branding & Design Guidelines p32) -- which is why the footer
  names the club and its teams. This permission covers the LOGOS. It does not
  cover season artwork, mat graphics or mission models, which stay out.
- **NOTHING RENDERS A MARK EXCEPT `BrandLogo.svelte`, AND IT ENFORCES RATHER
  THAN DOCUMENTS.** Its only geometry prop is `height`; there is no width,
  rotation, crop, colour, radius, filter or background prop and no
  `class`/`style` passthrough. Below a mark's documented minimum size it
  refuses. A supporting mark refuses unless a full official logo is on the
  same surface. The icon alone and the wordmark alone refuse ALWAYS, because
  FIRST supplies no such file and making one means cropping. An ancestor
  `filter`, `opacity`, `mix-blend-mode` or rotation is DETECTED after mount
  and the mark withdrawn, because CSS cannot defend a subtree from those.
  Adding a prop that lets a caller change how a mark looks is the one change
  this component must never accept.
- **THE GROUND SWAPS THE ASSET; IT NEVER STYLES THE MARK.** `BrandLogo`
  renders BOTH supplied files and the ground's own tokens display exactly one,
  so the right mark is right in the first painted frame rather than one
  hydration later. There is no `variant` prop: with two grounds a caller cannot
  know which one its mark will land on. Where the official download supplies no
  reverse file (the FLL horizontal, vertical-icon and vertical lockups) the
  full-colour mark gets a WHITE PLATE -- square, no border, no radius, no
  shadow, extending past the full clear space, which is the background that
  artwork is specified for, not a containing shape. Never a filter, an invert,
  a blend or a recolouring, and never a prop that could ask for one. The
  accessible name is on the wrapper, not on an image, because a `display:none`
  image's alt text is announced by nothing.
- **EVERY SURFACE IS A `BrandSurface`, MOUNTED AT THE ROOT LAYOUT.** It
  carries the verbatim trademark attribution and two full official logos, so
  a route added next season inherits both without its author knowing the
  rules exist. It is keyed on the pathname: the mark register and the
  first-use register are per SURFACE, and carrying either across a
  client-side navigation would put the ® on the wrong page and let a mark be
  vouched for by a logo the reader can no longer see.
- **THE ATTRIBUTION IS QUOTED, NOT WRITTEN.** `TRADEMARK_ATTRIBUTION` is the
  IP policy's section IV.A joint FIRST/LEGO trademark disclaimer, word for
  word. The other candidates in that section say the marks are "used by
  special permission", which this club has not been granted; do not swap one
  in because it sounds more formal.
- **`FirstName.svelte` IS THE ONLY THING THAT PRINTS THE NAMES.** FIRST all
  capitals and italic, LEGO all capitals and never italic, a superscript ®
  on the first use of each per surface and not after, never plural, never
  possessive. Season names (CANOPY, BIOGLOW) are unregistered per the IP
  policy's Attachment A and take ™, and they are TEXT in the surrounding
  face: setting them differently would create the appearance of a new logo.
- **THE FIRST PALETTE IS THE PROGRAM LAYER, NOT THE APP'S IDENTITY.** The
  published FIRST LEGO League values (`#ED1C24 / #00A651 / #662D91 / #231F20`)
  are used unmodified and colour PROGRAM CHROME only: the lockups, the program
  rail, the thin FIRST-gray rule between a FIRST logo and a division lockup.
  They never colour content and never compete with IDEA green for identity.
  The app's own palette and faces are the IDEA pathway's; see "Visual theme".
  The MARKS are untouched by any of this: they are artwork files, used as
  supplied, and a ground swaps the asset rather than styling the mark.
- **THREE FUNCTIONAL COLOURS ARE DECLARED NON-BRAND, AND THAT LIST DOES NOT
  GROW QUIETLY.** `--success-text`, `--danger-text` and `--warning` exist
  because green (3.19) and red (4.38) cannot clear 4.5:1 as small text and
  "blocked" has no brand equivalent. Darkening a brand colour and still
  calling it the brand colour is the thing the guidelines forbid, so these
  are separate values, never used as brand expression, and never on or near
  a mark. Team accents are in the same category.
- **A TEAM ACCENT NEVER TOUCHES A MARK.** `BrandLogo` resets the accent
  variables on its own wrapper so one cannot be inherited, and the accent
  palette is measured to sit at least 27.9 dE from every official colour.
