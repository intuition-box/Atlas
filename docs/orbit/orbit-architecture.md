# Orbit Architecture

The orbit visualization renders community members as dots orbiting on elliptical rings around a center avatar. This document explains how the code is structured and how the pieces fit together.

## Overview

There are two ways to see an orbit:

1. **Homepage** (`scene.tsx`) — a monolithic component that handles both the universe view (all communities as bubbles) and the orbit view (zooming into one community). Everything lives in one ~1900-line file.

2. **Standalone orbit page** (`/c/[handle]/orbit`) — uses the modular orbit components described below. No universe, no zoom transitions. Just the orbit.

The standalone components were extracted from `scene.tsx`'s orbit mode, behavior-for-behavior. They share constants, types, and UI components but are otherwise fully independent. Deleting `scene.tsx` would not break any orbit page.

## The Three Pieces

```
view.tsx (manager)
  |-- simulation.ts (physics)  -- "where should dots be?"
  |-- canvas.tsx (painter)     -- "draw the dots there"
```

### :art: `canvas.tsx` -- "The Painter"

> *"I draw pictures on the screen"*

- Draws the rings, the center avatar, the member dots
- Detects when your mouse hovers over or clicks things
- Handles zoom (scroll wheel) and panning (drag empty space)
- Doesn't know anything about physics or tooltips -- it just paints and reports what the mouse is doing

The canvas runs a continuous `requestAnimationFrame` loop. It reads node positions directly from the simulation's mutable `x`/`y` fields each frame. Static geometry (rings) is cached in an offscreen canvas; the center avatar and member nodes are drawn every frame so hover borders update instantly.

### :gear: `simulation.ts` -- "The Physics Engine"

> *"I move the dots around"*

- Runs the D3 force simulation that positions nodes on ellipses
- Handles the rotation (rings slowly spinning)
- Handles pause/resume (pause when mouse enters, resume when it leaves)
- Handles drag physics (when you grab a dot and move it)
- Doesn't draw anything -- it just updates `x`, `y` positions

The simulation uses two separate animation sources:

1. **D3's internal timer** -- runs the force simulation (orbit pull + collision avoidance)
2. **A rotation rAF loop** -- advances ring rotation in t-space and re-warms the simulation each tick so nodes follow their new targets

When paused (mouse inside the container), the rotation loop stops and the simulation cools via `alphaDecay`. When unpaused, both restart.

### :jigsaw: `view.tsx` -- "The Manager"

> *"I connect everything together and handle the UI"*

- Creates the simulation and passes its nodes to the canvas
- Listens to canvas events (hover, click) and shows tooltips/popovers
- Plays sounds
- Controls the cursor (`pointer` vs `grab`)
- Manages pause/resume based on mouse enter/leave and popover state

This is the only component that knows about React UI (tooltips, popovers, sounds). The canvas and simulation are pure rendering and physics -- they have no opinion about what happens when a user hovers or clicks.

## Shared Code

These files are used by both `scene.tsx` and the standalone orbit components:

| File | Purpose |
|------|---------|
| `constants.ts` | Ring radii, rotation speeds, simulation forces, node sizes, colors |
| `types.ts` | `OrbitMember`, `SimulatedNode`, `OrbitLevel`, `OrbitViewProps` |
| `ellipse-arc-distribution.ts` | Math for evenly distributing nodes along ellipse perimeters |
| `node-popover.tsx` | Tooltip and popover UI for member nodes and the center avatar |

## Data Flow

```
API (/api/community/get)
  |
  v
page.tsx -- fetches data, maps to OrbitMember[], passes to OrbitView
  |
  v
view.tsx -- creates simulation, wires up events
  |
  |-- simulation.ts
  |     * receives members + center coords
  |     * creates D3 force simulation
  |     * outputs: nodes[] with live x/y positions
  |     * exposes: setPaused, updateNodePosition, releaseNode
  |
  |-- canvas.tsx
  |     * receives: nodes[], center logo, size
  |     * draws every frame (reads node.x/y directly)
  |     * fires callbacks: onNodeHover, onNodeClick, onCenterHover, onCenterClick, onDragStart
  |
  v
view.tsx -- receives callbacks, shows tooltips/popovers, plays sounds
```

## Key Behaviors (matched from scene.tsx)

| Behavior | Where |
|----------|-------|
| Expansion animation (nodes fly out from center) | `simulation.ts` -- `startFromCenter` param |
| Ring rotation | `simulation.ts` -- separate rAF loop advancing t-space rotation |
| Pause on mouse enter | `view.tsx` -- `onMouseEnter` calls `sim.setPaused(true)` |
| Resume on mouse leave | `view.tsx` -- `onMouseLeave` calls `sim.setPaused(false)` (only if no popover open) |
| Hover sound | `view.tsx` -- `sounds.play("hover")` on node/center hover |
| Drum sound on start | `view.tsx` -- `sounds.play("drum")` when orbit first has nodes |
| Center avatar border glow | `canvas.tsx` -- white/1.0 + 3px when hovered, white/0.3 + 2px normal |
| Member node border glow | `canvas.tsx` -- white/1.0 + 3px when hovered, white/0.5 + 1.5px normal |
| Node drag + snap back | `simulation.ts` -- `updateNodePosition` (sets fx/fy + warms sim), `releaseNode` (converts to baseT) |
| Cursor | `view.tsx` -- `pointer` when hovering node/center, `grab` otherwise |
| HiDPI rendering | `canvas.tsx` -- DPR clamped to [1, 2], canvas sized at physical pixels |

## If You Delete scene.tsx

The standalone orbit pages will keep working. The only things you lose:

- The homepage universe view (all communities as floating bubbles)
- The zoom-in/zoom-out transition between universe and orbit
- The "back" button to return from orbit to universe

Everything in `src/components/orbit/` is self-contained and imports nothing from `scene.tsx`.
