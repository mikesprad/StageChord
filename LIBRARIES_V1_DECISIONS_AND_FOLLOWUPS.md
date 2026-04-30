# StageChord Libraries V1 Decisions and Follow-ups

Date: 2026-04-30

## Confirmed V1 Decisions
- A song belongs to one library only.
- Libraries represent separate contexts (examples: Church, Funk Band), not per-band set curation.
- Sets are library-scoped.
- Default library exists from first run and is used for migration of existing songs/sets.
- If a set import includes songs not in the current library, those songs are added to the current library.
- Import Set remains compatible with existing format; imported set and songs go into current library.
- Import Bundle: imports songs into current library (menu: Import Bundle).
- Export Bundle: exports current library only (menu: Export Bundle).
- Switching libraries must prompt user to save current set first.
- After switching libraries, restore the previously used set for that library, or show blank if none.
- Contact link should move from the main menu into the Help & Songs page.
- Switch Libraries should use a dropdown if compatible on old devices.

## V1 UX/Compatibility Guidelines
- Prefer native HTML select/dropdown controls for broad compatibility.
- Ensure both main menu and iOS fallback menu paths expose the new library actions.
- Keep import/export wording consistent in UI and help text: "bundle" for file package, "library" for in-app container.

## Deferred / Later (Track for Future Chat)
- Library rename UI: implemented in V1 (pencil icon in Manage Libraries).
- Optional export of all libraries in one file.
- Copy or move songs between libraries in bulk.
- Better conflict handling UX for duplicate song names across libraries.
- Library metadata (color, icon, sort order).

## Implementation Notes
- IndexedDB schema update required: add libraries store, add libraryId on songs and setlists, migrate legacy rows to Default.
- Session restore should include active library + last active set per library.
- Delete library flow should move songs and sets to Default (Default cannot be deleted).
