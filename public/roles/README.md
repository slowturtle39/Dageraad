# Dropping in the real card art

The emblems in the app right now are **placeholders drawn for this project**.
They are deliberately not the printed game's artwork — that belongs to its
publisher. §13 of the concept doc assumed you'd crop the rulebook icons
yourself for a personal, non-commercial app; this folder is where they go.

## How

1. Crop each role's icon square-ish, transparent background.
2. Save it here as `<roleId>.png` — the id, not the Dutch name:

   ```
   weerwolf  alphawolf  mystiekewolf  droomwolf  volgeling
   schildwacht  ziener  leerlingziener  onderzoeker  onrustoker
   dubbelganger  heks  rechter  dorpsgek  medium
   schoneslaapster  slapeloze  dronkaard  vrijmetselaar
   bodyguard  jager  dorpeling  looier
   ```

3. Register the ones you've added, in `src/main.ts`:

   ```ts
   registerRoleImages(['heks', 'medium', 'dorpsgek']);
   ```

That's it. Registered roles use your image; everything else keeps its
placeholder, so you can replace the set a few at a time rather than all at once.

## Why registration is explicit rather than automatic

The app could just try `/roles/heks.png` and see what happens — but a missing
file then shows as a broken-image icon on somebody's card, mid-game. A
placeholder emblem is a much better failure than that, so the app only reaches
for an image when told the file exists.

## Sizing

Roughly 128×128 or larger, square. They render at 22px on a phone card and 38px
on the tablet, so detail below about 3px of stroke will disappear — the printed
icons are usually busier than they need to be at this size and crop well.

## If you'd rather draw new ones

Match the placeholders: single-weight line art on a 24×24 grid, `currentColor`
only, no fills. That is what lets one file serve both the bone-coloured
revealed card (dark ink) and a dashed suspicion guess (dim gold) without
needing a second asset.
