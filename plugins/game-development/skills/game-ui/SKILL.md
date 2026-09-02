---
name: game-ui
description: Design, implement, and test game HUDs, menus, overlays, inventories, input prompts, accessibility, localization, and responsive layouts without obscuring or fighting the playfield.
---

# Game UI

## Establish the interaction model

Identify the genre, camera, primary player verbs, input devices, target platforms, safe areas, localization scope, accessibility requirements, and which information must remain visible during play.

## Design rules

- Protect the center of the playfield and aiming, movement, or puzzle-critical regions.
- Give critical state clear hierarchy; move secondary detail into contextual or dismissible surfaces.
- Keep visual language consistent with the game rather than defaulting to application dashboards.
- Make focus ownership explicit when menus, dialogs, inventories, chat, or text input open.
- Pause or gate gameplay and camera input when an overlay requires exclusive interaction.
- Support keyboard, pointer, controller, and touch navigation that matches the target platform.
- Preserve safe areas, readable text scaling, localization expansion, contrast, and reduced motion.
- Avoid per-frame UI rebuilding when event-driven updates are sufficient.

## Implementation

Use the chosen engine's established UI system and project patterns. Keep UI state separate from simulation truth, derive presentation from stable game state, and keep screen transitions reversible. Make loading, empty, disabled, error, disconnected, and save-in-progress states visible.

## Verification

1. Exercise the HUD during active gameplay rather than only in an isolated preview.
2. Navigate every changed surface with each supported input family.
3. Verify focus restoration and gameplay input suppression around overlays.
4. Test narrow, wide, high-density, and safe-area-constrained layouts in scope.
5. Capture screenshots with representative content, long labels, warnings, and low-resource states.
6. Check frame time and allocation behavior while rapidly changing HUD state.

## Completion criteria

Report the UI states exercised, input devices, resolutions or safe areas, accessibility checks, screenshots, and any platform-native behavior that remains unverified.
