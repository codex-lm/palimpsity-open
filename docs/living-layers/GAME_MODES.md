# Choose how to play

Living Layers now opens a mode selector instead of placing a River Pact advert beside an unnamed classic city. The selected mode remains visible in the top bar; its menu starts a new city only after an explicit replacement confirmation. Returning or pressing Escape preserves the current city and leaves it paused.

- **Sandbox:** 600 EUR, normal construction costs, upkeep, income and progressive unlocks. No deadline or forced victory/defeat screen; resource shortages still affect inhabitants.
- **God mode / Mode créatif:** free construction, transformations and conversions, all buildings available immediately. Phase and age do not prevent upgrades; terrain, quay orientation, occupied tiles, valid conversions and the four-floor limit still apply. Food, water, workers and city services remain simulated. Money is a finite internal anchor; construction money/materials display infinity without introducing infinite numbers into simulation. Free buildings cannot generate demolition income. No forced ending.
- **River Pact:** the existing three-act scenario and its 240-turn deadline, charter choice and drought remain intact.
- **First Neighbourhood:** the earlier timed challenge remains a secondary choice. Its record is separate from free play.

Every confirmed new game constructs a fresh engine; creative permissions and unlocks do not leak into the budgeted modes. English is default, French is selectable without restarting, including inside the startup dialog. The inactive River Pact panel is hidden outside that scenario.

## Validation

185 Node tests pass, including 16 new engine-mode tests, two UI budget/objective tests and one translation regression. Existing attribution checks now assert preservation of the inherited entries rather than incorrectly forbidding any future contribution. Production build and artifact/source comparison pass; all 102 embedded GLBs match their source files, including the prior shoreline fix.

Local browser acceptance on the built artifact:

- English/French selection, keyboard radios and startup Escape guard.
- Creative house built and expanded to two floors for no cost; current city survives cancelling the new-game menu.
- Creative to sandbox reset: 600 EUR, house costs 40 EUR, factories locked, no River Pact panel.
- River Pact begins at turn zero and advances five real turns; First Neighbourhood starts at 0/120.
- At 390 × 844: stacked cards, accessible scrolling and start/cancel controls; document width equals viewport width. Desktop layout at 1280 × 720. No warning/error messages observed.

Kimi K3 implemented the selector module; Nilo integrated it, corrected localization/focus issues, implemented and reviewed the game rules with independent agents, and ran browser acceptance. Prior code, model credits and licenses are preserved.

Hosted publication and hosted playtest results are recorded separately in the PR and the local publication receipt. This change does not merge any source PR or deploy the LOB7 platform. It is a new immutable edition of the existing Living Layers variant; earlier editions remain available.
